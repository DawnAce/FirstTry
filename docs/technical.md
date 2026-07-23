# 技术文档

## 1. 项目架构

本项目采用前后端分离架构，使用 FastAPI + React 构建单页应用（SPA）。前端图表使用 ECharts（通过 echarts-for-react 封装），支持折线图、柱状图等多种图表类型。

### 开发模式
- 前端：Vite 开发服务器运行在 `http://localhost:5173`
- 后端：FastAPI 服务运行在 `http://localhost:8000`
- 前端通过 CORS 跨域请求后端 API
- 一键启动脚本：`dev.ps1`（Windows PowerShell）、`dev.bat`（Windows CMD）、`dev.sh`（macOS / Linux）

### 生产模式
- 前端构建为静态文件（`frontend/dist`）
- FastAPI 直接提供静态文件服务
- 所有请求由单一 FastAPI 进程处理
- API 路由优先，其他路由返回 `index.html` 支持客户端路由

## 2. 目录结构

```
FirstTry/
├── backend/
│   ├── alembic/                # 数据库迁移脚本
│   │   └── versions/
│   ├── app/
│   │   ├── api/                # API 路由
│   │   │   ├── auth.py         # 用户认证
│   │   │   ├── exports.py      # 导出 Excel
│   │   │   ├── history_import.py # 往期导入（模板下载、预览、提交）
│   │   │   ├── issues.py       # 期数管理
│   │   │   ├── recipients.py   # 物流管理
│   │   │   ├── reports.py      # 报数数据
│   │   │   ├── schedule.py     # 刊期查询、年度刊期 PDF 上传预览与提交
│   │   │   ├── shipping.py     # 发货管理
│   │   │   ├── shipping_details.py # ZTO-MF CRUD
│   │   │   ├── operation_logs.py  # 操作日志查询
│   │   │   └── templates.py    # 模板管理
│   │   ├── models/             # SQLAlchemy 模型
│   │   │   ├── issue.py
│   │   │   ├── publication_schedule.py
│   │   │   ├── publication_schedule_upload.py
│   │   │   ├── recipient.py
│   │   │   ├── report_entry.py
│   │   │   ├── report_item_template.py
│   │   │   ├── report_revision.py  # 作废记录
│   │   │   ├── shipping_record.py
│   │   │   ├── shipping_detail.py  # ZTO-MF
│   │   │   ├── operation_log.py   # 操作日志
│   │   │   ├── subscription.py
│   │   │   ├── temp_print_detail.py # 临时加印归属明细
│   │   │   └── user.py         # 用户模型
│   │   ├── schemas/            # Pydantic 模式
│   │   │   ├── auth.py         # 认证模式
│   │   │   └── publication_schedule_upload.py # 刊期上传预览/提交模式
│   │   ├── seeds/              # 种子数据
│   │   │   ├── publication_schedule_2026.py
│   │   │   ├── report_templates.py
│   │   │   └── shipping_details_2649.py  # 2649期中通发货初始种子数据
│   │   ├── services/           # 业务逻辑
│   │   │   ├── address_service.py  # 地址解析与规范化（cpca）
│   │   │   ├── history_import_service.py       # 往期导入：解析、校验、提交
│   │   │   ├── history_import_template_service.py # 往期导入模板生成
│   │   │   ├── publication_schedule_parser.py  # 刊期 PDF 文本解析与校验
│   │   │   ├── publication_schedule_upload_service.py # 刊期上传存储与提交
│   │   │   ├── raw_report_import_service.py    # 原始印数多工作表解析
│   │   │   ├── original_zto_shipping_import_service.py # 原始中通多工作表解析
│   │   ├── templates/          # Excel 模板
│   │   ├── auth.py             # JWT 认证工具
│   │   ├── config.py           # 配置管理
│   │   ├── cache.py            # Dashboard 内存缓存
│   │   ├── database.py         # 数据库连接
│   │   └── main.py             # FastAPI 应用入口
│   ├── alembic.ini
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/                # API 客户端
│   │   │   └── auth.ts         # 认证 API
│   │   ├── components/         # 通用组件
│   │   │   └── AppLayout.tsx  # 全局布局：顶部导航栏（搜索、通知铃铛、帮助、用户头像）+ 可折叠侧边栏（Logo、印数管理/物流管理/刊期表管理/订单管理/商品管理/客户管理/合同管理/财务管理 等一级菜单；物流管理与订单管理为展开式子菜单）
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx  # 认证上下文
│   │   ├── pages/              # 页面组件
│   │   │   ├── DashboardPage.tsx  # 印数报数仪表盘（/，侧边栏「印数报数」）— 统计卡片、一键创建/补录、报数流程、近期印数表、趋势图（ECharts）、待处理/快捷入口侧栏
│   │   │   ├── History.tsx        # 历史期数页（/history，侧边栏「印数管理 > 历史期数」）
│   │   │   ├── HistoryImport.tsx  # 往期导入页（/history-import，从历史印数期数页右上角「导入往期」按钮进入）
│   │   │   ├── Login.tsx       # 登录页面
│   │   │   ├── ScheduleView.tsx              # 期刊表页面（/schedule）
│   │   │   ├── ScheduleImport.tsx            # 导入期刊表页面（/schedule/import）
│   │   │   ├── Recipients.tsx     # 物流管理子菜单（/recipients「ZTO-MF」、/recipients?tab=recipients「收件人」两标签）
│   │   │   ├── PostDelivery.tsx    # 邮局管理页（/post-delivery，一级菜单「邮局管理」）— 2 tab：投递名册 DeliveriesTab / 客服工单 TicketsTab（投诉/改地址/回访三合一，按类型筛选）；「邮局订报生成」在 /post-delivery/subscription、「收款发票」已迁至财务管理（PostalReceipts.tsx）
│   │   │   ├── ProductCatalog.tsx  # 商品管理页（/products，侧边栏一级菜单「商品管理」）
│   │   │   ├── ReportEditor.tsx
│   │   │   ├── ShippingPreview.tsx
│   │   │   └── Templates.tsx    # 报数模板页（/templates，侧边栏「印数管理 > 报数模板」）
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── docs/
│   ├── technical.md            # 本文档
│   ├── requirements.md         # 需求文档
│   └── user-guide.md           # 操作手册
├── .env                        # 环境变量
├── .gitignore
└── README.md
```

## 3. 数据库模型

系统数据表按模块分组如下（核心印数/物流 §3.1–3.14 + 订单管理 §3.15 + 商品库 §3.16 + 邮局投递 §3.17，另含合同/财务等）：

### 3.1 publication_schedule（刊期表）
存储每年的出版计划。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| year | INT | 年份 |
| issue_number | INT | 期号 |
| publish_date | DATE | 出版日期 |
| is_suspended | BOOLEAN | 是否休刊 |

**示例数据（2026年）**：
- 52 周，49 期出版，3 期休刊（2/16, 2/23, 10/5）
- 期号范围：2635 - 2683

### 3.2 publication_schedule_uploads（刊期上传记录）
记录管理员上传的年度刊期 PDF、解析结果和提交状态，用于审计和排查。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| year | INT | 刊期年份 |
| original_filename | VARCHAR(255) | 原始 PDF 文件名 |
| stored_path | VARCHAR(500) | 服务端保存路径 |
| status | ENUM | 状态：previewed/committed/failed |
| summary_json | JSON | 解析摘要，如总行数、出版期数、休刊期数、期号范围、版数（page_count） |
| rows_json | JSON | 预览时解析出的刊期行（日期使用 ISO 字符串），提交时以此为准 |
| error_json | JSON | 解析或提交错误列表 |
| uploaded_by | VARCHAR(50) | 上传用户名 |
| raw_text | TEXT | PDF 抽取出的原始文本 |
| created_at | DATETIME | 上传时间 |
| committed_at | DATETIME | 提交写入时间 |

上传文件保存到 `backend/app/uploads/publication_schedules/<year>/`。只有文字版 PDF 可解析；扫描件需要先 OCR；单个 PDF 最大 10 MB。提交时使用服务端保存的 `rows_json`，不接受浏览器重新提交的行数据；提交前会先拒绝已有解析错误的上传，再校验期号连续、日期不重复、日期年份匹配，并保护已创建期数：已创建的期号不能被移除，也不能被改到其他出版日期。

### 3.3 issues（期数）
记录每期的创建和状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_number | INT | 期号（唯一） |
| publish_date | DATE | 出版日期 |
| status | ENUM | 状态：draft/confirmed/exported |
| page_count | INT | 版数（默认 24，步长 4）。创建期次时自动从期刊表获取计划版数作为初始值 |
| notes | TEXT | 备注 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**关系**：
- 一对多 `report_entries`（报数数据）
- 一对多 `shipping_records`（发货记录）

**年内期次**：`issues` 表不单独存储年内第几期。接口返回时根据 `publication_schedule` 实时计算：同一年、未休刊、出版日期不晚于当前期的计划条数。例如 2026-04-20 的总第 2648 期为当年第 14 期，接口返回 `year_issue_index: 14`、`year_issue_label: "十四"`。

**期刊表联动**：接口返回的 `IssueOut` 包含 `planned_page_count` 字段（来自 `publication_schedule` 的计划版数），前端同时显示"计划 XX 版"和"实际 XX 版"。当两者不一致时显示警告提示，用户可手动修改实际版数。

### 3.4 report_item_templates（报数模板配置）
定义报数表的所有项目及其属性。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| category | VARCHAR | 主类别 |
| sub_category | VARCHAR | 子类别 |
| destination | VARCHAR(50) | 发货目的地 |
| default_value | INT | 默认值 |
| is_variable | BOOLEAN | 是否为变动项 |
| excel_sheet | VARCHAR | Excel sheet 名称 |
| excel_cell | VARCHAR | Excel 单元格位置 |
| display_order | INT | 显示顺序 |

**示例**：
```sql
('邮发', '北京邮发（外埠）', '北京市报刊发行局', 0, TRUE, '邮发、报零、订户', 'B4', 1)
('邮发', '北京邮发（本市）', '北京市报刊发行局', 0, TRUE, '邮发、报零、订户', 'B5', 2)
('订户', '杂志铺', '中通物流公司', 12, FALSE, '邮发、报零、订户', 'B24', 3)
```

**固定项 vs 变动项**：
- **固定项**（`is_variable=FALSE`）：每期数值相同，如"杂志铺"、"国图贸"、"合订本"等
- **变动项**（`is_variable=TRUE`）：每期需要手工输入，如"北京邮发"、"北京报零"、"广州日报"等

**已移除的项目**：营报传媒加印、财经中心加印、中经未来、产经中心加印（原 social_use 类别下的冗余项）已移除，其功能由 `temp_print_details` 明细表替代。

**合订本显示**：合订本（binding 类别）不再作为独立类别显示，其条目合并计入社用报小计。

**社用报前端显示顺序**：报数编辑页仅对当前可见的社用报普通条目按原始印数表顺序排序；隐藏或复合管理的条目（如印厂留存、报社订阅自投/展示）不会因此新增到页面。

### 3.5 report_entries（报数数据）
存储每期的具体报数值。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_id | INT | 外键 → issues.id |
| category | VARCHAR | 主类别 |
| sub_category | VARCHAR | 子类别 |
| destination | VARCHAR(50) | 发货目的地 |
| value | INT | 数值 |
| is_variable | BOOLEAN | 是否为变动项 |

**创建逻辑**：
1. 创建新期时，优先从上一期 `report_entries` 复制条目和值
2. 如果没有上一期，则从 `report_item_templates` 初始化条目
3. 同步复制已有 `destination`；缺失时按固定去向规则兜底
4. 固定项和变动项使用复制值或模板 `default_value`，等待用户输入本期变动

**去向规则**：
- 北京邮发（`postal`）→ 北京市报刊发行局
- 北京报零（`retail`）→ 北京市报刊零售公司
- 合订本（`binding`）→ 印厂
- 其他类别 → 中通物流公司

### 3.6 recipients（收件人）
管理所有收件人信息。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| name | VARCHAR | 姓名 |
| phone | VARCHAR | 电话 |
| address | TEXT | 地址 |
| type | ENUM | 类型：business/reader/sample |
| frequency | ENUM | 频率：weekly/biweekly/monthly |
| status | ENUM | 状态：active/inactive |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**类型说明**：
- **business**（对公）：企业单位
- **reader**（读者）：个人订阅
- **sample**（样报）：媒体、合作方等

**频率说明**：
- **weekly**（周）：每期都发
- **biweekly**（半月）：半月发一次
- **monthly**（月底）：月最后一期发

### 3.7 subscriptions（订阅记录）
记录收件人的订阅历史。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| recipient_id | INT | 外键 → recipients.id |
| type | ENUM | 类型：new/renewal |
| start_date | DATE | 起始日期 |
| end_date | DATE | 截止日期 |
| quantity | INT | 每期份数 |
| created_at | DATETIME | 创建时间 |

**设计要点**：
- 新订和续订分别记录，便于统计分析
- 支持计算续订次数、续订率等指标
- `end_date` 用于判断订阅是否有效

### 3.8 users（用户）
管理系统用户和权限。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| username | VARCHAR | 用户名（唯一） |
| password_hash | VARCHAR | bcrypt 密码哈希 |
| role | ENUM | 角色：admin/operator |
| created_at | DATETIME | 创建时间 |

**默认账户**：用户名 `admin`，密码 `admin123`，角色 `admin`。

### 3.9 report_revisions（作废记录）
记录报数确认和作废的修订历史。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_id | INT | 外键 → issues.id |
| revision_number | INT | 修订序号 |
| operator_id | INT | 外键 → users.id |
| reason | TEXT | 作废原因（可选） |
| changes_json | JSON | 数据快照 |
| confirmed_at | DATETIME | 确认时间 |
| revoked_at | DATETIME | 作废时间（可选） |

