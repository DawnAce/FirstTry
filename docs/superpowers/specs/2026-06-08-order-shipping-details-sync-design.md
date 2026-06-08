# V1.3 订单到 shipping_details 同步设计

## 1. 概述

V1.3 目标是把已生效订单的履约目标同步到每期 `shipping_details`，闭合“录入订单 → 生成发货明细 → 导出中通表”的主链路。

本期采用**手动预览后同步**：用户按期号触发同步，系统先返回将新增、更新、跳过和冲突的明细清单；用户确认后才写入 `shipping_details`。这样保留现有人工复核节奏，避免自动写入覆盖人工维护的发货明细。

## 2. 核心规则

- 只同步 `active` 订单。
- 只同步纸刊订单：`publication_format = paper`。
- 只同步中通外包履约目标：`fulfillment_targets.shipping_channel = zto_outsource`。
- 按目标期号 `issue_number` 判断订单明细是否应在当期发货：
  - 订阅 / 赠阅 / 续订 / 换订：当期出版日期落在 `coverage_start_date ~ coverage_end_date` 内。
  - 单期 / 补寄：`order_items.issue_number = 目标期号`。
  - 休刊期不生成同步候选。
- 使用 `order_id + order_item_id + fulfillment_target_id + issue_number` 做幂等匹配；V1.3 只从订单详情页同步**单个订单**，不做全量订单按期批处理。
- 同步写入的行标记为 `source_type = order_generated`、`sync_status = synced`。
- 人工创建的 `shipping_details` 行不参与覆盖；如果内容相似但没有订单 linkage，仅在预览里提示“可能重复”。
- 对已人工修改的订单生成行（`sync_status = manually_modified`），重同步时进入冲突，不自动覆盖。

## 3. 数据映射

| 订单来源 | shipping_details 字段 | 规则 |
|---------|------------------------|------|
| 目标期号 | `issue_number` | 用户选择的同步期号 |
| 固定值 | `sheet_name` | `ZTO-MF` |
| 订单来源平台 / 店铺 | `channel` / `company` | 优先 `source_platform`、`source_store`；为空时用 `个人订阅` / 空 |
| 目标收件人 | `name` | `fulfillment_targets.recipient_name` |
| 目标电话 | `phone` | `fulfillment_targets.recipient_phone` |
| 目标地址 | `address` | 写入前复用现有 `normalize_address` |
| 目标份数 | `quantity` | `fulfillment_targets.quantity`，语义为每期份数 |
| 固定值 | `transport` | `中通物流` |
| 固定值 | `frequency` | `周` |
| 固定值 | `status` | `正常` |
| 订单 / 明细 / 目标 | `order_id` / `order_item_id` / `fulfillment_target_id` | 用于幂等和反查 |
| 订单备注 / 目标备注 | `notes` / `extra_info` | 保留订单号、明细类型、目标备注，便于人工识别 |

## 4. 后端设计

### 4.1 新增服务

新增 `backend/app/services/order_shipping_sync_service.py`，集中处理候选计算、diff 和写入，避免把同步逻辑塞进 `orders.py` 或 `shipping_details.py`。

核心函数：

```python
def preview_order_shipping_sync(
    db: Session,
    order_id: int,
    issue_number: int,
) -> OrderShippingSyncPreview:
    ...

def apply_order_shipping_sync(
    db: Session,
    order_id: int,
    issue_number: int,
    operator_id: int | None,
) -> OrderShippingSyncResult:
    ...
```

候选查询逻辑：

1. 锁定目标期号并读取出版日期，休刊则返回空候选和提示。
2. 查询该订单下覆盖目标期号的 active 订单明细及其 allocation 版本。
3. 选择当期生效的 allocation：`effective_from_issue <= issue_number` 且 `effective_until_issue IS NULL OR >= issue_number`；为空时回退到未设置边界的 v1。
4. 只取 `status = active` 且当期有效的 targets。
5. 将候选映射为 shipping detail 快照。

### 4.2 新增 API

```http
GET /api/orders/{order_id}/shipping-sync/preview?issue_number=2655
POST /api/orders/{order_id}/shipping-sync/apply
```

`apply` 请求体：

```json
{
  "order_id": 1,
  "issue_number": 2655
}
```

预览 / 提交响应都返回同一结构：

