# 邮局投递 P1 执行 Plan（订单驱动 + 每月起投批次）

> **For agentic workers:** 按 task 顺序实现，每个 task 先写测试再实现（TDD）。步骤用 `- [ ]` 勾选跟踪。
> **Spec**: `docs/superpowers/specs/2026-07-01-postal-delivery-design.md`（v2）。
> **Goal**: 把邮局读者明细（2024/25/26 全量）导入成 **post_office 订单**；按「起投月」生成/冻结/导出**每月投递批次**；PostDelivery 页展示批次+明细+导出；投递单位结构化为 Partner（有则标注、无则留空）。

**Architecture**：邮局每行 → `Order`(excel_import) + `OrderItem`(publication、coverage 显式起止、delivery=post_office、份数、金额) + `FulfillmentTarget`(收报人、shipping_channel=post_office、新增 `distribution_unit_id`)。复用 `create_imported_order` + `allocate_order_codes` + `external_order_no` 去重。`postal_batch_service` 按 `month(coverage_start)` 把 post_office 明细归批，冻结进 `postal_delivery_batches`/`postal_delivery_rows`。前端 PostDelivery 变批次页 + 导入入口。**不碰中通按刊期管线**（post_office 目标本就被 `order_shipping_sync_service.py:299-301` 跳过）。

**Tech Stack**：FastAPI, SQLAlchemy, Alembic, Pydantic v2, pytest, React, TypeScript, Ant Design, TanStack Query。

**关键复用点（已核实）**：
- 订单创建：`order_service.create_imported_order`(order_service.py:474) + `_build_order_items` + `allocate_order_codes`。
- 导入两阶段：`cbj_order_import_service.preview_import/commit_import`（session 缓存 + 原子提交）为范式；去重键 `Order.external_order_no`。
- 覆盖期：`OrderItemIn.coverage_start_date/coverage_end_date` 已支持显式区间（schemas/order.py:109-110）。
- 渠道枚举：`ShippingChannel.post_office` / `DeliveryMethod.post_office` 已存在。
- 投递单位主数据：`Partner(partner_type=distribution)`。

---

## File Structure

- Create `backend/app/models/postal_delivery.py`：`PostalDeliveryBatch` + `PostalDeliveryRow`。
- Modify `backend/app/models/fulfillment_target.py`：加 `distribution_unit_id` FK→partners（nullable）。
- Modify `backend/app/models/__init__.py`：导出新模型。
- Create `backend/alembic/versions/<hash>_add_postal_delivery.py`：建两表 + 加列 + 预置 7 个集订分送 Partner。
- Create `backend/app/schemas/postal.py`：批次/明细/导入 preview 的 Pydantic 模型。
- Modify `backend/app/schemas/order.py`：`FulfillmentTargetIn` / `FulfillmentTargetOut` 加 `distribution_unit_id`。
- Modify `backend/app/services/order_service.py`：`_build_order_items` 透传 `distribution_unit_id`。
- Create `backend/app/services/postal_order_import_parser.py`：解析邮局读者明细 sheet → `ParsedPostalRow`。
- Create `backend/app/services/postal_import_service.py`：preview/commit（映射→OrderCreate、投递单位匹配 Partner、编号年份前缀、去重）。
- Create `backend/app/services/postal_batch_service.py`：起投月归批 / 冻结 / 重生成 / 标记已发 / 导出。
- Create `backend/app/api/postal.py`：导入 + 批次 REST。
- Modify `backend/app/main.py`：include `postal` router。
- Create `frontend/src/api/postal.ts`：类型 + API。
- Modify `frontend/src/pages/PostDelivery.tsx`：占位 → 批次页 + 导入入口。
- Create tests：`test_postal_order_import.py` / `test_postal_batch_service.py` / `test_postal_api.py`；regression 补进 `test_order_shipping_sync_service.py`。
- Update `docs/technical.md` / `docs/user-guide.md`（实现后）。

---

## Task 1：新表 + 加列 + 迁移 + 预置投递单位

**Files**: Create `models/postal_delivery.py`；Modify `models/fulfillment_target.py`, `models/__init__.py`；Create migration；Read `models/partner.py`, `alembic/versions/d7f9b1c3e5a8_add_products_catalog_table.py`（迁移范式）。