**作废流程**：管理员作废已确认的报数后，`issue.status` 重置为 `draft`，同时创建一条 `revoked_at` 不为空的修订记录。

### 3.10 temp_print_details（临时加印归属明细）
记录临时加印的部门归属分配。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_id | INT | 外键 → issues.id |
| department | VARCHAR | 部门：营报传媒/财经中心/中经未来/产经中心/其他 |
| custom_name | VARCHAR | 自定义名称（department=其他 时使用） |
| quantity | INT | 加印数量 |
| self_quantity | INT | 自留分发数量 |

**计算规则**：
- 快递数 = quantity - self_quantity（自动计算）
- 所有明细行的 quantity 之和 = 临时加印总数
- 所有明细行的 self_quantity 之和 = 自留分发
- 所有明细行的快递数之和 = 北京快递

**说明**：原先独立的 营报传媒加印、财经中心加印、中经未来、产经中心加印 等 `report_entry` 项目已移除，所有部门级别的临时加印现在统一通过此明细表管理。

**前端保存机制**：归属明细的编辑采用防抖保存（1.5 秒无操作后通过 ref 读取最新值保存），避免快速输入时多个并发请求导致数据被旧响应覆盖。

### 3.11 shipping_records（发货记录）
每期为每个收件人生成的发货明细。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_id | INT | 外键 → issues.id |
| recipient_id | INT | 外键 → recipients.id |
| quantity | INT | 发货数量 |
| status | ENUM | 状态：pending/confirmed/shipped |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 3.12 shipping_details（ZTO-MF）
存储中通快递发货明细数据，从 Excel 发货表导入，支持完整 CRUD。数据按 `issue_number` 管理；前端通过期号选择器查看、编辑指定期的明细，不再将业务操作固定到 2649 期。`shipping_details_2649.py` 仅作为初始化种子数据。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_number | INT | 期号（如 2649） |
| sheet_name | VARCHAR(50) | 来源 sheet 名（溯源用） |
| channel | VARCHAR(255) | 渠道类型（中通原始文件中可能为较长的描述文本，如"样报缴送，中经报1月每期各4份+样报缴送清单"） |
| sub_channel | VARCHAR(255) | 子渠道（如赠阅下的"监管"/"政府"） |
| transport | VARCHAR(50) | 运输方式 |
| frequency | VARCHAR(50) | 发送频率 |
| status | VARCHAR(50) | 状态：正常/停发 |
| name | VARCHAR(100) | 收件人/联系人 |
| address | TEXT | 收件地址 |
| phone | VARCHAR(50) | 联系电话（支持多号码） |
| quantity | INT | 份数 |
| deadline | VARCHAR(50) | 截止日期（支持"长期"等文本） |
| notes | TEXT | 备注 |
| extra_info | TEXT | 附加信息 |
| station_name | VARCHAR(100) | 站名（高铁展示用） |
| station_hall | VARCHAR(200) | 站厅名称（高铁展示用） |
| contact_person | VARCHAR(100) | 联系人（高铁展示用） |
| seq_number | INT | 序号（高铁展示用） |
| period_count | INT | 期数（月用） |
| confirmation | VARCHAR(50) | 信息确认（高铁展示用） |
| company | VARCHAR(100) | 签约公司（如：北京悦途出行、广州日报） |
| shipped_at | DATETIME | 发货时间（可选，手动填写） |
| order_id | INT | 订单发货同步来源订单；手工行为空 |
| order_item_id | INT | 订单发货同步来源明细；手工行为空 |
| fulfillment_target_id | INT | 订单发货同步来源履约目标；手工行为空 |
| source_type | ENUM | 来源：manual/order_generated/historical_import |
| sync_status | ENUM | 同步状态：synced/manually_modified/orphaned |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

订单发货同步行通过唯一索引 `uq_shipping_detail_order_target_issue`
约束 `(issue_number, order_id, order_item_id, fulfillment_target_id)`，避免同一期同一订单履约目标在并发同步时生成重复发货明细；历史手工行的关联字段为 `NULL`，仍允许多行共存。

### 3.13 issue_audit_snapshots（确认/导出快照）
记录当期报数与ZTO-MF之间的关键校验快照，用于追溯确认时和导出时采用的数量状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_id | INT | 对应 `issues.id` |
| snapshot_type | VARCHAR(20) | 快照类型：`confirm` / `report_export` / `shipping_export` |
| report_total | INT | 快照时的报数中通合计 |
| shipping_total | INT | 快照时的 `shipping_details.quantity` 合计 |
| delta | INT | `report_total - shipping_total` |
| is_match | BOOLEAN | 是否一致 |
| created_by | VARCHAR(50) | 触发人（确认时记录用户名；导出快照当前可为空） |
| created_at | DATETIME | 创建时间 |

### 3.14 operation_logs（操作日志）
记录所有写操作的审计日志，支持按表名和记录ID查询。当前用于ZTO-MF，设计上可扩展到其他表。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| table_name | VARCHAR(100) | 操作的表名（如 shipping_details） |
| record_id | INT | 被操作记录的 ID |
| record_name | VARCHAR(200) | 被操作记录名称（冗余，便于展示） |
| action | VARCHAR(20) | 操作类型：create / update / delete |
| changes | JSON | 变更详情（新增：完整数据，编辑：字段差异，删除：被删数据） |
| user_id | INT | 操作人 ID |
| username | VARCHAR(50) | 操作人用户名（冗余） |
| created_at | DATETIME | 操作时间 |

**渠道类型**（8种）：

| 渠道 | 说明 |
|------|------|
| 渠道订阅 | 分销商/代理商（如广州日报、杂志铺、国图贸） |
| 对公订阅 | 机构直接订阅（如北京悦途出行/高铁展示） |
| 个人订阅 | 自有网点个人订单 |
| 记者站 | 外地记者站内部分发 |
| 赠阅 | 免费赠送（含监管、政府两个子渠道） |
| 库房留存 | 中通库房备用报 |
| 报社留存 | 中通包车运输到报社 |

**运输方式**（4种）：中通物流、邮政物流、包车运输、库房留存

**频率**：周、半月、月

### 3.15 订单管理 V1.2（5 张表）

订单管理子模块与刊期 / 印数 / 物流子系统正交；V1.1 完成手工建单和确认作废，V1.2 已补齐 active 状态明细编辑、多版本履约方案与订阅期限/套餐价：

| 表 | 说明 |
|----|------|
| `orders` | 订单主体（订单编码、付款主体、来源、状态、金额）。状态机：`draft → active → void`（`pending_confirmation` 为保留状态，目前不会自动跳入）|
| `order_items` | 订单明细（一笔履约：订阅 / 单期 / 赠阅 / 补寄 / 续订 / 换订），含 `expected_issues_at_creation` 期数快照、`total_quantity`（每期份数）、`unit_price`（订阅 = 单订户覆盖期总价 / 单期 = 每份零售价）、`subtotal`（= total_quantity × unit_price），以及订阅定价元数据 `subscription_term`（`half_year` / `one_year` / `custom`）、`delivery_method`（`post_office` / `zto_mf`）、`term_start_month`（`YYYY-MM`）、`issue_label`（单期归一化期次，见下） |
| `fulfillment_allocations` | 分配方案版本（V1.2 起支持 active 订单明细编辑时按生效期号切出 v2+） |
| `fulfillment_targets` | 履约目标（收件人 / 电话 / 地址 / 邮编 / 份数 = 每期份数），`shipping_channel` V1.1 默认 `zto_outsource` |
| `order_events` | 订单事件流（created / confirmed / modified / voided / allocation_updated / target_* / item_added / item_removed / item_modified / synced_to_shipping / shipping_sync_conflict） |

关键约束：

- `order_code` 在 `active` 后由 `OrderCodeGenerator` 生成，格式 `ORD-YYYY-NNNNNN`（年内 6 位零填充序号，如 `ORD-2026-000003`），创建草稿时为 `NULL`
- `order_items.allocation_id` 是 NOT NULL FK，因此**草稿创建时即写入 v1 allocation**（避免 confirm 时改 schema）
- **份数 / 单价语义**：`order_items.total_quantity` 与 `fulfillment_targets.quantity` 均指**每期**份数（与覆盖期长度无关）；`order_items.unit_price` 在订阅场景下是单订户在整个覆盖期内的订阅费，单期/零售场景下是每份零售价；`subtotal = total_quantity × unit_price`，公式与期数无关。每期实际印数 = total_quantity × `expected_issues_at_creation`（在详情页进度卡里展示）
- **订阅定价字段（V1.2A）**：`order_items` 现持久化 `subscription_term`（`half_year` / `one_year` / `custom`）、`delivery_method`（`post_office` / `zto_mf`）与 `term_start_month`（`YYYY-MM`）。这些字段用于保存订阅报价与起订月元数据；覆盖范围的履约权威字段仍然是 `coverage_start_date / coverage_end_date`，因此 2 年等非标周期依旧通过实际日期区间表达。
- **单期期次标识 `order_items.issue_label`（迁移 `b8e3a1c5d7f0`，`String(32)`、加索引）**：为没有「期号」的刊物（主要是商学院月刊）记录归一化的单期身份，格式 `YYYY-MM` / `YYYY-MM~MM`（合刊）。年月归属于「期」这一层（即本字段），**不写进任何商品名**。中国经营报单期继续使用 `issue_number`（期号），商学院月刊使用 `issue_label`。归一化辅助函数：`app/services/issue_label.py` 的 `normalize_business_school_issue_label()`。本字段也是 §4.15「按期统计」的聚合维度。
- **原价列 `orders.original_amount`（迁移 `c4f1a9e2b6d3`，`Numeric(10,2)`、可空）**：CBJ 导出的「原价」（折前标价）列原先解析后被丢弃（导入器只写 `total_amount=实付`），现予以持久化；`total_amount` 仍追踪实付。该列支撑 §4.15「按活动统计」的折扣计算：`原价合计 = SUM(COALESCE(original_amount, paid))`，`折扣额 = 原价合计 − 实收`（未捕获原价的订单按「无折扣」计）。
- 所有金额字段使用 `DECIMAL(10, 2)`（最大 9999 9999.99 元）；前端 TS 用 `string` 传输，避免 JS 浮点损失
- 在 active 状态下，`PUT /api/orders/{id}` 仍只允许 `order_service.ACTIVE_EDITABLE_FIELDS` 白名单内的 13 个非结构字段被修改；明细 / 履约目标的结构改动改走 `PUT /api/orders/{id}/items`，并按 `effective_from_issue` 关闭旧 allocation、创建新版本或取消缺失明细
- **当前业务范围限定**：仍主要覆盖"个人客户预付 + 同事赠阅"两种场景。`paid_amount` 字段虽已建表，但**没有任何业务逻辑读它**（不算欠款、不阻塞 confirm、不做对账、列表不能按"未付清"过滤）。"渠道订单（先履约后付款 / 赊账）"留待后续版本的财务对账引入「收款流水子表 + 欠款追踪 + 未付清筛选 + Dashboard 欠款卡片」时再激活该字段的业务价值
- **`source_type` 字段的录入方式收敛**：原 5 个枚举值（`ecommerce` / `corporate_transfer` / `vip_gift` / `manual` / `mail_annual`）实际混杂了 4 个维度的概念（销售渠道 / 付款方式 / 业务性质 / 录入方式），与已有的 `source_platform`（销售渠道）/ `payment_method`（付款方式）/ `billing_type`（业务性质）字段重复。**PR-A 已将 UX 解耦为"录入方式"** —— 前端表单完全隐藏该字段，列表筛选器移除，详情页用 Tag「📥 手工录入」展示；后端 `OrderCreate.source_type` 默认 `manual`、`OrderUpdate` 完全移除该字段（provenance 元数据任何状态下都不可改）。数据迁移 `d8a1f4e7b9c2` 已把全部历史数据规范化为 `manual`。后续版本电商批量导入 / API 同步启用前，建议继续推进 DB schema rename `source_type` → `entry_method`，枚举值收敛为 `manual / excel_import / api_sync`
- **录入方式与销售渠道的区分**：用户填的"渠道信息"（微信小程序 / 淘宝 / 有赞 + 店铺名）走 `source_platform` / `source_store`，不走 `source_type`；详情页 Descriptions 区有专门展示。这与"录入方式"是两个正交维度（例：吴娟那张订单是"销售渠道 = 微信小程序，录入方式 = 手工录入"）

迁移：

- `alembic/versions/c7e3a9b1d2f4_add_order_management_v1_1.py`：建表 + 索引
- `alembic/versions/d8a1f4e7b9c2_normalize_order_source_type_to_manual.py`：PR-A 数据规范化（全部 `source_type` 写为 `manual`）
- `alembic/versions/e9b3c5d7f1a4_add_invoice_tax_no_and_email.py`：把"发票抬头"单字段拆出 `invoice_tax_no`（纳税人识别号 VARCHAR(64)）、`invoice_recipient_email`（电子发票送达邮箱 VARCHAR(128)）两个新列，便于后续生成 / 推送电子发票
- `alembic/versions/f4a8c2d9e6b1_add_order_item_subscription_pricing_fields.py`：为 `order_items` 新增 `subscription_term`、`delivery_method`、`term_start_month` 三个订阅定价字段

### 3.16 商品库（products）+ 电商订单导入（CBJ 小程序）

把电商平台（首个：CBJ 小程序）的订单尽量自动、完整地导入订单管理。采用「商品中心」模式——**借成熟电商的数据模型，不引入重型平台**：商品库是真源 + 映射层，订单行（`order_items`）继续快照属性，所以改商品库永不篡改历史订单。

