# 邮局投递模块 · 设计与分期路线（Postal Delivery）

> 状态：设计定稿待评审 · 2026-07-01（v2：改为**订单驱动 + 每月起投批次**，替掉 v1 的 hybrid 静态名册）
> 决策已定：**功能全做（P1→P4）** · **邮局行 = 订单（delivery=post_office）** · **发票/收款复用「财务模块」** · **续订/流失/读者360 先搁置**
> 本文是 spec（做什么 / 为什么 / 数据模型 / 分期）；每一期实现时再各自出 task-by-task 的执行 plan。

> ---
> ## ⭐ v3 根因重构（2026-07-03，已实现并合并进 main · PR #39）
> **本文下方 v2「邮局行 = 订单」的结论已被推翻。** 用户澄清定架构：**邮局投递是一种投递方式（等同中通 ZTO-MF），数据源自平台订单，但邮局明细本身是投递记录、不是订单**——只 CBJ/淘宝/中经报有赞 有订单详情，其余平台只有投递数据；中通/邮局明细都可能有订单里没有的数据。核实现有 `shipping_details` 本就是「投递记录，可挂订单/可独立」，邮局照它。
> - **不再造 `post_office` 订单**：新表 `PostalDelivery`（迁移 `b5d7f9a1c3e6`，照 shipping_details）；《读者明细》→ 投递记录；`(year, delivery_no)` 去重；产品认不出留原文；读者明细无平台订单号 → `order_id` 恒 NULL；**邮局记录不进订单列表/客户管理**。
> - 月度起投明细批次从 `PostalDelivery` 归批（`postal_delivery_rows` 加 `postal_delivery_id` 溯源）。
> - 投诉/改地址/回访经 `postal_common.delivery_map` 按 编号+年度 **关联投递记录**（挂真实订单才继承 order_id）；改地址「回流」→**「应用新地址」**写回投递记录（挂订单则连带更新订单）、未匹配 400；跨年靠改地址表头括注声明的读者年度挂对。
> - 新增 `/api/postal/deliveries` + 前端 **📇 投递名册** tab；共 6 tab。**大白话叫法**：批次→月度起投明细、挂订单→已关联读者/未匹配、回流→应用新地址。订单号精确挂单 + 并入财务发票工作台 = **后续**（先做电商订单导入）。
> - 下面 v2 各节的「Order/OrderItem/FulfillmentTarget」「post_office 订单」「PostalDeliveryRow FK order_item/target」等，请以此 v3 为准：实体换成 `PostalDelivery` 投递记录。技术细节见 `docs/technical.md §3.17 / §4.16`，效果图 `docs/preview/postal-delivery-refactor-preview.html`。
> ---

---

## 1. 背景与关键领域事实

数据源 `报纸邮局投递明细.xlsx`：4 个 sheet、靠「编号」互相钩连、跨 **2024/2025/2026** 三年：

| Sheet | 行数 | 作用 |
|---|---|---|
| 邮局读者明细 | 4316 | 读者/订阅明细（1 行 = 1 个读者·1 年·1 次起投） |
| 邮局年投诉 | 299 | 投诉工单：缺某期 → 转当地邮局 11185 → 回访 → 处理次数(1~4) |
| 邮局年改地址 | 157 | 改地址工单：新姓名/电话/地址 → 转「XX局微信」→ 生效起月 |
| 提现发票合集 | 49 | 收款+发票：金额/手续费/到款/开票抬头税号 |

**领域关键事实（决定架构）**：
- **邮局投递明细是「每月生成一次」的批次，不是静态名册、也不是像中通那样按刊期（周）。**
- 用户是活的、随时下单；但**每月只给邮局同步一次**：给邮局的是**「那个月起投」的新明细**，给过的不再给。
- **每个订阅只进它「起投月」那一版批次**；所有月批次的并集 = 用户手里那张完整 Excel 记录。
- 月中错过当月截止的订单 → **顺延到下月批次** ⇒「改地址」表里「原读者起月日 vs 实际起月日」两列的由来（实际起月 = 真正进的那一版）。
- 邮局集订分送 = 邮局自己按期投递；发行部只需按月把「新起投名册」交给邮局。

**"不够完善"根源**（Excel 撑关系型工作流的固有病）：回访按天开列；投递单位只 40% 有值；投诉/处理全自由文本；跨表手工 VLOOKUP、发票仅靠姓名；改地址不回流；多年度混表、编号逐年新发；收款两处对不上账。