- [ ] **Step 1**：`FulfillmentTarget` 加 `distribution_unit_id = Column(Integer, ForeignKey("partners.id"), nullable=True, index=True)`。
- [ ] **Step 2**：`postal_delivery.py` 建模：
  - `PostalDeliveryBatch`：`id`, `year:int`, `month:int`, `status:Enum(draft/generated/sent)`, `generated_at`, `sent_at`, `row_count`, `notes`, `UniqueConstraint(year,month)`。
  - `PostalDeliveryRow`：`id`, `batch_id FK`, `order_item_id FK nullable`, `fulfillment_target_id FK nullable`, 冻结快照 `snap_name/phone/province/city/district/address/postal_code`, `copies`, `coverage_start_date`, `coverage_end_date`, `source_channel`, `distribution_unit_id FK nullable`, `salesperson`, `notes`。
- [ ] **Step 3**：`models/__init__.py` 导出二者。
- [ ] **Step 4**：迁移：建两表、加列、**预置 7 个 Partner**（partner_type=distribution）：北京/安徽/广东/江苏/山东/湖南/内蒙 集订分送（`INSERT ... ON CONFLICT/存在则跳过`，与既有 Partner 预置同风格）。
- [ ] **Step 5**：`alembic upgrade head` 通过；回滚 `downgrade` 删表删列（Partner 预置数据在 downgrade 里按 name 删）。

---

## Task 2：把 `distribution_unit_id` 透传进订单创建

**Files**: Modify `schemas/order.py`, `services/order_service.py`；Read `create_imported_order`(order_service.py:474) 与 `_build_order_items`。

- [ ] **Step 1（测试先行）**：`test_postal_order_import.py::test_target_carries_distribution_unit` —— 用带 `distribution_unit_id` 的 `OrderCreate` 走 `create_imported_order`，断言落库 target 的 `distribution_unit_id` 正确。
- [ ] **Step 2**：`FulfillmentTargetIn` + `FulfillmentTargetOut` 加 `distribution_unit_id: Optional[int] = None`。
- [ ] **Step 3**：`_build_order_items` 建 `FulfillmentTarget` 时透传 `distribution_unit_id`（默认 None）。
- [ ] **Step 4**：确认既有中通订单创建不受影响（默认 None，回归既有订单测试）。

---

## Task 3：邮局读者明细导入（→ post_office 订单）

**Files**: Create `postal_order_import_parser.py`, `postal_import_service.py`；Read `cbj_order_import_service.py`（preview/commit 范式）、`order_code_service.allocate_order_codes`、`address_service.normalize_address`。

- [ ] **Step 1（测试先行）**：`test_postal_order_import.py`：
  - 解析：一行 → `ParsedPostalRow`（编号/姓名/电话/省市区/详细地址/邮编/年度/产品/起月日/止月日/份数/金额/渠道/投递单位/赠阅关联/备注）。
  - 映射：产品「中国经营报」→`Publication.cbj`、「商学院」→`business_school`；coverage_start=年度+起月日、coverage_end=年度+止月日；`delivery_method=post_office`；target `shipping_channel=post_office`、`quantity=份数`。
  - 投递单位：文本命中 Partner(distribution) → `distribution_unit_id`；**空/未命中 → None（不推断）**。
  - 去重键：`external_order_no = f"{年度}-{编号}"`；已存在 → duplicate。
  - commit：原子创建订单，返回 created/skipped。
- [ ] **Step 2**：`postal_order_import_parser.py`：openpyxl 读「邮局读者明细」sheet；表头识别（含「编号/投递单位/起月日」列签名）；产出 `List[ParsedPostalRow]`。地址过 `normalize_address` 清洗、`snap_*` 存原文。
- [ ] **Step 3**：`postal_import_service.build_postal_preview`：每行 → `OrderCreate`（一条 `OrderItemIn` + 一个 `FulfillmentTargetIn`）；`entry_method` 由 `create_imported_order` 固定 excel_import；`is_historical_archive=True`（历史补录）；coverage **显式取自行**（不走 CBJ 的批次起投月推算）。
- [ ] **Step 4**：`preview_import`/`commit_import`（复用 session 缓存范式 + `allocate_order_codes` 按年分配 order_code + 单次 `db.commit()`）。
- [ ] **Step 5**：**编号唯一性校验**：commit 前对解析结果按 `(年度, 编号)` 去重检测，撞号进报告（不静默覆盖）。
- [ ] **Step 6**：金额/份数一致性告警（金额≈份数×月数×20，仅告警不拦截）。

---

## Task 4：每月起投批次（归批 + 冻结）

**Files**: Create `postal_batch_service.py`；Read `models/order_item.py`（coverage）、`models/postal_delivery.py`。

