# V1.2 Active 订单明细就地编辑设计

## 1. 概述

允许用户在订单已生效（active）状态下编辑明细和履约目标，无需作废重建。采用版本化 allocation 方案：每次修改目标时生成新版本，旧版本保留可查。

## 2. 核心规则

- 编辑 active 订单明细时复用 OrderEditor 页面（跳转 `/orders/{id}/edit`）
- 用户须手动填写"生效起始期号"（新 allocation 从该期号起生效）
- 变更原因为可选字段
- 任何用户均可操作（无额外权限限制）
- 事件流记录完整 diff

## 3. 版本化语义

### Allocation 生命周期

```
v1: effective_from_issue=2650, effective_until_issue=NULL (当前生效)
    └─ targets: [张三 1份, 李四 1份]

用户编辑目标，填写"从第 2656 期起生效"：

v1: effective_from_issue=2650, effective_until_issue=2655 (已截止)
    └─ targets: [张三 1份, 李四 1份]
v2: effective_from_issue=2656, effective_until_issue=NULL (当前生效)
    └─ targets: [张三 1份, 王五 2份]
```

### 明细级别字段

覆盖期、单价、总份数、计费类型等明细级别字段：**直接覆盖更新**（不版本化）。这些字段影响的是整个订阅周期，不存在"从第几期开始用新价格"的语义。

### 整条明细新增/删除

- **新增明细**：创建新 OrderItem + allocation v1 + targets
- **删除明细**：将 OrderItem.status 设为 `cancelled`，所有 allocation 标记 `effective_until_issue`

## 4. 后端设计

### 4.1 新增 API 端点

```
PUT /api/orders/{order_id}/items
```

**请求体：**

```python
class OrderItemsUpdatePayload(BaseModel):
    effective_from_issue: int  # 新版本生效起始期号
    change_reason: str | None = None  # 可选变更原因
    items: list[OrderItemIn]  # 完整明细列表（同创建时结构）
```

**处理逻辑：**

1. 校验订单存在且 status == 'active'
2. 校验 `effective_from_issue` 在覆盖期范围内且 > 已发货的最大期号
3. 对比当前 items 与提交的 items，计算 diff：
   - 新增的 item → INSERT OrderItem + Allocation(v1) + Targets
   - 删除的 item → 标记 OrderItem.status='cancelled'，关闭当前 allocation
   - 修改的 item：
     - 明细级字段（unit_price 等）→ 直接 UPDATE OrderItem
     - 目标变更 → 关闭当前 allocation（effective_until_issue = effective_from_issue - 1），创建新 allocation（version_no + 1）+ 新 targets
4. 记录事件流
5. 返回更新后的完整订单

### 4.2 Diff 算法

使用 item 的数据库 ID 匹配：
- 请求中每个 item 可带 `id` 字段（已有 item）或不带（新增）
- 当前存在但请求中不含的 item → 视为删除
- 目标层面同理：通过 target ID 匹配

### 4.3 事件类型扩展

| 事件类型 | 说明 |
|---------|------|
| `item_added` | 新增明细 |
| `item_removed` | 删除（取消）明细 |
| `item_modified` | 明细字段变更（含 diff） |
| `allocation_created` | 新版本 allocation 生成 |
| `allocation_closed` | 旧版本 allocation 截止 |

事件 payload 包含：`effective_from_issue`、`change_reason`、字段级 diff。

### 4.4 校验规则

- `effective_from_issue` 必须 ≥ 覆盖期起始对应的首个期号
- `effective_from_issue` 必须 > 已同步发货的最大期号（V1.1 暂无发货同步，预留校验）
- 每条明细的 targets.quantity 之和 == total_quantity
- 覆盖期日期范围合法（start < end）

## 5. 前端设计

### 5.1 OrderEditor 改造

**移除限制：**
- 删除 `const itemsReadOnly = isEditMode;`
- 改为 `const itemsReadOnly = isVoid;`（仅作废订单不可编辑）

**Active 订单编辑时新增：**
- 明细区域上方显示输入：
  - `effective_from_issue`（InputNumber，必填，标签"生效起始期号"）
  - `change_reason`（Input，可选，标签"变更原因"）
- 提交时调用 `PUT /api/orders/{id}/items`（新 API）而非原来的 `PUT /api/orders/{id}`

**保存逻辑分支：**
- 草稿（draft）订单：仍用 `PUT /api/orders/{id}`（header fields）+ 创建时 items 已含
- Active 订单：
  - Header 字段 → `PUT /api/orders/{id}`（原有逻辑）
  - 明细变更 → `PUT /api/orders/{id}/items`（新 API）
  - 两个请求顺序执行

### 5.2 OrderDetail 改造

- 明细 Tab 头部增加"编辑明细"按钮 → 跳转 `/orders/{id}/edit`
- 履约方案 Tab：
  - 当 allocation 有多个版本时，按版本分组展示
  - 每个版本显示：version_no、生效期号范围、targets 列表、创建时间、变更原因

### 5.3 API Client

新增函数：

```typescript
export function updateOrderItems(
  orderId: number,
  payload: { effective_from_issue: number; change_reason?: string; items: OrderItemIn[] }
) {
  return axios.put(`/api/orders/${orderId}/items`, payload);
}
```

## 6. 数据模型变更

**无 schema migration 需要。** 现有 FulfillmentAllocation 表已有：
- `version_no` (int)
- `effective_from_issue` (int, nullable)
- `effective_until_issue` (int, nullable)
- `change_reason` (text, nullable)

只需在代码中正确填充这些字段即可。

## 7. 测试策略

### 后端测试
- 新增 item → 验证 allocation v1 生成
- 删除 item → 验证 status=cancelled + allocation 截止
- 修改 target → 验证旧 allocation 截止 + 新 allocation 生成 + version_no 递增
- 明细字段修改 → 验证直接更新（不产生新 allocation）
- 校验 effective_from_issue 合法性
- 事件流记录完整性

### 前端测试
- TypeScript 类型检查通过
- Active 订单可进入编辑页面
- effective_from_issue 必填校验
- 保存后正确跳转并刷新数据

## 8. 不包含在本期

- 暂停/恢复投递（挂起某个 target）
- 与 shipping_details 的实际同步（V1.2 后续）
- 批量导入变更