**商品库 `products` 表（数据驱动的映射表，新促销 = 加一行）**

| 列 | 说明 |
|----|------|
| `code`（唯一）/ `display_name` / `aliases`（JSON） | 匹配键：精确编码/名称 → 别名 → 归一化包含（容活动后缀如「618促销活动」） |
| `publication`（可空，套餐为 NULL）/ `publication_format` / `fulfillment_type` / `subscription_term` / `delivery_method` / `billing_type` | 与 `order_items` 快照字段一一对应，解析时直接拷贝 |
| `coverage_rule`（`term_from_month` / `latest_issue` / `explicit` / `custom`）/ `coverage_start_date` / `coverage_end_date` | 覆盖期算法；起投时间由导入批次提供，不写死在商品上。**注**：后端枚举保留 `explicit`（固定日期），但因其无日期输入、导入端从不读取、选中会 422，**PR#43 已从商品表单「覆盖期算法」下拉移除该选项**（仅 UI 不可选，枚举与逻辑不动） |
| `list_price` | 仅参考/差异提示——实际记录订单行的**实付价** |
| `is_bundle` / `components`（JSON） | 套餐拆分：固定价腿 + 一个 `remainder` 腿（中国经营报固定 240、商学院拿余额）；每腿可带 `delivery_method` 逐刊设投递（缺省回落套餐顶层 `delivery_method`）|
| `active` / `notes` / 时间戳 | |

**`orders` 表新增列**

| 列 | 说明 |
|----|------|
| `entry_method`（由 `source_type` 改名，枚举 `manual / excel_import / api_sync`）| 录入方式 provenance；手工入口固定写 `manual`，导入入口写 `excel_import` |
| `commercial_status`（`OrderCommercialStatus`：`pending_payment / paid / shipped / refunded / partial_refund / cancelled`，已发货含已完成）| 我们自己的干净商业状态枚举；手工订单为 NULL |
| `source_status_raw` | 原始平台状态串（参考存档，永不依赖）|
| `is_historical_archive` | 历史归档标记；归档单**默认不自动同步**（不被硬拦——补齐覆盖期/期号后仍可手动同步）、列表可单独筛 |
| `campaign`（索引）| 营销活动标签（如 `2026-618`），电商导入按批次写入，用于追溯 + 按活动统计；手工单为 NULL |

**导入管线（服务）**：`cbj_order_import_parser.parse_cbj_orders`（解析 Excel：多行产品拆分、X0 丢弃、运费/转中通标记、地址拆姓名/电话/地址/邮编）→ `product_resolver_service.resolve_product`（商品匹配 + 属性拷贝 + 套餐拆分 + 价=实付）→ `order_import_status_service.map_commercial_status`（状态映射 + 收/跳/退款标记策略）→ `cbj_order_import_service.build_import_preview`（覆盖期按批次 `BatchSettings`：邮局/中通起投月 + 截止日，历史模式留空；**活动标签 `campaign` + 赠品 `bonus_months`/`gift_publication`/`gift_note`**；去重 `external_order_no`；逐单决策 import / skip_status / duplicate / unresolved）→ 缓存（`order_import_cache`，uuid 会话 30 分钟 TTL，单 worker）→ `commit_import`（按年块分配 `order_code`，逐单 `order_service.create_imported_order`，单事务原子提交）。

**活动 + 赠品（按批次落到订单，商品库不按年拆）**：每年 618 等活动的「价格差异」走实付、「基础履约」(618=全年/邮局) 稳定 → 商品库一行兜住、不为每年的活动建行；活动差异写到订单：`campaign` 标签（追溯 + `GET /api/orders?campaign=…` 统计）；`bonus_months` 顺延订阅覆盖期末（如送 1 月 → 13 个月）；`gift_publication`/`gift_note` 生成一条**免费赠品明细**（`fulfillment_type=gift` / `billing_type=free_gift`，收件人同主单 → `compute_expected_issues` 返回 None，不计期数偏差、不进自动同步）。延长与赠品**只作用于含订阅的订单**，单期单跳过。

**商品库种子（`app/seeds/products.py`）要点**：
- 新增商品「《中国经营报》全年订阅（中通 月送）」`code = CBJ-SUB-1Y-ZTO-M`、¥240，与「中通 周送」¥390 区分开（发送频率落在商品名/价格上，**不进** `DeliveryMethod` 枚举）。
- 促销商品改名为活动中性的「《中国经营报》全年订阅（促销价）」；「618促销活动」/「双十一订阅优惠」/旧全名保留为 `aliases`。理由：具体活动（618 / 双十一 / 年份）属于 `order.campaign`（携带年份、可聚合），不属于商品名。
- 运费补拍仍按运费信号处理，**不是**目录商品（保持不变）。

**关键不变量与业务规则**：
- 定价取**实付金额**（促销价如 199/576/10），`list_price` 只用于差异提示。
- 套餐：中国经营报固定 ¥240，商学院 = 实付 − 固定；余额为负时打 warning。**每组件可设自己的投递**（如中国经营报=邮局、商学院=中通）——组件 `delivery_method` 未设则回落套餐顶层。
- 运费补拍行只计入订单总额、不建明细；含「中通」/「转中通」→ 投递改 `zto_mf` 并在预览高亮（漏检会让整年投递走错，后果严重）。
- 起投时间**人为按批设定**（非写死 15 号）：付款晚于截止日 → 顺延一个月；每单可在预览/订单页改。
- 状态映射：认得的映到干净枚举，认不得的默认 `paid` + 标黄待核；退款单「收但标记」，绝不静默丢。
- 未识别商品 → 「待确认」队列：预览页按商品名聚合成「待确认商品汇总」，一键预填快速新增到商品库（智能默认 + `ProductForm` 共享组件）、保存后自动重新预览，绝不乱猜。
- **商学院月刊自动识别（取代旧的「手动快速新增月刊为商品」思路）**：导入时，未匹配行若标题形如「2026年X月刊《…》」/「2026年2~3月合刊《…》」，自动识别为商学院单期（`publication=business_school`、`single_issue`），并填好 `issue_label`；它**不**创建以年份命名的商品库行、也**不**进「待确认」。守卫：必须含「月刊/合刊」标记 **且** 标题不含「中国经营报」（带日期的中国经营报行仍照常排队）；真正未知商品（如「2026年1月新春礼包」）仍 → 「待确认」。该单期的 `delivery_method` 保持为空（不被订单级 zto 覆盖盖成「中通」）。中国经营报单期走 `issue_number`（期号），商学院单期走 `issue_label`。
- **「最新一期」自动判期号**：导入时 `coverage_rule=latest_issue` 的单期行，按"付款时间 + `publication_schedule` + 周五约 22 点翻期"算出 `issue_number`（中国经营报周一出刊；某期在其出刊周一前的周五 22:00 起售，订单期号 = 付款时间落入的起售窗口对应的期）。`app/services/latest_issue_resolver.py`（`FLIP_WEEKDAY/FLIP_HOUR/BORDERLINE_HOURS` 可配）。翻期点 ±4h 内的临界单加 warning 标黄待核（仍自动判、正常导入）；覆盖期仍留空（单期不走 term_from_month）。
- `order_code` 发号由 `order_code_service` 的 `MAX(suffix)+1` + 批量块分配（替代旧的无锁 `COUNT(*)+1`，避免批量撞号），单 worker 假设。

**新增接口**：`GET/POST/PUT /api/products`、`DELETE /api/products/{id}`（硬删除，返回 204）、`POST /api/products/{id}/deactivate`（软停用）（商品库 CRUD；硬删除安全——`order_items` 是属性快照、不外键引用 `products`）；`POST /api/order-import/preview`（上传 Excel + 批次设置：起投月/截止日 + 活动标签/延长月/赠品刊物+说明）、`POST /api/order-import/commit`（session_id）；`GET /api/orders?campaign=…`（按活动筛）。前端页：`/products`（商品管理，独立一级侧边栏菜单）、`/orders/import`（电商导入，近期 / 历史归档两种模式，含待确认汇总快速新增 + 活动赠品设置）。

迁移（均已应用到生产）：
- `b4d6f8a1c3e5`：补 `ordereventtype` 枚举遗漏的 `item_added/removed/modified`（修复 V1.2 在严格模式 MySQL 上的潜在崩溃）
- `c5e7a9b2d4f6`：`orders.source_type → entry_method`，枚举收敛为 `manual/excel_import/api_sync`（MySQL `CHANGE COLUMN`）
- `d7f9b1c3e5a8`：建 `products`（商品库）表
- `e1a3c5b7d9f2`：`orders` 新增 `commercial_status` / `source_status_raw` / `is_historical_archive`
- `f3b5d7c9e1a2`：`orders` 新增 `campaign`（营销活动标签，可空 + 索引）
- `b8e3a1c5d7f0`：`order_items` 新增 `issue_label`（单期归一化期次，`String(32)` + 索引）
- `c4f1a9e2b6d3`：`orders` 新增 `original_amount`（原价 / 折前标价，`Numeric(10,2)` 可空）

> 部署见 README §8。

### 3.17 邮局管理（投递记录层 + 客服工单）

**一级菜单「邮局管理」现有 3 个二级菜单**：①**投递名册**（`/post-delivery/deliveries`，纯台账/查询）②**邮局订报生成**（`/post-delivery/subscription`，唯一产出「给邮局文件」——汇总表/分送表/zip，给邮局的名单只来自这里）③**客服工单**（`/post-delivery/tickets`，投诉/改地址/回访三合一，按类型筛选）。「收款发票」已迁到「财务管理」，作为财务管理第三个 Tab「邮局收款」（见 §4.16 迁移说明）。

> **重构说明（2026-07，PR#76/#77/#78）**：①**「月度起投明细」整层已删除**（`PostalDeliveryBatch`/`PostalDeliveryRow` 两表、`/api/postal/batches*` 端点、前端 BatchesTab 全部删除；迁移 `c3d5e7f9a1b3` 删表，删表前用 `backend/scripts/export_postal_snapshot.py` 导 json 归档）；投递名册删除**守卫也已移除**（可直接删，不再有 409）。②「收款发票」迁到财务管理（后端 `/api/postal/finance/*` → `/api/finance/postal-receipts/*`）。③原「投诉工单/改地址/回访」三个独立 tab 合并为**客服工单**——回访不再是独立菜单/tab，成为工单的一种类型。

**邮局投递 = 一种投递方式，与中通 ZTO-MF 同级**（照 `shipping_details` 的成熟模型：投递记录，可挂订单/可独立）。数据来源于平台订单，但**邮局明细本身是投递记录、不是订单**——用户只对 CBJ/淘宝/中经报有赞 等平台有订单详情，其余平台只有投递数据；中通与邮局的明细里都可能出现「订单里没有的数据」。

> **重构说明（2026-07）**：早先版本把邮局每行做成 `post_office` 订单（`create_imported_order`），会污染订单列表/客户管理、并与电商真实订单双算。现改为独立的 `PostalDelivery` 投递记录层——不再造订单；邮局记录不进订单列表/客户管理；有平台订单号且平台对得上才挂真实订单（读者明细本身无平台订单号 → 多数 `order_id=NULL`，独立）。**注：本系统无独立客户资料表**，订单收报人真值在 `FulfillmentTarget`。

**投递记录 `postal_delivery`（迁移 `b5d7f9a1c3e6`，照 `shipping_details`）**：`(year, delivery_no)` 唯一（`delivery_no`=编号去前导零）；`order_id`/`order_item_id`/`fulfillment_target_id` 全可空（SET NULL，将来挂真实订单用）；`external_order_no`（平台订单号，将来补）；`source_type`（`historical_import`/`order_generated`/`manual`）；收报人（姓名/电话/省市区/详细地址/邮编）；`product`（认不出留原文，不强求刊物枚举）；`copies`/`amount`/`coverage_start_date`/`coverage_end_date`；`source_channel`（渠道/平台）；`distribution_unit_id`→`partners`（投递单位，落在本表，原表未填则留空、不推断）；`salesperson`/`remittance_name`/`remittance_date`/`notes`。

**月度起投明细批次（已移除，PR#77）**：早先的「月度起投明细」层（`postal_delivery_batches` / `postal_delivery_rows` 两表 + `postal_batch_service.generate_batch` 冻结成行 + `/api/postal/batches*` 端点 + 前端 BatchesTab）**整层已删除**。迁移 `c3d5e7f9a1b3` 删除两表；删表前先用 `backend/scripts/export_postal_snapshot.py` 把两表导成 json 归档。给邮局的名单改由「邮局订报生成」（`/post-delivery/subscription`）独立产出。：`postal_order_import_parser`（按表头解析「邮局读者明细」，零改动）+ `postal_delivery_import_service`（映射→`PostalDelivery`，不造订单；`(year, delivery_no)` 去重；投递单位有则挂 `Partner(distribution)` 无则空；产品留原文）。**投递名册**：`postal_delivery_service.list_deliveries`（年度/渠道/投递单位/起投月/搜索筛选）——邮局记录不进订单列表，这里是完整名册的家。投递名册列表另返回 `summary` 聚合（合计份数·未填单位数）供页面顶部「概览行」使用。

**服务 / API**：`app/services/postal_{order_import_parser,delivery_import_service,delivery_service}.py`；`app/api/postal.py`（`/api/postal/deliveries`、`/import/preview|commit`）。`partners` 删除守卫检查 `PostalDelivery.distribution_unit_id`（在用则 409）。

**统一客服工单（PR-E，迁移 `d4e6f8a0b2c4`）**：投诉 / 改地址 / 回访通过 SQLAlchemy 单表继承统一存入 `postal_tickets`，类型列为 `complaint/address/follow`，公共字段含 `postal_delivery_id/order_id/external_order_no/year`，类型专属字段保持可空。投诉处理、关联回访和应用地址留痕统一存入 `postal_ticket_events`。迁移保留投诉主键，重排改地址 / 回访主键；同编号回访设置 `parent_ticket_id` 并写入投诉时间线，独立回访仍作为工单展示。旧模型模块仅保留兼容导出。

