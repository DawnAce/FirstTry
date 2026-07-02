# 邮局投递 P2 执行 Plan · 投诉工单

> Spec: `docs/superpowers/specs/2026-07-01-postal-delivery-design.md`（P2 段按**订单驱动**重映射，见下）。
> **Goal**: 把《邮局年投诉》(299 行) 导入成挂在邮局订单上的投诉工单；PostDelivery 加「投诉工单」tab（筛选 + 列表 + 导入）。

**订单驱动重映射**（spec §3.1 的 postal_complaints 原写 recipient_id/postal_subscription_id 是 hybrid 时代，作废）：投诉挂 **订单**——`编号`("000680")去零 → `f"{年度}-{680}"` = `orders.external_order_no`，匹配到则 `order_id`，匹配不上留 `external_order_no` 字符串。

**数据要点**（真实 299 行）：编号零填充6位；年度 2024/25/26（2 空）；处理次数 1/空/2/3/4；投递渠道单位 74 行命中 7 个集订分送；处理情况=局名(北京局/广东局…)或热线(057111185/转徐州11185…)；回访 79/299。

## 数据模型

```
postal_complaints
  id PK
  order_id            FK→orders.id (nullable, ondelete SET NULL)   -- 按(年度,编号)匹配
  external_order_no   VARCHAR(64)          -- "2024-680" 引用键(即便未匹配)
  complaint_date      DATE                 -- 接诉日期
  year                INT (nullable)       -- 年度
  missing_issues      TEXT                 -- 投诉情况(缺哪期,原文)
  handling            TEXT                 -- 处理情况(原文)
  routed_label        VARCHAR(64) (null)   -- 归一:\d*11185 热线 或 XX局
  routed_unit_id      FK→partners.id (null)-- 投递渠道单位匹配
  follow_up           TEXT                 -- 回访
  handling_count      INT (nullable)       -- 处理次数
  status              ENUM(open, resolved) -- 派生:有回访→resolved
  first_handler       VARCHAR(64)          -- 第一接诉人
  snap_name           VARCHAR(128)
  snap_phone          VARCHAR(64)
  snap_address        TEXT (null)
  snap_postal_code    VARCHAR(20)
  notes               TEXT                 -- 备注
  created_at
```

## Tasks

### P2.1 模型 + 迁移
- `models/postal_complaint.py`(PostalComplaint + PostalComplaintStatus)；`__init__` 导出；迁移 `<hash>_add_postal_complaints`（建表 + FK orders SET NULL / partners）。
- `api/partners.py` 删除 guard 加 `postal_complaints.routed_unit_id` 引用检查（同 P1 投递单位保护）。

### P2.2 解析 + 导入
- `postal_complaint_parser.py`：按表头解析「邮局年投诉」sheet → `ParsedComplaint`。
- `postal_complaint_import_service.py`：`编号`去零 + 年度 → 匹配 `orders.external_order_no`（预载 map）；`routed_label` 归一；status 派生；投递渠道单位匹配 Partner；preview/commit（复用 session 缓存范式；投诉可重复接诉，去重键用 编号+接诉日期+投诉情况 防重导）。

### P2.3 列表 service + API
- `postal_complaint_service.py`：list（筛选 年度/状态/投递单位/处理次数≥N/搜索 姓名·编号）+ 分页。
- `api/postal.py` 加 `/complaints`（list）、`/complaints/import/preview|commit`。

### P2.4 前端
- PostDelivery → `Tabs`：「投递批次」(P1) +「投诉工单」(P2)。投诉 tab：筛选栏 + 列表 + 「导入投诉」弹窗。`api/postal.ts` 补投诉接口/类型。

### P2.5 测试 + 验证 + 评审 + 提交
- 单测（解析/挂订单/去零匹配/归一/状态/去重）+ API 测试；真实 299 行验证匹配率；对抗式评审；提交并入 PR #39。

## 明确不在 P2
- 订单详情页的投诉时间线（可 P2.5+/后续）；改地址+回访(P3)；发票(P4)；处理情况的深度 SLA 统计。
