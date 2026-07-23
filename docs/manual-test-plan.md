# 发行系统 · 人工测试清单

> 适用基线：`main`（已含 PR #80；快照核对时点：2026-07-23）
> 说明：本清单只列「自动化测不到、必须人工执行」的用例。凡标注「疑似bug」者，请按用例内「预期」判定当前行为是否可接受，并把结论回填给开发。
> 覆盖 8 大模块：3.1–3.4 首轮多智能体产出并对抗核验；**3.5–3.8 见文末「三（续）」**（补跑逐文件读码产出，附 Part B 优先速览）。
> PR #80 专项 P0 已完成：关联回访不重复计数、投诉时间线展示、回访编辑同步、删除后清除时间线及回访筛选计数均已验证。

---

## 一、建议测试顺序（先测这些 P0）

按「影响钱 / 影响发货 / 影响数据正确性」的顺序，先跑完下列全部 P0，再按模块推进 P1/P2。带 ★ 者为跨模块端到端，建议放在对应单点用例都过之后压轴跑。

| 顺序 | 用例 | 一句话风险 |
|---|---|---|
| P0-1 | 草稿单直接 API 退款（订单） | 未生效草稿单凭空产生退款流水 |
| P0-2 | 草稿单直接 API 取消（订单） | 草稿单凭空产生收款+退款+cancelled 台账 |
| P0-3 | 草稿单直接 API 记收款（订单） | 收款挂在无单号草稿单、并计入欠款汇总 |
| P0-4 | 套餐实付<固定项 → 商学院腿负金额入库（商品） | 负金额明细污染金额/发行统计 |
| P0-5 | PUT 编辑商品绕过跨字段校验造非法商品行（商品） | 非法商品被 resolver 匹配时抛异常 |
| P0-6 | 月刊全年从12月跨年 → 应发期数低估为1（覆盖期，bug#3） | expected 严重低估、污染 drift |
| P0-7 | 月刊半年从11月跨年 → 应发期数低估为2（覆盖期，bug#3变体） | 同上，更隐蔽 |
| P0-8 | 对账卡说「一致」但作废后导出面单份数变少（发货对账） | 对账口径 vs 导出口径背离，少发不自知 |
| P0-9 | 报数确认自动复制上期 → order_generated 行溯源丢成 manual、下期双计（发货） | 订单份数被重复计入对账 |
| P0-10 | 单期发货明细 >200 行 → 前端 limit 截断少算（发货对账） | 记录数/渠道数/份数少算 |
| P0-11 | 同名同号不同地址被误判「疑似重复」阻断整单排发 409（发货） | 一个订户两投递点无法排发 |
| ★ | 跨模块端到端剧本 ①②③（见末节） | 完整生命周期回归 |

> 注：内存审计历史清单里的「has_drift 分页」「订单列表日期筛选」两项，在本分支已改好（见第二节判定），复核为主、无需重点攻。

---

## 二、已知历史缺陷 · 人工复核

逐条给出：**当前分支状态** + **如何人工构造场景验证它是不是 bug**。

### 2.1 退款仍发货 —— 状态：present（已被同步层拦住，但草稿单退款是新裂口）
- **代码事实**：`order_shipping_sync_service.py:270` 对 `commercial_status∈{refunded,cancelled}` 的单在排发候选阶段全 skip、apply 不写发货行；退款/取消时也会 orphan 原有行。所以「已退款单再排发」这条主路径**已被拦**（已有自动化 `test_refunded_order_is_not_shipped` 覆盖）。
- **仍需人工复核的裂口**：`refund_order`（`order_service.py:763`）只拦 `status==void`，**不拦 draft**。草稿单能被直接退款（见用例 订单-1）。
- **如何构造验证**：建一张 `status=draft` 手工单 → 先用 API 记一笔收款使 `paid_amount>0` → 直接 `POST /api/orders/{id}/refund {"amount":10}`（越过前端按钮）。若返回 2xx 并生成 `refunded` 事件、把 `commercial_status` 从 NULL 写成 `partial_refund`，即确认为 bug（前端 `canRefundOrder` 要求 `status==='active'`，后端应对齐）。

### 2.2 作废仍发货 —— 状态：present（同步层已拦，草稿单取消是新裂口）
- **代码事实**：作废（void）单同样被 `order_shipping_sync_service.py:270` 全 skip，主路径已拦。
- **仍需人工复核的裂口**：`cancel_order`（`order_service.py:849/851`）只拦 `void` 与已 `cancelled`，**不拦 draft**（见用例 订单-2）。
- **如何构造验证**：`status=draft` 单 + 已记收款 → 直接 `POST /api/orders/{id}/cancel {"reason":"手工测试"}`。若为草稿单新建一笔全额退款、`commercial_status=cancelled`、记 `cancelled` 事件，即确认为 bug。

### 2.3 has_drift 分页 —— 状态：**fixed（复核为主）**
- **代码事实（本分支）**：`list_orders`（`order_service.py:1245-1252`）已明确：`has_drift` 置位时「物化全过滤集 → 内存按 drift 过滤 → 内存分页」，且 `total` 取 **post-drift** 计数，保证每页满 limit 且计数与返回一致。历史审计标的「has_drift 筛选下分页/总数错乱」在本分支已修。
- **如何人工复核**：造 ≥ 2 页量级的订单，部分 has_drift=true。带 `has_drift=true` 翻页，核对：①每页条数满 `limit`（除最后一页）；②返回的 `total` 等于「真有 drift 的单数」而非全表数；③翻到末页不缺行/不重复。若三者成立即确认已修好。

### 2.4 订单列表日期筛选 —— 状态：**fixed/present（复核 + 边界确认）**
- **代码事实（本分支）**：`order_date_start` / `order_date_end` 已接线（`orders.py:92-93` → `order_service.py:1265-1268`），以 `Order.order_date >= start` / `<= end` 下推 SQL。历史审计标的「日期筛选缺失/无效」在本分支已具备。
- **需人工确认的残留点**：①筛选口径是 `order_date`（下单日），非覆盖期、非付款日——确认与页面标签语义一致；②`<= end` 为**含当日**、且按 `date` 比较，若 `order_date` 存了时间分量需确认「选到当天能否筛出当天最晚的单」（off-by-one）。
- **如何构造验证**：造下单日分别为区间左端、右端当天、右端+1 天的三张单，设 `order_date_start/end` 卡边界，核对右端当天入选、右端+1 出局。

### 2.5 月刊 expected 高估 —— 状态：**权威层 fixed；建单预览层仍高估（present）；另发现相反向低估 bug（present）**
本条一分为三，务必分开判定：
- **(a) 权威落库值：fixed**。确认后的 `expected_issues_at_creation` 走 `compute_expected_issues` 的商学院月刊分支（`expected_issues_calculator.py:65`），半年约得 6 期、正确。详情/列表偏差列口径是对的。
- **(b) 建单页预览：present（高估，误导操作员）**。`build_pricing_preview` 无 publication 入参、无商学院分支，`expected_issue_count` 恒按周刊排期统计（`order_pricing_service.py:55`），半年会显示接近 26 期；`OrderEditor.tsx:1322` 的 Alert「预计发货：N 期」直接展示该数字。**构造验证**：OrderEditor 新建商学院·订阅·半年明细 → 看 Alert 的「预计发货 N 期」（≈26）→ 确认订单进详情看该明细 `expected_issues_at_creation`（≈6）→ 二者背离即确认「预览大、落库小」的误导（见用例 订单-5）。
- **(c) 相反向低估：present（新 bug#3）**。刊历 `bs_issues` 只种到 2026 年；`_count_business_school_issues`（`expected_issues_calculator.py:121-133`）的粗估兜底条件是 `count==0 且 issues 为空`。当覆盖期跨到未录年（2027），因 `BsIssue.year.in_([2026,2027])` 命中了 2026 的行 → `issues` 非空 → 跳过按月粗估，未录的 2027 各月贡献 0 → **严重低估**。**构造验证**：见 P0-6 / P0-7（12月起投全年→显示 1，应约 12；11月起投半年→显示 2，应为 5）。

---

## 三、按模块用例

> 紧凑格式：**[优先级] 标题** / 前置 / 步骤 / 预期 / 为何人工。凡「疑似bug」按预期判定后回填结论。

### 3.1 订单管理

---
**[P0] 草稿单通过 API 直接退款（refund_order 只拦 void、未拦非-active）**（疑似bug）
- 前置：新建手工单存草稿（`status=draft`、`order_code=NULL`）；先用用例「草稿单记收款」或直接置 `paid_amount=100`；admin token。
- 步骤：
  1. OrderDetail 打开草稿单，确认**无**「退款」按钮（`canRefundOrder` 要 `active` + isAdmin 门槛——这是掩盖表象）。
  2. 越过前端：`POST /api/orders/{草稿单id}/refund`（admin），body `{"amount":10}`（≤ paid）。
  3. 看响应码、返回体 `commercial_status`/`refunded_amount`。
  4. `GET /api/orders/{id}` 或 `/events`：是否生成 `refunded` 事件、`refunded_amount` 是否累加、`commercial_status` 是否从 NULL 变 `partial_refund`。
- 预期（疑似bug）：`refund_order` 仅 `status==void` 抛 409（`order_service.py:763`），draft 放行 → 建 Refund 行、累加、把无电商态草稿单重算成 `partial_refund`、记 `refunded` 事件，产生「草稿单已退款」诡异台账。正确应对齐前端 `canRefundOrder` 要求 `active`，对 draft 返 409。`amount>paid` 会先命中超退 422，故用小额触发。
- 为何人工：自动化只覆盖 void 被拒 / 超退 / active 各类退款，无 draft 送进 refund 的用例；前端按钮被 status+isAdmin 双隐藏，只有直接打 API 能触发。

---
**[P0] 草稿单通过 API 直接取消（连带建全额退款、挂 cancelled）**（疑似bug）
- 前置：`status=draft` 手工草稿单 + 已记收款（`paid_amount>0`，如 100）；admin token。
- 步骤：
  1. OrderDetail 确认**无**「取消订单」按钮（`canCancelOrder` 要 active + isAdmin）。
  2. `POST /api/orders/{id}/cancel`（admin），body `{"reason":"手工测试"}`。
  3. 看响应码。
  4. GET 该单：`commercial_status`/`refunded_amount`、是否新建 `reason=「订单取消：…」` 的 Refund、是否记 `cancelled` 事件。
- 预期（疑似bug）：`cancel_order` 只判 void/已 cancelled（`order_service.py:849/851`），draft 放行 → 算 `outstanding=paid−refunded=100`、建 100 全额退款、`commercial_status=cancelled`、记 `cancelled` 事件。从未生效的草稿单凭空产生收款+退款+cancelled 电商态。正确应要求 `active`。
- 为何人工：取消自动化只覆盖 active 单与已 cancelled 被拒，无 draft 分支；须直接打 API 并核对新生成台账是否合理。

---
**[P0] 草稿单通过 API 直接记收款（paid_amount 累加到无 order_code 草稿单）**（疑似bug）
- 前置：`status=draft`、`order_code=NULL` 手工草稿单；任意登录 token（该接口只要 `get_current_user`，不需 admin）。
- 步骤：
  1. `POST /api/orders/{id}/payments`，body `{"amount":50,"method":"现金"}`。
  2. 看响应码。
  3. GET 该单：`paid_amount` 是否变 50、是否生成 `payment_recorded` 事件、`payments[]` 是否出现挂在无单号草稿单上的到账。
  4. `GET /api/analytics/outstanding`：该草稿单收款是否被计入汇总。
- 预期（疑似bug）：`record_payment` 只在 void 时 409（`order_service.py:908`），draft 放行 → 建 Payment、累加 50、记事件；`summarize_outstanding` 把它纳入欠款/收款口径。正确应要求 active（至少有 order_code）。此用例同时为上两条提供「先有 paid_amount」前置。
- 为何人工：现有测试只测 confirmed(active) 单；前端不提供草稿单记款入口，只有 API 能触发。

---
**[P1] 按明细退款不带 stop_from_issue：把该明细已发历史期也置 orphaned、从对账消失**（疑似bug/下游对账风险）
- 前置：active 纸刊订阅单，某明细覆盖多期已排发到 ZTO-MF；其中至少一期 `order_generated` 行已 ship-all 标 `shipped_at`（已发历史期）、`sync_status=synced`；未来期也有 synced 行；`paid_amount>0`；admin token。
- 步骤：
  1. 记下该明细「已发历史期」与「未发未来期」各行 `issue_number/shipped_at/sync_status`。
  2. `POST /api/orders/{id}/refund`，body 只带 `{"amount":50,"order_item_id":<明细id>}`（不传 `stop_from_issue`，金额<实付→partial_refund）。
  3. 查该明细全部 `order_generated` 行的 `sync_status`：已发历史期是否也被置 `orphaned`。
  4. `GET /api/orders/shipping-sync/issues/{已发历史期}/reconciliation`：该行是否从「应发/已发」清单消失。
- 预期（疑似bug）：`_orphan_order_generated_details` 带 `order_item_id` 但无 `from_issue` 时，过滤只有 `order_id+source_type+order_item_id+sync_status!=orphaned`，**无 `shipped_at` 保护**（`order_service.py:683-695`，由 `refund_order:805` 调用），把该明细所有非 orphaned 行（含已 shipped 历史期）置 orphaned；`reconcile_issue` 又以 `sync_status!=orphaned` 为应发清单（`order_shipping_batch_service.py:270`）→ 已发历史期静默从对账消失、缺口失真。正确应确认按明细退款是否只停未发/未来期（配合 stop_from_issue）。
- 为何人工：自动化只用单条当期 synced（未 shipped）明细，无「已发历史期」样本，测不出追溯 orphan + 对账消失。

---
**[P1] 商学院（月刊）订阅建单：定价预览「预计发货 N 期」按周刊高估（~26 vs 权威~6）**（数据正确性/跨模块）
- 前置：`publication_schedule` 已录周刊排期；`bs_issues` 商学院月刊刊历已录；建单选 publication=商学院、订阅、半年、ZTO-MF、跨月起始月份。
- 步骤：
  1. OrderEditor 新增明细：商学院 / 订阅 / 半年 / 起始月 2026-01 / ZTO-MF。
  2. 观察套餐价 Alert「预计发货：N 期」（预览 enable 只看是否订阅/续订、不看 publication，故商学院也触发）。
  3. 保存草稿→确认→详情看该明细 `expected_issues_at_creation` 与列表偏差列。
  4. 对比「预览 N 期」与「落库权威值」。
- 预期（riskySpot）：`build_pricing_preview` 无 publication 分支，`expected_issue_count` 恒按周刊统计（`order_pricing_service.py:55`）→半年≈26；`OrderEditor.tsx:1322` 直接展示，误导操作员。权威 `expected_issues_at_creation` 走月刊分支（`expected_issues_calculator.py:65`）≈6，故详情/列表口径对。即「预览大、落库小」不一致。覆盖期本身前端由纯日期运算决定，误导点集中在「期数」。
- 为何人工：`build_pricing_preview` 根本不接收 publication，测不到商学院高估；口径对比是 UI 联动 + 落库值对照，须人工在 OrderEditor 观察并与详情比对。

