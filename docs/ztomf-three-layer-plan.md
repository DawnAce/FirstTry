# ZTO-MF 物流管理三层页面 · 实施计划

> 目标：把当前"单期视图"的 ZTO-MF 重构为三层页面——**工作台总览 → 期数总览 → 单期详情**，
> 让人不用逐期点击就能看到"哪些期已上传 / 未上传 / 异常"，并处理具体发货数据。
> 状态：**已实施并全部合并**——5 个 stacked PR（#64→#68）已于 2026-07-08 依次合并进 `main`（合并提交 `2e2b2cb` / `d08ac9b` / `4840851` / `a3f3d34` / `ea41346`），三层页面全部上线。下文为当时的实施计划，保留作设计留档。

## 关键结论（核验后）

1. **操作日志表已存在**：`operation_logs`（`backend/app/models/operation_log.py`，迁移 `24709c379498`）已接入 ~11 个发货明细写操作 + 前端单条"操作日志"抽屉。→ 无需新建表，只需 **加 3 列 + 补 5 个埋点 + 1 个列表接口**。
2. **收件人 CRUD 页已删**：commits `e1e02aa` / PR #62-63 删除；`/recipients` 现在只渲染单期发货明细视图，`?tab=` 参数已废。→ 需确认 收件人 是否就此不做（见"待确认"）。
3. **无需新建其它表**：所有数据（`publication_schedule` / `issues` / `shipping_details` / `report_entries` / `issue_audit_snapshots`）都已存在；核心新增是**一个只读聚合接口**。
4. **对账口径复用**：聚合接口逐字复用 `reports.py get_report` 的算法，保证总览数字与单期卡片分毫不差。

---

## 一、信息架构与路由

```
菜单「ZTO-MF」 →  /recipients            工作台总览 (LogisticsOverview)   ← 新首页，替换现单期视图
                     │  点蓝色「查看期数总览」
                     ▼
                  /logistics/issues       期数总览 (LogisticsIssues)      ← 新页面，全部年份
                     │  点某期「进入详情」
                     ▼
                  /logistics/issues/:id   单期详情 (LogisticsIssueDetail) ← 现单期视图重构，:id = Issue.id
```

- 菜单结构（`AppLayout.tsx` 物流管理组）：`ZTO-MF` / **`期数总览`(新增)** / `邮局投递`。`ZTO-MF` 的 key 仍为 `/recipients`，只是背后页面换成工作台。
- 旧跳转 `/shipping/:issueId` 保留，重定向目标改为 `/logistics/issues/:id`。
- `getSelectedKey` / `getOpenKeys` 增加 `/logistics` 前缀匹配，保证子菜单高亮/展开。

---

## 二、状态模型（最终版）

单一「状态」枚举，**服务端计算一次**（`overview_service._compute_status`），前端只读不重算。**首个命中即止**：

| 优先级 | 状态 | 判定条件 | 异常说明 |
|---|---|---|---|
| 1 | **休刊** | `publication_schedule.is_suspended=true` 或 `issue_number` 为空 | —（整行剔除，不进任何计数/分母） |
| 2 | **未创建** | 刊期表有该期、但无 `issues` 行（`issue_id` 空） | 尚未创建期数（操作=去创建） |
| 3 | **草稿** | `issue.status=='draft'`（报数未确认） | 草稿未提交 |
| 4 | **异常** | `detail_count>0` 且（`delta≠0` 或 `确认后漂移`） | `delta>0`→发货份数少于报数份数；`delta<0`→发货份数多于报数份数；漂移→确认后明细已变更 |
| 5 | **待上传** | `status≠draft` 且 `detail_count==0` | 等待上传发货明细 |
| 6 | **已上传** | `detail_count>0` 且 `delta==0` 且无漂移 | —（一致） |

- **差值 = 报数 − 发货**（D1，正数=发货缺口/少发）。后端 `reports.py:149` 已是此符号；只需改单期详情摘要条"差值"卡的**文案**为 `报数−发货`（数值不变）。
- **未上传 ≠ 异常**：`detail_count==0` 永远不算异常（即使报数>0，差值大）。这正是你截图 2654 期"报数 1473 / 发货 0 / 异常 0 条"的画法。
- **草稿优先于异常**：草稿期即使有复制来的发货且差值≠0，仍显示"草稿"（报数没确认前不谈漂移）。
- **confirmed/exported 合并**：合并状态轴里只有 `draft` 短路成"草稿"，confirmed/exported 都落到数据驱动的 已上传/异常/待上传。（历史期数页仍单独显示 草稿/已确认/已导出，那是另一条状态轴，两者共存。）
- **自动复制注意**：确认报数时若本期为空会自动复制上期发货行 → `detail_count>0` 但非真上传。MVP 仍以 `detail_count>0` 作为覆盖信号；日志里用 `batch_copy`（复制）区别于 `create`（人工上传）。"（自动复制·待核对）"子状态**推迟**。

