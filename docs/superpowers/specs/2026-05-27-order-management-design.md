# 订单管理模块设计（V1）

## 背景

系统当前已支持印数管理、刊期管理、物流明细（ZTO-MF 中通明细 + 收件人）等中段能力，所有"应发数据"都靠运营人员从店铺导出表、邮局年度表、同事微信沟通信息等多个来源**手工抄录**到物流页面，订单与发货之间没有可追溯的关联。

业务方主要承接来自 6 个左右来源的订单：

- 淘宝店铺（千牛平台）
- 有赞店铺
- 微信 CBJ 小程序
- 同事微信沟通转交的订单
- 工作邮件往来订单
- 客户微信直接转账订单

订阅主商品为《中国经营报》和《商学院》两种。运营人员日常会先把所有来源整理到一张统一规格 Excel（按月份分 sheet 归档），再分别按"邮局"和"中通"两条物流通道抄录到现有物流管理页面。

日常订单量较小（每周几单），但年底续订/双十一高峰单周可达数百单；20% 左右订单涉及非常规履约（退订、补寄、赠送、延期补偿、订户替换）。

订单管理是后续客户管理、合同管理、财务/发票管理的数据源头，因此优先于其他三块开始建设。

## 目标

- 把订单作为系统的业务源头，订单一旦确认即驱动后续物流执行，消除"订单→物流"之间的手工抄录环节。
- 支持单笔手工录入和 Excel 批量导入两种入口，覆盖运营人员现有工作模式。
- 支持 4 种订单履约类型：长期订阅、单期、赠送、补寄；后续可扩展延期补偿、订户替换等子类型。
- 支持订单明细按多个履约目标分配份数（A3/B3/C2/D2 等团购场景），并允许按刊期切换分配方案版本，不覆盖历史。
- 支持历史订单**轻量归档**导入，仅用于查询、统计、客户合并依据，不重建过往物流明细。
- 订单确认后能按本期自动生成 `shipping_details` 行，物流管理页继续作为执行界面，新增"数据来源"追溯能力。
- 现有"印数管理 / 刊期表管理 / 物流管理"功能保持原样，订单模块以新增的方式与之并行，逐步替代手工抄录环节。

## 非目标（V1 明确不做）

- **客户档案合并去重**：V1 不建独立客户表，付款主体、收件主体、开票主体的名称信息冗余存于订单上；客户中心放 V2。
- **财务/发票/手续费记账**：V1 仅记录开票要求自由文本与金额，不做发票生成、手续费拆分；放 V2 财务中心。
- **邮局年度结算逻辑**：V1 按起止日期粗算订阅覆盖，邮局年度窗口截断、合刊不顺延等规则放 V2 邮局专项。
- **赠送/补寄/退订的自动履约**：V1 仅"登记 + 查询 + 备注"，不自动驱动 `shipping_details`；V2 接通。
- **续订提醒、客户经营分析**：V2 客户中心后建。
- **第三方平台 API 自动抓单**（淘宝/有赞/CBJ）：V3 待评估。
- **修改现有"订阅 / 收件人"页面**：V1 不动，避免风险；V2 客户中心建好后再考虑迁移或退役。

## 方案选择

整体走"**订单驱动型，分层解耦**"路线（与 2026-05-20 讨论方案 A 一致）：

```
订单中心 → 履约中心 → 印数/物流中心 → 财务/客户中心
```

订单 ≠ 订阅 ≠ 发货，三层必须分开。订单是来源，履约是规则，发货是执行结果。

订单与现有物流的衔接采用**模式 B**：订单确认后自动写入 `shipping_details`，现有物流管理页面作为下游视图，不重构其 UI；老数据继续保留，新订单驱动新物流明细。

历史数据导入采用**轻量归档**：历史订单只进订单中心做查询/统计/客户合并依据，不反向生成 `shipping_details`，不与已存的历史物流明细做强匹配。预留后期人工挂接的可能性。

## 数据模型