---
**[P2] OrderList「期数(已同步/预估)」列已同步恒显 0，与详情不一致；偏差数字受 synced=0 影响**（列表误读/跨模块）
- 前置：active 单已排发若干期到 ZTO-MF（实际 synced>0），且 has_drift 使偏差 Tag 显示。
- 步骤：
  1. OrderList 看「期数(已同步/预估)」列的「已同步」与偏差 Tag。
  2. 详情 → fulfillment-progress / 关联快递明细，看真实 `synced_count`。
  3. 对比两处「已同步」，注意列表偏差 Tag 数值。
- 预期（riskySpot）：`_build_list_row` 硬写 `synced_count=0`（V1.3 占位，`order_service.py:1204`），OrderList 渲染 `{synced}/{expected}` 恒显「0/N」；偏差 Tag 由服务端 `has_drift` 门控是否显示，但 Tag 内数字 `driftLabel(drift)` 用 `drift=expected−0`（`OrderList.tsx:381`），把整段 expected 当偏差量显示。详情 `compute_fulfillment_progress` 才给真实值。列表易误读为「一期没同步」且偏差虚高。已知占位、非功能性 bug，故 P2。
- 为何人工：synced=0 占位有后端单测，但「列表 0 vs 详情真实值」跨页误读 + Tag 数字联动是端到端 UI 观感，须两页对照。

---
**[P2] 退款/取消单再排发：preview 全 skip 且 apply 不新增发货行（端到端防回归）**
- 前置：两张 active 纸刊订阅单 A、B，覆盖同一目标期、姓名地址齐、目标中通外包；A 全额退款(refunded)、B 取消(cancelled)；目标期已在 issues 表。
- 步骤：
  1. A 全额退款、B 取消。
  2. `GET /api/orders/{A}/shipping-sync/preview?issue_number=<期>`：`candidates=0`、每条 skip、reason 含「退款」。
  3. A `apply`：不新建 ShippingDetail。
  4. B 重复 preview/apply（reason 含「取消」）。
  5. 另建同期 active 未退款单 C 对照：能正常产候选并 apply。
- 预期（防回归）：`_build_candidates` 开头对 refunded/cancelled 全 skip、candidates=0（`order_shipping_sync_service.py:270`），apply 不为 A/B 建行。C 正常。任一退款/取消单仍能产候选或写行即回归。
- 为何人工：主逻辑已覆盖；本用例价值在把「退款/取消→再排发→对照单正常」串成端到端 + 校对 message 文案，作回归走查（P2）。

---
**[P2] 历史归档单：批量排发排除，但单单 shipping-sync 仍可手工同步**（边界不对称，设计如此非 bug）
- 前置：历史模式导入一张 `is_historical_archive=True` 单，补齐覆盖期/期号满足排发、中通外包、姓名地址齐、明细 active 纸刊、`status=active`。
- 步骤：
  1. 对某期 `apply_all_for_issue`：结果不含该归档单。
  2. 对该归档单单独 `preview?issue_number=<期>`：是否产候选。
  3. 对该归档单 `apply`：是否新建 `order_generated` 行。
- 预期（edgeCase）：批量 `_candidate_order_ids_for_issue` 带 `is_historical_archive.is_(False)`（`order_shipping_batch_service.py:91`），归档单不进批量；单单 `_build_candidates` 无该过滤，只要条件齐仍产候选并 apply 成功。model 注释（`order.py:114-118`）明确「批量排除、单单放行」是刻意设计。人工确认符合预期（勿误以为归档单永不发货）。
- 为何人工：自动化只证批量排除半边；单单放行半边无覆盖。

---
**[P1] 排发命中疑似手工重复行（同名同号 order_id=NULL）→ preview conflict、apply 409 不写入**
- 前置：某目标期已存在一条手工 `shipping_detail`（`order_id=NULL`、`source_type=manual`），其 `name+phone` 与某 active 订单某期候选完全一致；该订单满足排发条件。
- 步骤：
  1. 确认已有手工发货行（issue=该期、`order_id IS NULL`、name/phone 与收件人相同）。
  2. `preview?issue_number=<期>`：该候选 `action=conflict`、reason=「存在疑似重复的手工发货明细」。
  3. `apply`。
  4. 响应码=409、无新建行、原手工行未被覆盖、是否记 `shipping_sync_conflict` 事件。
- 预期：`_find_possible_manual_duplicate` 用 `(issue, order_id IS NULL, name, phone)` 匹配 → preview conflict（`order_shipping_sync_service.py:104,427`）；apply 有 conflict 时记事件、commit、抛 409(detail=preview)，不写不覆盖（`:152`）。人工确认冲突时序与「不覆盖手工数据」保护生效。
- 为何人工：已有测试只覆盖「已链接行被改成 manually_modified」路径；`order_id=NULL` 按 name+phone 模糊匹配这条无测试。

---
**[P1] 生效单改明细填错 effective_from_issue（小于已排发期）导致 allocation 空窗/错配**
- 前置：active 订阅单，某明细已按 v1 排发到若干期（如已发 2655）；改该明细 targets 触发版本升级。
- 步骤：
  1. `PUT /api/orders/{id}/items`，提交该明细（带原 id）改动 targets，把 `effective_from_issue` 填成 < 已发期（如 2600）。
  2. 确认返回 200、旧版 `effective_until_issue` 截为 from−1、新 v2 从 2600 生效。
  3. 对已发期(2655)与更早期(2620)分别 `preview`：命中 v1 还是 v2。
  4. 是否出现某期无生效 allocation（skip「当期没有生效的履约方案」）或已发期被 v2 命中、与当初已发不一致。
- 预期（riskySpot）：`_update_existing_item` 直接用 `data.effective_from_issue` 截断/开新版（`order_service.py:189/1036`），不校验它与已排发期先后；`_select_allocation` 按覆盖该期 + 最高 version 选版（`order_shipping_sync_service.py:353`）→ 已发期改由 v2 命中，重排与当初可能不一致；截断不当则某期落入两版本空窗 → 返回 None → skip。正确应校验 from_issue 不早于已排发期。
- 为何人工：需跨「改明细→版本截断→按期选版本」多步逐期 preview 对照，判空窗/错配是否合理；无自动化覆盖。

---
**[P2] 导入未识别平台状态串 → 预览标 unknown、落 active+paid；待付/关闭串 skip 不建单**（导入解析边界）
- 前置：一批 CBJ/淘宝 导入行，其中一行原始状态串词典与关键字都命中不到（如「审核中」「待成团」）。
- 步骤：
  1. 走导入预览（CBJ 或淘宝），让怪串行进入映射。
  2. 看该行 `commercial_status` 与是否带「需人工确认/unknown」标记。
  3. 含「待付」行、含「关闭/取消」行是否被 skip 不建单。
  4. 提交导入：unknown 行是否落 active + `commercial_status=paid`，原始串是否存 `source_status_raw`。
- 预期：`map_commercial_status` 对怪串既不命中 `_EXACT` 也不命中关键字 → `StatusMapping(paid, should_import=True, unknown=True)`（`order_import_status_service.py:64`）：仍导入、落 active、paid，unknown=True 供预览标记；含「待付/未付/等待付款」→pending_payment+skip；含「关闭/取消」→cancelled+skip；原始串始终存 `source_status_raw`。
- 为何人工：映射各分支逻辑已被单测完整覆盖；唯一未覆盖的是「预览页 unknown 标记如何呈现、skip 行是否真不出现在建单结果」这层导入 UI 端到端确认。

---
**[P2] 订单列表导出 xlsx：筛选与列表一致、中文表头/金额格式、限 50000 行、仅 admin**（打印导出/权限）
- 前置：列表多状态订单；一组筛选（如 status=active + 覆盖期重叠 + 未付清）；admin 与非 admin token。
- 步骤：
  1. OrderList 应用该组筛选，记条数与关键行（单号/付款主体/金额/欠款）。
  2. 导出 `GET /api/orders/export`，下载 xlsx。
  3. Excel 核对：导出行集合是否与筛选一致（非当前页）、中文表头齐全、金额/欠款列格式与页面一致、是否受 `limit=50000` 截断。
  4. 非 admin 调 export → 403。
- 预期：export 复用与列表相同筛选、`skip=0/limit=50000`、经 excel_service 输出 xlsx StreamingResponse（`orders.py:133-178`）；依赖 `require_admin`，非管理员 403；导出覆盖整个过滤集（受 5 万上限），非当前页。
- 为何人工：现有测试只验 admin 走通 + content-type + 非空，未校对二进制内容/非 admin 403/筛选一致性。

---
**[P2] OrderEditor 提交前校验：份数合计≠总份数经 Modal 汇总 + 目标合计 Tag 变色**（纯 UI 交互）
- 前置：OrderEditor 新建订单页（校验仅在 `!isEditMode` 创建路径触发）。
- 步骤：
  1. 新增明细，每期总份数 10，只填一个目标 quantity=7；观察「目标合计 7 / 每期总份数 10」Tag 变橙。
  2. 目标改回合计=10 → Tag 变绿。
  3. 点「确认生效」→ `Modal.error` 汇总；核对「明细 N：履约目标份数合计 7 ≠ 明细总份数 10」文案。
  4. 另测：不填明细→「至少需要 1 条订单明细。」；删光某明细目标→「明细 N：至少需要 1 个履约目标。」。
- 预期：目标 Divider 上 Tag `color = targetSum===totalQty ? 'green':'orange'`（`OrderEditor.tsx:1445`）；提交经 `validateBusinessRules` + `showValidationErrors` 一次性 Modal 列出（`:427`）。注意：覆盖期缺失、单期缺期号、总份数 min:1 等会先被 antd `form.validateFields()` 拦下弹「请先修正表单错误」warning，通常不走到那两条文案——能稳定由 Modal 汇总的主要是「份数合计不符」。
- 为何人工：纯前端实时 Tag + 提交前 Modal 汇总，后端不参与；`validateBusinessRules` 未导出、无单测；须人工核对弹窗文案/Tag 颜色，并确认哪些错误由 antd 先拦。

### 3.2 商品与覆盖期

---
**[P0] 月刊（商学院）全年从12月跨年到无刊历年 → 应发期数严重低估为1**（已知bug#3）
- 前置：`bs_issues` 只种到 2026（seed 含 2024/2025/2026，无 2027）；商品「商学院·全年订阅(月刊)」（business_school/subscription/one_year/term_from_month）；批次 `post_office_start_month=2026-12`（或 `zto_start_month`）。
- 步骤：
  1. 导入页设批次起投月 2026-12（非 historical），或 OrderEditor 手工建商学院全年单、起始月 2026-12。
  2. 让覆盖期落 `[2026-12-01, 2027-11-30]`。
  3. 确认订单（draft→active）写入 `expected_issues_at_creation` 快照。
  4. 详情/列表看该明细「应发期数」。
- 预期（实测复现）：应发期数=**1**（仅 2026-12 一期相交，2027 的 11 个月全丢）。正确应约 12。根因：`_count_business_school_issues` 粗估兜底要求 `count==0 且 issues 为空`；`BsIssue.year.in_([2026,2027])` 命中 2026 行 → issues 非空 → 跳过按月粗估，未录 2027 各月贡献 0（`expected_issues_calculator.py:121-133`）。与旧「高估」相反方向的低估，污染 drift。人工判定显示成 1 是否可接受（不可接受即确认 bug）。
- 为何人工：现有测试全落单一已录年（2026 全年=11）或完全未录年（走周刊路径），`_bs_db()` 只种 2024-2026，恰好避开「部分已录+跨到未录 2027」触发条件。

---
**[P0] 月刊（商学院）半年从11月跨年 → 应发期数低估为2**（bug#3 变体）
- 前置：同上，`bs_issues` 只到 2026；商品「商学院·半年订阅」（business_school/subscription/half_year/term_from_month）；批次起投月=2026-11。
- 步骤：
  1. 导入或手工建商学院半年单、起始月 2026-11，覆盖期 `[2026-11-01, 2027-04-30]`。
  2. 确认写入快照。
  3. 看该明细应发期数。
- 预期（实测）：返回 **2**（仅 2026-11、2026-12 相交；2027 的 1/2-3合刊/4月因无刊历贡献 0）。正确应为 **5**（2026-11、2026-12、2027-01、2027-02~03合刊、2027-04）。同一根因（issues 非空跳过粗估）。人工判定显示 2 是否为 bug。
- 为何人工：与上条同类，用半年+11月起投验边界；半年跨年只差几期，比全年更隐蔽，需对照刊历数。

---
**[P0] 套餐实付<固定项合计 → 商学院腿生成负金额明细仍可提交入库**（资金/统计污染）
- 前置：套餐「《中国经营报》和《商学院》全年订阅(8折)」，components=[中国经营报 fixed_price=240、商学院 remainder=true]；一条电商订单匹配该套餐，实付<240（如 200，模拟异常改价）。
- 步骤：
  1. 导入页上传含该套餐行、实付=200 的订单。
  2. 预览列表找到该单，观察是否标黄「套餐实付 ¥200 少于固定项合计 ¥240，余额为负，请核对」。
  3. 无视警告直接勾选导入/提交。
  4. 订单详情看商学院腿金额。
- 预期：预览加 warning 但不阻断；提交后商学院腿 `subtotal=-40.00`（负金额明细）真实入库，中国经营报腿=240，不硬拦。判定点：负金额明细污染金额汇总/发行统计，人工确认是否应硬拦而非仅警告。
- 为何人工：resolver 单测已验证产生 -40 与警告，但「无视警告→负额落库→污染下游统计」端到端后果须人工走完导入→入库→看统计。

---
**[P0] PUT 编辑商品把套餐改非套餐但不清 components / 把非套餐 publication 置空 → 生成非法商品行**（create 有校验、update 无）
- 前置：商品库有套餐（`is_bundle=true`、`publication=null`、components 有值）与非套餐（`is_bundle=false`、`publication=cbj`）。
- 步骤：
  1. 对套餐 `PUT /api/products/{id}`，body 只含 `{"is_bundle":false}`（既不清 components 也不补 publication）。看返回码。
  2. 对非套餐 `PUT {"publication":null}`。看返回码。
  3. 导入页上传会匹配到这些被改坏商品的订单，看解析是否异常。
- 预期（实测）：两个 PUT 都返回 **200**（`ProductUpdate` 独立全可选、无 `_check_shape` 校验器，`update_product` 直接 setattr，`products.py:100-108`）→产生「非套餐却 publication=null」或「非套餐却残留 components」非法行。对比 POST 同形状被 422 拒（`ProductCreate` 继承 `_check_shape`）。非法商品被 resolver 非套餐分支匹配时会 `Publication(None)` 异常。正确应 update 也做跨字段一致性校验。人工判定为 bug。
- 为何人工：products 测试只覆盖 create 的 422，没测 update 绕过；且要走到「改坏后再导入触发解析异常」才见真实危害。

---
**[P1] 手工订单定价预览「参考覆盖期」（真实首末刊日）与实际保存覆盖期（[1号,末月末日]）不一致**（口径分歧/对外正确性）
- 前置：`publication_schedule` 中起投月（如 2026-07）1 号无出版期（周报首个出版日在 7 月上旬某周一，7 月末最后一期不落月末 31 号）；商品中国经营报周报订阅。
- 步骤：
  1. OrderEditor 新建/编辑中国经营报订阅明细，邮局、半年、起始月 2026-07。
  2. 触发定价预览，记预览面板 `coverage_start_date`/`coverage_end_date` 与期数。
  3. 不改日期直接保存。
  4. 回看该明细实际存储覆盖期（RangePicker 值）。