**目标**：把邮局行落成**订单**，用**每月起投批次**复现"给邮局一版明细"的操作，投递单位结构化，投诉/改地址/回访/收款发票挂到订单上；导入可复核可重导。

---

## 2. 关键结论：订单驱动 + 每月起投批次（为什么不是 hybrid）

**邮局行 = 订单**（`Order` + `OrderItem` delivery=post_office + `FulfillmentTarget` shipping_channel=post_office），**邮局投递明细 = 按「起投月」从 post_office 订单生成、冻结存档的月度批次**。

这比 v1 的 hybrid（新建 postal_subscriptions + Recipient 收敛）**更简单、复用更多**，因为订单模式让 v1 评审里的多数 blocker 直接消失：

| v1 hybrid 的成本 | 订单模式下 |
|---|---|
| (姓名+电话) 认人去重 / 合并拆分复核队列 | **消失**：一行一单，不做跨年读者收敛；跨年就靠客户管理页按 姓名+电话 只读聚合（够用） |
| ZTO 隔离（Recipient.source 过滤 shipping_service） | **消失**：post_office 目标本就被中通发货 gate 跳过（`order_shipping_sync_service.py:299-301`），不串 |
| 发票 `Invoice.order_id` 改可空 + union | **消失**：邮局就是订单，发票/收款自然挂邮局订单，`Invoice`/`Payment`/财务工作台**原样复用** |
| 客户管理页看不到邮局读者 | **消失**：`customer_service` 按订单收报人聚合、不挑渠道，邮局收报人**自动出现** |

**代价/边界**：续订/流失/读者 360 这类"稳定读者档案"的价值**先不做**（= 用户说的"客户管理先不做"）；跨年用客户管理只读聚合先顶着，将来要精细再引入读者主档。

---

## 3. 数据模型

```
Order（邮局销售单，复用）              渠道/付款方(汇款名称)/金额/收款(Payment)
  └─ OrderItem（复用）                中国经营报=cbj；coverage_start/end=起止月；份数；delivery_method=post_office
        └─ FulfillmentTarget（复用 + 加列）  收报人 姓名/电话/地址/邮编；shipping_channel=post_office
                + distribution_unit_id → Partner   ← 投递单位（集订分送），新增列          [P1]

PostalDeliveryBatch（每月起投批次，新表）  year/month/status/generated_at/sent_at/count   [P1]
  └─ PostalDeliveryRow（冻结明细行，新表）   FK batch + FK order_item/target + 冻结快照     [P1]

Partner(partner_type=distribution)  ← 投递单位，迁移预置 7 个各地集订分送                  [P1]

PostalComplaint / PostalAddressChange / PostalFollowUp（挂订单/收报人，新表）        [P2/P3]
Invoice / Payment（复用，挂邮局订单；按需补 手续费 / 普票·专票 字段）                  [P4]
```

**要点**
- **不碰中通按刊期管线**：邮局订单的 post_office 目标本就被 `order_shipping_sync` 跳过，不会生成中通 `shipping_details`。邮局投递明细走**独立的每月批次**生成。
- **批次冻结**：`postal_delivery_row` 在生成时**冻结当月快照**（姓名/地址/份数/起止/投递单位），即使事后改了订单也不动已发批次 —— 对应"3 月给邮局的就是这些人"。与中通「按刊期 `shipping_details` 冻结行」同构，只是**按月、post_office**。
- **起投月归批**：`batch(Y,M)` = `month(coverage_start_date) == (Y,M)` 的 post_office 订阅；每单只进一版。
- **投递单位** 落 `FulfillmentTarget.distribution_unit_id`（新列，→ Partner distribution）。

### 3.1 新表（pseudo-DDL，最终以 migration 为准）

```
postal_delivery_batches
  id PK
  year INT, month INT                 -- 起投批：2026-07
  status ENUM(draft/generated/sent)
  generated_at, sent_at DATETIME NULL
  row_count INT
  notes TEXT
  UNIQUE(year, month)

postal_delivery_rows                  -- 冻结的当月投递明细行（交邮局的内容）
  id PK
  batch_id            FK→postal_delivery_batches.id
  order_item_id       FK→order_items.id (nullable, 溯源)
  fulfillment_target_id FK→fulfillment_targets.id (nullable, 溯源)
  -- 冻结快照：
  snap_name, snap_phone, snap_province, snap_city, snap_district, snap_address, snap_postal_code
  copies INT
  coverage_start_date, coverage_end_date DATE
  source_channel VARCHAR
  distribution_unit_id FK→partners.id (nullable)
  salesperson VARCHAR                 -- 赠阅/关联（业务员）
  notes TEXT

-- FulfillmentTarget 加列：
fulfillment_targets.distribution_unit_id  FK→partners.id (nullable)   -- 投递单位

postal_complaints         [P2]  见 §6
postal_address_changes    [P3]  见 §6
postal_follow_ups         [P3]  见 §6（取代按天开列的回访）
```