### 1. `orders`（订单主表）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| order_code | str(64), nullable | 业务可读编码（如 `ORD-2026-000123`），系统自动生成 |
| external_order_no | str(128), nullable, index | 来源平台原始单号 |
| order_date | date, not null | 下单日期 |
| source_type | enum, not null | `ecommerce` / `corporate_transfer` / `vip_gift` / `manual` / `mail_annual` |
| source_platform | str(64) | CBJ+小程序 / 淘宝发行部 / 商学院有赞 / 中经报有赞 / 拼多多 / 商学院APP / 中国经营报APP / 对公转账 / VIP赠阅 / 其他 |
| source_store | str(128), nullable | 店铺/同事名（自由文本，V1 不归一化） |
| payer_name | str(128) | 付款主体名 |
| payer_contact | str(64), nullable | 付款联系人 |
| payment_method | enum | `wechat` / `alipay` / `bank_card` / `corporate_transfer` / `cash` / `offset` / `other` |
| payment_collector | str(64), nullable | 收款经办人姓名（张裕光/张中成/季为明 等） |
| total_amount | decimal(10,2), default 0 | 订单总金额 |
| paid_amount | decimal(10,2), default 0 | 已付金额（V1 通常等于 total） |
| invoice_required | bool, default false | 是否需要开票 |
| invoice_title | text, nullable | 开票抬头自由文本（V2 结构化） |
| status | enum, not null, default `draft` | `draft` / `pending_confirmation` / `active` / `void` |
| import_batch_id | int, nullable | 关联导入批次（手工录入为空） |
| import_row_no | int, nullable | 原始 Excel 行号 |
| import_source_sheet | str(64), nullable | 原始 sheet 名 |
| notes | text, nullable | 备注 |
| created_at, updated_at | datetime | |
| created_by | int FK users | |

索引：`(external_order_no)`、`(source_type, status, order_date)`、`(payer_name)`

### 2. `order_items`（订单明细）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| order_id | int FK orders, cascade | |
| publication | enum, not null | `cbj`（中国经营报）/ `business_school`（商学院）/ `other` |
| publication_format | enum, default `paper` | `paper` / `digital`（V2 启用） |
| fulfillment_type | enum, not null | `subscription`（长期订阅）/ `single_issue`（单期）/ `gift`（赠送）/ `makeup`（补寄）/ `extension`（延期补偿）/ `replacement`（订户替换） |
| billing_type | enum, not null | `paid` / `free_gift` / `bundle_gift` |
| coverage_start_date | date, nullable | 覆盖起投日（订阅/单期用） |
| coverage_end_date | date, nullable | 覆盖终止日 |
| issue_number | int, nullable | 指定刊期（单期/补寄用） |
| total_quantity | int, default 1 | 该明细订购总份数 |
| unit_price | decimal(10,2), default 0 | 单价 |
| subtotal | decimal(10,2), default 0 | 小计金额 |
| status | enum, default `active` | `active` / `cancelled` |
| notes | text, nullable | |
| created_at, updated_at | datetime | |

索引：`(order_id)`、`(publication, fulfillment_type, status)`、`(coverage_start_date, coverage_end_date)`

### 3. `fulfillment_allocations`（履约分配方案版本）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| order_item_id | int FK | |
| version_no | int, not null | 同一 order_item 下递增 |
| effective_from_issue | int, nullable | 从哪一期开始生效（按刊期） |
| change_reason | str(255) | 变更原因（地址变化、份数调整、邮局转中通等） |
| operator_id | int FK users | |
| created_at | datetime | |

唯一约束：`(order_item_id, version_no)`

V1 中订单确认即创建 v1 版本；后续每次调整生成新版本。

### 4. `fulfillment_targets`（履约目标 / 分配项）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| order_item_id | int FK | |
| allocation_id | int FK fulfillment_allocations | 属于哪一版分配方案 |
| recipient_name | str(128) | 收件人姓名 |
| recipient_phone | str(64), nullable | |
| recipient_address | text | |
| recipient_postal_code | str(20), nullable | |
| quantity | int, default 1 | 这一目标分到几份 |
| shipping_channel | enum, not null | `post_office`（邮局）/ `zto_outsource`（中通外包）/ `self_sf`（报社自发顺丰）/ `other` |
| effective_from_issue | int, nullable | 该目标从哪一期开始生效 |
| effective_until_issue | int, nullable | 该目标到哪一期失效 |
| status | enum, default `active` | `active` / `suspended` / `replaced` |
| replaced_by_target_id | int, nullable | 被哪个目标替换（订户替换场景） |
| notes | text, nullable | |
| created_at, updated_at | datetime | |

索引：`(order_item_id, allocation_id)`、`(effective_from_issue, effective_until_issue, status)`

### 5. `order_events`（订单事件流）

记录订单生命周期内所有变更：

- `created`、`imported`、`confirmed`、`modified`、`split`、`voided`
- `allocation_updated`、`target_added`、`target_replaced`、`target_suspended`
- `synced_to_shipping`、`shipping_sync_conflict`