- 预期：后端 `build_pricing_preview` 的覆盖起止 = 刊期表 `[起投月1号,止月月末]` 内 issue_number 非空的 min/max 出版日（真实首末刊日，`order_pricing_service.py:96-106`）；前端 `computeCoverageRange` 保存 `[start(1号), start+N月-1天]`（纯月份算术，`OrderEditor.tsx:127-130`）。二者不同；`useEffect` 只回填 unit_price、不回填覆盖期。非崩溃，是口径分歧：操作员看到的参考覆盖期与落库值不同，易误判首末期。人工确认是否误导。
- 为何人工：两处口径分歧无自动化守；须人工在真实刊期表下同时看「预览显示值」与「保存后 RangePicker 值」逐字段对比。

---
**[P1] 付款日「恰等于」截止日 cutoff_date 时不顺延起投月（严格大于才顺延）**（跨月边界易配错）
- 前置：批次 `post_office_start_month=2026-07`、`cutoff_date=2026-06-22`；三张订单（邮局、中国经营报全年订阅），付款时间 2026-06-22 23:59 / 2026-06-23 00:01 / 2026-06-25。
- 步骤：
  1. 导入这三张（非 historical）。
  2. 预览逐单看各自 `coverage_start_date`。
- 预期（实测）：付款 06-22（==cutoff）→起投月仍 2026-07（不顺延），覆盖 `2026-07-01~2027-06-30`；06-23 / 06-25（>cutoff）→顺延到 2026-08，覆盖 `2026-08-01~2027-07-31`。判定 `payment_time.date() > cutoff_date`（严格大于），等于当天不顺延（`cbj_order_import_service.py:140-151`）。人工核对「截止日当天付款算本期还是下期」是否符合业务约定。
- 为何人工：现有测试只覆盖 6/1 与 6/25 两端，没测「恰等于 cutoff 当天」这个 off-by-one；跨月顺延一次差一个月直接影响整批发货期。

---
**[P1] 同批次中通与邮局起投月不同 + bonus_months 叠加 → 两腿覆盖期各自偏移，套餐两腿投递不同尤甚**（多变量组合）
- 前置：批次 `post_office_start_month=2026-07`、`zto_start_month=2026-08`、`bonus_months=1`、`cutoff_date=null`；商品库有混合投递套餐（中国经营报=邮局、商学院=中通）+ 单独中通/邮局订阅商品。
- 步骤：
  1. 导入匹配混合投递套餐的订单（实付覆盖两腿）。
  2. 预览看中国经营报腿（邮局）与商学院腿（中通）各自 `coverage_start_date/end_date`。
  3. 再导入纯中通订阅、纯邮局订阅，各看起投月。
- 预期：`_start_month_for` 按每腿 delivery_method 取月：邮局腿=2026-07、中通腿=2026-08，差一月；`_coverage_for` 里 `months += bonus_months` 对每腿都叠，一年订阅 months=13、末日再顺延一月（邮局腿 `2026-07-01~2027-07-31`，中通腿 `2026-08-01~2027-08-31`，`cbj_order_import_service.py:140-167`）。人工核对「同一套餐两腿起投差一月」是否符合预期、bonus 是否该同时叠两腿。
- 为何人工：多变量（投递分月×bonus×套餐分腿投递）组合的整体覆盖期正确性无端到端自动化；操作员靠肉眼逐腿核对，配错整批偏移。

---
**[P1] 订单确认后手工改覆盖期 → 快照不重算，立刻显示 drift**（操作产物被当真实排期漂移）
- 前置：active 中国经营报周报订阅单，确认时已定格 `expected_issues_at_creation`（如=26）；刊期表覆盖该覆盖期。
- 步骤：
  1. 打开该单进可编辑明细，把覆盖期结束日往后延几周（或改起始日）使 current_expected 变化。
  2. 保存（`update_order_items` 允许改 active 单明细覆盖期）。
  3. 列表/详情看是否标 drift、`has_drift` 筛选能否筛出。
- 预期：`_update_existing_item` 会 setattr 覆盖期但**不重算** `expected_issues_at_creation`（快照仅在 create/confirm 定格，`order_service.py:162-177`）；`compute_fulfillment_progress` 每次按新覆盖期算 current_expected → `drift=current−快照≠0` → 立即标 drift、`has_drift` 命中。这是操作产物而非真实漂移，系统无法区分。人工判定「刚改完就 drift」是否让操作员误读。
- 为何人工：drift 是派生只读值，自动化测的是「刊期表变化引发的真 drift」；「人工编辑覆盖期引发的假 drift」要真在 UI 改一次再看标记才暴露。

---
**[P2] 最新一期：付款落在周五约22:00翻期窗口±4h → 自动判期并标黄「翻期临界请核对」但仍导入**（临界边界）
- 前置：`publication_schedule` 有连续周一出刊的中国经营报期（如 6-15、6-22）；商品中国经营报「最新一期」单期（coverage_rule=latest_issue）；6-22 期在售起点=6-19（周五）22:00。
- 步骤：
  1. 导入三张最新一期订单，付款时间：6-19 21:00（翻期前1h,临界内）、6-19 22:30（翻期后0.5h,临界内）、6-17 12:00（远离,非临界）。
  2. 预览看各单自动判定期号与是否标黄。
- 预期（实测）：6-19 21:00（距 6-22 在售起点<4h）→判上一期(6-15)标黄「翻期临界(周五约22点±4h)…请核对」；6-19 22:30（距本期在售<4h）→判 6-22 期标黄；6-17 12:00→判 6-15 期、note=None 不标黄（`latest_issue_resolver.py:35-38,84-96`）。临界只标黄不阻断。人工核对翻期附近自动判期是否正确。
- 为何人工：判期逻辑本身已有单测，增量价值在「真实刊期表下临界±4h 黄标在预览是否醒目、是否真让操作员核对」的可见性（P2）。

---
**[P2] 别名过短（如裸「618」）做第③级子串匹配 → 误命中任何含618的不相干订单行**（匹配护栏）
- 前置：某非套餐商品 aliases 含过短裸串（如「618」）；一条订单行名称含618但实为别的商品（如「618元话费充值」）。
- 步骤：
  1. 导入该订单行。
  2. 是否被误命中到带「618」别名的商品。
  3. 把别名改成完整活动串（如「《中国经营报》全年订阅-618促销活动」）后重导，看是否不再误命中。
- 预期（实测）：裸别名「618」因 `match_product` 第③级（`_norm(alias) in target`）命中「618元话费充值」→误解析（`product_resolver_service.py:78-81`）；改成完整串后子串匹配范围收窄，不相干行回待确认。系统无护栏，靠命名纪律。人工验证短别名误命中风险。
- 为何人工：第③级子串匹配无自动护栏、靠命名约定；需人工用「恰含短别名子串但实为别物」的刁钻名触发。

---
**[P2] 商品编辑弹窗：覆盖期算法「固定日期(explicit)」已从下拉移除，但历史该值商品需并回显示不丢值**（纯 UI/历史数据兼容）
- 前置：DB 直接存一条 `coverage_rule=explicit` 历史商品（前端下拉已无 explicit，只能靠历史数据造）。
- 步骤：
  1. ProductCatalog 打开该 explicit 商品编辑弹窗。
  2. 「覆盖期算法」下拉当前值是否正确显示「固定日期」而非空/裸值。
  3. 不动该字段，改 notes 后保存，重开确认 `coverage_rule` 仍 explicit。
  4. 对比：新建商品下拉里应无「固定日期」。
- 预期：`COVERAGE_RULE_OPTIONS` 只含 term_from_month/latest_issue/custom；`ProductFormFields` 当 coverageRule 不在 OPTIONS 内→并回 `[...OPTIONS,{label:'固定日期',value:explicit}]`，正确回显且保存不丢（`ProductForm.tsx:104-110,36-47`）；新建不含 explicit。功能层 explicit 已废（`_coverage_for` 对非 term_from_month 一律返 None）。人工验证编辑老数据不掉值、新建看不到废选项。
- 为何人工：explicit 只能由历史数据构造，回显并回是纯前端行为，无法后端自动化覆盖。

---
**[P2] match_product 大小写/全角括号差异不命中，但含空格差异能命中**（归一只去空白）
- 前置：某商品 display_name 含半角括号或特定大小写；订单行名称与之仅差 (a)多/少空格 (b)全角vs半角括号 (c)英文大小写。
- 步骤：
  1. 分别导入三种变体。
  2. 哪些命中、哪些落待确认。
- 预期（实测）：仅空格差异→命中（`_norm` 去所有空白后相等）；全角/半角、大小写差异→不命中、落待确认（`_norm` 只 `''.join(value.split())`，不折大小写/全半角/繁简，`product_resolver_service.py:28-30`）。人工验证「看着一样怎么没匹配上」的归一口径是否符合预期。
- 为何人工：归一口径边界靠人工喂视觉几乎相同、字节不同的名称才暴露；单测不会穷举全半角/大小写变体。

### 3.3 发货与物流对账

---
**[P0] 对账卡显示「一致」但订单作废后中通面单导出份数变少**（对账口径 vs 导出口径背离）（疑似bug）
- 前置：某期（2655）已有若干 order_generated 行；报数编辑页「中通物流公司」合计 = 该期 ShippingDetail 份数合计（使 `shipping_check.is_match=true`，如报数10份=发货明细10份，含3份来自订单A）；订单A active 且已生成发货行。
- 步骤：
  1. ZTO-MF 页选 2655，记「报数·中通合计」「发货明细·合计」「对账·差值」三卡，确认差值卡绿✓「一致」。
  2. 订单模块把订单A作废（void）——对应 order_generated 行 `sync_status` 置 orphaned。
  3. 回 ZTO-MF 页 2655 刷新，再看三卡数字与颜色。
  4. 点导出下载中通面单 xlsx，数份数合计。
  5. xlsx 份数合计 vs 对账卡「发货明细·合计」对比。
- 预期（疑似bug）：对账卡「发货明细·合计」取 `shipping_check.shipping_total`，来源 `get_report` 的 `SUM(ShippingDetail.quantity) WHERE issue_number`（`reports.py:140-144`，**不排除 orphaned/void**）→作废后仍显示 10 份、差值卡仍绿✓「一致」；但导出 xlsx 只有 7 份——`export_shipping_excel`（`excel_service.py:318-328`）显式排除 orphaned 且排除 link 到 void 订单的行。两口径背离。正确行为：对账发货合计也应排除 orphaned/void（作废后应显示差值3、红✗）。
- 为何人工：需跨订单模块作废 + 打开真实 xlsx 核对，两口径分处 reports.py 与 excel_service.py；自动化只验证「导出排除孤儿行」，未串联到「对账卡 SUM 仍含孤儿→说一致」；卡片颜色/✓✗需肉眼判定。

---
**[P0] 报数确认自动复制上期明细：order_generated 行被复制且溯源丢成 manual、下期重复计入对账**（疑似bug）
- 前置：N 期（2654）已有明细，既有手工行也有 order_generated 行（source_type=order_generated）；N+1 期（2655）当前**无任何明细**、报数 draft。
- 步骤：
  1. 确认 2655 当前 0 条明细。
  2. 2655 报数编辑页填好变动项，点「确认报数」（`POST /report/confirm`）。
  3. 回 2655 ZTO-MF 页，看复制来的行数与「来源·同步」列。
  4. 对每条复制行看 `source_type/sync_status/order_id`。
  5. 对 2655 跑订单同步（应给同一订户再建 order_generated 行），或看报数对账「发货明细·合计」是否把复制来的订单份数又算一遍。
- 预期（疑似bug）：confirm 触发 `_copy_previous_shipping_details_for_confirm`（`reports.py:49-106`），查询上期明细时**未过滤 source_type**（`:73-78`），把上期全部行含 order_generated 一并复制；`_SHIPPING_DETAIL_COPY_FIELDS`（`:41-46`）不含 source_type/sync_status/order_id/…，复制行落模型默认 `source_type=manual`、`sync_status=synced`（`shipping_detail.py:70-82`）。结果：①订单溯源被抹成手工；②这些「假手工」份数进本期对账 SUM；③再跑同步会另建 order_generated 行→同一订户双份重复计入。正确应与手工复制路径 `_copy_shipping_details_from_previous`（`shipping_details.py:112-123` 显式排除 order_generated）一致。
- 为何人工：自动化只覆盖手工 copy 路径，confirm 自动复制路径无等价测试；需人工触发 confirm 并逐行核对 source_type 与后续对账双计。

---
**[P0] 单期发货明细 >200 行时 ZTO-MF 页「本期N条明细/记录数/渠道数」少算**（前端 limit 截断）
- 前置：构造某期（2655）拥有 >200 条 ShippingDetail（如导入 250 行历史明细）；报数确认或未确认均可。
- 步骤：
  1. ZTO-MF 页选该期。
  2. 看「发货明细·合计」卡份数及副标题「本期 N 条明细求和」的 N、「记录数」卡及「x 个渠道 · y 家签约公司」。
  3. 看「报数·中通合计」与「对账·差值」卡。
  4. `GET /api/issues/{id}/report` 看 `shipping_check.shipping_total`（后端 SQL SUM 全量）与前端各处对比。
  5. 滚动表格确认是否只显示前 200 条。
- 预期：`list_shipping_details` 默认 `limit=200`（`shipping_details.py:175`），前端 `getShippingDetails` 不传 limit（`Recipients.tsx:245` 的 allDetails、`:233` 的 details 均未传）→只拿 200 条。当报数已生成（check 存在）时「发货明细·合计」卡取 `check.shipping_total`（后端 SUM 全量，正确），但副标题「本期 {allDetails.length} 条」（`:452`）、「记录数」卡值 `allDetails.length`（`:476`）、渠道/公司去重计数（`:430-431`）全部基于截断到 200 的列表→显示 250 行只算 200、渠道/公司数偏少；当 report 未生成（check 空）时该卡回退 `currentShippingTotal=details.reduce`（`:428/450`）也被截断→份数直接少算。正确：前端分页取全量或后端该场景放开 limit。
- 为何人工：需造 >200 行真实数据量，同时对比前端卡片数字与后端 SQL SUM，观察记录数/渠道数隐蔽少算。

---
**[P0] 同名同号但不同收件地址的两个投递点被误判「疑似手工重复」，阻断整单排发（409）**（冲突判定）（疑似bug）
- 前置：订单A active，某 fulfillment_target 收件人「张三」、phone「13800000000」、`shipping_channel=zto_outsource`、地址=甲地；该期已存在手工 ShippingDetail（`order_id IS NULL`）、name「张三」、phone「13800000000」、地址=乙地（另一投递点，与订单目标不同地址）。
- 步骤：
  1. 对该期跑订单A同步 preview（`GET /orders/{id}/shipping-sync/preview` 或按期一键排发）。
  2. 看该候选行 action 与 reason。
  3. 尝试 apply。
  4. 是否报 409、是否写 `OrderEvent(shipping_sync_conflict)`。
