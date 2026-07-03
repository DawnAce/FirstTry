# 邮局投递 · 根因重构执行 plan（订单驱动 → 投递记录层）

> 2026-07-03 · 已实现并合并进 main（PR #39，merge `8e152b5`）。spec 见 `docs/superpowers/specs/2026-07-01-postal-delivery-design.md` 的 **v3** 段；技术细节 `docs/technical.md §3.17 / §4.16`；效果图 `docs/preview/postal-delivery-refactor-preview.html`。

## 为什么

用户澄清定架构：**邮局投递是一种投递方式（等同中通 ZTO-MF）**，数据源自平台订单，但**邮局明细本身是投递记录、不是订单**——只 CBJ/淘宝/中经报有赞 有订单详情，其余平台只有投递数据；中通/邮局明细都可能有订单里没有的数据。核实现有 `shipping_details` 本就是「投递记录，可挂订单/可独立」，邮局照它。旧 v2「每行造 `post_office` 订单」会污染订单列表/客户管理、与电商单双算，故推翻。

## 目标模型

新表 `PostalDelivery`（照 `shipping_details`）：`(year, delivery_no)` 唯一，`order_id`/`order_item_id`/`fulfillment_target_id` 全可空（SET NULL），`source_type`，收报人/coverage/product/`distribution_unit_id`/汇款。《读者明细》→ 投递记录（不造订单）；读者明细无平台订单号 → `order_id` 恒 NULL；将来补订单号再挂真实订单。邮局记录不进订单列表/客户管理。

## 步骤（8）

1. **模型 + 迁移** `b5d7f9a1c3e6`：建 `postal_delivery`（29 列）+ 给 `postal_delivery_rows`/`postal_complaints`/`postal_address_changes`/`postal_follow_ups` 各加 `postal_delivery_id`(SET NULL)。downgrade 先删列（drop_constraint→drop_index→drop_column）再 `drop_table`（踩坑记忆）。
2. **P1 导入重写** `postal_delivery_import_service`：读者明细 → `PostalDelivery`（不造订单）；`(year, delivery_no=编号去零)` 去重；产品认不出留原文；复用现有 parser + 会话握手。删旧 `postal_import_service`。
3. **批次归批**：`postal_batch_service` 从 `PostalDelivery` 按 `coverage_start_date∈[月1,次月1)` 归批冻结，`postal_delivery_rows` 溯源 `postal_delivery_id`；省市区优先读记录、都空 `normalize_address` 兜底。
4. **工单挂投递记录**：`postal_common.delivery_map` 按 编号+年度 关联；投诉/改地址/回访继承 `postal_delivery_id`（挂真实订单才继承 `order_id`）；改地址**「应用新地址」**写回投递记录（挂订单则连带更新订单 target）、未匹配 400；改地址跨年靠表头括注声明的读者年度挂对。
5. **API + 名册**：切 import 端点到新服务；新增 `GET /api/postal/deliveries`（投递名册）+ schema `DeliveryOut`/工单 `postal_delivery_id`；`partners` 删除守卫加 `PostalDelivery.distribution_unit_id` 检查。
6. **测试**：反向断言 `test_postal_delivery_not_in_customer_view`（邮局记录不进客户聚合）；批次/工单测试改断言 `postal_delivery_id`；新增跨年改地址、份数改0、名册筛选等。
7. **前端 100% 复刻效果图**：`PostDelivery.tsx` + `api/postal.ts` —— 新增「📇 投递名册」tab；批次→「📦 月度起投明细」；术语 邮局订单→投递记录；工单「读者」列「已关联读者/未匹配」；改地址「回流」→「应用新地址」。
8. **评审 + 文档 + 合并**：对抗式评审（5 维度 + 逐个证伪，11 候选→8 确认）修 6：备注冻结丢失、份数改0被跳过、金额溢出500、预览/入库金额一致、改地址跨年关联。更新 technical/user-guide/spec；提交 PR #39 → CI（新建 `.github/workflows/ci.yml`）绿 → main 分支保护 → 合并。

## 验证

454 后端测试通过；前端 `tsc -b` 通过；迁移 `b5d7f9a1c3e6` 在 dev MySQL up/down/up 往返验证；dev 无残留假订单、生产从未导入邮局明细 → 无需回填。

## 大白话叫法（用户锁定）

批次→**月度起投明细**；挂订单→**已关联读者 / 未匹配**；回流→**应用新地址**。订单号精确挂单 + 并入财务发票工作台 = **后续**（先做电商订单导入这个前提）。