字段：`id, order_id, event_type, payload_json, operator_id, created_at`。

V1 必须可查、可筛选，不要求高级回放。

### 6. 现有 `shipping_details` 表追加字段

| 字段 | 类型 | 说明 |
|---|---|---|
| order_id | int FK orders, nullable | 来源订单（NULL = 手工录入或历史数据） |
| order_item_id | int FK order_items, nullable | |
| fulfillment_target_id | int FK fulfillment_targets, nullable | |
| source_type | enum, default `manual` | `manual` / `order_generated` / `historical_import` |
| sync_status | enum, default `synced` | `synced` / `manually_modified`（订单生成后被手工修改）/ `orphaned`（来源订单作废） |

加 `(order_id)`、`(source_type)` 索引。

### 7. `order_import_batches`（导入批次）

| 字段 | 说明 |
|---|---|
| id | |
| filename | 原始文件名 |
| publication | 该批次对应报种 |
| sheet_summary_json | 每个 sheet 的解析结果统计 |
| total_rows | |
| parsed_rows | |
| dedup_rows | 去重后的订单条数 |
| issues_count | 数据质量问题条数 |
| status | `parsing` / `awaiting_confirmation` / `confirmed` / `cancelled` |
| created_by, created_at | |

### 8. `order_import_staging`（待确认导入区）

| 字段 | 说明 |
|---|---|
| id | |
| batch_id | |
| source_sheet | sheet 名 |
| source_row_no | Excel 行号 |
| raw_json | 原始行的完整字段 JSON |
| parsed_json | 拆字段映射后的结构化结果 |
| dedup_key | 去重 key（订单号 或 姓名+电话+起投+终止） |
| dedup_status | `unique` / `duplicate_first` / `duplicate_skip` |
| issues_json | 数据质量问题列表 |
| resolution_status | `pending` / `confirmed` / `discarded` / `merged` |
| target_order_id | 确认后落到哪个订单 |

## 业务流程

### 流程 1：单笔手工录入

1. 打开"订单管理 → 新建订单"
2. 选择报种（中经报/商学院）→ 选择履约类型 → 填写订单头信息
3. 添加 1～N 条订单明细（每条明细可独立设置履约/计费类型、覆盖期、份数、单价）
4. 为每条明细分配 1～N 个履约目标（默认 1 个；团购订单可添加多个）
5. 保存为草稿 → 检查无误 → 确认生效（自动生成 v1 分配方案）

### 流程 2：批量导入

1. 上传 Excel 文件，选择对应报种（用户先告诉系统这是中经报表还是商学院表）
2. 系统按 sheet 解析（兼容现有 19 列结构）；用户也可在 V1.5 增加自定义字段映射
3. 字段拆分映射：
   - `订单平台` 拆 → `source_type` + `source_platform`（如"对公转账" → `corporate_transfer` + 自身名；"VIP赠阅" → `vip_gift` + 自身名）
   - `付款平台` 拆 → `payment_method` + `payment_collector`（微信/支付宝/银行卡 → 支付方式；个人姓名 → 经办人）
   - `订阅类型` 映射 → `fulfillment_type` + 覆盖期长度提示（全年→subscription，半年→subscription，特殊情况→需用户在确认区指定子类型）
   - `商品` 映射 → `publication` + `publication_format`
4. 跨 sheet 去重：key 优先用 `external_order_no`；为空时回退到 `(recipient_name + phone + coverage_start + coverage_end)`
5. 数据质量检查（标记给确认区，不阻塞导入）：
   - 电话格式异常、金额缺失、起投/终止日期缺失
   - 列错位（如商品列被填了备注）
   - 新出现的来源平台/支付方式（未在枚举映射表中）
   - 疑似重复（多次跨 sheet 命中同一 key）
6. 进入"待确认导入区"——按报种、批次、sheet 分组展示
7. 人工逐条/批量确认：
   - 单条确认 / 多条选中批量确认
   - 修正字段后确认
   - 标记丢弃
   - 标记合并到已存在的订单
8. 确认后生成正式订单与明细（自动生成 v1 分配方案、履约目标）

### 流程 3：历史订单轻量归档

与流程 2 几乎一致，但批次模式标记为 `historical_archive`：

- 不要求 `coverage_end_date >= 今天`
- 确认后订单 `status = active`，但**不参与自动同步 `shipping_details`**
- 在订单列表里可以筛选"仅看归档订单"
- 预留"手工挂接 shipping_details"功能（V1 可不实现，仅留模型字段）

