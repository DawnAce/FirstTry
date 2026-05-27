# ZTO-MF按期导出设计

## 背景

用户在「物流管理 → ZTO-MF」维护某期ZTO-MF时，需要直接导出该期的ZTO-MF Excel。目前后端已经提供按 issue 导出的 `/api/issues/{issue_id}/export/shipping` 接口，历史页也能通过「导出全部」间接导出，但中通明细维护页缺少直接入口。

## 范围

- 导出当前选择期号对应的全部ZTO-MF。
- 导出不受页面筛选条件、搜索关键字或表格勾选状态影响。
- 复用现有ZTO-MF Excel 模板、文件命名和导出快照逻辑。
- 不新增筛选导出、勾选导出或新的 Excel 格式。

## 推荐方案

在「ZTO-MF」筛选面板底部右侧、现有记录汇总和「新增」按钮附近增加「导出」按钮。按钮读取当前选中的 `Issue`，调用现有导出地址 `/api/issues/{issue_id}/export/shipping`，由浏览器触发文件下载。

## 组件与数据流

1. `Recipients.tsx` 的 `ShippingDetailsTab` 已维护 `currentIssue` 和 `currentIssueNumber`。
2. 新增导出处理函数：
   - 如果没有可用 `currentIssue.id`，提示先选择期号。
   - 否则打开 `/api/issues/{currentIssue.id}/export/shipping`。
3. 后端 `exports.py` 的现有接口继续调用 `export_shipping_excel()`，并记录 `shipping_export` 快照。

## 用户体验

- 「导出」按钮显示在「新增」旁边，便于在检查明细后立即导出。
- 没有可选期号时按钮禁用，并保持错误提示兜底。
- 导出的文件名继续使用现有规则：`YYYY年M月D日《中国经营报》中通快递发货明细（期号）.xlsx`。

## 文档与验证

- 更新用户手册，说明可在ZTO-MF页按当前期号导出。
- 前端变更后运行 TypeScript 检查。