---

## 4. 四张表 → 模型 字段映射（要点）

| Excel 列 | 落到 | 备注 |
|---|---|---|
| 编号 | `Order.external_order_no`（加年份前缀 "2026-4784"） | 导入去重键；`UNIQUE` 防重导 |
| 姓名/联系电话 | `FulfillmentTarget.recipient_name/phone` | |
| 省/市/区/详细地址/邮编 | 合成 `recipient_address` + `recipient_postal_code` | 导入过 `normalize_address` 清洗 |
| 地区 | 由地址推导 / 冗余（见 §7） | |
| 年度 + 起月日/止月日 | `OrderItem.coverage_start_date/coverage_end_date` | **起投月 = 归批键** |
| 产品名称（中国经营报/商学院） | `OrderItem.publication` cbj / business_school | |
| 份数/金额 | `OrderItem.total_quantity` / `unit_price·subtotal` | 20 元/月/份，可校验 |
| 渠道（13 值） | `Order.source_platform`(+campaign) | 保留原文 |
| 汇款名称/汇款日期 | `Order.payer_name` + `Payment`(到款额/日期/未到) | "未到"=未收 |
| 投递单位（7 值） | `FulfillmentTarget.distribution_unit_id → Partner` | 只 40% 有值，省→Partner 兜底 |
| 赠阅/关联 | `salesperson`（batch row / 订单字段）；赠阅→`billing_type=free_gift` | |
| 备注 | `notes` | |
| 回访列（按天） | `postal_follow_ups`（一行一条） | 消灭按天开列 |
| 投诉 sheet | `postal_complaints.*`（按编号挂订单/收报人） | 处理情况归一化路由 |
| 改地址 sheet | `postal_address_changes.*` | 新地址可回流收报人 |
| 发票 sheet | `Invoice` + `Payment`（挂邮局订单） | 抬头→buyer_title、税号→tax_no、普票/专票→新 tax_category |

---

## 5. 复用清单（订单模式复用面很大）

| 能力 | 复用什么 | 位置 |
|---|---|---|
| 邮局行落订单 | `Order`/`OrderItem`/`FulfillmentTarget`（post_office 已是合法值） | order.py / order_item.py:58-60 / fulfillment_target.py:21 |
| Excel→订单 导入 | CBJ/淘宝 两阶段导入管线，加邮局解析器 | `cbj_order_import_service.py:455-472,475-550` |
| 地址清洗 | `normalize_address`（省/市/区/邮编） | `address_service.py:41-79` |
| 发票登记/工作台、收款 | `Invoice`/`Payment`/`finance_service`（邮局就是订单，直接挂） | invoice.py / finance_service.py / api/invoices.py |
| 客户（收报人）跨年只读聚合 | `customer_service`（自动含邮局收报人） | customer_service.py |
| 投递单位主数据/结算锚点 | `Partner(distribution)`（已预置成都邮征天下等） | partner.py:17-23 |
| 只读明细 + 统计卡 + CSV 导出 | `ShippingPreview.tsx` | frontend ShippingPreview.tsx:38-300 |
| 列表 + 筛选 + 导出（批次页参考） | `Recipients.tsx` / 导出 | frontend |
| 导入上传/预览 UI | `OrderImport.tsx` | frontend |
| 导航位 | `/post-delivery` 已挂「物流管理」 | AppLayout.tsx |

---

## 6. 分期路线 P1 → P4

### P1 · 邮局订单 + 每月起投批次（地基）
- **交付**：
  1. 导入完整记录（读者明细）→ post_office 订单；
  2. 按「起投月」生成/冻结**每月投递批次** + 存档 + 导出交邮局；
  3. PostDelivery 页：按月看批次 + 明细行 + 导出；底层订单在订单列表/客户管理自然可见；
  4. 投递单位：原文有则挂 Partner，**无则留空（不自动推断）**。