### 流程 4：履约分配方案变更（A3/B3/C2/D2 → A4/B3/C2/D1）

1. 进入订单明细 → "履约分配方案"标签 → "新建版本"
2. 选择"从第 XXXX 期起生效"
3. 编辑各履约目标的份数、地址、联系人、物流通道
4. 填写变更原因（自由文本 + 可选预置标签）
5. 保存，写入新版本 + 一条 `allocation_updated` 事件
6. 后续 `shipping_details` 同步自动按新版本生成

### 流程 5：订单 → 当期 `shipping_details` 同步

1. 在"印数管理 / 物流管理"页选定本期
2. 点击"同步本期订单"按钮
3. 系统计算：所有处于"该期生效"状态的 `fulfillment_targets`
   - 条件 1：所属订单 `status = active` 且 `import_batch.status != historical_archive`
   - 条件 2：该目标 `effective_from_issue <= 本期 <= effective_until_issue`（NULL 视为不限制）
   - 条件 3：所属 `order_item.fulfillment_type ∈ {subscription, single_issue}`（V1 自动履约范围）
4. 生成/更新 `shipping_details` 行：
   - 不存在 → 新建，`source_type = order_generated`
   - 已存在且 `source_type = order_generated` → 更新
   - 已存在且 `source_type = manual` → 标记冲突，列入"冲突清单"让用户决策
5. 同步结果汇总：新增 X 条 / 更新 Y 条 / 冲突 Z 条 / 跳过 W 条
6. 写入 `synced_to_shipping` 事件

**字段映射规则**：

| `shipping_details` 字段 | 来源 |
|---|---|
| issue_number | 同步操作选定的本期 |
| name | `fulfillment_targets.recipient_name` |
| address | `fulfillment_targets.recipient_address` |
| phone | `fulfillment_targets.recipient_phone` |
| quantity | `fulfillment_targets.quantity` |
| transport | `fulfillment_targets.shipping_channel` 映射（邮局→中国邮政、中通外包→中通物流、报社自发顺丰→顺丰） |
| channel | `orders.source_type + source_platform` 映射 |
| sub_channel | `orders.source_store` |
| frequency | 由报种推断（中经报→每周；商学院→每月） |
| status | 默认"正常" |

V1 报种 + 通道的字段映射规则用静态映射表表达；V1.5 提取为可配置映射服务。

## 前端设计

### 菜单调整

侧边栏 V1 新增"订单管理"为可用菜单（现有灰色 disabled 状态去掉），位置在"刊期表管理"之后：

```
订单管理
  - 订单列表
  - 新建订单
  - 待确认导入
  - 历史归档
```

V1 阶段保持"订阅 / 收件人"现有页面不变，"客户管理 / 合同管理 / 财务管理"仍为灰色。

### 关键页面

1. **订单列表** (`/orders`)
   - 筛选：报种、来源类型、来源平台、状态、起投月份、付款主体关键字
   - 列：订单编码、来源单号、下单日期、付款主体、报种、份数总计、金额、起投日期、状态、操作
   - 行点击进入详情
   - 顶部按钮："新建订单"、"批量导入"、"导出"
2. **订单详情** (`/orders/:id`)
   - 头部：订单信息（来源、付款、金额、状态、备注）
   - Tab 1：订单明细（含每条明细的履约目标列表）
   - Tab 2：履约分配方案版本历史
   - Tab 3：关联 `shipping_details`（V1.5 可展示）
   - Tab 4：事件流
3. **新建/编辑订单** (`/orders/new`、`/orders/:id/edit`)
   - 多步表单或单页 + 折叠区块
4. **批量导入向导** (`/orders/import`)
   - Step 1：选择报种 + 上传 Excel
   - Step 2：自动解析进度 + 解析结果摘要
   - Step 3：待确认列表（分 sheet/分类型，含数据质量提示和疑似重复提示）
   - Step 4：批量确认 / 单条修正 / 丢弃 / 合并
   - Step 5：确认后跳到订单列表，并展示"本批新增 X 条订单"
5. **历史归档** (`/orders/archive`)
   - 同订单列表，但限定 `import_batch.mode = historical_archive`
   - 顶部按钮："导入历史 Excel"

### 现有页面改动