- 预期（疑似bug）：`_find_possible_manual_duplicate` 仅按 同期 + `order_id IS NULL` + 同 name + 同 phone 匹配（`order_shipping_sync_service.py:427-441`），**不比地址**→把乙地手工行判为疑似重复，preview `action=conflict`、reason=「存在疑似重复的手工发货明细」；`conflicts>0` 使 apply 写事件后 raise 409(detail=preview)，整单不产发货行（`:100-118,152-169`）。「同一订户两个不同投递点」是误报——正确应把地址纳入重复判定，或允许同名同号不同地址各自建行。人工判定属可接受的保守拦截还是应放开。
- 为何人工：需构造「同名同号不同地址」手工行并观察 409 阻断与事件写入；测试库无任何针对 `_find_possible_manual_duplicate` 的用例。

---
**[P1] 已发行 shipped_quantity 为空时对账把实发按计划份数计，缺口被吃掉**（设计如此，需人工确认是否可接受）
- 前置：某期（2655）有 order_generated 行 R，`quantity(计划)=5`；DB 直接构造使 `R.shipped_at` 已置（已发）但 `R.shipped_quantity=NULL`；真实只发 2 份。
- 步骤：
  1. `GET /api/orders/shipping-sync/issues/2655/reconciliation` 看 planned/shipped/shortfall。
  2. 或 IssueDispatch 选 2655 看「本期对账(应发vs实发)」卡的应发/已发/缺口。
  3. 对照 R 实际只发 2 份但 shipped_quantity 为空。
- 预期（有意设计非漏洞）：`reconcile_issue`（`order_shipping_batch_service.py:336-337`）`shipped_qty += shipped_quantity if not None else (quantity or 0)`。R 的 shipped_quantity 为 NULL→按计划 5 计入，已发显示 5、缺口 0，看似「已足额」。`IssueReconciliation` schema 注明「实发缺省按计划计」（`order.py:620-621`），ship 接口默认 `shipped_quantity=quantity`（`shipping_details.py:368-369`），正常 UI 标发不会留空。故本用例非 bug，而是验证：仅当有人绕过 UI（DB/历史脏数据）造出 shipped_at 非空+shipped_quantity=NULL 行时缺口被掩盖；人工据此判断是否需为异常行加「需补录实发」标记。
- 为何人工：需绕过 UI 构造异常行；自动化 `test_reconcile_*` 均写了 shipped_quantity，未覆盖 NULL 回退分支。

---
**[P1] 同一出刊日既有正常期又有 issue_number=NULL 的休刊行时，整期被误判休刊、订单同步产出空**（状态机边界）（疑似bug）
- 前置：`PublicationSchedule` 中同一 `publish_date`（如 2026-07-10）存两行：一行 `issue_number=2660`、`is_suspended=False`（正常）；另一行 `issue_number=NULL`、`is_suspended=True`（整刊休刊通配行）；issues 表有 2660 期、`is_suspended=False`；有 active 订单覆盖该期。
- 步骤：
  1. IssueDispatch 选 2660，观察是否弹「该期为休刊期」Alert 且不渲染统计。
  2. 点「一键排发本期」，看返回 message/suspended。
  3. 或对该期某订单跑 preview，看 message 与 items。
- 预期（疑似bug）：`_is_suspended_issue`（`order_shipping_sync_service.py:245-260`）用 `or_(issue_number==本期, issue_number.is_(None))` 且 `is_suspended.is_(True)` 匹配——NULL 通配行命中→整期判休刊：preview 返回空 items + message「目标期号为休刊期，不生成发货明细」，`apply_all_for_issue` 返回 `suspended=True` 不写库（`order_shipping_batch_service.py:158-161`），前端弹休刊 Alert。但 2660 其实正常出刊，被 NULL 休刊行误伤停发整期。正确：`issue_number=NULL` 的休刊行不应通配已有明确正常期号的期，或仅在该 publish_date 无正常期行时才生效。
- 为何人工：需在排期表精心构造「同日正常期号行 + NULL 休刊行」组合；自动化 `seed_issue(is_suspended=True)` 只造单一 issue_number=None 休刊行、从不与同日正常期号行并存。

---
**[P1] 运营在 ZTO-MF 页微调订单生成行（如改状态为停发）后，该行永久脱离自动同步、订单后续改地址不再回写**（跨模块端到端）（疑似bug/是否过度锁定）
- 前置：订单A active，已对 2655 期同步生成 order_generated 行 R（`sync_status=synced`，地址=甲地）。
- 步骤：
  1. ZTO-MF 页找 R 行，行内编辑把「状态」从『正常』改『停发』（或改任一字段），保存。
  2. 确认 R 的 `sync_status` 变 `manually_modified`（看操作日志或「来源·同步」列）。
  3. 回订单A，改该 fulfillment_target 收件地址为乙地（经 address_service 规范化）。
  4. 对 2655 重跑同步 preview/apply。
  5. R 行地址是否被更新为乙地、R 在 preview 里的 action。
- 预期：`update_shipping_detail`（`shipping_details.py:327-334`）order_generated 行任一被跟踪字段变更即置 `sync_status=manually_modified`；此后 preview 对 R 判 `action=conflict`、reason=「订单生成行已被人工修改」（`order_shipping_sync_service.py:124-126`），apply 因 conflicts>0 raise 409（`:152-169`），R 地址**不会**更新为乙地——R 与订单永久脱钩。即一次「改停发」微调冻结该行后续所有自动回写。人工判定这是有意保护人工改动，还是过度锁定（仅改 status 不该冻结 address 同步）。
- 为何人工：update 置 manually_modified 有单测，但「改字段→订单再改地址→验证不回写并 409」完整端到端链路（跨 shipping_details.update 与 order_shipping_sync + 地址规范化）无自动化。

---
**[P1] 「一键标记本期已发」只标订单生成行，手工/历史导入行 shipped_at 永远为空、运营易漏发**（发货状态维护）（疑似bug/口径缺口）
- 前置：某期（2655）同时含 order_generated 行与手工/历史导入行（source_type=manual 或 historical_import），两类都未标发（shipped_at IS NULL）。
- 步骤：
  1. IssueDispatch 选 2655，点「一键标记本期已发」（`POST …/issues/2655/ship-all`）。
  2. 看 toast 报的 shipped_rows。
  3. 回 ZTO-MF 页，展开手工行与订单行看「发货时间」。
  4. 看 IssueDispatch「本期对账」卡应发/已发/缺口。
- 预期：`ship_all_for_issue` 只取 `_order_generated_rows_for_issue`（`order_shipping_batch_service.py:263-274`：source_type==order_generated 且非 orphaned）→仅订单行标 `shipped_at=当天`、`shipped_quantity=quantity`；手工/历史导入行不在范围、`shipped_at` 仍空。`reconcile_issue` 也用同一口径（`:326`，只统计订单生成行）→对账卡看似「订单行已全发、缺口0」，而大量手工行发货状态无从批量维护→只看对账卡会漏发手工行。人工确认手工行是否应另有批量标发入口或纳入对账口径。
- 为何人工：需混合两类来源行并肉眼核对手工行「发货时间」始终空 + 对账卡口径只覆盖订单行的误导，跨 IssueDispatch/ZTO-MF 两页；自动化只验证订单行被标发。

---
**[P1] 订阅同步出的中通行频率恒硬编码「周」，ZTO-MF 频率筛选与导出面单频率列失真**（同步字段硬编码/导出正确性）
- 前置：走 zto_outsource 渠道、实际非周刊（如双周/月刊）的订单（target 生效、姓名地址齐），已对某期同步生成 order_generated 行。
- 步骤：
  1. 对该订单某期 apply，生成发货行。
  2. ZTO-MF 页该期展开该行看「频率」「运输方式」「状态」。
  3. 用「更多筛选」里『频率』选『半月』/『月』，看该行是否被筛出。
  4. 导出中通面单 xlsx，看该行「频率」「运输方式」列的值。
- 预期：`_candidate_data`（`order_shipping_sync_service.py:378-397`）恒写 `frequency=「周」`、`transport=「中通物流」`、`status=「正常」`，不读订单真实周期。故：①ZTO-MF 频率列一律「周」；②用『半月』/『月』筛选（前端 `FREQUENCY_OPTIONS=['周','半月','月']`）该行筛不出；③导出 xlsx 频率列取行自身 frequency（`excel_service.py:25-27`）也一律「周」。设计缺口：应按订单真实周期写入。人工判定该字段失真对运输统计/运营核对的影响。**并确认订单模型层面是否已有可映射的「周期」字段**（可能属尚未接线的字段缺口而非纯 bug）。
- 为何人工：需构造非周订阅但走中通的订单，肉眼核对页面频率列/筛选/导出列三处一致失真；自动化未校验 frequency 真实性。

---
**[P1] 报数确认后修改被 403 拦截，需管理员先作废(revoke)方可改，且再次确认新增快照取最新一条**（报数状态机/权限边界）
- 前置：某期（2655）报数已 confirmed，已有一条 confirm 快照；准备普通用户与管理员两种登录。
- 步骤：
  1. 普通用户改任一变动项，`PUT /api/issues/{id}/report`，是否被拒。
  2. 普通用户尝试 `POST /report/revoke`。
  3. 改用管理员 revoke，确认 status 回 draft、写 ReportRevision。
  4. 修改数值→再次 `POST /report/confirm`→看是否新增 confirm 快照、`get_report` 的 `confirmation_summary` 取哪条。
- 预期：`update_report` 在 confirmed 时 raise 403「报数已确认，如需修改请先作废」（`reports.py:186-187`）；`revoke_report` 依赖 `require_admin`（`:271`）→普通用户被拒；管理员 revoke 成功：status→draft、写 ReportRevision（revision_number 递增，`:288-306`）；修改后重新 confirm 会 `db.add` 一条新 IssueAuditSnapshot（不覆盖旧的，`:238-248`）；`get_report` 的 latest_confirmation 按 `created_at desc,id desc` 取最新一条（`:131-139`）。行为符合设计，人工验证 403 文案、admin-only、快照取最新。
- 为何人工：涉及两角色权限 + 确认/作废/再确认多步状态流转与快照选取，需切换身份观察 revision 与 confirmation_summary；测试库无任何针对 update_report(403) 与 revoke_report(admin-only) 的用例。

---
**[P2] IssueDispatch 未发清单行内「标已发」按钮 loading 绑定共享 mutation：点一行全行 loading**（纯 UI 交互）
- 前置：某期（2655）对账「未发清单」有多行（≥3 行未发）。
- 步骤：
  1. IssueDispatch 选 2655，滚到「本期对账」未发清单表。
  2. 点第 2 行「标已发」。
  3. 请求进行中，观察所有行「标已发」按钮 loading 状态。
  4. 成功后看 toast 与该行是否从未发清单消失。
- 预期：未发清单每行『标已发』共用 `shipOneMutation.isPending`（`IssueDispatch.tsx:174-184`）→点任一行，请求期间所有行按钮同时转圈，而非仅被点那行；成功后 `message.success`（`:140`）并 invalidate issueRecon/shippingDetails（`:141-142`），该行移除。功能正确但 loading 反馈误导。正确应按行 id 局部 loading。
- 为何人工：loading 视觉误导只能人工观察，纯前端细节。

---
**[P2] 批量规范化地址：cpca 对脏地址（缺省/市辖区/短区名歧义/含空格）的规范质量抽样**（纯数据质量）
- 前置：库中若干脏地址 ShippingDetail：①缺省份「朝阳区xx路」；②市辖区「北京市市辖区xx」；③短区名歧义「城区xx」；④含多余空格「  广州市 天河区  xx」；⑤已规范正常若干。
- 步骤：
  1. `POST /api/shipping-details/normalize-addresses`（**注意：该端点全库规范化、非按期，且当前前端 ZTO-MF 页未接任何「批量规范化地址」按钮，只能直接调 API 或临时接线触发**）。
  2. 看返回 `Normalized {updated} out of {total}`。
  3. 逐行对比规范前后：省市区前缀补全、市辖区处理、明细段保留。
  4. 已规范正常行确认未被无谓改写（不计 updated）。
  5. 短区名歧义/无法解析行确认是否回退原值（不报错、不乱改）。
- 预期：`normalize_address`（`address_service.py:41`）用 cpca：市辖区→省作市（`:58`），缺市/区走 `_fallback_lookup` 按区名前缀匹配并校验省一致（`:82-108`），`_rebuild_address` 重建前缀+保留明细段（`:111-169`）；端点（`shipping_details.py:503-525`）遍历全库 address 非空行、仅对「规范后有变化」的行回写并计 updated（`:518-522`），幂等——已规范行不计；无法解析回退原值不抛错。**修正候选描述：该端点不按期、无 issue_number 参数、也无对应前端按钮，用例步骤「进入 ZTO-MF 页该期点批量规范化」与实现不符，应改为直接调用全库端点。** 风险：`_fallback_lookup` 短区名前缀匹配可能误判（如「城区」≥2字歧义配到错省）、含空格地址可能规范不全——需人工抽样评估。
- 为何人工：cpca 对真实脏地址的规范质量与 `_fallback_lookup` 歧义误判只能人工肉眼抽样，无客观断言；且端点全库无差别处理，须人工控制样本。

### 3.4 客户 · 合同 · 财务

---
**[P1] 客户详情与列表「份数不变量」在生产 MySQL 上跨大小写/尾空格变体的一致性**（客户聚合·跨库口径）
- 前置：生产/预发 MySQL（排序规则 `utf8mb4_general_ci` 或 `_0900_ai_ci`）；造 3 个生效订单，各带 1 个当前分配版本的有效履约目标，收报人 A={name:'Zhang',phone:'138'}、B={name:'zhang',phone:'138'}（仅大小写不同）、C={name:'Zhang ',phone:'138 '}（尾空格）；份数各 2/3/5。
- 步骤：
  1. 管理员进「客户管理」。
  2. 搜索框输 'Zhang' 回车，观察返回行数与每行「在订份数」。
  3. 点 name='Zhang'（不含空格、大写Z）那行，打开抽屉，读顶部「在订份数」汇总并数明细行数。
  4. 再点 'zhang'（小写）那行，读抽屉「在订份数」。
- 预期：列表把 A(Zhang) 与 C(Zhang␣) 归并为「Zhang/138」一组，份数=2+5=7；B(zhang) 因 `_name_key`（`customer_service.py:94-103`）只 strip 不折大小写，独立一组，份数=3。关键不变量：点 'Zhang' 抽屉份数=7、明细 2 行；点 'zhang' 抽屉=3、1 行。`get_customer_detail`（`:204-222`）用 `func.trim` 等值做 MySQL 侧超集预筛，再在 Python 用相同 `_name_key/_phone_key` 逐字节收窄——若 MySQL 不敏感排序使 TRIM 预筛多命中小写 zhang，Python 收窄应剔除，详情不会算成 10/3 行。若「详情份数≠列表行份数」即回归。
- 为何人工：本质是 MySQL 默认排序规则的大小写/尾空格不敏感行为，SQLite 二进制比较复现不出；CI 跑 SQLite，此跨库分叉路径无法自动化覆盖。

---
**[P1] 红冲发票金额留空被当作「已覆盖」掩盖真实未冲红**（needs_red 漏催）
- 前置：一张生效订单，`invoice_required=True`，`refunded_amount=100`（先做一笔 100 部分退款或直接置该值）。
- 步骤：
  1. 管理员进「财务管理」→「订单发票」，找到该订单。
  2. 点「登记发票」，类型「正票」，金额 100，保存。
  3. 确认该行变「需冲红」（红 Tag）、右上角「需冲红」计数=1。
  4. 点该行「登记红冲」，类型保持「红冲」，金额输入框清空（留空），保存。
  5. 刷新工作台，观察该行状态与「需冲红」计数。