**待处理提醒（恰好 3 项，本年，去重规则）**：
- 尚未上传发货明细 = `COUNT(状态=='待上传')`
- 报数与发货差异 = `COUNT(状态=='异常' 且 delta≠0)` ← 报数>0&发货0 的期是"待上传"不是"异常"，只算前一项，不重复计
- 草稿未确认 = `COUNT(状态=='草稿')`
- （❌ 地址异常本期不做，D4）

---

## 三、后端改动

### 3.1 聚合接口（新增）

`GET /api/analytics/overview?scope={workbench|periods}&year=`（加入现有 `analytics.py` 路由，委托新 `overview_service.py`）

- `scope=workbench`：强制 `year = 本年`（D5），返回本年 rows + 工作台 KPI + 3 待处理提醒 + 本月最新更新 + 最近期数/后续期数。
- `scope=periods`：`year` 可选（不传=全部年份，D5），返回跨年 rows + 期数总览 KPI，无 extras。
- **每期字段**：`issue_number, issue_id|null, year, publish_date, status(状态枚举), report_zt_total(报数份数), shipping_total(发货份数), delta(报数−发货), is_match, detail_count, has_shipping_drift, exception_note(异常说明), last_updated_at(最后更新时间)`。
- **~5 个批量查询，无 N+1**：① 刊期表全集（驱动，剔除休刊）② issues join（开期与否+status）③ shipping_details GROUP BY（Σ份数、条数、MAX更新时间）④ `compute_zt_report_totals`（仿 `compute_print_totals` 但按中通目的地过滤，逐字对齐 `get_report`）⑤ 每期最新 confirm 快照（算漂移）。其余（状态、KPI、提醒、最近/后续）纯 Python 归约。
- **缓存**：仿 `app/cache.py` 的 dashboard 模式，键 `(scope,year)`，~30s TTL；**所有 ZTO-MF 写操作**处失效（发货明细全部 CRUD、报数确认/作废、导出、期创建/删除）。
- **不复用** `GET /api/dashboard`（那是最近10期小部件，宇宙不对）。

### 3.2 操作日志扩展（不新建表）

- **加 3 列**到 `operation_logs`：`issue_number`(int, 可空, 加索引)、`channel`(varchar100, 可空)、`status`(varchar20, 非空, 默认'success')。
- **服务助手** `operation_log_service.record_operation(...)`：只 `db.add`（不 commit，随调用方事务），操作人取现有 `Depends(get_current_user)`。中文标签用 `ACTION_LABELS` 字典在接口层派生（不落库，免回填）。
- **去重现有 11 处** 内联 `OperationLog(...)` 走助手，并补传 `issue_number/channel`。
- **补 5 个缺失埋点**（现只写快照/修订，无日志）：`reports.confirm`、`reports.revoke`、`issues.create_issue`（+加 user 参数）、`issues.delete_issue`、`exports.report/shipping/all`（+加 user 参数，export_all 只记一次）。
- **新列表接口** `GET /api/operation-logs/recent`（`table_name` 可选、加 `issue_number/action` 过滤、按时间倒序）。保留现有 `GET /api/operation-logs`（`table_name` 必填）给单条抽屉用。

### 3.3 数据库迁移

- 新 revision `<id>_extend_operation_logs_workbench.py`，`down_revision='c7e9a1b3d5f2'`（已核为唯一 head）。
- `upgrade`: 加 3 列 + `ix_operation_logs_issue_number`；`status` 用 `server_default='success'` 以便存量行回填。
- `downgrade`: **先 drop_index 再 drop_column**（本迁移是删带索引的列，非删表 —— 与"删表只 drop_table"的仓库经验不冲突）。
- 本地跑 `alembic upgrade head` + `downgrade -1` 验证往返再提 PR。

---

## 四、前端改动

### 三个页面

| 页面 | 文件 | 克隆自 | 要点 |
|---|---|---|---|
| **工作台总览** | `pages/LogisticsOverview.tsx` | `DashboardPage.tsx`（KPI卡+右侧待办）+ `History.tsx` statCards | 4 KPI（本年 期数/已上传/异常/待上传）+ 蓝按钮「查看期数总览」+ 待处理提醒(3项) + 最近操作记录表(`/operation-logs/recent` 取5) |
| **期数总览** | `pages/LogisticsIssues.tsx` | `History.tsx`（近乎复制后重列） | 状态条 Segmented(6桶) + 可选4卡 + 表格列：期号/出版日期/状态/报数中通/发货合计/差值/异常说明/操作。数据源=聚合接口 `scope=periods`（`getIssues` 上限100且无 join，不够用） |
| **单期详情** | `pages/LogisticsIssueDetail.tsx` | 现 `ShippingDetailsTab`（整体抬升） | 面包屑〈期数总览 + 摘要条(现4卡) + 新增"本期处理状态"3卡 + 右栏(下一步待办/期数信息/快捷操作) + 有/无数据两态；表格/筛选/弹窗/日志抽屉原样搬 |

