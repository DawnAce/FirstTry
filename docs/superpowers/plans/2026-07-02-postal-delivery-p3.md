# 邮局投递 P3 执行 Plan · 改地址工单 + 回访

> Spec: `docs/superpowers/specs/2026-07-01-postal-delivery-design.md`（P3 段按订单驱动重映射）。
> **Goal**: 《邮局年改地址》(157) 导入成挂订单的改地址工单（可**回流**到订单收报人）；读者明细的「按天回访列」拍平成 `postal_follow_ups`。PostDelivery 加「改地址」「回访」两 tab。

**数据要点**：
- 改地址 sheet：修改日期/姓名/编号("000402")/新姓名(49)/新电话(50)/新地址(149)/处理情况(转XX局微信 123+)/原·实际起月/份数2。**无年度列** → 链接年份取自修改日期。
- 回访：读者明细的 `20240227回访`/`20240228回访`/`20240229回访`/`2025回访` 列，值 "——"/"电话错误"/"拒接"/"按时收"。每个非空单元格 → 一条回访记录。

## 数据模型

```
postal_address_changes
  id PK
  order_id            FK→orders.id (nullable, SET NULL)   -- year(修改日期)+编号去零 匹配
  external_order_no   VARCHAR(64)
  change_date         DATE                 -- 修改日期
  old_name, old_phone, old_address(Text), old_copies      -- 原(快照)
  new_name, new_phone, new_address(Text), new_copies      -- 新(份数2)
  original_start_month VARCHAR(16)          -- 原读者起月日
  effective_start_month VARCHAR(16)         -- 实际起月日
  handling            VARCHAR(128)          -- 处理情况(转XX局微信)
  routed_label        VARCHAR(64)           -- 归一 XX局
  applied_to_order    BOOL default false    -- 是否已回流到订单收报人
  applied_by          INT FK→users (null), applied_at DATETIME (null)  -- 回流留痕
  notes               TEXT
  created_at

postal_follow_ups
  id PK
  order_id            FK→orders.id (nullable, SET NULL)   -- 读者行 年度+编号 匹配
  external_order_no   VARCHAR(64)
  follow_up_date      DATE (nullable)       -- 列头 "20240227回访"→2024-02-27；"2025回访"→null
  batch_label         VARCHAR(32)           -- 列头原文
  result              TEXT                  -- 单元格值
  snap_name           VARCHAR(128)
  created_at
```

无 partner FK → **不动 partner 删除 guard**。

## Tasks

### P3.1 模型 + 迁移
两模型 + `__init__` 导出 + 迁移 `<hash>_add_postal_address_follow`（建两表，FK orders SET NULL / users）。downgrade **只 drop_table**（记取 P1/P2 教训，别先 drop_index）。

### P3.2 改地址导入
`postal_address_change_parser`（解析邮局年改地址）+ import 服务：year(修改日期)+编号去零 → `orders.external_order_no` 挂订单；处理情况归一 routed_label（`XX局`）；新旧身份快照；去重键 (external, change_date, new_address)；preview/commit。

### P3.3 回访导入
`postal_follow_up_parser`（读者明细「回访」列拍平）：每行 年度+编号 + 每个非空回访列 → 一条 follow_up（列头解析日期/label、结果）；去重键 (external, batch_label)；preview/commit。

### P3.4 服务 + API + 回流
- list 改地址 / list 回访（筛选：年度/状态·已回流/搜索；回访按日期）。
- **回流动作** `apply_address_change(id)`：把 new_* 写到订单当前 FulfillmentTarget（地址/姓名/电话），置 applied_to_order + applied_by/at；已回流幂等。
- `/api/postal/address-changes`、`/address-changes/{id}/apply`、`/address-changes/import/*`、`/follow-ups`、`/follow-ups/import/*`。

### P3.5 前端
PostDelivery 加「改地址」「回访」两 tab（列表+导入；改地址行「回流」按钮，已回流显示标记）。`api/postal.ts` 补接口/类型。

### P3.6 测试 + 验证 + 评审 + 提交
单测（解析/挂订单/归一/回流/幂等）+ API 测试；真实 157 改地址 + ~90 回访 验证；对抗式评审；提交入 PR #39。

## 明确不在 P3
- 收款/发票(P4)；改地址生效起月与批次的精确联动（回流只更新当前地址，实际起月留信息）；订单详情页时间线。