**投诉工单（P2）**：投诉 `编号`(去前导零) + `年度` 经 `postal_common.delivery_map` → `postal_delivery`（`postal_delivery_id` 可空 SET NULL；关联的投递记录挂了真实订单才继承 `order_id`；匹配不上保留 external 字符串）。`处理情况` 归一为 `routed_label`（`\d*11185` 热线 / `XX局`）；状态为 open/in_progress/resolved；`投递渠道单位` → `partners.distribution`（删除受 partner guard 保护）。

**改地址工单 + 回访（P3）**：均按 编号+年度 关联投递记录；历史独立表已由 PR-E 迁入 `postal_tickets`。
- **改地址**：编号(去零) + `year(修改日期)` → `postal_delivery`；处理情况归一 `routed_label`（XX局）；**「应用新地址」** `apply_address_change` 把新姓名/电话/地址写回**投递记录**并置 `applied_to_order`/`applied_by`/`applied_at`（幂等，行锁 `with_for_update`）——若该读者挂了真实订单则同步当前 `FulfillmentTarget`（=同步履约订单），详情标注「已应用·已同步履约订单」或「已应用·仅名册」；未关联投递记录（`postal_delivery_id` 空）→ 400。
- **回访**：把读者明细「按天开列」的回访列（`YYYYMMDD回访`）拍平成一行一条，列头解析日期；同样关联投递记录。
- 公用小工具 `postal_common.py`（编号归一/年度/日期/处理情况归一/`order_map`/`delivery_map`）。服务 `postal_{address_change,follow_up}_{parser,import_service}.py` + `postal_change_service.py`；前端统一使用 `/api/postal/tickets*` 完成列表、详情、CRUD、应用、处理和导入。旧 `/complaints`、`/address-changes`、`/follow-ups` 路径仅作部署兼容。

**收款/发票（P4，已迁至财务管理，PR#76）**：迁移 `a4c6e8b0d2f4` 建 `postal_finance`（自成台账，**不改共享财务 Invoice/Payment/finance_service**）。导入《提现发票合集》：`发票信息` 正则拆 `发票抬头`/`购方税号`；链接 = `原始订单号(external_order_no)→orders` 优先、`姓名` 兜底（唯一命中才挂，`link_by` 记来源）；`net_amount` = 到款金额或 金额−手续费；去重键 (订单号或姓名, 到款日期, 金额-规范2位)。`postal_finance_{parser,import_service,service}.py`。**此模块已从邮局管理迁到「财务管理」**，作为财务管理第三个 Tab「邮局收款」：后端 API 从 `/api/postal/finance/*` 迁到 **`/api/finance/postal-receipts/*`**（筛选 平台/普专票/是否挂单/搜索 + import）；前端页在 `pages/PostalReceipts.tsx`（财务管理内），api 在 `api/finance.ts`。**并进财务发票工作台留待原始订单号补齐后**（那时再扩 Invoice.tax_category / Payment.fee_amount + 建真发票）。

**手工 CRUD + 投诉三态处理（P5 / PR#41）**：各源台账均有页面内新增/编辑/删除，写端点均 `require_admin`。投递名册删除**无守卫、可直接删**。投诉状态为 `open(待处理)/in_progress(处理中)/resolved(已解决)`；每次处理经 `POST /tickets/{id}/handlings` 写入 `postal_ticket_events`，`handling_count +1`、`status` 由最新处理驱动（删记录则回退）。

## 4. API 接口一览

所有 API 路径以 `/api` 为前缀。

### 4.1 用户认证

#### POST /api/auth/login
用户登录，返回 JWT 令牌。

**请求体**：
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**响应**：
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

**错误**：
- 401：用户名或密码错误

#### GET /api/auth/me
获取当前登录用户信息（需要认证）。