- **物流管理页**（ShippingDetail 列表）：
  - 列表新增"来源"列（手工 / 订单生成 / 历史导入）
  - 行点击"来源订单"可跳转订单详情
  - 行编辑保存时若 `source_type = order_generated`，提示"该行来自订单 #XXX，建议回订单中修改履约目标"，但不强制阻止
  - 顶部新增"同步本期订单"按钮（与"清空本期"并列）
  - 同步结果展示在抽屉里：新增/更新/冲突/跳过

### TanStack Query 缓存键

- `['orders', filters]`
- `['order', id]`
- `['order-events', orderId]`
- `['import-batches', publication]`
- `['import-staging', batchId]`
- 现有 `['shipping-details', ...]` 需要在订单同步操作后失效

## 数据迁移与兼容

- V1 不迁移现有 `recipients` / `subscriptions` / `shipping_records` 任何数据。
- 新增表通过 SQLAlchemy 模型自动建表；如需 Alembic 迁移，遵循现有项目脚本风格。
- 现有 `shipping_details` 加字段为可空、可默认，不影响现有读写。

## 数据质量与导入容错

针对当前 Excel 已观察到的质量问题，导入解析必须做：

- 电话/邮编/金额类型统一（int / float / str / None → 规范化字符串或 decimal）
- 列错位识别（如订阅类型列出现长备注串 → 自动落到 `notes`）
- 多 sheet 跨期重复识别
- 起投/终止日期缺失或反序的告警
- 商品/报种识别（默认按上传时选择的报种填充，特殊行可在确认区改）

所有问题在确认区聚合展示，不阻塞导入。

## 测试要点

- 模型层：订单/明细/分配方案/履约目标的级联、唯一约束、状态机
- 服务层：导入解析（含跨 sheet 去重、字段拆分映射）、订单同步到 shipping_details（含冲突）
- 接口层：列表筛选、批量导入工作流、状态变更
- 前端：导入向导各步、订单详情各 Tab、物流页"同步本期订单"
- 关键边界：
  - 同一订单跨多张 sheet → 去重后只剩 1 条
  - 团购订单 50 份单履约目标
  - 多履约目标（A3/B3/C2/D2）
  - 分配方案版本切换的刊期截断
  - 订单作废后已生成 shipping_details 的 `sync_status = orphaned`

## 实施分期

V1 内部仍可分成 4 个连续可交付的小阶段：

- **V1.1 订单基础**：数据模型 + 单笔录入 + 订单列表 + 详情（不含导入、不含同步）
- **V1.2 批量导入**：Excel 解析 + 待确认区 + 字段拆分映射
- **V1.3 履约目标 + 分配方案版本**：多履约目标、按刊期切版本、事件流
- **V1.4 订单 → shipping_details 自动同步**：同步按钮、冲突处理、物流页来源列

V1.1 完成即可让用户开始用单笔录入；V1.2 完成即可承接历史归档；V1.3 完成支持团购和地址变更；V1.4 闭环。

## 待确认的开放问题（设计阶段需要业务方确认）

1. **商学院 Excel 结构** — 用户将提供该表样本，确认字段差异（覆盖月份语义、合刊不顺延等需在导入时如何标注）
2. **团购订单（份数 ≥ 5）** — 是否常态需要拆履约目标？V1 默认"支持但不强制"，按订单创建时由用户决定
3. **订单状态机** — `draft / pending_confirmation / active / void` 是否够用？是否需要 `partial_fulfilled / completed`（履约完成态）？
4. **现有"订阅 / 收件人"** — V1 不动，V2 是否退役需在 V2 阶段再决策
5. **历史归档显示** — 是按月份分组（贴近现有 Excel sheet 习惯）还是统一大列表 + 筛选器？默认采用大列表 + 筛选
6. **导入字段映射可配置性** — V1 用静态映射规则；如后续来源 Excel 字段差异大，V1.5 再做映射规则可视化配置
7. **付款经办人** — 是否需要在 V1 就建一个"经办人"字典表（约束枚举）？目前倾向 V1 自由文本 + V2 客户中心建好后归一化

## 后续版本规划（V2+）

- V2 客户中心：付款主体、收件主体、开票主体的归一化、合并去重、客户档案聚合
- V2 财务中心：发票生成（销项/进项/手续费）、收入/成本记账、邮局/物流商对账
- V2 邮局专项：年度履约段、合刊不顺延、退订顶替的承接关系建模
- V2 自动履约扩展：赠送、补寄、延期补偿、订户替换的全自动驱动 `shipping_details`
- V3 第三方平台 API 对接：淘宝/有赞/CBJ 自动抓单
- V3 客户经营分析：续订提醒、客户贡献度、渠道效益分析