- 预期：任一红冲发票 `amount` 为 None 即 `reversal_covers=True`（`finance_service.py:67-68`），该单立刻从「需冲红」变「已开票」（绿）、计数归 0。注释明确这是刻意保守设计（「红冲未填金额时保守视为已覆盖，不误催」），但它掩盖了「实退 100 却没填冲红金额、可能根本没冲红」的合规风险。人工判定：可接受的保守设计，还是应收紧为保留「需冲红」/给「冲红金额待补全」提示的 bug。`amount=None` 兜底分支无等价自动化测试。
- 为何人工：金额口径的语义/合规判断，非纯功能对错；且 amount=None 兜底分支无覆盖。

---
**[P1] 发票登记不校验订单状态、允许对同一订单重复开多张正票**（数据正确性）
- 前置：O1 草稿（status=draft）且 invoice_required=True；O2 生效单已登记 1 张正票且状态「已开票」。
- 步骤：
  1. 用 API 直接对草稿单 O1 的 id 调 `POST /api/invoices` 登记正票，是否被接受。
  2. 确认草稿单 O1 即便被登记也不出现在工作台（工作台只查 active/void）。
  3. 对 O2 再点一次「登记发票」（正票），金额随便填，保存。
  4. 刷新工作台，看 O2「已开发票」列。
- 预期：`create_invoice` 只校验 order 存在（`invoices.py:51`），不校验 `order.status`、不阻止第二张 normal。所以：(1) 对 O1 登记正票返 201 成功——记录已落库（但 `list_invoice_orders` 只查 status∈{active,void}，`finance_service.py:49-54`，故 O1 不展示）；(2) O2 重复登记后「已开发票」列并排显示两个「正票」Tag（`FinanceManagement.tsx:193`），状态仍「已开票」，不报错不拦截。人工判定是否需加「一单一正票」唯一约束/重复提示、是否应禁止对草稿单登记。
- 为何人工：财务数据正确性与业务规则（一单一票）是否算 bug 需业务确认；无重复正票/草稿单登记的自动化约束。

---
**[P1] 部分退款订单：客户聚合仍全额在订 vs 发票工作台需冲红（跨模块口径分叉）**
- 前置：一张生效订单 O，实付 200，含 1 个当前分配版本有效履约目标（份数=4），invoice_required=True，已登记 1 张正票（200）；状态「已开票」，该收报人在客户列表、份数 4。
- 步骤：
  1. 对 O 记一笔部分退款 50 元（经订单模块退款入口，scope 选纯退钱/不停发），使 `refunded_amount=50`、`commercial_status=partial_refund`。
  2. 客户管理搜该收报人，读列表「在订份数」并点开抽屉看订单状态列。
  3. 财务管理→订单发票，找 O，看状态与「需冲红」计数。
  4. 对 O 再退 150 使累计=200 成全额退款（注意累计>实付 200 会被 `order_service.py:778` 拦 422），观察两处变化。
- 预期：partial_refund 不在客户聚合排除集——`_EXCLUDED_COMMERCIAL_STATUSES` 仅含 refunded/cancelled（`customer_service.py:35-38`），故列表该收报人份数仍 4（全额，不按退款比例缩减），抽屉订单状态显示「部分退款」；同时财务工作台 O 变「需冲红」（有正票+refunded 50>0+未冲红，`finance_service.py:72`）。累计退款达 200 后 `commercial_status=refunded`（`order_service.py:796-801`），该收报人从客户列表消失（被排除），但财务工作台 O 仍以「需冲红」保留（合规待办，void/refunded 不删正票不清退款）。验证两模块口径刻意不同步是符合设计的。
- 为何人工：把退款(订单)→客户聚合口径→发票工作台三处串成真实业务链，验证跨模块口径分叉；各单元有测试但此端到端组合无自动化。

---
**[P2] 改派（新分配版本）后旧地址不应成为客户列表「代表地址」**（代表地址语义，防回归）
- 前置：一张生效订单，收报人「钱七/135」；先建旧分配版本 v1（`effective_until_issue` 非空，地址「旧址」），再改派生成当前版本 v2（`effective_until_issue=NULL`，地址「新址」），让「旧址」目标的 target_id **大于**「新址」目标的 target_id（模拟乱序导入）。
- 步骤：
  1. 管理员进「客户管理」，搜「钱七」。
  2. 读该行「代表地址」列与是否有橙色「N 个地址」Tag。
  3. 点开抽屉，查看在订明细的收件地址列与行数。
- 预期：份数与明细只计当前版本 v2——`_eligible_target_query` 在 SQL 层过滤 `FulfillmentAllocation.effective_until_issue IS NULL`（`customer_service.py:84`），v1 目标不进结果集，故明细只有「新址」1 行；代表地址 `primary_address=max(addresses key=target_id)`（`:160-164`）只在当前版本行内取——因旧目标已被 SQL 过滤，即便 target_id 更大也不参与，代表地址仍应「新址」，address_count=1、不出现橙色多地址 Tag。若列表把「旧址」显示为代表地址则版本过滤失效（bug）。因 SQL 过滤已结构性保证旧目标不入集，本场景实为验证既有过滤器仍生效，属防回归。
- 为何人工：代表地址=max(target_id) 依赖单调递增假设，乱序 id 下「是否真是最新地址」的业务语义只能人工判断；橙色 Tag 属 UI 层。

---
**[P2] 合同/结算扫描件浏览器实际下载：中文原名 + PDF/图片可正常打开**（附件·端到端下载）
- 前置：一个合作渠道 + 一份合同；准备真实 PDF（文件名含中文，如「中通2026年度合同.pdf」）与一张 JPG。
- 步骤：
  1. 管理员进「合同管理」→「合同」，在目标合同行「附件」列点「上传」，选中文名 PDF。
  2. 上传成功后该列变「下载」，点「下载」。
  3. 检查下载目录落地文件名，双击打开验证内容。
  4. 删除后改上传 JPG，重复下载并用看图应用打开。
  5. 切「财务管理」→「渠道结算」，对某结算记录上传中文名 PDF 并下载验证同上。
- 预期：下载走 blob→createObjectURL→`<a download>`（`contracts.ts:137-149`），download 属性取 `attachment_filename`，落地名应等于上传原始中文名（后端 `FileResponse filename=attachment_filename`，`contracts.py:234-237`）；PDF/JPG 内容与上传字节一致、可打开。注意：落盘文件名被 `_safe_filename` 清洗为 ASCII+uuid（`attachment_service.py:30-42`），但下载呈现名仍是 DB 存的原始中文名——两者不同是正常的。若下载文件名变 uuid 乱码或中文乱码，则是编码/响应头问题。
- 为何人工：浏览器 blob 下载的真实落地、中文名在 Content-Disposition 的编码、能否被系统应用打开，headless 自动化无法可靠断言。

---
**[P1] 附件路径防目录穿越：被篡改的相对路径应被拦截为 404 而非泄露任意文件**（附件·安全边界）
- 前置：一份已上传扫描件的合同（取得 id）；能直接改 DB（模拟历史导入/原始 SQL 写坏 `attachment_path`）。
- 步骤：
  1. DB 把该合同 `attachment_path` 改为穿越路径，如 `../../../../etc/passwd`（Windows 下 `..\..\..\Windows\win.ini`）。
  2. 任意登录用户调 `GET /api/contracts/{id}/attachment` 下载。
  3. 再改为 uploads 目录外但看似合法的绝对路径，重复下载。
  4. 改回正常值确认下载恢复。
- 预期：`resolve_path` 用 `resolve()` 归一后校验 target 必须是 uploads_root 本身或其子孙（`attachment_service.py:57-61`），否则抛 ValueError→`download_attachment` 捕获转 404「附件路径无效」（`contracts.py:229-231`）。穿越路径与 uploads 外绝对路径都应返回 404，绝不能把 /etc/passwd 或 win.ini 内容吐出。若返回 200 且带出目标文件内容，即严重目录穿越漏洞。
- 为何人工：需构造被篡改的存储路径（正常上传永远生成 uuid 名，不会自然产生穿越路径），属安全边界；自动化仅验证正常下载。

---
**[P2] 替换合同附件后旧文件应从磁盘删除（不留孤儿）**（附件·落盘副作用）
- 前置：预发环境，可访问 `backend/uploads/contracts/`；一份合同。
- 步骤：
  1. 对合同上传 A.pdf，记 `uploads/contracts/` 新增落盘文件名。
  2. 再上传 B.pdf（替换），观察目录文件数变化。
  3. 合同行点「删除附件」，再看目录。
  4. （边界）对另一合同上传后，直接删除整条合同，确认落盘文件也被清理。
- 预期：替换后 DB 指向 B 的新文件，旧文件 A 被删（`contracts.py:213-214`：old_path 存在且 !=stored_path 才删；uuid 命名保证不同）；删除附件后 B 被删（`:252`）；删除整条合同先删行、再清落盘（`:165-169`，且有 settlement 引用会先 409 拦）；目录不应残留孤儿。注意：并发两管理员同时替换同一合同附件时后写覆盖 attachment_path、前者落盘可能成孤儿——已知竞态，单人顺序操作不复现。
- 为何人工：落盘增删是文件系统副作用，需人工查看 uploads 目录；提交与删文件的时序、竞态孤儿场景无自动化覆盖。

---
**[P1] 渠道结算侧 partner 悬空外键应优雅降级（partner_name 空串、不 500）**（财务·结算·孤儿降级）
- 前置：能直接写 DB。先建 partner 并建一条引用它的 `channel_settlements`，再直接从 DB 删除该 partner 行（SQLite 不强制 FK；或用原始 SQL 绕过守卫），制造悬空 partner_id。
- 步骤：
  1. DB 保留一条 partner_id 指向已不存在 partner 的结算记录。
  2. 任意登录用户进「财务管理」→「渠道结算」加载列表（`GET /api/settlements`）。
  3. 观察该结算行「合作渠道」列显示与整页是否报错。
- 预期：结算列表 `_to_out` 用 `s.partner.name if s.partner else ''`（`settlements.py:29-33`），悬空时 `partner_name` 降级空串，整页不 500、不抛 ValidationError。合同侧同类降级已有回归测试（`test_orphan_partner_degrades_gracefully`），但结算侧 `SettlementOut.partner_name` 同样依赖 `s.partner` 却无等价自动化测试——需人工确认结算侧也不因悬空 partner 崩页。
- 为何人工：需构造悬空外键（正常流程删 partner 会被守卫拦住），且结算侧此降级路径经核实无对应自动化测试（仅合同侧有）。

---
**[P2] 发票工作台全量计数（待开票/需冲红）不随筛选与搜索变化**（工作台·汇总提示）
- 前置：造 4 张 active 单、均 invoice_required=True：X1 未开票、X2 已开正票、X3 正票+退款未冲红、X4 正票+退款未冲红。
- 步骤：
  1. 管理员进「订单发票」，不加筛选，读右上角「待开票 N · 需冲红 M」。
  2. 状态下拉选「需冲红」，只显示 X3/X4，再读右上角两个数字。
  3. 搜索框输只匹配 X3 订单号的关键字，读右上角两个数字。
  4. 清空筛选与搜索，确认数字复原。
- 预期：`pending_count`/`needs_red_count` 在过滤前全量 orders 循环内累加（`finance_service.py:57-89`），rows 才在其后经 q/status 过滤（`:109-118`）。所以无论怎么筛选/搜索，右上角「待开票」恒 1(X1)、「需冲红」恒 2(X3+X4)，只有表格行数随筛选变化（前端直接渲染 `pending_count/needs_red_reversal_count`，`FinanceManagement.tsx:247-254`）。若切「需冲红」筛选后右上角数字跟着变成只数当前显示行，即把计数错误放到过滤后统计的回归。
- 为何人工：「计数不受筛选影响」这一不变量无专门自动化断言（基本状态虽已测）；且这是前端汇总提示与表格行数解耦的视觉一致性，适合人工 UI 交叉验证。

---
**[P1] 删除被下游引用的合作渠道应 409 并逐项列明各引用数**（合同·主数据·删除守卫）
- 前置：一个合作渠道 P，同时被多类下游引用：建 1 份合同(partner_id=P)、1 条结算记录(partner_id=P)；若环境有邮局模块，再让 P 作为投递单位关联 1 个履约目标(distribution_unit_id=P)/1 条投递记录/1 条投递明细/1 条投诉。
- 步骤：
  1. 管理员进「合同管理」→「合作渠道」，对 P 点「删除」并在 Popconfirm 确认。
  2. 观察弹出的 `message.error` 文案。
  3. 逐一解除引用（删合同、删结算、清邮局引用）后再次删除 P。
- 预期：删除前统计 合同/结算/履约目标/投递记录/邮局投递明细/邮局投诉 六类引用（`partners.py:98-123`），任一非零即 409，detail 拼出各引用数，如「该渠道下还有 1 份合同 / 1 条结算记录 / 1 个投递目标 …，不能删除（可改为「停用」）」（`:124-141`）；前端弹成 `message.error`。所有引用清干净后删除应 204。自动化仅覆盖合同与结算两类，投递目标/投递记录/邮局明细/投诉四类分支及「逐项列明」文案未覆盖。
- 为何人工：邮局投递/投诉/履约目标等引用需跨模块造数据才能触发完整分支；409 文案的「逐项列明」体验只能人工核对。

---
**[P2] 合同「快到期」Tag 的 end_date 边界（第 0/30/31 天）与作废/已过期不亮**（合同·派生提示·边界）
- 前置：同一渠道下建多份 active 合同，end_date 分别：今天、今天+30、今天+31、昨天（已过期）；再建一份 end_date=今天+10 但 status=作废 的合同。
- 步骤：
  1. 管理员进「合同管理」→「合同」，逐行查看「有效期」列是否出现橙色「快到期」Tag。
  2. 重点核对 end_date=今天、+30、+31、昨天 四行。
  3. 核对 status=作废 且 10 天后到期 那行。
- 预期：`_is_expiring = status==active 且 end_date 非空 且 (end_date-today).days ∈ [0,30]` 含边界（`contracts.py:31-36`，EXPIRING_WINDOW_DAYS=30）。所以：今天(days==0)→亮；+30(边界含)→亮；+31→不亮；昨天(days<0 已过期)→不亮；status=作废 那份即便 10 天到期也不亮（状态门槛先 return False）。人工判定边界日与非 active 状态的 Tag 呈现符合规则。
- 为何人工：日期边界（0/30/31）与「今天」强相关、随运行日漂移，适合人工按当天日期即时核对；橙色 Tag 属 UI 层。

---
**[P1] 非管理员（operator）登录时写入口全部隐藏、仅下载/查看可见**（权限·前端呈现）
- 前置：一个 operator 账号；库中已有渠道/合同(带附件)/结算/发票数据。
- 步骤：
  1. operator 登录，依次进「客户管理」「合同管理」（两页签）「财务管理」（两页签）。
  2. 合同/结算表格查看是否有「操作」列、「新增」按钮、附件「上传」入口、「删除」按钮。
  3. 对已有附件的行，确认是否仍能看到并点「下载」。
  4. （交叉）operator 直接调写接口（如 `POST /api/partners`）确认后端 403。