**响应**：
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin"
}
```

**说明**：
- JWT 令牌有效期为 72 小时
- 前端通过 localStorage 存储令牌
- 所有需要认证的 API 通过 axios 拦截器自动附加 `Authorization: Bearer <token>` 请求头
- 令牌过期或无效时返回 401，前端自动跳转到登录页面
- **所有业务 API 均需认证**：在 `main.py` 中通过 `dependencies=[Depends(get_current_user)]` 对所有业务路由强制认证，仅 `/api/auth/login` 为公开接口
- `/api/admin/seed` 需要管理员权限（`require_admin`）
- 前端启动时无论 localStorage 是否有缓存用户，都会调用 `/api/auth/me` 验证 token 有效性
- axios 全局超时设置为 120 秒（`timeout: 120000`），适配远程数据库延迟

### 4.2 系统管理

#### GET /api/health
健康检查。

**响应**：
```json
{"status": "ok"}
```

#### GET /api/dashboard
Dashboard 聚合接口，返回最近期数、统计、下一期信息、可创建期数列表、周印数统计和最新报数时间。使用 30 秒内存缓存，创建期数时自动清除缓存。

**响应**：
```json
{
  "recent_issues": [
    {
      "id": 1, "issue_number": 2650, "publish_date": "2026-05-18",
      "status": "confirmed", "print_total": 9355
    }
  ],
  "stats": {"total": 10, "draft": 2},
  "next_issue": {"issue_number": 2652, "publish_date": "2026-05-18", "previous_issue_id": 2},
  "available_issues": [{"issue_number": 2635, "publish_date": "2026-01-05"}, ...],
  "weekly_stats": {
    "this_week_total": 9355,
    "last_week_total": 9200,
    "change": 155
  },
  "latest_report_time": "2026-05-27T15:26:00"
}
```

**字段说明**：
- `print_total`：每个期数的总印数（排除临时加印自留、营报传媒加印等内部分类）
- `weekly_stats`：本周与上周印数对比（按周计算，非月累计）
- `latest_report_time`：最新创建期数的时间（ISO 格式）

#### POST /api/admin/seed
运行种子数据初始化（2026年刊期表 + 报数模板）。

**响应**：
```json
{
  "message": "Seeded 52 schedule entries, 30 report templates"
}
```

### 4.3 刊期查询

前端提供两个刊期表管理页面，侧边栏入口为展开式「刊期表管理」子菜单：

- **期刊表**（`/schedule`，`ScheduleView.tsx`）：使用 `GET /api/schedule` 按年份展示出版期数、休刊次数、期号范围等概览统计，支持按月份、日期、期号、状态（正常/休刊）筛选，按月份分组展示刊期明细。数据通过 TanStack Query 以 `['schedule', year]` 缓存。年份下拉框的可选项由 `GET /api/schedule/years` 数据驱动（库内实际存在的年份 ∪ 近年窗口），因此任何已导入年份（含历史年）都能被选中，不会因写死年份范围而"看不到"。
- **导入期刊表**（`/schedule/import`，`ScheduleImport.tsx`）：管理员上传年度刊期 PDF 并预览确认。使用 `GET /api/schedule/uploads` 展示上传记录。数据通过 TanStack Query 以 `['scheduleUploads', year]` 缓存。

刊期上传实现位于 `backend/app/api/schedule.py`、`backend/app/services/publication_schedule_parser.py` 和 `backend/app/services/publication_schedule_upload_service.py`。解析服务使用 `pypdf` 从文字版 PDF 抽取 `raw_text`，识别年份、出版日期、期号和休刊行；如果运行环境缺少 `pypdf` 会返回明确的依赖缺失错误，PDF 文本抽取出的粘连日期/期号数字会按 1-2 位日期 + 4 位期号尽量拆分，超范围日期数字会被记录为解析错误而不是触发 500。上传服务保存原始 PDF 到 `backend/app/uploads/publication_schedules/<year>/`，并在 `publication_schedule_uploads.stored_path`、`raw_text`、`summary_json`、`rows_json`、`error_json` 中保留审计信息。写入类接口仅管理员可用，提交时只读取服务端保存的 `rows_json`，并执行期号连续性、休刊行不占号、日期唯一性/年份一致性和已创建期数保护校验。管理员可通过 `PUT /api/schedule/uploads/{upload_id}/rows` 替换待确认上传的预览行，服务端会重新计算摘要和校验错误。

#### GET /api/schedule?year=2026
查询指定年份的刊期表。如果某期次已在印数管理中创建，会附带 `actual_page_count`（Issue 表的实际版数）。

**响应**：
```json
[
  {
    "id": 1,
    "year": 2026,
    "issue_number": 2635,
    "publish_date": "2026-01-05",
    "is_suspended": false,
    "page_count": 24,
    "actual_page_count": null
  },
  {
    "id": 227,
    "year": 2026,
    "issue_number": 2651,
    "publish_date": "2026-05-11",
    "is_suspended": false,
    "page_count": 24,
    "actual_page_count": 28
  },
  ...
]
```

- `page_count`：期刊表中的计划版数
- `actual_page_count`：Issue 表中的实际版数（未创建期次时为 `null`）

#### GET /api/schedule/years
返回 `publication_schedule` 中实际存在的全部年份（去重、升序）。供期刊表页年份下拉框构建可选项，确保已导入的历史年份（如 2024）始终可选。空库时返回 `[]`。

**响应**：
```json
[2024, 2025, 2026]
```

#### GET /api/schedule/uploads?year=2026
查询刊期 PDF 上传记录，按上传时间倒序返回。`year` 可省略。

**响应**：
```json
[
  {
    "id": 1,
    "year": 2026,
    "original_filename": "2026-publication-schedule.pdf",
    "status": "previewed",
    "summary_json": {
      "total_rows": 52,
      "published_count": 49,
      "suspended_count": 3,
      "first_issue_number": 2635,
      "last_issue_number": 2683,
      "remarks": null
    },
    "error_json": [],
    "uploaded_by": "admin",
    "created_at": "2026-05-22T15:30:00",
    "committed_at": null
  }
]
```

#### POST /api/schedule/uploads/preview
管理员上传年度刊期 PDF 并解析预览，不会写入正式刊期表。该接口要求管理员权限。

**请求**：`multipart/form-data`
- `file`：PDF 文件，仅支持文字版 PDF。

**响应**：
```json
{
  "upload_id": 1,
  "year": 2026,
  "rows": [
    {"publish_date": "2026-01-05", "issue_number": 2635, "is_suspended": false},
    {"publish_date": "2026-02-16", "issue_number": null, "is_suspended": true}
  ],
  "summary": {
    "total_rows": 52,
    "published_count": 49,
    "suspended_count": 3,
    "first_issue_number": 2635,
    "last_issue_number": 2683,
    "page_count": 32,
    "remarks": null
  },
  "errors": [],
  "can_commit": true
}
```

#### POST /api/schedule/uploads/{upload_id}/commit
管理员确认服务端已保存的预览行，系统从 `publication_schedule_uploads.rows_json` 读取行数据并替换对应年份的 `publication_schedule`。该接口要求管理员权限，请求体为空，可选查询参数 `page_count`（整数）用于保存用户编辑后的版数。

**提交规则**：
- 非休刊行必须填写正数期号，期号必须连续递增。
- 休刊行不能填写期号。
- 同一年内出版日期不能重复，出版日期年份必须与上传年份一致。
- 上传记录存在解析错误时不能提交。
- 如系统中已有该年份期数，提交不能移除已创建期号，也不能改变已创建期号的出版日期。
- 提交成功后清理 Dashboard 内存缓存，并将上传记录状态改为 `committed`。
- 提交成功后自动删除同年份其他待确认（`previewed`）的上传记录。

#### DELETE /api/schedule/uploads/{upload_id}
管理员手动删除一条待确认（`previewed`）状态的上传记录。已保存或失败的记录不可删除。

### 4.4 期数管理

#### GET /api/issues
列出所有期数（按期号倒序）。

**查询参数**：
- `skip`（默认 0）：跳过条数
- `limit`（默认 20）：返回条数

**响应**：
```json
[
  {
    "id": 1,
    "issue_number": 2635,
    "year_issue_index": 1,
    "year_issue_label": "一",
    "publish_date": "2026-01-05",
    "status": "confirmed",
    "notes": null,
    "created_at": "2026-01-03T10:00:00",
    "updated_at": "2026-01-03T15:30:00",
    "print_total": 9355
  },
  ...
]
```

> `print_total`：该期总印数（批量计算，排除「临时加印_自留」「营报传媒加印」等内部子类）。历史期数页据此显示每期「印数（份）」列与「本年累计印数」统计卡。

#### GET /api/issues/next
获取下一个待创建的期数信息。

**响应**：
```json
{
  "issue_number": 2636,
  "publish_date": "2026-01-12"
}
```

**错误**：
- 404：没有更多计划中的期数

#### GET /api/issues/available
获取刊期表中尚未创建的所有期数，供前端下拉选择。

**响应**：NextIssueInfo 数组，包含 `issue_number` 和 `publish_date`。

#### POST /api/issues
创建新期。

**请求体**：
```json
{
  "issue_number": 2636,
  "publish_date": "2026-01-12",
  "notes": "春节前最后一期"
}
```

**响应**：201 Created + Issue 对象

**错误**：
- 409：期号已存在

#### GET /api/issues/{issue_id}
获取期数详情。

**响应**：Issue 对象

**错误**：
- 404：期数不存在

#### PATCH /api/issues/{issue_id}
更新期数信息（版数、备注等）。

**请求体**：
```json
{
  "page_count": 28,
  "notes": "本期加版"
}
```

**响应**：更新后的 Issue 对象

#### DELETE /api/issues/{issue_id}
管理员删除指定期数。用于清理误建或测试期数，会同时删除该期关联的报数数据、发货记录、临时加印明细和同期期号的ZTO-MF。

**权限**：管理员

**响应**：
```json
{
  "message": "Issue deleted"
}
```

**错误**：
- 403：当前用户不是管理员
- 404：期数不存在

### 4.5 印数管理

#### GET /api/issues/{issue_id}/report
获取指定期的报数数据（按 display_order 排序），并返回总印数、按报数去向汇总的 `destination_summary`、以及实时的 `shipping_check`（报数中通合计 vs 当期发货明细合计的一致性快照）。

**响应**：
```json
{
  "issue_id": 1,
  "issue_number": 2635,
  "entries": [
    {
      "id": 1,
      "category": "postal",
      "sub_category": "外埠",
      "destination": "北京市报刊发行局",
      "value": 3200,
      "is_variable": true
    }
  ],
  "total": 5200,
  "destination_summary": [
    {"destination": "北京市报刊发行局", "total": 3200},
    {"destination": "中通物流公司", "total": 2000}
  ],
  "shipping_check": {
    "report_zt_total": 2000,
    "shipping_total": 1950,
    "delta": 50,
    "is_match": false
  },
  "confirmation_summary": null
}
```

`shipping_check` 字段说明（始终返回，与是否确认无关）：
- `report_zt_total`：报数中"中通物流公司"目的地的合计
- `shipping_total`：当期 `shipping_details.quantity` 合计
- `delta`：`report_zt_total - shipping_total`（正数说明报数多、负数说明明细多）
- `is_match`：两者是否相等

**实时校验 vs 确认快照**：
- `shipping_check`（本字段）：**始终返回**，反映"此刻"两边数据是否一致，供前端在草稿阶段就显示实时黄色警告
- `confirmation_summary`（POST `/confirm` 之后才有）：基于确认时快照对比当前明细，反映"确认后是否发生漂移"
两者并存：前者是 draft 阶段的早期校验，后者是 confirmed 之后的偏移追踪

#### PUT /api/issues/{issue_id}/report
批量更新报数数据。

**请求体**：
```json
[
  {
    "category": "邮发",
    "sub_category": "北京邮发（外埠）",
    "value": 3200
  },
  ...
]
```

**验证规则**：
- 已确认（confirmed/exported）的期数不能修改，返回 403
- 变动项不能为空
- 数值不能为负

**响应**：`{"message": "Report updated"}`。更新后可重新调用 `GET /api/issues/{issue_id}/report` 获取包含 `destination_summary` 和实时 `shipping_check` 的最新报数对象。

#### POST /api/issues/{issue_id}/report/confirm
确认报数（状态变更为 confirmed）。需要用户认证。若当期没有ZTO-MF，系统会自动从上一期复制明细，并清空 `confirmation` 与 `shipped_at`；确认响应会同时校验报数目的地"中通物流公司"合计与当期发货明细份数是否一致。

**验证规则**：
- 所有变动项必须有值
- 总印数不能为 0

**响应**：
```json
{
  "message": "Report confirmed",
  "issue_number": 2650,
  "shipping_details_copied": 81,
  "zt_report_total": 1240,
  "zt_shipping_total": 1200,
  "warning": "中通物流份数不一致：报数合计 1240 份，发货明细合计 1200 份，请核查。"
}
```

字段说明：
- `shipping_details_copied`：确认时若当期没有ZTO-MF，自动从上一期复制的行数；若已有明细则为 0
- `zt_report_total`：报数去向为"中通物流公司"的份数合计
- `zt_shipping_total`：当期 `shipping_details.quantity` 份数合计
- `warning`：仅当两项合计不一致时返回，提示用户核查当期ZTO-MF

此外，接口会写入一条 `issue_audit_snapshots(snapshot_type='confirm')` 快照；`GET /api/issues/{issue_id}/report` 会额外返回 `confirmation_summary`，其中包含：
- `confirmed_*`：确认时快照值
- `current_*`：当前最新 `shipping_details` 合计对比值
- `has_shipping_drift`：确认后明细是否已发生漂移

#### POST /api/issues/{issue_id}/report/revoke
作废已确认的报数（仅限管理员）。将状态从 `confirmed` 重置为 `draft`。

**查询参数**：
- `reason`（可选）：作废原因

**响应**：
```json
{
  "message": "Report revoked",
  "issue": { Issue 对象 }
}
```

**错误**：
- 403：非管理员用户
- 400：期数不是 confirmed 状态

#### GET /api/issues/{issue_id}/report/temp-details
获取指定期的临时加印归属明细。

**响应**：
```json
[
  {
    "id": 1,
    "issue_id": 1,
    "department": "营报传媒",
    "custom_name": null,
    "quantity": 100,
    "self_quantity": 20
  },
  ...
]
```

#### PUT /api/issues/{issue_id}/report/temp-details
批量更新临时加印归属明细。

**请求体**：
```json
[
  {
    "department": "营报传媒",
    "custom_name": null,
    "quantity": 100,
    "self_quantity": 20
  },
  {
    "department": "其他",
    "custom_name": "特殊渠道",
    "quantity": 50,
    "self_quantity": 10
  }
]
```

**响应**：更新后的 temp_print_details 列表

#### GET /api/issues/{issue_id}/report/revisions
获取指定期的修订历史（确认和作废记录）。

**响应**：
```json
[
  {
    "id": 1,
    "issue_id": 1,
    "revision_number": 1,
    "operator_id": 1,
    "reason": null,
    "changes_json": { 数据快照 },
    "confirmed_at": "2026-01-03T15:30:00",
    "revoked_at": null
  },
  ...
]
```

### 4.6 物流管理

#### GET /api/recipients
列出所有收件人。

**查询参数**：
- `status`（可选）：active/inactive
- `type`（可选）：business/reader/sample

**响应**：
```json
[
  {
    "id": 1,
    "name": "张三",
    "phone": "13800138000",
    "address": "北京市朝阳区xxx",
    "type": "reader",
    "frequency": "weekly",
    "status": "active",
    "created_at": "2026-01-01T10:00:00",
    "updated_at": "2026-01-01T10:00:00"
  },
  ...
]
```

#### POST /api/recipients
创建新收件人。

**请求体**：
```json
{
  "name": "张三",
  "phone": "13800138000",
  "address": "北京市朝阳区xxx",
  "type": "reader",
  "frequency": "weekly"
}
```

> **地址自动规范化**：系统使用 cpca 地址解析库，自动补全缺失的省/市/区前缀，并自动填充 `province` 和 `city` 字段。例如输入 `广州市白云区增槎路1113号` 会自动补全为 `广东省广州市白云区增槎路1113号`。

**响应**：201 Created + Recipient 对象

#### PUT /api/recipients/{recipient_id}
更新收件人信息。

**请求体**：同创建（地址同样会自动规范化）

**响应**：Recipient 对象

#### PATCH /api/recipients/{recipient_id}/status
修改收件人状态（停发/恢复）。

**请求体**：
```json
{
  "status": "inactive"  // 或 "active"
}
```

**响应**：Recipient 对象

### 4.7 订阅管理

#### GET /api/recipients/{recipient_id}/subscriptions
获取收件人的所有订阅记录。

**响应**：
```json
[
  {
    "id": 1,
    "recipient_id": 1,
    "type": "new",
    "start_date": "2026-01-01",
    "end_date": "2026-12-31",
    "quantity": 2,
    "created_at": "2026-01-01T10:00:00"
  },
  ...
]
```

#### POST /api/recipients/{recipient_id}/subscriptions
为收件人添加订阅。

**请求体**：
```json
{
  "type": "renewal",
  "start_date": "2027-01-01",
  "end_date": "2027-12-31",
  "quantity": 2
}
```

**响应**：201 Created + Subscription 对象

### 4.8 发货管理

#### GET /api/issues/{issue_id}/shipping
获取指定期的发货明细。

**响应**：
```json
[
  {
    "id": 1,
    "issue_id": 1,
    "recipient_id": 1,
    "quantity": 2,
    "status": "pending",
    "recipient": { Recipient 对象 },
    "created_at": "2026-01-03T10:00:00",
    "updated_at": "2026-01-03T10:00:00"
  },
  ...
]
```

#### PUT /api/issues/{issue_id}/shipping
批量更新发货明细。

**请求体**：
```json
[
  {
    "recipient_id": 1,
    "quantity": 3
  },
  ...
]
```

**响应**：更新后的 shipping_records 列表

#### POST /api/issues/{issue_id}/shipping/regenerate
重新生成发货明细（删除旧记录，重新计算）。

**响应**：
```json
{
  "message": "Regenerated shipping records",
  "count": 45
}
```

### 4.9 Excel 导出

#### GET /api/issues/{issue_id}/export/report
导出报数表 Excel。

**响应**：Excel 文件（application/vnd.openxmlformats-officedocument.spreadsheetml.sheet）
**副作用**：写入一条 `issue_audit_snapshots(snapshot_type='report_export')`

#### GET /api/issues/{issue_id}/export/shipping
导出发货明细 Excel。

**响应**：Excel 文件；包含一个「ZTO-MF」sheet，表头覆盖 `shipping_details` 当前业务字段。
**副作用**：写入一条 `issue_audit_snapshots(snapshot_type='shipping_export')`

#### GET /api/issues/{issue_id}/export/all
导出合并文件（报数表 + 发货明细）。

**响应**：ZIP 文件
**副作用**：同时写入 `report_export` 与 `shipping_export` 两条快照

### 4.10 模板管理

#### GET /api/templates
获取所有报数项模板，按 sort_order 排序。

**响应**：
```json
[
  {
    "id": 1,
    "category": "postal",
    "sub_category": "外埠",
    "display_name": "外埠",
    "default_value": 0,
    "is_variable": true,
    "sort_order": 1,
    "excel_sheet": null,
    "excel_cell": null
  }
]
```

#### POST /api/templates
创建新的报数项模板。

**请求体**：
```json
{
  "category": "postal",
  "sub_category": "新渠道",
  "display_name": "新渠道",
  "default_value": 0,
  "is_variable": false,
  "sort_order": 10
}
```

**响应**：201 Created，返回创建的模板对象。

#### PUT /api/templates/{template_id}
更新指定模板（所有字段可选）。

**响应**：返回更新后的模板对象。

#### DELETE /api/templates/{template_id}
删除指定模板。仅影响新创建的期数，不影响已有期数数据。

**响应**：204 No Content

#### POST /api/templates/reorder
批量更新报数项模板的排序，供「报数模板」页的**拖拽排序**使用（在同一类别内拖动行改变顺序）。

**请求体**：
```json
{
  "items": [
    { "id": 3, "sort_order": 10 },
    { "id": 1, "sort_order": 20 }
  ]
}
```

**响应**：204 No Content。若任一 `id` 不存在，返回 404 且整批不做任何修改。

### 4.11 ZTO-MF

#### GET /api/shipping-details
获取ZTO-MF列表，支持多条件筛选。前端使用 `issue_number` 按期管理明细，并显示所选期的份数合计。

**查询参数**：
- `issue_number`：期号筛选
- `channel`：渠道类型筛选
- `company`：签约公司筛选（支持逗号分隔多选，如 `广州日报,成都杂志铺`）
- `transport`：运输方式筛选
- `frequency`：频率筛选
- `status`：状态筛选（正常/停发）
- `search`：姓名模糊搜索
- `skip`/`limit`：分页

**响应**：ShippingDetail 数组

#### GET /api/shipping-details/companies
获取去重的签约公司列表，用于前端筛选下拉框。

**查询参数**：
- `issue_number`：可选，按期号筛选

**响应**：字符串数组（如 `["北京悦途出行", "广州日报", "国图贸", "成都杂志铺"]`）

#### POST /api/shipping-details
新增发货明细记录。

**必填字段**：`issue_number`, `sheet_name`, `channel`, `name`

> **地址自动规范化**：提交时 `address` 字段会自动通过 cpca 解析补全省/市/区前缀。

**响应**：201 Created + ShippingDetail 对象

#### PUT /api/shipping-details/{detail_id}
更新发货明细记录（地址同样会自动规范化）。

**响应**：更新后的 ShippingDetail 对象

#### DELETE /api/shipping-details/{detail_id}
删除发货明细记录。

**响应**：`{"message": "Deleted"}`

#### POST /api/shipping-details/copy-from-previous
手动将上一期发货明细复制到指定期。需要用户认证。

**查询参数**：
- `issue_number`：目标期号
- `previous_issue_number`：来源期号

**复制规则**：目标期已有发货明细时跳过；否则复制来源期所有行，目标行使用新的 `issue_number`，并将 `confirmation`、`shipped_at` 置空。复制操作写入 `operation_logs`，`action` 为 `batch_copy`。确认报数时若当期没有明细，也会按同样规则自动复制上一期明细作为人工调整起点。

**响应**：
```json
{
  "message": "已从2649期复制81条发货明细",
  "copied": 81
}
```

#### POST /api/shipping-details/batch-update
批量更新发货明细字段。当前支持批量更新 `status` 和 `deadline`。每条实际发生变化的记录都会写入操作日志。

**请求体**：
```json
{
  "ids": [1, 2, 3],
  "updates": {
    "status": "停发",
    "deadline": "2026-06-30"
  }
}
```

**响应**：`{"affected_count": 3}`

#### POST /api/shipping-details/batch-delete
批量删除发货明细记录。每条被删除的记录都会写入操作日志。

**请求体**：
```json
{
  "ids": [1, 2, 3]
}
```

**响应**：`{"affected_count": 3}`

#### DELETE /api/shipping-details/by-issue/{issue_number}
管理员清空某一期的全部ZTO-MF。该接口只删除 `shipping_details` 中指定 `issue_number` 的记录，不删除期号、报数数据、发货记录或临时加印；会写入一条 `batch_delete_issue` 操作日志。

**响应**：`{"affected_count": 55}`

#### POST /api/shipping-details/normalize-addresses
批量规范化所有发货明细地址。使用 cpca 解析补全缺失的省/市/区前缀。

**响应**：
```json
{
  "message": "Normalized 14 addresses out of 81 total"
}
```

### 4.12 操作日志

#### GET /api/operation-logs
查询操作日志，支持按表名和记录ID筛选。

**查询参数**：
- `table_name`（必填）：表名（如 `shipping_details`）
- `record_id`：记录ID（查看单条记录的日志）
- `skip`/`limit`：分页

**响应**：OperationLog 数组，按时间倒序排列

**说明**：ZTO-MF的新增/编辑/删除/批量复制操作会自动写入操作日志。编辑操作仅记录实际变化的字段差异。

### 4.13 往期导入

#### GET /api/history-import/templates/report
下载印数导入模板（Excel 文件）。模板由系统根据当前 `report_item_templates` 动态生成，包含三个 sheet：

| Sheet | 内容 |
|-------|------|
| `基本信息` | 期号、出版日期、版数、备注 |
| `报数项` | 分类编码、分类名称、项目名称、去向、是否变动、数值 |
| `临时加印明细` | 部门、自定义名称、加印数量、自留分发数量 |

**响应**：Excel 文件（`印数导入模板.xlsx`）

#### GET /api/history-import/templates/shipping
下载中通发货导入模板（Excel 文件）。包含两个 sheet：

| Sheet | 内容 |
|-------|------|
| `基本信息` | 期号、出版日期 |
| `发货明细` | 19列字段（工作表名称、渠道、子渠道、运输方式、频次、状态、姓名、地址、电话、数量、截止日期、备注、附加信息、网点名称、网点大厅、联系人、序号、期数、公司） |

**响应**：Excel 文件（`history_shipping_template.xlsx`）

#### POST /api/history-import/preview
上传报数文件和中通发货文件，执行解析与校验，返回预览结果（不写入数据库）。

报数文件支持两种格式：

1. 系统下载的单表导入模板：`基本信息` + `报数项` + `临时加印明细`
2. 可识别的原始印数多工作表文件：包含 `北京印厂`、`零售渠道\``、`订阅渠道\``、`社用报\``、`收发室自留分发（需打印）` 等工作表

