# 中通发货明细批量操作设计

## 背景

中通发货明细目前支持单条新增、编辑、删除，并已经具备操作日志。为了提升批量维护效率，需要在“物流管理 - 中通发货明细”中增加批量操作能力。

## 范围

本次实现以下能力：

1. 表格多选。
2. 批量设为“正常”。
3. 批量设为“停发”。
4. 批量修改截止日期。
5. 批量删除。
6. 每条被批量影响的记录仍单独写入操作日志。

暂不实现更复杂的批量字段编辑器；后续如有需要，可以继续扩展批量更新白名单字段。

## 后端设计

在 `backend/app/schemas/shipping_detail.py` 中新增批量操作 schema：

- `ShippingDetailBatchPatch`：批量更新字段白名单，首批支持 `status` 和 `deadline`。
- `ShippingDetailBatchUpdate`：包含 `ids` 和 `updates`。
- `ShippingDetailBatchDelete`：包含 `ids`。
- `ShippingDetailBatchResult`：返回受影响记录数量。

在 `backend/app/api/shipping_details.py` 中新增两个接口：

- `POST /api/shipping-details/batch-update`
  - 按 `ids` 查询记录。
  - 若存在不存在的 ID，返回 404，避免静默漏处理。
  - 对每条记录应用更新。
  - 使用现有 `_snapshot` / `_diff` 计算字段变化。
  - 对每条有变化的记录写入 `OperationLog(action="update")`。

- `POST /api/shipping-details/batch-delete`
  - 按 `ids` 查询记录。
  - 若存在不存在的 ID，返回 404。
  - 对每条记录写入 `OperationLog(action="delete")`。
  - 删除所有选中记录。

## 前端设计

在 `frontend/src/api/shippingDetails.ts` 中新增：

- `batchUpdateShippingDetails(data)`
- `batchDeleteShippingDetails(data)`

在 `frontend/src/pages/Recipients.tsx` 的 `ShippingDetailsTab` 中：

- 为表格增加 `rowSelection`。
- 增加 `selectedRowKeys` 状态。
- 选中记录后，在筛选栏附近显示批量操作区：
  - 已选 N 条
  - 批量设为正常
  - 批量设为停发
  - 批量修改截止日期
  - 批量删除
- 批量修改截止日期使用日期选择器，用户手动选择目标截止日期。
- 批量删除使用 `Popconfirm` 二次确认。
- 操作成功后清空选择，并刷新 `shippingDetails`、`shippingCompanies` 及相关缓存。

## 日志与一致性

批量操作不会只写一条总日志，而是对每条被影响的记录分别写日志。这样用户在单条记录的“操作日志”抽屉中仍能看到完整历史，例如：

- `状态：正常 -> 停发`
- `截止日期：2026-05-01 -> 2026-06-01`

批量更新时，如果某条记录没有实际变化，则不写更新日志。

## 错误处理

- `ids` 为空时由 schema 校验阻止。
- 找不到任意 ID 时返回 404。
- 前端失败时显示错误提示，不清空当前选择。
- 成功后显示影响记录数量并清空选择。

## 测试

- 后端：测试批量更新状态、批量更新截止日期、批量删除，以及不存在 ID 的错误响应。
- 前端：运行 `npx tsc --noEmit`。
- 手动验证：选择多条记录后批量修改，确认列表刷新、日志可查、删除确认生效。