- 预期：前端按 isAdmin 隐藏：operator 下「操作」列整列不渲染（`ContractManagement.tsx:187-204`、`FinanceManagement.tsx:217-229、465-477` 均以 `...(isAdmin?[{操作列}]:[])` 拼接），新增/编辑/删除/上传不出现；附件列对已有附件仍显示「下载」（`FinanceManagement.tsx:436-439`，下载对所有登录用户开放）、对无附件行 operator 显示「无」（`:462`）；后端写接口对 operator 一律 403（require_admin，已由 `test_*_writes_require_admin` 覆盖）。人工确认前端 isAdmin 隐藏与后端 403 双层一致，operator 无任何写入路径但能查看下载。
- 为何人工：后端 403 已测，但前端 isAdmin 隐藏（操作列/按钮/上传入口是否真的不渲染）未被自动化覆盖，属 UI 呈现，需逐页核对。

---
**[P2] 删除最后一张正票使工作台状态从「已开票」回退「待开票」（点 Tag→Popconfirm 交互路径）**（财务·发票·状态回退）
- 前置：一张 active 单 invoice_required=True，已登记恰 1 张正票，状态「已开票」。
- 步骤：
  1. 管理员进「订单发票」，确认该单「已开票」（绿）。
  2. 「已开发票」列点该正票 Tag，弹 Popconfirm「删除该发票登记？」，点「删除」。
  3. 刷新工作台，观察该单状态与右上角「待开票」计数。
- 预期：`invoice_state` 全派生不落库；删掉唯一正票后 `has_normal=False`→state 回退 pending（`finance_service.py:79-80`），该单重新「待开票」（橙），pending_count+1。后端逻辑已被 `test_invoice_delete_flips_state_back_to_pending` 覆盖，但「点击发票 Tag→Popconfirm→删除」的前端交互路径（`FinanceManagement.tsx:199-209`）+ react-query invalidateQueries 后列表自动刷新的时序未被 UI 自动化覆盖，故保留为前端专属人工核验。
- 为何人工：后端派生逻辑虽有单测，但点击 Tag 触发 Popconfirm 删除的交互、缓存失效后列表即时刷新的时序属前端行为，端到端 UI 路径无自动化覆盖。

---

## 四、跨模块端到端剧本

把上面零散用例串成完整生命周期。每个剧本给出串起来的检查点，建议在各单点用例通过后压轴跑。

### 剧本 ① 电商订单全生命周期：导入 → 识别平台 → 脱敏收件人补录 → 生成订单 → 生成面单/发货 → 财务结算

**串联步骤**
1. **导入 + 自动识别平台**：准备一批 CBJ/淘宝混合导入行（含正常单、一条未识别状态怪串单、一条含短别名易误命中的名称、一条套餐实付<固定项的异常改价单），设批次起投月 + cutoff。走导入预览（自动 platform-detect）。
2. **脱敏收件人补录**：对脱敏收件人（如淘宝掩码手机）逐单补录真实姓名/地址/电话。
3. **生成订单**：提交导入，unknown 行落 active+paid、待付/关闭串被 skip、套餐负额腿仍入库。
4. **生成面单/发货**：对目标期跑一键排发（apply_all_for_issue）→ 生成 order_generated 行 → 一键标记本期已发。
5. **财务结算**：对生效单登记正票；做一笔部分退款；观察发票工作台与客户聚合。

**检查点（串起来核对）**
- CP1（导入→平台）：平台被正确识别；unknown 怪串行标「需人工确认」但仍落 active+paid、原始串进 `source_status_raw`；含「待付/关闭」行未出现在建单结果。（关联：订单-导入解析边界）
- CP2（商品匹配护栏）：短别名「618」误命中「618元话费充值」→需在预览拦下改正；改完整活动串后回待确认。（关联：商品-短别名）
- CP3（套餐资金）：套餐实付<固定项的单，商学院腿 `subtotal=-40` 负额入库、预览有黄警告——确认是否应硬拦；负额是否污染后续发行统计/金额汇总。（关联：商品-负额；★是钱正确性）
- CP4（覆盖期）：cutoff 当天付款不顺延、次日顺延；混合投递套餐两腿起投月按 delivery_method 各自取值 + bonus 各叠一月——逐腿核对起止。（关联：商品-cutoff/多变量）
- CP5（脱敏补录→排发前置）：补录后的姓名/地址齐全，才使排发候选成立；未补录的应在排发 preview 里被 skip（缺姓名地址）。
- CP6（排发/发货）：一键标记本期已发只标 order_generated 行，手工/历史导入行 `shipped_at` 仍空——确认是否漏发。（关联：发货-ship-all 口径）
- CP7（对账 vs 导出背离）：把某已生成发货行的订单作废 → 对账卡仍显「一致」，但导出中通面单份数变少 → 背离即 bug。（关联：发货-作废背离；★是发货正确性）
- CP8（财务闭环）：部分退款后，财务工作台该单变「需冲红」、客户聚合份数仍全额（partial 不排除）；红冲金额留空则被当「已覆盖」漏催——确认合规风险。（关联：财务-needs_red / 跨模块口径分叉）

### 剧本 ② 履约版本与期数一致性：商品起投月 → 覆盖期 → 应发期数 → 期数漂移 → 报数一致性

**串联步骤**
1. **起投月 → 覆盖期**：建两条订阅明细：一条中国经营报周报（起投月 2026-07、邮局、半年）、一条商学院月刊（起投月 2026-12、全年，跨到无刊历的 2027）。
2. **应发期数**：确认订单，定格各明细 `expected_issues_at_creation` 快照。
3. **期数漂移**：对已生效单手工改覆盖期结束日（制造假 drift）；另观察建单页预览期数 vs 落库权威值。
4. **报数一致性**：对某期把订单同步的行纳入报数，确认报数（confirm）后回看溯源与对账。

**检查点**
- CP1（覆盖期口径分歧）：中国经营报明细，建单预览「参考覆盖期」= 真实首末刊日，落库 RangePicker = [1号,末月末日]——二者不同，确认是否误导。（关联：商品-预览覆盖期分歧）
- CP2（月刊期数）：商学院全年从 12 月跨年到 2027 → 应发期数显示 **1**（应约 12）；换半年从 11 月 → 显示 **2**（应 5）——低估 bug#3。（关联：商品-bug#3 两条；★是数据正确性）
- CP3（预览高估 vs 权威）：商学院建单页 Alert「预计发货 ≈26 期」（周刊高估）vs 详情落库 ≈6——预览大、落库小的不一致。（关联：订单-商学院预览高估）
- CP4（假 drift）：手工改覆盖期后，快照不重算 → 立即标 drift、`has_drift` 筛选命中——确认操作员是否会误读为真实排期漂移。（关联：商品-快照/drift）
- CP5（has_drift 分页复核）：带 `has_drift=true` 翻页，核对每页满 limit、total=真有 drift 单数（本分支已修，作回归）。（关联：已知缺陷 2.3）
- CP6（报数溯源与双计）：confirm 自动复制上期明细时，order_generated 行被复制且溯源丢成 manual → 再跑同步双份重复计入对账；且列表「已同步」列恒显 0 与详情真实进度不一致。（关联：发货-confirm 复制 / 订单-列表 synced=0；★是发货正确性）

### 剧本 ③ 邮局投递闭环：起投明细 → 关联读者 → 应用新地址 → 投诉三态处理

> 邮局=投递方式、不造订单、不进订单列表；以下走投递记录层。

**串联步骤**
1. **月度起投明细**：进入邮局投递模块，按某月生成/查看起投明细（该月应起投的投递项）。
2. **关联读者**：对起投明细关联已读者（收报人），补齐投递单位（有则标注、无则留空、不推断）。
3. **应用新地址**：对某读者应用新地址（经 address_service 规范化），观察投递明细地址更新与规范质量。
4. **投诉三态处理**：对某投递记录发起投诉，走 待处理 → 处理中 → 已处理（关闭）三态流转，并测删除被投诉引用的合作渠道被 409 拦。

**检查点**
- CP1（起投明细口径）：月度起投明细的应起投项与订单覆盖期/起投月一致；投递单位「有则标注、无则留空」，不出现推断出的错误单位。（关联：邮局投递模块设计约束）
- CP2（关联读者）：关联后该读者的投递明细正确挂接；同名同号不同地址的两个投递点应能各自成立（对照发货侧「同名同号不同地址被误判重复」的教训，确认邮局侧是否也有类似合并/误判）。（关联：发货-同名同号不同地址 409）
- CP3（应用新地址·规范化质量）：新地址经 cpca 规范后省市区前缀补全、市辖区/短区名歧义/含空格的处理质量抽样；注意批量规范化端点是全库、无按期、当前无前端按钮，须直接调 API。（关联：发货-批量规范化地址）
- CP4（投诉三态）：投诉状态机 待处理→处理中→已处理 正确流转、不可逆/可逆规则符合预期；已处理后是否仍可被引用统计。
- CP5（删除守卫逐项列明）：让合作渠道 P 同时被合同/结算/投递目标/投递记录/邮局投递明细/投诉六类引用，删除 P 应 409 且逐项列明各引用数；逐一解除后方可删除。（关联：合同-删除守卫；这是把邮局投诉/投递引用串进主数据删除守卫的关键跨模块点）

---

**回填要求**：凡「疑似bug」用例，请在执行后回填结论（确认为 bug / 属可接受设计 / 无法复现），并注明当前分支 `feat/postal-delivery-redesign` 与核对日期。

---

相关文件（绝对路径，便于开发定位）：
- 退款/取消/收款未拦 draft：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\services\order_service.py:763`（refund）、`:849`（cancel）、`:908`（payment）
- 月刊期数低估 bug#3：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\services\expected_issues_calculator.py:121-133`
- 对账 vs 导出口径背离：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\api\reports.py:140` 与 `C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\services\excel_service.py:318`
- confirm 自动复制丢溯源：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\api\reports.py:73` / `:41`
- 发货明细 >200 截断：`C:\Users\xichen5\PersonalRepos\FirstTry\frontend\src\pages\Recipients.tsx:245/452/476`
- 同名同号不同地址误判：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\services\order_shipping_sync_service.py:427`
- has_drift 分页（已修，复核）：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\services\order_service.py:1245-1252`
- 订单列表日期筛选（已接线，复核）：`C:\Users\xichen5\PersonalRepos\FirstTry\backend\app\api\orders.py:92-93` → `backend\app\services\order_service.py:1265-1268`

---

## 三（续）· 补跑模块用例（直接读码产出）

> 首轮多智能体工作流在这 4 个模块「出用例」阶段卡死（基础设施层 agent 挂起），故改为逐文件读码补出。**两项已在代码层核实属实**（非臆测）：
> ① 报数「确认」自动复制上期明细，会把 `order_generated` 行溯源抹成 `manual`（`backend/app/api/reports.py:41-46` 复制字段集不含 source_type/sync_status/order_id、`:73-78` 复制查询不过滤 source_type）；
> ② 中通面单导出排除孤儿/作废行、而对账卡 SUM 不排除（`backend/app/services/excel_service.py:316-328` vs `backend/app/api/reports.py:140-144`）。

**Part B 优先速览**

| 优先 | 用例 | 模块 |
|---|---|---|
| P0 | 报数确认自动复制上期→`order_generated` 溯源丢成 manual、下期双计（读码确认） | 报数 |
| P0 | 导出面单排除孤儿/作废行 vs 对账卡 SUM 不排除（读码确认） | 导出 |
| P1 | 任意登录用户可「确认报数」触发复制副作用，仅 admin 可作废 | 报数·权限 |
| P1 | 淘宝脱敏收件人未补录→占位「(未填写)」流入发货 | 导入 |
| P1 | 应用改地址就地改订单当前目标（不升 allocation 版本、多目标只改第一个） | 邮局 |
| P1 | 投诉三态无方向校验、可任意跳转/回退 | 邮局 |
| P1 | 平台自动识别失败→422；一次性会话重复 commit→400；去重双保险 | 导入 |
| P1 | 月度起投批次冻结/重生成/已发拒改；名册「月」筛选须带 year | 邮局 |
| P1 | 印数排期校验（期号连续+1/日期不重复）阻断 commit | 排期 |

### 3.5 订单导入（菜鸟 CBJ / 淘宝）

---
**[P1] 平台自动识别：无法识别的表头→422；淘宝/CBJ 各自落对平台**
- 前置：三个文件——真实 CBJ 导出（表头含「订单号/产品名称」）、真实淘宝导出（表头含「订单编号/商品标题」）、一个随便的 xlsx（表头都不匹配）。
- 步骤：1) 导入页依次上传三个文件走「预览」。2) 看 CBJ 单的 `source_platform`、淘宝单的 `source_platform`/`source_store`。3) 看随便 xlsx 的返回。
- 预期：`_detect_and_parse`（`cbj_order_import_service.py:455-472`）按表头签名分派：淘宝→`source_platform=淘宝`、`source_store=中国经营报发行部`；CBJ→`CBJ小程序`；都不匹配→抛 ValueError→接口 422「无法识别的订单导出格式…」。同一上传框两种平台都能用。
- 为何人工：需两种真实导出文件 + 预览页显示平台标签；自动化不覆盖「预览页平台呈现」。

---
**[P1] 淘宝脱敏收件人：导入即占位「(未填写)」，必须逐单补录后才能发货**
- 前置：一份淘宝导出（`收货地址` 是脱敏前缀「江苏省 南京市 …****」、无姓名/电话）。
- 步骤：1) 预览+确认导入。2) OrderDetail 打开该单，看 `payer_name`/收件人/地址。3) 不补录，直接对相应期跑排发 preview。4) 再 OrderDetail 编辑补真实姓名/电话/地址后重试排发。
- 预期：`taobao_order_import_parser.py:217-219` 收件人姓名/电话留空、地址存脱敏前缀（hint）；`cbj_order_import_service.py:367-372`/`389` 落 `payer_name="(未填写)"`、目标 `recipient_name/address="(未填写)"`。未补录时该单目标姓名/地址是占位符，排发要么被 skip（缺姓名地址）、要么把「(未填写)」写进面单——发货正确性风险。补录后方可正常排发。这就是脱敏→逐单 topup 工作流。
- 为何人工：脱敏补录是跨「导入→订单→发货」的人工闭环；自动化测不到「不补录会流出占位收件人」。

---
**[P1] 一次性会话握手：重复 commit 同一 session→400**
- 前置：一份全新订单文件。
- 步骤：1) 预览得到 `session_id`。2) commit 一次（成功、返回 created/skipped_duplicates）。3) 用同一 `session_id` 再 commit 一次。
- 预期：`commit_import` 用 `pop_order_import_session` 一次性取出会话（`cbj_order_import_service.py:506-510`）；第二次 commit→400「导入会话不存在或已过期，请重新预览」。防重复提交造重复单。
- 为何人工：需手动重放 commit；自动化通常只走一次。

