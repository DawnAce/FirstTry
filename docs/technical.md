# 技术文档

## 1. 项目架构

本项目采用前后端分离架构，使用 FastAPI + React 构建单页应用（SPA）。

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
│   │   │   ├── issues.py       # 期数管理
│   │   │   ├── recipients.py   # 收件人管理
│   │   │   ├── reports.py      # 报数数据
│   │   │   ├── schedule.py     # 刊期查询
│   │   │   ├── shipping.py     # 发货管理
│   │   │   ├── shipping_details.py # 中通发货明细 CRUD
│   │   │   ├── operation_logs.py  # 操作日志查询
│   │   │   └── templates.py    # 模板管理
│   │   ├── models/             # SQLAlchemy 模型
│   │   │   ├── issue.py
│   │   │   ├── publication_schedule.py
│   │   │   ├── recipient.py
│   │   │   ├── report_entry.py
│   │   │   ├── report_item_template.py
│   │   │   ├── report_revision.py  # 作废记录
│   │   │   ├── shipping_record.py
│   │   │   ├── shipping_detail.py  # 中通发货明细
│   │   │   ├── operation_log.py   # 操作日志
│   │   │   ├── subscription.py
│   │   │   ├── temp_print_detail.py # 临时加印归属明细
│   │   │   └── user.py         # 用户模型
│   │   ├── schemas/            # Pydantic 模式
│   │   │   └── auth.py         # 认证模式
│   │   ├── seeds/              # 种子数据
│   │   │   ├── publication_schedule_2026.py
│   │   │   ├── report_templates.py
│   │   │   └── shipping_details_2649.py  # 2649期中通发货数据
│   │   ├── services/           # 业务逻辑
│   │   │   ├── address_service.py  # 地址解析与规范化（cpca）
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
│   │   ├── contexts/
│   │   │   └── AuthContext.tsx  # 认证上下文
│   │   ├── pages/              # 页面组件
│   │   │   ├── Dashboard.tsx
│   │   │   ├── History.tsx
│   │   │   ├── Login.tsx       # 登录页面
│   │   │   ├── Recipients.tsx
│   │   │   ├── ReportEditor.tsx
│   │   │   ├── ShippingPreview.tsx
│   │   │   └── Templates.tsx
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

系统使用 12 张数据表：

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

### 3.2 issues（期数）
记录每期的创建和状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_number | INT | 期号（唯一） |
| publish_date | DATE | 出版日期 |
| status | ENUM | 状态：draft/confirmed/exported |
| page_count | INT | 版数（默认 24，步长 4） |
| notes | TEXT | 备注 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

**关系**：
- 一对多 `report_entries`（报数数据）
- 一对多 `shipping_records`（发货记录）

### 3.3 report_item_templates（报数模板配置）
定义报数表的所有项目及其属性。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| category | VARCHAR | 主类别 |
| sub_category | VARCHAR | 子类别 |
| default_value | INT | 默认值 |
| is_variable | BOOLEAN | 是否为变动项 |
| excel_sheet | VARCHAR | Excel sheet 名称 |
| excel_cell | VARCHAR | Excel 单元格位置 |
| display_order | INT | 显示顺序 |

**示例**：
```sql
('邮发', '北京邮发（外埠）', 0, TRUE, '邮发、报零、订户', 'B4', 1)
('邮发', '北京邮发（本市）', 0, TRUE, '邮发、报零、订户', 'B5', 2)
('订户', '杂志铺', 12, FALSE, '邮发、报零、订户', 'B24', 3)
```

**固定项 vs 变动项**：
- **固定项**（`is_variable=FALSE`）：每期数值相同，如"杂志铺"、"国图贸"、"合订本"等
- **变动项**（`is_variable=TRUE`）：每期需要手工输入，如"北京邮发"、"北京报零"、"广州日报"等

**已移除的项目**：营报传媒加印、财经中心加印、中经未来、产经中心加印（原 social_use 类别下的冗余项）已移除，其功能由 `temp_print_details` 明细表替代。

**合订本显示**：合订本（binding 类别）不再作为独立类别显示，其条目合并计入社用报小计。

### 3.4 report_entries（报数数据）
存储每期的具体报数值。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_id | INT | 外键 → issues.id |
| category | VARCHAR | 主类别 |
| sub_category | VARCHAR | 子类别 |
| value | INT | 数值 |
| is_variable | BOOLEAN | 是否为变动项 |

**创建逻辑**：
1. 创建新期时，从 `report_item_templates` 复制所有模板
2. 固定项使用 `default_value`
3. 变动项初始值为 `default_value`（通常为 0），等待用户输入

### 3.5 recipients（收件人）
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

### 3.6 subscriptions（订阅记录）
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

### 3.7 users（用户）
管理系统用户和权限。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| username | VARCHAR | 用户名（唯一） |
| password_hash | VARCHAR | bcrypt 密码哈希 |
| role | ENUM | 角色：admin/operator |
| created_at | DATETIME | 创建时间 |

**默认账户**：用户名 `admin`，密码 `admin123`，角色 `admin`。

### 3.8 report_revisions（作废记录）
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

### 3.9 temp_print_details（临时加印归属明细）
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

### 3.10 shipping_records（发货记录）
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

