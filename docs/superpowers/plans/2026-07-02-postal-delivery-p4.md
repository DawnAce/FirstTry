# 邮局投递 P4 执行 Plan · 收款 / 发票（提现发票合集）

> **Goal**: 《提现发票合集》(49) 导入成邮局收款/发票记录；PostDelivery 加「收款发票」tab。链接**优先订单号(external_order_no)、姓名兜底**（现数据无订单号 → 多兜底/待补；将来补订单号重导即精确）。
> **原则**：P4 **不改共享财务模块**（Invoice/Payment/finance_service 零改动，零风险）。等订单号可靠后，再单独做「一键并进财务发票工作台」。

**数据**（提现发票合集 49 行）：姓名 / 商品名称(中国经营报37·商学院11·套书1) / 份数 / 金额 / 手续费 / 到款金额 / 到款日期 / 开票金额 / 发票信息("发票抬头：X\\n购方税号：Y") / 发票接收手机·邮箱 / 发票类型(普票47·专票1) / 订单平台(CBJ+小程序41·商学院APP5·淘宝发行部3)。**无编号/订单号列**（用户后期补原始平台订单号）。

## 数据模型

```
postal_finance
  id PK
  order_id            FK→orders.id (nullable, SET NULL)   -- 订单号或姓名匹配
  external_order_no   VARCHAR(128)   -- 原始平台订单号(将来补) → 精确挂单键
  link_by             VARCHAR(16)    -- order_no | name | none （链接来源，便于甄别）
  payer_name          VARCHAR(128)   -- 姓名
  product             VARCHAR(128)   -- 商品名称
  copies              INT            -- 份数
  amount              NUMERIC(10,2)  -- 金额(应收)
  fee_amount          NUMERIC(10,2)  -- 手续费
  net_amount          NUMERIC(10,2)  -- 到款金额
  collected_at        DATE           -- 到款日期
  invoiced_amount     NUMERIC(10,2)  -- 开票金额
  buyer_title         TEXT           -- 发票抬头（从发票信息解析）
  tax_no              VARCHAR(64)     -- 购方税号（解析）
  invoice_recipient   VARCHAR(128)   -- 发票接收手机/邮箱
  tax_category        VARCHAR(16)     -- 普票 | 专票
  platform            VARCHAR(64)     -- 订单平台
  notes               TEXT
  created_at
```

无 partner FK → 不动 partner guard。

## Tasks

### P4.1 模型 + 迁移
`postal_finance` 模型 + `__init__` + 迁移 `<hash>_add_postal_finance`（FK orders SET NULL；downgrade 只 drop_table）。

### P4.2 解析 + 导入
- `postal_finance_parser`：解析提现发票合集；`发票信息` 用正则拆 `发票抬头：` / `购方税号：`；兼容将来的「订单号」列（表头含订单号/单号）。
- `postal_finance_import_service`：链接 = 订单号(→order.external_order_no) 优先；无订单号则姓名兜底（payer_name 唯一命中一张 order 才挂，多张/零张→未匹配）。net_amount 缺则 金额−手续费。preview/commit；去重键 (external_order_no or 姓名+到款日期+金额)。

### P4.3 service + API + 前端
- list（筛选 平台/普专票/是否挂单/搜索 姓名·抬头）。`/api/postal/finance` + `/finance/import/preview|commit`。
- 前端 PostDelivery 加「收款发票」tab（列表 + 导入；显示 挂单/link_by、手续费、到款、开票抬头、普专票、平台）。

### P4.4 测试 + 验证 + 评审 + 提交
单测(解析发票信息/链接/兜底/幂等) + API 测试；真实 49 行验证；对抗式评审；提交入 PR #39。

## 明确不在 P4（后续）
- 「一键并进财务发票工作台」(建真 Invoice+Payment、扩 Invoice.tax_category/Payment.fee_amount)——等原始订单号补齐、链接可靠后再做。