---
**[P1] 去重双保险：预览标 duplicate + commit 再查一次**
- 前置：系统已有订单 `external_order_no=X`；导入文件含 X 与若干新单。
- 步骤：1) 预览：X 是否标 `duplicate`「订单号已存在，跳过」、计数正确。2) 在预览与 commit 之间，另建/导入一张同为新单里某个 `external_order_no=Y` 的订单。3) commit，看 `skipped_duplicates`。
- 预期：预览期用 existing 集合标 duplicate（`:242-243`）；commit 再查一次 existing、过滤已存在者（`:513-520`），Y 在此被拦、计入 `skipped_duplicates`。两道去重防并发/重复导入。
- 为何人工：需构造预览-提交之间的并发插入；单测一般不覆盖 TOCTOU 窗口。

---
**[P1] 忽略名单：整单只含忽略品→跳过；多商品单丢弃忽略行、其余照导（金额受影响）**
- 前置：三张单——(a) 只含「家族企业」行；(b) 含「电子刊」；(c) 含一条「深潜」+ 一条正常商品行。
- 步骤：1) 预览三张。2) 看 (a)(b) 的 decision，(c) 的商品行数与金额。
- 预期：`_IGNORED_PRODUCT_KEYWORDS`＝家族企业/深潜/深度系列/电子刊/对公专用/利润薄如刀片（`:213`）。整单只含忽略品→`skip_status`「已忽略（特殊品/对公/电子刊等，不导入）」；多商品单里忽略行被**静默丢弃**、其余照常导入（`:256-267`）——注意单一真实行的 line_paid=实付−运费，丢弃忽略行可能让金额归属与直觉不符。
- 为何人工：预览分类 + 多商品单静默丢行对金额的影响需肉眼核。

---
**[P1] 未识别状态串→仍导入并标黄；待付/关闭→skip；原始串留档**
- 前置：导入文件里放三行怪状态：「审核中」（词典/关键字都不命中）、「等待付款」、「交易关闭」。
- 步骤：1) 预览。2) 看三行 decision、`commercial_status`、是否标 `status_unknown`（黄）。3) 确认导入后看落库单 `source_status_raw`。
- 预期：`map_commercial_status`（`order_import_status_service.py:45-65`）：怪串→`paid + should_import + unknown=True`（导入、落 active/paid、预览标黄请核）；「等待付款/待付/未付」→pending_payment+skip；「交易关闭/已关闭/取消」→cancelled+skip；原始串始终存 `source_status_raw`。
- 为何人工：映射分支单测已覆盖，未覆盖的是「预览黄标呈现 + skip 行不进建单结果」这层 UI 端到端。

---
**[P0] 商学院单期 vs 中国经营报往期 的识别护栏**
- 前置：两条商品库未匹配的行：(a) 名称含「2026年5月刊《商学院》」或淘宝「【2026单期】《商学院》」；(b) 名称含「中国经营报」且带某日期/期次样式。
- 步骤：1) 预览。2) 看 (a) 是否按商学院单期落库（`issue_label` 有值；淘宝无分册名时留空并标黄「商学院单期：请补该单期次」）；(b) 是否进 unresolved 待确认队列而非被误记为商学院。
- 预期：`build_import_preview:281-318`——未匹配行若能解析出商学院月刊期次或命中「【YYYY单期】《商学院》」**且不含「中国经营报」**→按商学院单期（publication=business_school、single_issue）落库；含「中国经营报」→不触发该分支、进 unresolved。护栏防止带日期的中国经营报被误记为商学院并绕过待确认队列。
- 为何人工：需构造刁钻商品名触发护栏两侧；自动化难穷举。

---
**[P1] 活动赠品：含订阅的单加免费赠品行，纯单期单不加**
- 前置：批次设 `gift_publication=商学院`、`gift_note=618赠`；导入文件含一张「订阅」单 + 一张「纯单期」单。
- 步骤：1) 预览。2) 看订阅单是否多出一条 0 元赠品明细、纯单期单是否没有。
- 预期：`gift_publication` 且订单含 subscription→追加 `_gift_item`（`:376-381`）：fulfillment_type=gift、billing_type=free_gift、unit_price/subtotal=0、收件人镜像主单。纯单期单不加。赠品是 CBJ 导出没有、按活动人工配置补全的行。
- 为何人工：活动赠品是 off-platform 人工配置，需验证只加给订阅单。

---
**[P2] 权限：预览任意登录可用、提交仅 admin**
- 步骤：operator 登录，`POST /api/order-import/preview`（应 200）与 `POST /api/order-import/commit`（应 403）。
- 预期：preview 依赖 `get_current_user`、commit 依赖 `require_admin`（`order_import.py:35,77`）。
- 为何人工：前端按钮通常已隐藏，需直接打 commit 验证后端 403。

### 3.6 邮局投递（投递名册 / 月度起投 / 改地址 / 投诉三态 / 收款）

> 心智模型：邮局＝投递方式，投递记录（PostalDelivery）是独立台账层，不造订单、不进「订单列表/客户管理」。写操作一律 `require_admin`，读对所有登录用户开放。

---
**[P1] 投递名册编号归一 + 查重（新增/改编号）**
- 前置：管理员；某年已有投递记录 `delivery_no=680`。
- 步骤：1) 新增投递记录，编号填「000680」、同年。2) 新增编号填「abc」/空。3) 把另一条记录的编号改成同年的「680」。
- 预期：`norm_no` 去前导零（`postal_common.py:12-15`）「000680」→「680」→与已有撞→409「编号 {year}-680 已存在」；非数字/空→400「编号必须为数字且不能为空」；改编号撞已有→409（`postal_delivery_service.py:107-166`）。
- 为何人工：编号归一+查重是台账主键护栏，需喂等价编号变体。

---
**[P1] 更新投递记录：必填列显式传 null 视为「不修改」**
- 步骤：PUT 某投递记录，body 把 `recipient_name`/`year`/`copies`/`recipient_address` 之一传 `null`、同时改 `notes`。
- 预期：`update_delivery:144-147` 把这几个必填列的 null 从 patch 里剔除（避免落 NOT NULL 触发 500），其余字段照改、`notes` 生效。
- 为何人工：前端清空必填字段的兜底，需直接构造含 null 的 PUT。

---
**[P0] 删除被「未发批次」引用的投递记录→409；仅被「已发批次」引用→放行（且已发批次快照不受影响）**
- 前置：某投递记录 D 落在两个批次里：批次 M1（draft/generated，未发出）、批次 M2（已 sent）。
- 步骤：1) 删除 D。2) 若被 M1 引用→看是否 409。3) 把 M1 标记已发（或重生成剔除 D）后再删 D。4) 删除后打开 M2 的明细/导出，看 D 冻结那行是否仍在、数据是否完整。
- 预期：`delete_delivery:169-187` 统计引用 D 的 `PostalDeliveryRow` 且所属批次 `status != sent`，>0→409（提示先重生成或标记已发）；只被 sent 批次引用→放行删除，M2 的冻结行（snap_* 快照）独立保留、导出仍正确。**生产 MySQL 上还需确认**：删除被 sent 批次行引用的投递记录是否触发外键约束错误（服务层放行、DB 若 RESTRICT 可能 500）。
- 为何人工：删除守卫 + 已发批次快照独立性 + 跨库 FK 行为，跨投递记录/批次两表。

---
**[P1] 月度起投批次：生成/冻结/重生成幂等/已发拒改**
- 前置：某年某月有若干投递记录 `coverage_start_date` 落在该月。
- 步骤：1) `生成批次`(year,month)，看 row_count 与冻结行。2) 改一条投递记录地址，再对同月`重新生成`，看是否清旧行重建、行数刷新。3) 把批次`标记已发`，再`重新生成`同月。4) 对 draft（未生成）批次直接`标记已发`。
- 预期：`_candidate_deliveries` 取 `coverage_start_date ∈ [当月1号, 次月1号)` 冻结成 `PostalDeliveryRow`（`postal_batch_service.py:27-120`）；draft/generated 可重生成（清旧行重建、幂等）；sent→重生成 409「已发出（冻结），不可重新生成」；draft→标记已发 409「草稿批次尚未生成明细」。
- 为何人工：起投月归批口径 + 冻结/重生成语义，需多状态流转。

---
**[P1] 名册「月」筛选口径 = 起投月区间；且「月」必须与「年」同时给否则静默失效**
- 步骤：1) 名册页只选「月=7」不选年，看结果。2) 再补「年=2026 + 月=7」，对比。3) 与「生成 2026-07 批次」的行集合对比。
- 预期：`_deliveries_query:39-46` 的月筛选是 `if year and month:` ——只给 month **被静默忽略**（不报错、全量返回）；给全 year+month 时用 `[当月1号,次月1号)` 区间，与批次 `_candidate_deliveries` 同口径→应给相同集合。
- 为何人工：month-without-year 静默失效 + 名册/批次两处口径一致性，需交叉核对。

---
**[P0] 投诉三态无方向校验：可任意跳转/回退**
- 前置：一条投诉工单（open 待处理）。
- 步骤：1) 登记一次处理，`result_status` 直接选「已处理(resolved)」，跳过处理中。2) 再登记一次处理选「待处理(open)」把它退回。3) 或直接 PUT 工单把 status 改成任意态。
- 预期：`add_handling:200-238` 直接把 `status` 置为传入 `result_status`（缺省 in_progress），**不校验方向**；`update_complaint:160-164` 也能直接改 status。故 open→resolved 跳档、resolved→open 回退都允许。判定点：业务上「三态」是否应强制 open→in_progress→resolved 单向？当前是自由跳转。
- 为何人工：状态机是否该受限是业务判断；无方向约束的自动化守卫。

---
**[P1] 删处理记录→状态按剩余最新处理回退（含导入基线不误置）**
- 前置：一条投诉，连续登记 2 次处理（最终 resolved）。
- 步骤：1) 删掉最新那条处理记录。2) 看 `handling_count` 与 status。3) 再删光所有处理记录。4) 另造一条「有导入基线次数(handling_count>0)但无子表处理行」的投诉，删其处理记录。
- 预期：`delete_handling:241-281`——count−1、status 回退到剩余最新处理的 `result_status`；删光且 count 归 0→回 open；但若仍有导入基线（count>0 却无子表行）→保留原状态、不误置 open。
- 为何人工：纠错回退多分支，尤其「导入基线不误置待处理」，需构造基线数据。

---
**[P1] 投诉手工新增：按编号+年度自动关联投递记录 + 回填快照**
- 步骤：手工新增投诉，填 `year+delivery_no`（对应某投递记录）、`snap_*` 留空。
- 预期：`create_complaint:120-143` 用 `link_delivery`（编号去零+年度）关联→带出 `external_order_no`、`postal_delivery_id`、继承投递记录的 `order_id`（多数 None）；`_backfill_snapshot` 用投递记录收报人回填空的 snap_*；`handling` 文本经 `routed_label` 归一（\d*11185/XX局）。
- 为何人工：关联 + 快照回填 + routed_label 归一需真实编号数据。

---
**[P0] PR-E 关联回访并入投诉时间线，不在独立工单列表重复出现**
- 前置：同一年度 + 编号下已有一条投诉工单。
- 步骤：1) 新增或导入同编号回访。2) 查看「全部」和「回访」筛选的数量。3) 打开投诉处理抽屉查看工单时间线。4) 编辑回访结果后重新打开时间线。5) 从时间线删除该回访。
- 预期：关联回访不增加独立回访计数；投诉时间线出现绿色「回访」事件，编辑后结果同步，删除后事件和来源回访同时消失。无同编号投诉的回访仍作为独立工单展示。
- 为何人工：需核对统一列表计数、抽屉时间线标签和删除交互的视觉一致性；后端关联与迁移已有自动化覆盖。

---
**[P0] 应用改地址：回写投递记录 + 就地改订单「当前」目标（不升 allocation 版本、多目标只改第一个）**
- 前置：改地址工单 AC1 关联到投递记录 D（D 挂了真实订单 O，O 有 ≥2 个 active 履约目标）；AC2 未关联任何投递记录。
- 步骤：1) 对 AC1 点`应用`。2) 看投递记录 D 的 recipient_*/省市区/份数是否更新为新值。3) 看订单 O 的**当前**履约目标 recipient_* 是否被就地改、改了哪个/几个目标、是否新建了 allocation 版本。4) 再次`应用`AC1。5) 对 AC2`应用`。
- 预期：`apply_address_change:129-192`——写回投递记录 recipient_*（`new_address` 经 cpca 拆省市区）、`new_copies` 改份数；D 挂订单时 `_current_target`（active + `allocation.effective_until_issue IS NULL`、**order_by id 取第一个**）被**就地**改 recipient_*，**不新建 allocation 版本**、**多目标只改最小 id 那一个**；重复应用→409「已应用，请勿重复」；AC2 未关联→400「未关联到投递记录…请先导入读者名册」。
- 为何人工：跨「投递记录↔订单当前目标」就地回写、不升版本、多目标只改一个——都需真实关联单在 UI 走一遍核对，无端到端自动化。

---
**[P1] 邮局收款/发票挂单口径（与「财务·订单发票工作台」是两套）**
- 前置：订单库有 `external_order_no=Z` 一张、同名付款人「王五」的订单恰好 2 张。
- 步骤：手工新增邮局收款：(a) 填 `external_order_no=Z`；(b) 只填付款人「王五」；(c) 填一个唯一付款人。分别看 `link_by`/`order_id`；填 amount 与 fee 看 `net_amount`。
- 预期：`_resolve_link:78-88`——原始订单号精确命中→`link_by=order_no`；否则付款人姓名**唯一**命中→`name`，同名多单→不挂（`none`）；都不中→`none`。`net_amount=amount−fee_amount` 派生（`:97-98`）。注意这是**邮局侧收款台账**，与「财务管理·订单发票工作台」完全两套，别混淆。
- 为何人工：挂单兜底口径 + 与财务模块区分，需构造同名多单。

---
**[P1] 重构新增：概览统计卡 / 快筛 chip 口径与明细表解耦**
- 前置：名册/投诉/改地址/收款四个 tab 各有多行不同状态数据。
- 步骤：逐 tab 切换筛选/搜索，观察顶部统计卡数字与下方明细表行数是否按各自口径变化。
- 预期：`summarize_*` 各自口径——名册卡＝合计份数/投递单位数(distinct 忽略 NULL)/未填单位条数(NULL 计数)（`postal_delivery_service.py:81-102`）；投诉快筛＝按状态计数**忽略状态筛选**（`postal_complaint_service.py:72-98`）；改地址＝待应用/未匹配/已应用；收款＝合计金额/合计到款/未挂单数**忽略挂单筛选**（`postal_finance_service.py:57-73`）。故切「投诉=已处理」筛选时，明细表只剩已处理行，但三态快筛计数仍是各态全量——两者刻意解耦。
- 为何人工：重构新加的 summary 卡 vs list 口径一致性/解耦，纯前端+聚合，回归高风险。

---
**[P2] 投递单位「有则标注、无则留空、不推断」**
- 步骤：造一条有 `distribution_unit_id`、一条无的投递记录；看名册列表「投递单位」列、名册卡「未填单位」计数、批次导出 xlsx 该列。
- 预期：`_partner_name`/`_unit_names`（`postal.py:61-88`）有则显示 `Partner.name`、无则留空——不出现推断单位；`summarize_deliveries` 的 `missing_unit_count` 计 NULL 条数、`unit_count` 用 distinct 忽略 NULL；导出该列无值时留空（`postal.py:257-264`）。
- 为何人工：核对产品约束「留空不推断」，需有/无单位两类数据。