- **单期详情重构要点**：删除顶部期次条选择器（`Recipients.tsx 589-624`）与相关 state，改为 `const {id}=useParams()` + `getIssue(id)`；`Recipients.tsx` 不再被路由，可删或留作重定向。
- **StatusTag 扩展**：`History.tsx` 只有 draft/confirmed/exported 三色，需在 `index.css` 增 ~4 个新桶的样式修饰符（已上传/待上传/未创建 + 置灰休刊），不要把 3 色硬套 6 语义。

### 路由与导航

- `App.tsx`：`/recipients` element 改 `<LogisticsOverview/>`；新增 `/logistics/issues`、`/logistics/issues/:id`；`LegacyShippingRedirect` 目标改 `/logistics/issues/:id`。
- `AppLayout.tsx`：菜单加"期数总览"；`getSelectedKey` 加 `/logistics/issues` 分支；`getOpenKeys` 加 `/logistics` 前缀。

### 深链改点（关键，防回归）

| 位置 | 现在指向 | 改为 |
|---|---|---|
| `App.tsx:34` LegacyShippingRedirect | `/recipients?tab=shipping&issueId=` | `/logistics/issues/:id` |
| `History.tsx:202`「中通明细」 | `/recipients?tab=shipping&issueId=` | `/logistics/issues/:id` |
| `DashboardPage.tsx:189`「明细」 | `/recipients?tab=shipping&issueId=` | `/logistics/issues/:id` |
| `ReportEditor.tsx:516`「发货」 | `/shipping/:issueId` | `/logistics/issues/:id`（同步改本地守卫 `check-issue-detail-actions.ps1:13`，该守卫不在 CI） |

### 前端 API 模块

- `api/logisticsOverview.ts`（新）：`getWorkbenchOverview` / `getPeriodsOverview`。
- `api/operationLogs.ts`（扩展）：`action` 放宽为 string，加 `issue_number/channel/status/action_label`，加 `getRecentOperationLogs`。保留 `getOperationLogs`（单条抽屉）。

---

## 五、实施顺序（5 个 PR，每个独立过 CI）

> 顺序刻意让后端先行、深链先改、**首页翻转放最后**，避免任何时刻出现"点明细却进了工作台"的回归。

1. **PR1（后端）** operation_logs 迁移 + `record_operation` 助手 + 11 处去重 + 5 处补埋点 + `/recent` 接口 + 测试。
2. **PR2（后端）** `compute_zt_report_totals` + `overview_service` + `/api/analytics/overview` + 缓存 + 对账 parity 测试。
3. **PR3（前端）** `logisticsOverview.ts`/`operationLogs.ts` + 新路由/导航 + **期数总览页** + **重指所有深链** + LegacyRedirect。（此时 `/recipients` 仍是老详情，安全。）
4. **PR4（前端）** 单期详情 `LogisticsIssueDetail.tsx` 落到 `/logistics/issues/:id`（深链已就位）。
5. **PR5（前端）** 工作台 `LogisticsOverview.tsx` + `/recipients` 翻转 + 全链路冒烟。**唯一改变 ZTO-MF 打开内容的一步，最后做。**

---

## 六、本期不做（推迟）

- 地址异常 检测与提醒卡（D4）。
- 收件人 CRUD 重建（页已删，见待确认）。
- "自动复制·待核对"子状态。
- 历史导入 / 批量规整地址 的日志埋点（低优先）。
- 完整"操作记录"独立页（先只做工作台上的 5 条 + 查看全部占位）。

---

## 七、待确认

1. **收件人**：确认就此不做（无菜单、不在 MVP）？还是要另行重建。
2. **未创建计入哪**：工作台"待上传"卡是否包含"未创建"期？（后端会分开返回，UI 可选；默认：待上传卡只算已创建未上传，未创建只在"后续期数"露出。）
3. **最后更新时间口径**：MVP 用 `MAX(发货明细.updated_at)`（回退 `issue.updated_at`）够吗？还是要反映"该期任何操作"（需依赖操作日志，较重）。
4. 其余细节（草稿显差值、全零期显待上传、confirmed/exported 合并）按已定的 D1/D2 优先级默认处理，无异议即照做。