- **新增**：`postal_delivery_batches`/`postal_delivery_rows` 表 + migration；`FulfillmentTarget.distribution_unit_id` 列；Partner 预置 7 集订分送；`postal_import_service`（读者明细解析→订单，复用订单创建）；`postal_batch_service`（起投月归批/冻结/导出）；`api/postal.py`；前端 PostDelivery 批次页 + 导入入口。
- **复用**：订单导入 / 订单模型 / normalize_address / ShippingPreview / OrderImport。
- **验收门**：批次冻结后改订单不影响已发批次（回归测试）。投递单位**不设填充率门槛**——有则标注、无则留空。
- **P1 范围收敛**：不做续订/流失/读者 360；导入用**受控一次性载入 + 去重报告**（编号年份前缀防重），不做复杂复核 UI。

### P2 · 投诉工单
- **交付**：投诉导入 + 工单列表（按 投递单位/年度/状态/处理次数 筛选）+ 处理情况**路由归一化**（北京局/各地 11185）+ 回访 + 处理次数；订单/收报人详情里显示其投诉时间线。
- **新增**：`postal_complaints`（FK order/target + 接诉日期/缺哪期/路由/处理/回访/处理次数/第一接诉人）；投诉解析器（按编号挂订单）；service/API；前端投诉 tab。

### P3 · 改地址工单 + 回访
- **交付**：改地址导入 + 工单；**新地址可一键回流**收报人目标；回访记录**取代按天开列**，一条时间线；改地址联动下一版批次的实际起月。
- **新增**：`postal_address_changes`（原/新 姓名电话地址 + 原起月/实际起月 + 处理情况 + applied_by/applied_at 留痕）+ `postal_follow_ups`（date/批次/结果）；两个解析器；service/API；前端两 tab。

### P4 · 收款/发票对接财务
- **交付**：邮局订单的收款（汇款/到款/手续费/未到-到账）与发票**直接复用**财务模块（挂邮局订单，无需改 order_id 可空）；财务工作台自动含邮局订单发票；发票 sheet 导入。
- **新增**：按需给 `Payment` 加 `fee_amount`（手续费）、给 `Invoice` 加 `tax_category`（普票/专票，并定义其工作台筛选/导出行为，否则不入）；发票解析器（姓名→邮局订单匹配，歧义标记）；对公整笔汇款分组（一笔汇款供多单）按需建 `postal_batch_remittance` 或用 payer_name 串。

---

## 7. 横切决策与风险（贯穿各期）

1. **投递单位**：原文有值则映射到对应 Partner，**无则留空 —— 不自动推断/兜底**（用户明确）。预期 ~60% 空。下游影响：P2 投诉按投递单位路由、批次按中心分组时，空投递单位需人工指定；不阻塞 P1、不设填充率门槛。
2. **批次冻结 vs 溯源**：`postal_delivery_rows` 冻结快照为准（交邮局内容不可变）；同时留 `order_item_id/target_id` 溯源。已发批次不因改单而变。
3. **起投月顺延**：错过当月截止的单进下月批 → 记录 `实际起月` 与 `原起月`（P3 改地址表已有此语义），避免与投诉"某期没收到"口径打架。
4. **编号逐年重置** → 用作导入去重键前**加年份前缀**；出 migration 前跑 `GROUP BY year, external_no HAVING COUNT>1` 校验无撞。
5. **中通解耦已天然成立**：post_office 目标被 `order_shipping_sync` 跳过；P1 加回归测试"邮局订单不生成中通发货明细"。
6. **对公整笔收款**（一笔汇款供 116 读者、批量份数）：P4 决定 `postal_batch_remittance` 分组 vs payer_name 串。
7. **地址规范化幂等**：`postal_delivery_rows.snap_address` 存原文为再规范化源；重导时原文没变不覆盖订单地址。
8. **地区 vs 投递单位** 疑似冗余：P1 先留原文，观察后决定是否由地址+投递单位推导。

---

## 8. 待确认（不阻塞 P1 起步）

- 每月批次的**生成时机/截止**：由用户手动"生成 2026-07 批次并标记已发"，还是到月初自动生成待发？（P1 先做手动，自动化后置。）
- 发票 P4 的 `tax_category`（普票/专票）是否要进工作台筛选/导出（否则暂不建）。
- 对公整笔汇款：建分组实体还是 payer_name 串（P4 决策）。