中通发货文件支持两种格式：

1. 系统下载的单表导入模板：`基本信息` + `发货明细`
2. 原始中通多工作表文件：包含 `每周（对公）`、`每周（读者）`、`高铁展示`/`北京悦途出行（高铁）`、`上犹`、`停发-双周（读者）`、`月底-整月` 等工作表

**请求**：multipart/form-data，包含两个文件字段：
- `report_file`：报数文件（.xlsx）
- `shipping_file`：中通发货文件（.xlsx）

**校验规则**：
- 两份文件必须属于同一期（`基本信息.期号` 一致）
- 原始印数多工作表文件从标题中的“期数 / 版数 / 出版日期”识别基本信息
- 原始印数表会校验原表总印数与映射后总数一致；存在临时加印未分配，或原始社用报中出现“XX加印”部门加印项时，预览会生成导入会话并返回待手工分配数量和预填明细，前端提交时通过 `manual_temp_rows` 补齐；未命中映射项或总数不一致仍返回错误且不生成导入会话
- 原始中通多工作表文件从标题中的“总第XXXX期”识别期号；月底多期标题取最大期号作为本次导入期号
- 目标期号不能已存在（防止重复导入）
- 报数项行必须与 `report_item_templates` 中的 `(category, sub_category)` 完全匹配
- 不支持的中通发货文件格式会在预览阶段返回错误，不会写入数据库
- 报数中去向为“中通物流公司”的合计必须与ZTO-MF数量合计一致；不一致时预览返回差额并阻止提交

**响应**：
```json
{
  "issue_number": 2635,
  "publish_date": "2026-01-05",
  "page_count": 24,
  "report_entry_count": 30,
  "temp_detail_count": 2,
  "shipping_detail_count": 81,
  "can_commit": true,
  "import_session_id": "uuid-string",
  "errors": [],
  "warnings": [],
  "readiness": {
    "same_issue": true,
    "issue_exists": false,
    "can_commit": true,
    "errors": []
  },
  "manual_temp_print_required_quantity": 0,
  "manual_temp_print_self_quantity": 0,
  "manual_temp_rows": []
}
```

校验失败时 `can_commit` 为 `false`，`errors` 包含具体错误信息，`import_session_id` 为空字符串。只有临时加印需要手动分配时，`errors` 为空且 `import_session_id` 有值，`manual_temp_print_required_quantity` 返回待分配份数，`manual_temp_rows` 返回从“XX加印”识别出的预填部门明细；前端补齐明细后可提交。

`warnings` 用于不阻塞导入的提示。当印数表识别出的 `page_count` 与刊期表（`publication_schedule.page_count`）登记的版数不一致时，预览会在 `warnings` 中追加一条提示；提交时服务端会以印数表为准自动更新刊期表的版数（详见下文 commit 响应）。

预览结果通过内存缓存（`history_import_cache`）保存 15 分钟，由 `import_session_id` 索引。

#### POST /api/history-import/commit
将已预览通过的导入会话写入数据库（原子操作）。

**请求体**：
```json
{
  "import_session_id": "uuid-string",
  "manual_temp_rows": [
    {
      "department": "财经中心",
      "custom_name": "",
      "quantity": 12,
      "self_quantity": 0
    }
  ]
}
```

`manual_temp_rows` 仅在预览返回 `manual_temp_print_required_quantity > 0` 时必填；服务端会校验明细 `quantity` 合计等于该待分配份数，且 `self_quantity` 不得大于对应行 `quantity`。

**响应**：
```json
{
  "issue_id": 1,
  "issue_number": 2635,
  "report_entry_count": 30,
  "temp_detail_count": 2,
  "shipping_detail_count": 81,
  "schedule_page_count_updated": true,
  "previous_schedule_page_count": 24,
  "new_page_count": 32
}
```

`schedule_page_count_updated` 表示本次提交是否顺带同步更新了 `publication_schedule.page_count`。当印数表的版数与刊期表登记的不同（或刊期行原本没填版数）时，服务端会以印数表为准把刊期表对应行的 `page_count` 更新过来，并在响应里返回 `previous_schedule_page_count`（更新前的值，可能为 `null`）与 `new_page_count`（最终写入的值）。匹配优先按 `issue_number` 查找，找不到时再回退到 `publish_date` 匹配。

**错误**：
- 400：会话不存在或已过期
- 422：临时加印手工分配明细缺失、合计不一致或数量不合法
- 409：目标期号在提交时已被其他操作创建

创建成功后前端 invalidate `issues`、`dashboard` 以及 `publication-schedule(s)` 查询缓存，并自动跳转至新期的报数编辑页。

### 4.14 订单管理（V1.3）

所有订单接口位于 `backend/app/api/orders.py`，统一路径前缀 `/api/orders`，需 JWT 鉴权。

**权限分级（F）**：**敏感操作需管理员**（`require_admin`，非管理员 403）——`POST /{id}/refund`、`/cancel`、`/void`、`POST /bulk-confirm`、`/bulk-void`、`GET /export`，以及 `POST /api/order-import/commit`。其余（看列表/详情/统计、建单/改单/确认/收款/发货同步/标已发/导入预览）登录即可（运营）。模型为简单版：只在敏感路由加 `require_admin`，未做按 `created_by` 的归属细分。**前端**按 `useAuth().isAdmin` 隐藏这些管理员按钮（订单列表的作废/批量/导出、详情的退款/取消/作废、导入的确认导入），运营看不到、不会点出 403。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/orders` | 分页列表，支持 `status` / `source_type` / `payer_name_like` / `coverage_start` / `coverage_end` / `order_date_start` / `order_date_end` / `unpaid` / `has_drift` / `search`(订单编码/来源单号 ilike) / `sort`(`order_date`/`total_amount`/`outstanding`,仅 DB 列) / `order`(asc/desc) 筛选排序，返回 `{ rows, total }`（`source_type` API 参数保留以备后续版本批量导入 / API 同步扩展，前端 UI 不再暴露筛选器，详见 §3.15 录入方式说明）。`order_date_start/end` 为**下单日期闭区间，服务端过滤**（不再前端逐页过滤，跨页准确）。`unpaid=true/false` 按 `paid_amount < / >= total_amount` 筛未付清/已付清。`has_drift` 是 Python 端按实时刊期表算的谓词、无法下推 SQL：设了它时取全集 → 内存过滤 → 内存分页，`total` 反映**过滤后**条数（每页满、计数一致）；不设则走 SQL 分页、`total` 为 DB 计数 |
| `POST` | `/api/orders` | 创建草稿订单，内嵌 items + v1 allocation + targets，事务一致 |
| `POST` | `/api/orders/pricing-preview` | 根据订阅期限、起始月份、投递/收费方式与每期总份数，预览实际覆盖期、预计发货期数与套餐价 |
| `GET` | `/api/orders/{id}` | 详情，含 items / allocations / targets / 各明细的 `FulfillmentProgress` |
| `PUT` | `/api/orders/{id}` | 更新字段，active 状态下仅允许 `ACTIVE_EDITABLE_FIELDS` 白名单，否则 422 |
| `PUT` | `/api/orders/{id}/items` | 批量编辑 active 订单明细；带 `id` 的明细原地更新，targets 变化时按 `effective_from_issue` 切出新 allocation 版本；无 `id` 的明细新增；缺失的 active 明细标记为 `cancelled` |
| `POST` | `/api/orders/{id}/confirm` | 草稿 → 生效，自动分配 `order_code`、写入 `expected_issues_at_creation` 快照、记录 `confirmed` 事件 |
| `POST` | `/api/orders/{id}/void` | 作废订单（任何状态都可），body `{ reason }` 必填；同时把该订单已生成的 `order_generated` 发货明细置 `sync_status=orphaned`（停发，避免被中通导出/发货），作废事件 payload 记 `orphaned_shipping_details` 计数 |
| `POST` | `/api/orders/{id}/refund` | 记一笔退款（全额/部分），body `{ amount, reason?, order_item_id?, stop_from_issue?, refunded_at? }`。累加 `refunded_amount`、推 `commercial_status`（累计≥实付→`refunded`，否则`partial_refund`）、按范围停发已生成发货行（`order_item_id`=退某明细 / `stop_from_issue`=从该期起 / 都不填=纯退钱不动履约 / 全额退=整单停发）、记 `refunded` 事件；超退余额返回 422。**只改 `commercial_status`，不动内部 `OrderStatus`** |
| `POST` | `/api/orders/{id}/cancel` | 取消订单，body `{ reason }` 必填。标 `commercial_status=cancelled`、把未退实付（实付−已退）记一笔全额退款、停掉全部已生成发货行、记 `cancelled` 事件。已取消再取消返回 409 |
| `POST` | `/api/orders/{id}/payments` | 记一笔收款（到账），body `{ amount, method?, collected_at?, notes? }`。建 `payment_collections` 流水行 + 累加 `paid_amount` + 记 `payment_recorded` 事件。收款是商业事件、不动 `OrderStatus`；允许超付（欠款按 max(0,应收−实付) 展示） |
| `GET` | `/api/orders/export` | 按与列表相同的筛选/排序导出 .xlsx（无分页，上限 5 万行）。`StreamingResponse` |
| `POST` | `/api/orders/bulk-confirm` | 批量确认（draft→active），body `{ order_ids }`。逐单独立提交，单个失败(如已激活)收进 `failed`、不中断。返回 `{ succeeded, failed }` |
| `POST` | `/api/orders/bulk-void` | 批量作废（一个共享理由），body `{ order_ids, reason }`。逐单作废(各自 orphan 发货行)、单个失败收集、不中断。返回 `{ succeeded, failed }` |
| `GET` | `/api/orders/{order_id}/shipping-sync/preview?issue_number={issue}` | 预览 active 订单在指定期号将创建/更新/跳过/冲突的 `shipping_details` 行，不修改数据 |
| `POST` | `/api/orders/{order_id}/shipping-sync/apply` | 按 body `{ "issue_number": 2625 }` 写入无冲突的订单目标到 `shipping_details`；有冲突时返回 409 且不产生部分写入 |
| `GET` | `/api/orders/shipping-sync/issues/{issue_number}/gap-report` | 某期「谁该排却没排」报表（只读）：候选订单(active+非历史归档+覆盖该期)逐单分类为 待排/需更新/冲突/已同步/跳过(带原因)。`IssueGapReport` |
| `POST` | `/api/orders/shipping-sync/issues/{issue_number}/apply-all` | 某期一键排发所有活跃订单。**冲突单只报告、不覆盖、不中断整批**；每单独立提交；幂等。返回 `BatchSyncSummary`(建/改行数、各类订单数、冲突单、跳过原因直方图) |
| `POST` | `/api/orders/{order_id}/shipping-sync/apply-all-issues` | 单订单覆盖期内所有期一次排齐（仅同步 `issues` 表已存在的期；覆盖期推出但无刊期行的计入 `issues_no_calendar`）。`OrderAllIssuesSyncSummary` |
| `GET` | `/api/orders/shipping-sync/issues/{issue_number}/reconciliation` | 某期「应发 vs 实发」对账（只读）：应发份数(Σ已生成行计划份数)/已发份数(Σ实发)/缺口 + 未发清单。`IssueReconciliation` |
| `POST` | `/api/orders/shipping-sync/issues/{issue_number}/ship-all` | 按期一键标已发：把本期已生成且未发的行标已发（`shipped_at`=发货日、实发=计划份数）。`ShipBatchResult` |
| `POST` | `/api/shipping-details/{id}/ship` | 标记一行已发：body `{shipped_at?, shipped_quantity?, tracking_no?}`（默认 shipped_at=今天、实发=计划份数）。非 SYNC_FIELD，不会把 order_generated 行置 manually_modified |
| `POST` | `/api/shipping-details/{id}/unship` | 撤销已发：清空 shipped_at / 实发份数 / 运单号 |
| `GET` | `/api/orders/{id}/events` | 事件流（含 payload_json） |
| `GET` | `/api/orders/{id}/fulfillment-progress` | 各明细的进度（创建时预估 / 当前预估 / 已同步 / 偏差）；`synced_count` 统计已关联到该订单明细的 `shipping_details` 行数 |

#### POST /api/orders/pricing-preview

根据订阅期限、起始月份、投递/收费方式、每期总份数，预览实际覆盖期和套餐价。

请求：
```json
{
  "subscription_term": "half_year",
  "delivery_method": "zto_mf",
  "term_start_month": "2026-01",
  "total_quantity": 2
}
```

响应：
```json
{
  "month_range_label": "2026年1月～2026年6月",
  "coverage_start_date": "2026-01-05",
  "coverage_end_date": "2026-06-29",
  "expected_issue_count": 23,
  "unit_price": 195,
  "subtotal": 390,
  "price_label": "ZTO-MF 快递半年套餐",
  "schedule_incomplete": false,
  "warning": null
}
```

**期数估算（`backend/app/services/expected_issues_calculator.py`）**

- 输入：`fulfillment_type` / `coverage_start` / `coverage_end` / `publication`
- 算法：**按刊种区分频次**——中国经营报（周报，默认）在 `publication_schedule` 中按周排期 + 跳过 `is_suspended` 的休刊期数；**商学院月刊（`publication=business_school`）按 `bs_issues` 刊历数命中的期数**（全年=11 而非按周算的 ~52，避免月刊期数高估 ~4.7×、污染 drift）；单期固定为 1。`publication` 默认 `None` → 走周报路径（兼容旧调用）
- `expected_issues_at_creation`：confirm 时快照写入，后续刊期表修改不会回溯
- `current_expected`：详情接口实时计算，与快照对比得 `drift`，列表接口也据此回填 `has_drift`

**订单 → 发货明细同步（`backend/app/services/order_shipping_sync_service.py`）**

- Preview：`GET /api/orders/{order_id}/shipping-sync/preview?issue_number=2625` 返回 `OrderShippingSyncPreview`，只预览 active 订单在指定期号的每个 active 明细 + 履约目标将创建、更新、跳过或冲突的结果，不修改数据。**商业状态为 `refunded` / `cancelled` 的订单整单跳过、不生成发货明细**（停发；`partial_refund` 仍发货，精确停发待退款模块）。
- Apply：`POST /api/orders/{order_id}/shipping-sync/apply` 使用同一预览逻辑；仅在无冲突时把订单目标写入 `shipping_details`，订单生成行写 `source_type=order_generated`、`sync_status=synced`，并记录 `synced_to_shipping` 事件。
- 幂等键：`order_id + order_item_id + fulfillment_target_id + issue_number`。同一键再次同步会更新订单生成行；若发现手工修改、重复关联或其它冲突，返回 409、记录 `shipping_sync_conflict` 事件，且不做部分写入。
- `ShippingDetailOut` 会暴露订单关联字段（`order_id` / `order_item_id` / `fulfillment_target_id`）以及 `source_type` / `sync_status` 等来源与同步元数据，便于前端在 ZTO-MF 中展示“来源=订单生成”。
- 进度：订单详情与 `/fulfillment-progress` 中的 `synced_count` 直接统计已关联到 `order_id + order_item_id` 的发货明细行；`shipped_count` 统计其中 `shipped_at` 非空的行（已发），缺口 = synced−shipped；`skipped_count` 暂保留为 0。
- **已发货回写 + 应发vs实发对账（B）**：`shipping_details` 加 `shipped_quantity`(实发份数) + `tracking_no`(运单号) 两列（迁移 `a9c3e5f70b21`），「已发」标记 = `shipped_at` 非空。**人工标记为主**（无中通回执导入）：`POST …/issues/{n}/ship-all` 按期一键标已发、`POST /shipping-details/{id}/ship` `…/unship` 逐行标/撤。对账 `reconcile_issue`：某期 应发(Σ计划份数)/已发(Σ实发)/缺口 + 未发清单（已排但未标已发的行）。v1 只对账报缺口，自动补寄留作后续。
- **批量排发（`order_shipping_batch_service.py`）**：在单订单×单期之上包一层——`gap_report`(某期漏期报表，只读)/`apply_all_for_issue`(某期一键排发所有活跃单)/`apply_all_issues_for_order`(单订单覆盖期内所有期一次排齐)。订单集合 = `active` + **非历史归档** + 有 active 纸刊明细覆盖该期。批量**先 preview 再 apply**：冲突单只报告、不 apply、不中断整批；每单独立提交（已排订单不因后续失败回滚）；幂等。**无调度器**——出刊后由运营在「按期排发」页手动一键 + 漏期报表查残单（自动定时为后续可选项）。**纯计算 + 复用现有同步，无迁移**。

**订单状态机**

```
draft ──confirm──> active ──void──> void
  │                  │
  └──void──> void    └──update (whitelist only)