### 3.11 shipping_details（中通发货明细）
存储中通快递发货明细数据，从 Excel 发货表导入，支持完整 CRUD。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT | 主键 |
| issue_number | INT | 期号（如 2649） |
| sheet_name | VARCHAR(50) | 来源 sheet 名（溯源用） |
| channel | VARCHAR(20) | 渠道类型 |
| sub_channel | VARCHAR(20) | 子渠道（如赠阅下的"监管"/"政府"） |
| transport | VARCHAR(20) | 运输方式 |
| frequency | VARCHAR(20) | 发送频率 |
| status | VARCHAR(10) | 状态：正常/停发 |
| name | VARCHAR(100) | 收件人/联系人 |
| address | TEXT | 收件地址 |
| phone | VARCHAR(50) | 联系电话（支持多号码） |
| quantity | INT | 份数 |
| deadline | VARCHAR(50) | 截止日期（支持"长期"等文本） |
| notes | TEXT | 备注 |
| extra_info | TEXT | 附加信息 |
| city | VARCHAR(50) | 城市（高铁展示用） |
| station_name | VARCHAR(100) | 站名（高铁展示用） |
| station_hall | VARCHAR(200) | 站厅名称（高铁展示用） |
| contact_person | VARCHAR(100) | 联系人（高铁展示用） |
| seq_number | INT | 序号（高铁展示用） |
| period_count | INT | 期数（月用） |
| confirmation | VARCHAR(20) | 信息确认（高铁展示用） |
| company | VARCHAR(100) | 签约公司（如：北京悦途出行、广州日报） |
| shipped_at | DATETIME | 发货时间（可选，手动填写） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 3.12 operation_logs（操作日志）
记录所有写操作的审计日志，支持按表名和记录ID查询。当前用于中通发货明细，设计上可扩展到其他表。

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
Dashboard 聚合接口，返回最近期数、统计、下一期信息和可创建期数列表。使用 30 秒内存缓存，创建期数时自动清除缓存。

**响应**：
```json
{
  "recent_issues": [...],
  "stats": {"total": 10, "draft": 2},
  "next_issue": {"issue_number": 2652, "publish_date": "2026-05-18", "previous_issue_id": 2},
  "available_issues": [{"issue_number": 2635, "publish_date": "2026-01-05"}, ...]
}
```

#### POST /api/admin/seed
运行种子数据初始化（2026年刊期表 + 报数模板）。

**响应**：
```json
{
  "message": "Seeded 52 schedule entries, 30 report templates"
}
```

### 4.3 刊期查询

#### GET /api/schedule?year=2026
查询指定年份的刊期表。

**响应**：
```json
[
  {
    "id": 1,
    "year": 2026,
    "issue_number": 2635,
    "publish_date": "2026-01-05",
    "is_suspended": false
  },
  ...
]
```

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
    "publish_date": "2026-01-05",
    "status": "confirmed",
    "notes": null,
    "created_at": "2026-01-03T10:00:00",
    "updated_at": "2026-01-03T15:30:00"
  },
  ...
]
```

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

### 4.5 报数管理

#### GET /api/issues/{issue_id}/report
获取指定期的报数数据（按 display_order 排序）。

**响应**：
```json
[
  {
    "id": 1,
    "issue_id": 1,
    "category": "邮发",
    "sub_category": "北京邮发（外埠）",
    "value": 3200,
    "is_variable": true
  },
  ...
]
```

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

**响应**：更新后的 report_entries 列表

#### POST /api/issues/{issue_id}/report/confirm
确认报数（状态变更为 confirmed）。需要用户认证。

**验证规则**：
- 所有变动项必须有值
- 总印数不能为 0

**响应**：
```json
{
  "message": "Report confirmed",
  "issue": { Issue 对象 }
}
```

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

### 4.6 收件人管理

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

#### GET /api/issues/{issue_id}/export/shipping
导出发货明细 Excel。

**响应**：Excel 文件

#### GET /api/issues/{issue_id}/export/all
导出合并文件（报数表 + 发货明细）。

**响应**：Excel 文件

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

### 4.11 中通发货明细

#### GET /api/shipping-details
获取中通发货明细列表，支持多条件筛选。

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

> **地址自动规范化**：提交时 `address` 字段会自动通过 cpca 解析补全省/市/区前缀，`city` 字段若为空会自动填充。

**响应**：201 Created + ShippingDetail 对象

#### PUT /api/shipping-details/{detail_id}
更新发货明细记录（地址同样会自动规范化）。

**响应**：更新后的 ShippingDetail 对象

#### DELETE /api/shipping-details/{detail_id}
删除发货明细记录。

**响应**：`{"message": "Deleted"}`

#### POST /api/shipping-details/normalize-addresses
批量规范化所有发货明细地址。使用 cpca 解析补全缺失的省/市/区前缀，同时填充空的 `city` 字段。

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

**说明**：中通发货明细的新增/编辑/删除操作会自动写入操作日志。编辑操作仅记录实际变化的字段差异。

## 5. 发货逻辑

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

**Sheet 结构**（7 sheets）：
1. 对公（type=business）
2. 读者（type=reader）
3. 样报（type=sample）
4. 周（frequency=weekly）
5. 半月（frequency=biweekly）
6. 月底（frequency=monthly）
7. 汇总

**数据来源**：`shipping_records` + `recipients`

**字段**：
- 序号
- 姓名
- 电话
- 地址
- 数量

**汇总 Sheet**：
- 按类型统计：对公 X 人 Y 份，读者 X 人 Y 份，样报 X 人 Y 份
- 按频率统计：周 X 人 Y 份，半月 X 人 Y 份，月底 X 人 Y 份
- 总计：X 人 Y 份

### 6.3 合并文件

**文件名**：`第{issue_number}期全部文件.xlsx`

**结构**：报数表的 6 个 sheets + 发货明细的 7 个 sheets = 13 sheets

**实现**：
1. 生成报数表工作簿
2. 生成发货明细工作簿
3. 将发货明细的所有 sheets 追加到报数表工作簿
4. 设置密码保护：`0611`

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
- [ ] 数据统计与报表分析
- [ ] 自动发送邮件通知
- [ ] 移动端适配
- [ ] 多年度管理
- [ ] 历史数据对比
- [ ] 导入 Excel 数据
- [ ] 操作日志记录
