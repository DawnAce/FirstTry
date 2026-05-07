# 技术文档

## 1. 项目架构

本项目采用前后端分离架构，使用 FastAPI + React 构建单页应用（SPA）。

### 开发模式
- 前端：Vite 开发服务器运行在 `http://localhost:5173`
- 后端：FastAPI 服务运行在 `http://localhost:8000`
- 前端通过 CORS 跨域请求后端 API

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
│   │   │   ├── exports.py      # 导出 Excel
│   │   │   ├── issues.py       # 期数管理
│   │   │   ├── recipients.py   # 收件人管理
│   │   │   ├── reports.py      # 报数数据
│   │   │   ├── schedule.py     # 刊期查询
│   │   │   └── shipping.py     # 发货管理
│   │   ├── models/             # SQLAlchemy 模型
│   │   │   ├── issue.py
│   │   │   ├── publication_schedule.py
│   │   │   ├── recipient.py
│   │   │   ├── report_entry.py
│   │   │   ├── report_item_template.py
│   │   │   ├── shipping_record.py
│   │   │   └── subscription.py
│   │   ├── schemas/            # Pydantic 模式
│   │   ├── seeds/              # 种子数据
│   │   │   ├── publication_schedule_2026.py
│   │   │   └── report_templates.py
│   │   ├── services/           # 业务逻辑
│   │   ├── templates/          # Excel 模板
│   │   ├── config.py           # 配置管理
│   │   ├── cache.py            # Dashboard 内存缓存
│   │   ├── database.py         # 数据库连接
│   │   └── main.py             # FastAPI 应用入口
│   ├── alembic.ini
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/                # API 客户端
│   │   ├── components/         # 通用组件
│   │   ├── pages/              # 页面组件
│   │   │   ├── HomePage.tsx
│   │   │   ├── ReportEditPage.tsx
│   │   │   ├── ShippingPage.tsx
│   │   │   └── RecipientPage.tsx
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

系统使用 7 张数据表：

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
- **reader**（读者）：个人订户
- **sample**（样报）：媒体、合作方等

**频率说明**：
- **weekly**（每周）：每期都发
- **biweekly**（双周）：双周发一次
- **monthly**（月底）：每月最后一期发

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

### 3.7 shipping_records（发货记录）
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

## 4. API 接口一览

所有 API 路径以 `/api` 为前缀。

### 4.1 系统管理

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

### 4.2 刊期查询

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

### 4.3 期数管理

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

### 4.4 报数管理

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
- 已确认（confirmed/exported）的期数不能修改
- 变动项不能为空
- 数值不能为负

**响应**：更新后的 report_entries 列表

#### POST /api/issues/{issue_id}/report/confirm
确认报数（状态变更为 confirmed）。

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

### 4.5 收件人管理

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

**响应**：201 Created + Recipient 对象

#### PUT /api/recipients/{recipient_id}
更新收件人信息。

**请求体**：同创建

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

### 4.6 订阅管理

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

### 4.7 发货管理

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

### 4.8 Excel 导出

#### GET /api/issues/{issue_id}/export/report
导出报数表 Excel。

**响应**：Excel 文件（application/vnd.openxmlformats-officedocument.spreadsheetml.sheet）

#### GET /api/issues/{issue_id}/export/shipping
导出发货明细 Excel。

**响应**：Excel 文件

#### GET /api/issues/{issue_id}/export/all
导出合并文件（报数表 + 发货明细）。

**响应**：Excel 文件

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
   - **biweekly**：仅在双周（issue_number 为偶数）发送
   - **monthly**：仅在每月最后一期发送（通过比对 publish_date 判断）

### 5.2 代码实现

核心逻辑位于 `backend/app/services/shipping_service.py` 中的 `generate_shipping_records_for_issue()` 函数。

### 5.3 手动调整

生成后的发货明细可以通过以下方式调整：
- 修改数量（PUT /api/issues/{issue_id}/shipping）
- 重新生成（POST /api/issues/{issue_id}/shipping/regenerate）

## 6. Excel 导出

系统使用 `openpyxl` 库生成 Excel 文件。

### 6.1 报数表

**文件名**：`第{issue_number}期报数表.xlsx`

**Sheet 结构**（6 sheets）：
1. 邮发、报零、订户
2. 赠阅报
3. 备用报
4. 合计
5. 总计
6. 说明

**数据填充逻辑**：
1. 查询 `report_entries` 获取所有报数数据
2. 根据 `excel_sheet` 和 `excel_cell` 定位单元格
3. 填入 `value` 值
4. 设置密码保护：`0611`

**模板驱动**：
- 如果存在 `backend/app/templates/report_template.xlsx`，使用模板
- 否则创建基础工作簿并填充数据

### 6.2 发货明细

**文件名**：`第{issue_number}期发货明细.xlsx`

**Sheet 结构**（7 sheets）：
1. 对公（type=business）
2. 读者（type=reader）
3. 样报（type=sample）
4. 每周（frequency=weekly）
5. 双周（frequency=biweekly）
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
- 按频率统计：每周 X 人 Y 份，双周 X 人 Y 份，月底 X 人 Y 份
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

### 8.3 React + TypeScript
- 函数式组件 + Hooks
- 客户端路由（react-router-dom）
- 类型安全（TypeScript）
- 组件库（Arco Design）

### 8.4 安全性
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

- [ ] 用户认证与权限管理
- [ ] 数据统计与报表分析
- [ ] 自动发送邮件通知
- [ ] 移动端适配
- [ ] 多年度管理
- [ ] 历史数据对比
- [ ] 导入 Excel 数据
- [ ] 操作日志记录