- [ ] **Step 1（测试先行）**：`test_postal_batch_service.py`：
  - 归批：`generate_batch(year, month)` 收集 `delivery=post_office` 且 `month(coverage_start_date)==(year,month)` 的**在效**明细（order active、item active）→ 建 batch + 冻结 rows；断言只含该起投月。
  - 冻结不变性：生成后改订单地址/份数，重查已 `sent` 批次的 row 快照**不变**。
  - 幂等：对 `draft`/`generated` 批次重生成 = 覆盖重建；对 `sent` 批次重生成 → 拒绝（HTTP 409）。
  - 标记已发：`mark_sent(batch_id)` → status=sent + sent_at。
- [ ] **Step 2**：`generate_batch`：查询 → 冻结快照（snap_* / copies / coverage / distribution_unit_id / source_channel / salesperson，溯源存 order_item_id + fulfillment_target_id）→ 落 `postal_delivery_rows`，更新 `row_count`、status=generated。
- [ ] **Step 3**：`list_batches` / `get_batch_rows` / `mark_sent` / `regenerate`（受 sent 保护）。
- [ ] **Step 4**：导出：`export_batch(batch_id)` → Excel/CSV（复用导出风格），列同 rows 快照。

---

## Task 5：API + 路由

**Files**: Create `api/postal.py`, `schemas/postal.py`；Modify `main.py`；Create `test_postal_api.py`。

- [ ] **Step 1（测试先行）**：`test_postal_api.py`：导入 preview/commit、批次 CRUD、导出、mark-sent 的 HTTP 连通。
- [ ] **Step 2**：端点：
  - `POST /api/postal/import/preview`、`POST /api/postal/import/commit`（上传邮局 sheet；写操作 require_admin）。
  - `GET /api/postal/batches`（按 year/month 列）、`GET /api/postal/batches/{id}`（rows）。
  - `POST /api/postal/batches/generate`（body: year, month）、`POST /api/postal/batches/{id}/mark-sent`、`GET /api/postal/batches/{id}/export`。
- [ ] **Step 3**：`main.py` include `postal.router`（auth 注入同既有）。

---

## Task 6：前端 PostDelivery 页 + 导入

**Files**: Modify `frontend/src/pages/PostDelivery.tsx`；Create `frontend/src/api/postal.ts`；Read `ShippingPreview.tsx`（统计卡+导出）、`OrderImport.tsx`（上传+预览）。

- [ ] **Step 1**：`api/postal.ts`：批次/明细/导入的类型 + API 函数（TanStack Query）。
- [ ] **Step 2**：PostDelivery：**批次页** —— 左侧按 年-月 列批次（状态/行数/已发时间），右侧批次明细表（收报人/地址/份数/起止/投递单位/渠道）+ 导出按钮 + 「生成当月批次」「标记已发」。
- [ ] **Step 3**：**导入入口**：复用 OrderImport 的上传+预览+提交交互（识别邮局 sheet → preview 计数/告警 → commit）。
- [ ] **Step 4**：底层订单在既有订单列表/客户管理自然可见（无需改动，验证即可）。

---

## Task 7：回归 + 文档

**Files**: Modify `test_order_shipping_sync_service.py`；Update `docs/technical.md`, `docs/user-guide.md`。

- [ ] **Step 1**：**回归测试**：建一张 delivery=post_office 订单，跑中通排发 → 断言**不产生任何 shipping_details**（确认 zto gate 生效、邮局与中通解耦）。
- [ ] **Step 2**：回归：post_office 订单**出现在** `customer_service` 客户聚合与订单列表（"订单展示"成立）。
- [ ] **Step 3**：文档：技术文档补邮局模块数据流；用户手册补「导入邮局明细 / 生成每月批次 / 导出交邮局」操作。

---

## 验收标准（P1 Done）

- [ ] 邮局读者明细可导入为 post_office 订单，重导幂等（编号年份前缀去重）。
- [ ] 可按 年-月 生成/查看/导出**每月起投批次**；已发批次冻结不变。
- [ ] 投递单位有原文则挂 Partner、无则留空（**不设填充率门槛、不推断**）。
- [ ] 邮局订单**不生成中通发货明细**，但出现在订单列表/客户管理。
- [ ] 后端测试全绿；PostDelivery 页可用。

## 明确不在 P1（后续期）

- 投诉工单（P2）/ 改地址+回访（P3）/ 收款发票对接财务（P4）。
- 续订/流失/读者 360 主档（暂用客户管理只读聚合顶）。
- 投递单位自动兜底、合并/拆分复核 UI、批次自动生成排程。