```json
{
  "order_id": 1,
  "issue_number": 2655,
  "summary": {
    "candidates": 12,
    "to_create": 8,
    "to_update": 2,
    "skipped": 1,
    "conflicts": 1
  },
  "items": [
    {
      "action": "create",
      "order_id": 1,
      "order_item_id": 3,
      "fulfillment_target_id": 9,
      "shipping_detail_id": null,
      "name": "张三",
      "quantity": 1,
      "reason": null,
      "diff": null
    }
  ]
}
```

`action` 可选值：

- `create`：没有匹配行，提交时新增。
- `update`：存在订单生成行且未被人工改过，提交时更新字段。
- `skip`：目标不适合同步，例如非中通渠道、已作废、已取消。
- `conflict`：存在订单生成行但已人工修改，或检测到可能重复人工行，需要用户处理。

提交规则：

- 如果预览存在 `conflict`，默认返回 409，不写入任何行。
- 无冲突时，提交在一个事务内新增 / 更新全部 rows。
- 当前订单写入 `synced_to_shipping` 事件，payload 包含 `issue_number`、`created_count`、`updated_count`。
- 冲突时写入 `shipping_sync_conflict` 事件，payload 包含 `issue_number`、冲突数量和目标 ID 列表。

### 4.3 shipping_details 编辑联动

现有 `shipping_details` CRUD 需要识别订单生成行：

- 用户编辑 `source_type = order_generated` 的行时，若修改 tracked fields，自动把 `sync_status` 改为 `manually_modified`。
- 删除订单生成行仍允许，但操作日志保留 linkage 字段；后续重同步会重新识别为 `create`。
- `ShippingDetailOut` 增加 `order_id`、`order_item_id`、`fulfillment_target_id`、`source_type`、`sync_status`，前端可展示来源和状态。

## 5. 前端设计

### 5.1 订单详情页

改造 `OrderDetail.tsx` 的「关联快递明细」Tab：

- 显示期号选择器。
- 点击「预览同步」调用 preview API。
- 展示预览表：动作、收件人、份数、订单明细、目标 ID、冲突原因。
- 无冲突时显示「确认同步」按钮。
- 同步成功后刷新订单详情、事件流、对应期号的 `shippingDetails` 查询缓存。

### 5.2 发货明细页

在 ZTO-MF 发货明细表增加轻量可见性：

- 新增「来源」列：手工 / 订单生成 / 历史导入。
- 新增「同步状态」列：已同步 / 人工修改 / 孤立。
- 对 `manually_modified` 行用提示说明：该行不会被订单重同步自动覆盖。

本期不在发货页放主同步入口，避免用户在发货页误把所有订单同步进当前期。主入口先放订单详情页；后续可以再加“按期同步全部订单”的管理员入口。

## 6. 错误处理

- 目标期号不存在：404。
- 目标期号休刊：200，返回空候选和说明，不写入。
- 订单生成行被人工修改：409，返回冲突明细，不覆盖。
- 候选目标缺少地址或姓名：预览中标记 `conflict`，不写入。
- 数据库写入失败：事务回滚，API 返回错误，不产生部分同步。

## 7. 测试策略

### 后端

- 订阅订单覆盖目标期号时生成候选。
- 单期订单只在指定期号生成候选。
- 休刊期返回空候选。
- allocation v1/v2 按 `effective_from_issue` / `effective_until_issue` 选择正确 targets。
- 首次 apply 新增 `shipping_details`，二次 apply 幂等为 update 或无 diff。
- 手工修改订单生成行后，重同步返回 conflict 且不覆盖。
- apply 成功写入 `synced_to_shipping` 事件。
- conflict 写入 / 返回 `shipping_sync_conflict` 信息。

### 前端

- `npx tsc --noEmit`。
- 订单详情「关联快递明细」Tab 可选择期号、预览、确认同步。
- 有冲突时禁用确认同步并展示原因。
- 发货明细表展示来源和同步状态。
- 同步 mutation 成功后 invalidates：订单详情、订单事件、shipping details、shipping companies、report。

## 8. 不包含在本期

- 电商订单 Excel / API 批量导入。
- 财务收款流水、退款和欠款追踪。
- 客户自助下单入口。
- 自动按所有订单批量同步某一期。
- 覆盖 `manually_modified` 行的强制同步。
- 邮局、自提、顺丰等非中通发货渠道同步。