```

- `draft`：允许任意编辑、可作废
- `pending_confirmation`：（保留状态，目前未自动跳入）
- `active`：`PUT /api/orders/{id}` 仅允许 `ACTIVE_EDITABLE_FIELDS`（13 个非结构字段，含发票抬头 / 税号 / 接收邮箱）；items / targets 结构改动走 `PUT /api/orders/{id}/items`，并要求提供新版本生效期号
- `void`：终态，任何编辑/重新确认返回 409

### 4.15 活动订单统计（Analytics）

订单管理子模块下的「活动订单统计」页（前端 `/analytics`，`frontend/src/pages/Analytics.tsx`，侧边栏「订单管理 → 活动订单统计」）。后端文件：`app/api/analytics.py`、`app/services/order_analytics_service.py`、`app/schemas/analytics.py`，均需 JWT 鉴权。

两张表均可按**下单日期**区间筛选，且**只统计 active（已确认 / 已导入）订单**——草稿 / 待确认 / 作废一律不计；**商业状态为 `refunded` / `cancelled` 的订单整单排除**（手工单 `commercial_status` 为 NULL → 照常计入）。**按活动统计的实收为净额**：`total_paid = SUM(paid_amount − refunded_amount)`（部分退款按 `refunded_amount` 净额冲减），另出 `total_refunded` 列；折扣仍按 `折前原价 − 毛实付` 算（不被退款污染）。⚠️ **按份数的口径**（按期统计 / 商学院发行量）的退款净额**暂未做**——退款只冲减金额、份数仍按原覆盖期算，待后续。

- **按活动统计**（by campaign）：仅统计**携带 `campaign` 标签**的订单，列为 活动 / 订单数 / 原价合计 / 实收金额 / 折扣（省 ¥X 及百分比）。折扣公式：`原价合计 = SUM(COALESCE(original_amount, paid))`、`折扣额 = 原价合计 − 实收`（未捕获原价的订单按无折扣计）。
- **按期统计**（by issue）：仅统计携带 `issue_label` 的单期行（主要是商学院月刊），列为 刊物 / 期次（`issue_label`）/ 销量（份）/ 销售额 / 行数。
- **按期发行量**（商学院·含订阅）：某期实际发行量 = 单期销量 + 覆盖该期的订阅份数。订阅按 `[coverage_start, coverage_end]` 落到商学院刊历（`bs_issues` 表，迁移 `a3f1c8e2b5d9`）展开成命中各期，**合刊靠 `issue_label` 去重**、每张计 `quantity`；缺覆盖期的订阅计入 `unexpanded_subscriptions` 单独提示；卖出过但不在刊历的期仍列出（`in_calendar=false`）。`summarize_bs_circulation`。

#### GET /api/analytics/campaigns

按活动汇总。查询参数：`date_from` / `date_to`（下单日期区间）。

#### GET /api/analytics/issues

按期汇总。查询参数：`publication`（刊物）/ `date_from` / `date_to`。

#### GET /api/analytics/bs-circulation

商学院按期发行量（单期 + 订阅展开）。查询参数：`year`。返回每期 单期 / 订阅 / 合计 + `unexpanded_subscriptions`（缺覆盖期未展开的订阅数）。

#### GET /api/analytics/outstanding

欠款汇总：`total_receivable`（Σ应收）/ `total_paid`（Σ实付）/ `total_outstanding`（**逐单** Σ max(0,应收−实付)，超付单不抵销）/ `unpaid_orders`（未付清单数）。只计 active 且非退款/取消单。

**收款 / 欠款追踪（C，收款流水）**：订单已有 `total_amount`(应收) + `paid_amount`(实付)；欠款 = max(0,应收−实付)，净收 = 实付−已退。新增 `payment_collections` 子表（迁移 `c1d3f5a7b9e2`，一笔到账一行，与退款台账 `refunds` 对称），`record_payment` 累加 `paid_amount` + 记 `payment_recorded` 事件。电商单导入 `total=paid` → 欠款 0；欠款主要在对公/手工单。前端：订单列表「未付清」筛选 + 欠款列、订单详情金额区(应收/实付/已退/欠款) + 收款台账 + 记一笔收款、Analytics 页欠款汇总卡。月度营收走势/导出留后续。

### 4.16 邮局管理

邮局管理接口位于 `backend/app/api/postal.py`，统一前缀 `/api/postal`，需 JWT 鉴权。**读**（列表/详情/导出）登录即可；**写**（各 `import/commit`、台账手工 `POST`/`PUT`/`DELETE`、`address-changes/{id}/apply`、投诉 `handlings` 处理登记/删除）均需 `require_admin`。业务模型见 §3.17（邮局＝投递方式、投递记录层）。**「收款发票」已迁至财务管理**（`/api/finance/postal-receipts/*`，见本节末）；**「月度起投明细」层已删除**（`/api/postal/batches*` 端点连同两表随 PR#77 移除）。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/postal/deliveries` | **投递名册**：全部投递记录，筛选 `year`/`channel`/`distribution_unit_id`/`month`(起投月)/`search`(姓名·编号) + 分页 |
| `POST` | `/api/postal/import/preview` | 上传《邮局读者明细》.xlsx 预览 → 投递记录（不造订单）；计数 import/duplicate/unresolved |
| `POST` | `/api/postal/import/commit` | 提交导入（建 `PostalDelivery`；`(year, delivery_no)` 去重幂等） |
| `GET` | `/api/postal/tickets` | **客服工单统一查询**：从 `postal_tickets` 按 `type`/`year`/`status`/`applied`/`search` 做数据库筛选与分页；返回 `TicketOut` 和类型计数 `summary{complaint,address,follow}` |
| `POST` | `/api/postal/tickets` | 按 body `type` 新增投诉 / 改地址 / 独立回访工单 |
| `GET`/`PUT`/`DELETE` | `/api/postal/tickets/{id}` | 统一详情 / 编辑 / 删除；响应带类型判别字段 |
| `POST` | `/api/postal/tickets/{id}/apply` | 应用改地址：写回投递记录，挂真实订单则同步当前 `FulfillmentTarget` |
| `POST`/`DELETE` | `/api/postal/tickets/{id}/handlings[/{handling_id}]` | 新增 / 删除投诉处理时间线 |
| `POST` | `/api/postal/tickets/import/{type}/preview` · `/commit` | 按类型导入投诉 / 改地址 / 回访；同编号回访并入投诉时间线 |

> **收款发票已迁至财务管理**：原 `/api/postal/finance` + `/api/postal/finance/import/*` 迁为 **`/api/finance/postal-receipts`**（筛选 `platform`/`tax_category`/`linked`/`search`）+ **`/api/finance/postal-receipts/import/preview` · `/commit`**，作为财务管理第三个 Tab「邮局收款」；台账表 `postal_finance` 不变（见 §3.17 P4）。

**旧类型接口兼容层（始于 PR #41；PR #80 后暂留，写操作均 `require_admin`）**：以下路径供旧调用方过渡使用，实际同样读写 `postal_tickets` / `postal_ticket_events`；新前端和新调用统一使用上表的 `/api/postal/tickets*`，不得继续扩展旧路径。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST`/`PUT`/`DELETE` | `/api/postal/deliveries[/{id}]` | 投递名册：手工建/改/删投递记录（`source_type=manual`）；`(year, delivery_no)` 重复 409；**删除无守卫、可直接删**（月度起投明细层已随 PR#77 移除，不再有批次引用） |
| `POST`/`PUT`/`DELETE` | `/api/postal/complaints[/{id}]` | 投诉工单 CRUD（详见下方三态处理流程） |
| `POST` | `/api/postal/complaints/{id}/handlings` | 登记一次处理（body `{action, follow_result?, result_status?}`）；未指定 `result_status` → 置「处理中」；`handling_count +1`；投诉 `status` 由本次处理驱动；返回投诉详情（含处理时间线） |
| `DELETE` | `/api/postal/complaints/{id}/handlings/{handling_id}` | 删除一条处理记录；`handling_count −1`；`status` 回退为最新剩余处理记录的 `result_status`（无剩余且导入基线亦无 → open） |
| `POST`/`PUT`/`DELETE` | `/api/postal/address-changes[/{id}]` | 改地址工单 CRUD |
| `POST`/`PUT`/`DELETE` | `/api/postal/follow-ups[/{id}]` | 回访 CRUD |
| `POST`/`PUT`/`DELETE` | `/api/finance/postal-receipts[/{id}]` | 收款发票 CRUD（已迁至财务管理，见本节末） |

**关键点**：`import/commit` 返回 `{created, delivery_ids?, skipped_duplicates}`（投递记录导入用 `delivery_ids`，工单/发票用 `created`）。工单列表出参含 `postal_delivery_id`（前端据此显示「已关联读者 / 未匹配」）；改地址出参含 `applied_to_order`/`applied_by`/`applied_at`。删除被邮局投递引用的投递单位 `Partner` 会被 §partners 守卫拦（409，见 §3.17）。

**投诉三态处理流程（PR#41，PR-E 后）**：投诉状态为 **open(待处理) / in_progress(处理中) / resolved(已解决)**；每次处理经 `POST /tickets/{id}/handlings` 追加一行到 **`postal_ticket_events`**（处理时间 / 处理人 / 处理过程 / 回访结果 / 本次处理后状态），`handling_count +1`，状态由最新处理驱动；删除处理记录会回退到剩余最新状态。迁移 `c7e9a1b3d5f2` 最初建立三态和旧处理子表，PR-E 迁移 `d4e6f8a0b2c4` 再将其归一到统一时间线。

### 4.17 全局搜索（顶栏快速跳转）

顶栏全局搜索接口位于 `backend/app/api/search.py`（服务 `search_service.global_search`），前缀 `/api`，登录即可用。

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/search?q=` | 跨 **订单 / 收报人 / 商品 / 期数** 检索，各类取 top-N（默认每类 6 条）返回，供顶栏 AutoComplete 下拉快速跳转 |

**各实体匹配字段**（复用各列表已有搜索逻辑）：订单按 单号 `order_code` / 外部单号 `external_order_no` / 付款人 `payer_name` / 联系电话；收报人按 姓名 / 电话；商品按 编码 `code` / 名称 `display_name`；期数按 期号（`issue_number`，仅当输入为纯数字时匹配）。

**前端跳转**（顶栏 AutoComplete 选中项）：订单 → 详情页；期数 → 报数页；收报人 / 商品 → 对应列表页并带上搜索词。

> 附带修复：收报人列表「姓名搜索」此前失效（前端传 `name`、后端 `/api/recipients` 只认 `search`），PR#42 已统一为 `search` 参数。


发货明细的生成遵循以下优先级规则：

### 5.1 生成条件检查（按顺序）

1. **休刊检查**：
   - 如果当期为休刊（`is_suspended=true`），不生成任何发货记录

2. **收件人状态**：
   - 必须为 `active`
   - `inactive` 的收件人不会生成发货记录

3. **订阅有效性**：
   - 必须存在有效订阅（`start_date <= publish_date <= end_date`）
   - 使用订阅的 `quantity` 作为发货数量

4. **频率匹配**：
   - **weekly**：每期都发
   - **biweekly**：仅在半月（issue_number 为偶数）发送
   - **monthly**：仅在月最后一期发送（通过比对 publish_date 判断）

### 5.2 代码实现

核心逻辑位于 `backend/app/services/shipping_service.py` 中的 `generate_shipping_records_for_issue()` 函数。

### 5.3 手动调整

生成后的发货明细可以通过以下方式调整：
- 修改数量（PUT /api/issues/{issue_id}/shipping）
- 重新生成（POST /api/issues/{issue_id}/shipping/regenerate）

## 6. Excel 导出

系统使用 `openpyxl` 库生成 Excel 文件。

### 6.1 报数表

**文件名**：`{year}年《中国经营报》（总第{issue_number}期）报数.xlsx`

**表头**：导出的报数表会在 `北京印厂` 页标题中同时写入总期号和年内期次，例如 `期数：2648 第十四期`。

**模板驱动导出**：使用原始报数 Excel（解密后）作为模板 `backend/app/templates/report_template.xlsx`，保留所有格式、合并单元格、公式和跨 sheet 引用。导出时仅写入源数据单元格，公式自动计算其余值。

**Sheet 结构**（6 sheets）：
1. `北京印厂` — 汇总表（公式引用其他 sheet）
2. `人民日报印厂`` — 分类汇总 + 本期/上期对比
3. `零售渠道`` — 零售数据
4. `订阅渠道`` — 订阅数据
5. `社用报`` — 社用报分项（24 项）
6. `收发室自留分发（需打印）` — 部门分发表

**数据填充逻辑**：
1. 加载解密模板（`report_template.xlsx`）
2. 查询当前期 `report_entries`，通过 `CELL_MAPPING` 写入源数据单元格
3. 查询上一期数据，通过 `PREV_CELL_MAPPING` 填入"上期"列
4. 计算并填入 `人民日报印厂`` D 列的汇总值
5. 更新 `北京印厂` 表头（期数、出版日期、制表时间）
6. 输出未加密的 Excel 文件

**单元格映射**定义在 `excel_service.py` 的 `CELL_MAPPING` 和 `PREV_CELL_MAPPING` 字典中，将 `(category, sub_category)` 映射到 `(sheet_name, cell)` 列表。

### 6.2 发货明细

**文件名**：`第{issue_number}期发货明细.xlsx`

**Sheet 结构**：1 个 sheet，名称为「ZTO-MF」。

**数据来源**：`shipping_details`

**字段**：序号、期号、原工作表、渠道、子渠道、签约公司、姓名、电话、地址、份数、频率、运输方式、发货时间、截止日期、状态、备注、附加信息、站点、站厅、联系人、高铁序号、期数、信息确认。

### 6.3 合并文件

**文件名**：`issue_{issue_number}.zip`

**结构**：ZIP 内包含 2 个文件
1. `第{issue_number}期报数表.xlsx`
2. `第{issue_number}期发货明细.xlsx`

**实现**：
1. 生成报数表工作簿
2. 生成发货明细工作簿
3. 打包为 ZIP 输出
4. 记录两条导出快照：`report_export` 和 `shipping_export`

## 7. 部署指南

### 7.1 开发环境

**启动顺序**：
1. 启动 MySQL
2. 运行后端：
   ```bash
   cd backend
   venv\Scripts\activate
   uvicorn app.main:app --reload --port 8000
   ```
3. 运行前端：
   ```bash
   cd frontend
   npm run dev
   ```
4. 访问 `http://localhost:5173`

**数据初始化**：
```bash
# 运行数据库迁移
cd backend
alembic upgrade head

# 初始化种子数据
curl -X POST http://localhost:8000/api/admin/seed
```

### 7.2 生产环境

**构建前端**：
```bash
cd frontend
npm install
npm run build
```

**启动服务**：
```bash
cd backend
venv\Scripts\activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

**访问**：
- 直接访问 `http://your-server:8000`
- FastAPI 会自动提供前端静态文件

**注意事项**：
- 确保 `backend/app/main.py` 中静态文件路径正确
- 生产环境建议使用反向代理（Nginx）
- 使用进程管理工具（如 systemd、supervisor）保持服务运行

### 7.3 数据库迁移

**创建新迁移**：
```bash
cd backend
alembic revision --autogenerate -m "description"
```

**应用迁移**：
```bash
alembic upgrade head
```

**回滚**：
```bash
alembic downgrade -1
```

### 7.4 项目脚本（`scripts/`）

仓库根目录的 `scripts/` 存放与构建无关、但能提升开发体验的辅助脚本。

#### `use-dawnace.ps1` —— 多账号 GitHub 切换

适用场景：本机同时登录多个 GitHub 账号（典型情况是 Copilot CLI 会向子
进程注入个人账号的 `GH_TOKEN`，但本仓库需要以仓库 owner `DawnAce`
身份创建 PR / 调用 GitHub REST API）。

**工作原理**：
1. 通过 `git credential fill` 从 Windows Credential Manager 取出 DawnAce
   的 PAT（`git push` 一直在用同一把 token，所以一定存在）。
2. 仅覆盖**当前 PowerShell 进程** 的 `$env:GH_TOKEN`，不写 User /
   Machine 环境变量，不动 `~/.config/gh/hosts.yml`。
3. 原 token 备份到 `$env:GH_TOKEN_BACKUP`，关闭窗口即一切归零。

**用法**：
```powershell
. .\scripts\use-dawnace.ps1   # 必须 dot-source（开头有点 + 空格）
gh api user --jq .login       # 应输出 DawnAce
gh pr create --base main ...  # 此后 gh / API 调用全部以 DawnAce 身份
```

**故障排查**：脚本第一行会校验是否 dot-source 调用，若直接 `.\scripts\use-dawnace.ps1`
执行只会在子进程里短暂生效，回到父 shell 就失效。如果 GCM 里没有 DawnAce
凭据（弹出错误："无法从 Git Credential Manager 读取"），先执行一次
`git push` 让 GCM 弹窗存下 PAT。

## 8. 技术要点

### 8.1 FastAPI 特性
- 自动生成 OpenAPI 文档（`/docs`）
- 类型验证（Pydantic）
- 依赖注入（`Depends`）
- 异步支持

### 8.2 SQLAlchemy ORM
- 声明式模型定义
- 关系映射（`relationship`）
- 级联删除（`cascade="all, delete-orphan"`）
- 会话管理（`SessionLocal`）

### 8.3 数据库连接性能优化
由于数据库部署在腾讯云（远程），每次 DB 往返约 500ms+，因此采用以下策略：
- **启动预热**：`warmup_pool()` 在 FastAPI startup 事件中预建连接，避免首次请求冷启动
- **连接超时**：`connect_timeout=5s`、`read_timeout=10s`、`write_timeout=10s`
- **关闭 pre-ping**：`pool_pre_ping=False`，配合 `pool_recycle=300` 管理连接有效性
- **Dashboard 缓存**：30 秒内存缓存（`backend/app/cache.py`），写操作时自动清除
- **查询合并**：Dashboard 接口从 7 次 DB 查询优化到 2 次

### 8.4 React + TypeScript
- 函数式组件 + Hooks
- 客户端路由（react-router-dom）
- 类型安全（TypeScript）
- 组件库（Ant Design）
- 表格固定列使用 `fixed: 'end'` + `scroll={{ x: 'max-content' }}`，操作列固定在右侧
- 表格行 hover 使用不透明背景色（`#fafafa`），避免固定列穿透问题
- 操作按钮使用图标 + Tooltip 替代文字按钮，节省空间

### 8.5 安全性
- **JWT 认证**：所有业务路由均通过 `get_current_user` 依赖强制认证
- **管理员权限**：种子数据等管理接口通过 `require_admin` 限制
- Excel 密码保护（openpyxl）
- 环境变量管理（python-dotenv）
- SQL 注入防护（SQLAlchemy ORM）
- CORS 配置

### 8.6 中文本地化（i18n）
- 全局在 `frontend/src/bootstrap.tsx` 用 `<ConfigProvider locale={zhCN}>`（`antd/locale/zh_CN`）包裹应用，并 `dayjs.locale('zh-cn')`，一次性将所有 Ant Design 内置文案中文化：Modal/Popconfirm 的「确定 / 取消」按钮、表格「暂无数据」空状态、分页、列筛选（搜索/重置）、排序提示、DatePicker 面板（含月份/星期）、Select「无匹配结果」、Upload「删除文件」、Form 默认校验提示等。
- **静态方法例外**：`Modal.confirm/.error/.warning/.info` 等静态调用在 antd v6 下不消费 `ConfigProvider` 上下文，其默认按钮仍为英文，需在调用处显式传 `okText`（必要时 `cancelText`）。
- **文案约定**：所有面向用户的文字一律中文，包括后端 `HTTPException.detail` 错误信息——它经 `err.response.data.detail` 在前端 toast 弹出，因此后端报错文案也用中文（f-string 占位符如 `{order_id}` 保持不变）。后端成功响应体的 `message` 字段仅供程序读取、不直接展示给用户，可保留英文（部分被测试断言）。

## 9. 常见问题

### Q1: 如何添加新的报数项目？
**A**: 在 `backend/app/seeds/report_templates.py` 中添加新模板，然后重新运行种子数据。

### Q2: 如何修改 Excel 导出格式？
**A**: 编辑 `backend/app/services/excel_service.py` 中的导出函数，或使用自定义模板。

### Q3: 数据库连接失败怎么办？
**A**: 检查 `.env` 文件配置，确保 MySQL 服务正在运行，用户有足够权限。

### Q4: 前端打包后无法访问 API？
**A**: 检查 `vite.config.ts` 中的 `base` 配置，确保与部署路径一致。

### Q5: 如何备份数据？
**A**: 使用 `mysqldump` 导出数据库：
```bash
mysqldump -u user -p database_name > backup.sql
```

## 10. 未来扩展

- [x] 用户认证与权限管理
- [x] 操作日志记录
- [x] 往期数据导入（基于系统模板）
- [x] 订单管理 V1.1（手工创建、确认、作废、偏差跟踪；范围：**个人客户预付 + 同事赠阅**）
- [x] 订单管理 V1.2（active 状态明细就地编辑、多版本 allocation、订阅期限与套餐价）
- [x] 订单管理 V1.3 优先级 1：单订单按期手动预览 / 应用同步至 order_generated `shipping_details`
- [x] post-V1.3：电商订单导入（**CBJ 小程序 + 淘宝** Excel，上传按表头自动识别平台）+ 商品库（三段式命名，名称与匹配解耦）+ 活动标签/赠品 + **商学院按期发行量**（单期 + 订阅展开）（详见 §3.16；有赞等其它平台与 API 同步留待后续）
- [ ] post-V1.3：财务对账（实付 / 应收 / 退款、欠款追踪、未付清筛选）
- [ ] post-V1.3：客户自助下单
- [ ] 数据统计与报表分析
- [ ] 自动发送邮件通知
- [ ] 移动端适配
- [ ] 多年度管理
- [ ] 历史数据对比
- [ ] 导入 Excel 数据
- [ ] 操作日志记录