---
**[P2] 批次导出用冻结快照、与投递记录实时值脱钩**
- 步骤：生成并标记已发某月批次→改其中一条投递记录地址→再导出该已发批次 xlsx。
- 预期：`export_batch`（`postal.py:242-273`）导出的是 `PostalDeliveryRow.snap_*` 冻结快照，不随投递记录后续修改变化——已发批次导出仍是出批时的地址。
- 为何人工：快照独立性需改数据后打开 xlsx 核对。

### 3.7 期数 · 报数 · 印数排期

---
**[P0] 报数「确认」自动复制上期明细→`order_generated` 溯源丢成 manual、下期双计（读码已确认属实）**
- 前置：N 期（如 2654）既有手工行也有 `order_generated` 行；N+1 期（2655）**当前 0 条发货明细**、报数 draft。
- 步骤：1) 确认 2655 当前 0 明细。2) 2655 报数编辑页填好变动项→`确认报数`。3) 回 ZTO-MF 页看复制来的行：逐行看 `source_type`/`sync_status`/`order_id`。4) 对 2655 再跑一次订单同步（给同一订户建 order_generated 行），或看报数对账「发货明细合计」是否把复制来的订单份数又算一遍。
- 预期（bug）：`confirm_report`→`_copy_previous_shipping_details_for_confirm`（`reports.py:206-224,49-106`）在 2655 无任何明细时复制上期全部行；复制查询**不过滤 source_type**（`:73-78`）、复制字段集 `_SHIPPING_DETAIL_COPY_FIELDS`（`:41-46`）**不含 source_type/sync_status/order_id**→复制行落模型默认 `source_type=manual`、`sync_status=synced`、`order_id=NULL`。结果：①订单溯源被抹成手工；②这些「假手工」份数进 2655 对账 SUM；③再同步→同一订户另建 order_generated 行→双计。正确应像手工复制路径（`shipping_details.py` 的 `_copy_shipping_details_from_previous` 显式排除 order_generated）一致。
- 为何人工：需 confirm 触发 + 逐行核对 source_type + 后续同步双计，无等价自动化。

---
**[P0] 报数权限不对称：任意登录用户可「确认」触发复制副作用，仅 admin 可「作废」**
- 前置：普通 operator 与 admin 各一账号；某期 draft 报数。
- 步骤：1) operator 登录，对该期 `POST …/report/confirm`。2) 看是否成功、是否触发上一条的复制副作用、期变 confirmed。3) operator 再 `POST …/report/revoke`。4) 改用 admin revoke。
- 预期：`confirm_report` 依赖 `get_current_user`（`reports.py:207`）——**任意登录用户都能确认**并触发复制/快照/锁定；`revoke_report` 依赖 `require_admin`（`:271`）——operator 作废 403、仅 admin 可解锁。即 operator 能锁不能解。判定该不对称是否符合预期。
- 为何人工：需切两身份验证 confirm 可、revoke 403；测试库无 confirm 权限用例。

---
**[P1] 确认后改报数 403、需先作废；作废→改→再确认累积快照/修订**
- 步骤：1) 已 confirmed 期，PUT 报数改变动项→应 403。2) PUT 临时加印明细→应 403。3) admin `作废`→期回 draft、`revision_number` 递增。4) 改数值→再 `确认`→看是否新增一条 confirm 快照（不覆盖旧）、`get_report` 的 `confirmation_summary` 取最新。
- 预期：`update_report:186-187`/`update_temp_print_details:365-366` confirmed→403「报数已确认，如需修改请先作废」；`revoke_report:288-312` 写 `ReportRevision`（编号递增）、回 draft；再 confirm 新增 `IssueAuditSnapshot`；`get_report:131-139` latest_confirmation 按 `created_at desc,id desc` 取最新。
- 为何人工：确认/作废/再确认多步状态机 + 快照选取 + 权限，需多身份多步。

---
**[P1] confirm 复制仅在「目标期零明细」触发→操作顺序敏感**
- 步骤：对同一期分两种顺序各走一遍：(A) 先对该期跑一次订单同步（生成 ≥1 条 order_generated 行）再确认报数；(B) 先确认报数再同步。对比该期最终明细来源与对账。
- 预期：`_copy_previous_shipping_details_for_confirm:54-62`——目标期已有任一明细（`locked_existing_ids` 非空）→`return 0` 跳过复制。故 (A) 不复制上期、(B) 复制上期——结果完全不同。
- 为何人工：操作顺序敏感的隐性差异，需两种顺序对比。

---
**[P1] 印数排期解析校验阻断 commit（期号连续+1 / 日期不重复 / 休刊不填期号）**
- 前置：一份真实排期 PDF（含休刊行、若有合刊）；admin。
- 步骤：1) `上传预览`，看 rows/errors/can_commit。2) 在预览里手工把某期号改成跳号（如 2660 后填 2662）、或把两行改成同一出版日期、或给休刊行填期号。3) 看 `errors` 与 `can_commit`。
- 预期：`validate_schedule_rows`（`publication_schedule_parser.py:187-218`）——非休刊期号必须严格 +1（否则「期号必须连续递增：X 后应为 Y，实际为 Z」）、同年出版日期不得重复（「同一年内出版日期重复」）、休刊行不能填期号、日期年份须等于识别年份；任一 error→`can_commit=false`、commit 被挡。
- 为何人工：需真实 PDF 解析 + 预览编辑纠错回路，UI 端到端。

---
**[P1] 休刊行落 `issue_number=NULL`，及其与「整期误休刊」bug 的真实触发前置**
- 说明：编辑排期行时休刊行被强制 `issue_number=None`（`schedule.py:169`）；但 `validate_schedule_rows` **禁止同一 publish_date 出现两行**（`parser.py:196-198`）。所以 Part A 提到的「NULL 休刊行误伤整期」**无法**通过正常排期导入在同一天既放正常期又放休刊 NULL 行来构造。
- 步骤（诚实复核该 bug 是否可复现）：1) 尝试在排期预览里给同一出版日建「正常期号行 + 休刊行」→应被校验拦下。2) 若要复现 Part A 的整期误休刊，需跨来源造：排期表某日一条休刊 NULL 行 + `issues` 表某正常期的 `publish_date` 恰与之相同（期号来自别处）→再对该正常期跑排发 preview，看是否被 `_is_suspended_issue`（`order_shipping_sync_service.py` 的 `or_(issue_number==本期, issue_number.is_(None))`）误判整期休刊。
- 预期：正常导入路径下该组合被校验阻断（说明此 bug 触发前置苛刻）；仅当跨来源/手工造出「同日休刊 NULL 行 + 正常期」才可能复现整期停发。请据此判定风险等级。
- 为何人工：需诚实验证 bug 触发前置、跨排期表/issues 表手工造数据。

---
**[P2] PDF 解析边界（扫描件/无年份/超大/合刊/非周一）**
- 步骤：分别上传：扫描图片版 PDF、无「YYYY年」字样的 PDF、超 `MAX_PDF_UPLOAD_MB` 的 PDF、含「合刊」或某出版日非周一的排期。
- 预期：无可抽取文本→400「PDF 未包含可抽取文本，请上传文字版 PDF」；无年份→「无法识别出版年份」；超限→400（`schedule.py:28-32`）；`_resolve_publish_date:304-316` 假设周一出刊（weekday==0），非周一日期会顺延月份匹配、匹配不到则「无法匹配出版日期」；合刊按连续期号校验（跳号会报错）。
- 为何人工：真实 PDF 多样性（中文数字年份/对开N版/合刊/休刊）只能人工喂样本。

---
**[P2] 上传记录自动清理 + 只删待确认**
- 步骤：1) 对某年 `预览`一份上传（previewed）。2) 对同年 `commit` 另一份上传。3) 再 `list uploads`，看该年 previewed 记录是否被自动删。4) 尝试 `discard` 一个已 committed 上传。
- 预期：`list_schedule_uploads:96-111`——某年已有 committed→该年所有 previewed 上传被自动删除；`discard:212-230` 只能删 previewed（committed→400「只能删除待确认的上传记录」）。
- 为何人工：预览残留自动清理时序需多次上传观察。

### 3.8 前端 · 打印 · 导出 · 搜索

---
**[P0] 中通面单导出 vs 对账卡口径背离（读码已确认，与发货 P0 同根）**
- 前置：某期 2655 有若干 `order_generated` 行、对账卡显示「一致」；其中订单 A 的行。
- 步骤：1) 记对账卡「发货明细合计/差值」。2) 订单模块把 A 作废（其行置 orphaned）。3) 回 ZTO-MF 页看对账卡数字/颜色。4) 导出 `/export/shipping` xlsx 数行数/份数。
- 预期（bug）：`export_shipping_excel:316-328` 导出**排除** `sync_status=orphaned` 且排除 link 到 `void` 订单的行→作废后导出份数变少；而 `get_report` 的 `current_shipping_total`（`reports.py:140-144`）是 `SUM(quantity)` **不排除**→对账卡仍显旧值、差值仍「一致」。两口径背离，正确应让对账 SUM 也排除孤儿/作废。
- 为何人工：需跨订单模块作废 + 打开真实 xlsx 数行 vs 对账卡，两口径分处两文件。

---
**[P1] 导出是「写操作」：每次导出各写一条审计快照，且无 admin 门槛**
- 步骤：1) 对某期连续导出 `/report` 三次、`/shipping` 两次、`/all` 一次。2) 查该期 `IssueAuditSnapshot` 累积数（按 snapshot_type report_export/shipping_export）。3) operator 登录直接调导出接口。
- 预期：`exports.py:27-106` 每次 `/report` 写一条 `report_export` 快照、`/shipping` 写 `shipping_export`、`/all` 各写一条（共 2）；**无 `require_admin`**，任意登录用户导出都会累积快照。判定：导出是否应幂等/限权，快照是否会被无意义刷量。
- 为何人工：导出副作用（写快照）+ 无权限门槛需人工连续导出后查快照数。

---
**[P1] 报数 Excel 模板导出正确性（高度视觉）**
- 步骤：导出某期 `/report`→打开 xlsx，核对：当前期各渠道单元格填值、上期列（D 列/社用报 C 列）、聚合单元格（人民日报印厂 D4/D10–D16、社用报 C4/C18）、临时加印快递=总数−自留、页眉「期数 X 第Y期 版数 出版日期」、制表时间=出版日的上一周周五。
- 预期：`export_report_excel:228-303` 用 `report_template.xlsx` 只写数据源单元格、公式自算；`_fill_prev_issue_aggregates` 计上期聚合；`临时加印快递=temp_total−temp_self`；制表时间＝`publish_date − (weekday−4)%7 or 7` 天。
- 为何人工：模板单元格映射 + 公式 + 聚合只能开 Excel 肉眼核对。

---
**[P1] 上期无报数时导出上期列为 0（不报错）**
- 步骤：导出一期，其「上一期」（issue_number 最近的更小期）**无 ReportEntry**（或本就是首期）。
- 预期：`export_report_excel:263-285` prev 取不到 entry→`entry_map.get(...,0)` 全 0、聚合全 0，不报错。
- 为何人工：首期/上期未报数的导出边界，需构造缺上期数据。

---
**[P1] 订单列表导出 xlsx 列与中文状态**
- 步骤：订单列表加一组筛选→导出→打开 xlsx。
- 预期：`export_orders_excel:351-391` 13 列（订单编码/来源单号/下单日期/付款主体/平台/活动/份数/金额/实付/欠款/覆盖起/覆盖止/状态）、状态映射（draft草稿/pending_confirmation待确认/active生效/void已作废）、金额转 float。与 Part A 订单导出 P2（筛选一致/权限）呼应。
- 为何人工：导出内容/中文状态/金额格式核对。

---
**[P1] 顶栏全局搜索：debounce + 四类实体下拉 + 跳转**
- 步骤：顶栏输入订单号片段/收报人姓名/商品名/期号，观察 250ms 后下拉的四类分组（订单/收报人/商品/期数）、点击是否跳对应详情；输入纯空格/空串；大小写变体。
- 预期：`search.py`→`search_service.global_search`：订单按 order_code/external_order_no/payer_name/payer_contact、收报人按 name/phone、商品、期数各取 top-N；空 q→空结果。前端 `GlobalSearch.tsx` 250ms debounce、下拉跳转。
- 为何人工：debounce + 下拉 + 跳转是纯前端交互，端到端无自动化。

---
**[P2] `/export/all` zip：含报数+面单两个 xlsx（中文名），并写 2 条快照**
- 预期：`export_all:85-106` zip 内两个中文名 xlsx（`get_report_filename`/`get_shipping_filename`），并各写一条快照（共 2）。
- 为何人工：解压核对两文件名（中文不乱码）+ 快照数。

---
**[P2] 打印子页重构（视觉/分页/中文不截断）**
- 步骤：对面单/发货单等打印子页（参照 `docs/preview/print-subpages-redesign-preview.html`）走浏览器打印预览，核对分页、字段完整、边距、中文不截断。
- 为何人工：打印视觉只能人工。

---
**[P2] 仪表盘 / 经营分析口径与列表交叉核对**
- 步骤：DashboardPage 统计卡、Analytics 活动分析（campaign）的数字，与订单列表按同条件筛选的合计对比。
- 预期：口径应一致；若 Analytics 按 `campaign` 聚合，需与订单列表按同 campaign 筛选合计相符。
- 为何人工：跨页统计口径一致性需人工交叉核对。

---

## 剧本③（邮局投递闭环）落地细节 · 读码补充

把 Part A 剧本③ 的检查点对到真实实现，便于逐步核对：

1. **月度起投明细**：`生成批次(year,month)` 收集 `coverage_start_date ∈ [当月1号,次月1号)` 的投递记录、冻结成 `PostalDeliveryRow` 快照（`postal_batch_service.py:27-120`）。检查点：起投明细集合 = 名册按同「年+月」筛选集合（口径一致）；draft/generated 可重生成、sent 冻结拒改。
2. **关联读者**：投递记录名册即读者家；工单（投诉/改地址/回访）用 `link_delivery`（年度+编号去零）关联投递记录、继承其 `order_id`（`postal_common.py:90-110`）。检查点：投递单位「有则标注无则留空不推断」；同名同号不同地址的两个投递点应各自成立（对照发货侧「同名同号不同地址被误判重复 409」的教训，确认邮局侧不做类似误合并）。
3. **应用新地址**：`apply_address_change` 回写投递记录 recipient_*（cpca 拆省市区）+ 就地改订单**当前**目标（不升 allocation 版本、多目标只改最小 id 一个）（`postal_change_service.py:129-192`）。检查点：下一版月度明细即用新地址；挂订单的联动是否只改了一个目标。
4. **投诉三态处理**：`add_handling`/`delete_handling` 驱动 open↔in_progress↔resolved（无方向校验、可跳档/回退）（`postal_complaint_service.py:200-281`）。检查点：三态跳转是否符合预期；删处理记录回退正确。
5. **删除守卫逐项列明**：删除合作渠道时统计合同/结算/履约目标/投递记录/邮局投递明细/投诉六类引用，任一非零→409 逐项列明（Part A 客户·合同 P1，`partners.py:98-141`）。检查点：让某渠道同时被投递记录 + 投诉引用，删除应 409 且列明「投递/投诉」条数。
