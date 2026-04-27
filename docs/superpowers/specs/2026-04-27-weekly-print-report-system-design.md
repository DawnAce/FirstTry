# 中国经营报 · 每周印数报数系统 — 设计规格

## 1. 项目概述

### 1.1 目标
构建一个 Web 应用，方便每周五生成下周一出版的《中国经营报》的印数报数表和中通快递发货明细，替代当前的手动 Excel 操作流程。

### 1.2 核心价值
- 自动推算期号和出版日期（基于刊期表）
- 固定数据自动沿用，只需输入变动项
- 收件人名单集中管理，发货明细自动生成
- 一键导出格式一致的 Excel 文件
- 历史数据持久化，支持未来数据分析

### 1.3 用户
单人使用（报社内部操作人员）。

---

## 2. 技术架构

### 2.1 技术栈
| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React + TypeScript + Vite | Ant Design 组件库 |
| 后端 | FastAPI (Python 3.11+) | SQLAlchemy ORM |
| 数据库 | MySQL | 用户现有实例 |
| Excel 处理 | openpyxl + pandas | 模板驱动导出 |

### 2.2 部署模式
- **开发时**：Vite dev server (前端) + FastAPI uvicorn (后端)，两个进程
- **生产时**：React build 为静态文件，FastAPI 通过 `StaticFiles` 托管前端 + API，**单服务部署**

### 2.3 项目结构
```
FirstTry/
├── backend/                    # FastAPI 后端
│   ├── app/
│   │   ├── main.py             # FastAPI 入口，挂载静态文件
│   │   ├── api/                # API 路由
│   │   │   ├── issues.py       # 期数管理接口
│   │   │   ├── reports.py      # 报数数据接口
│   │   │   ├── recipients.py   # 收件人接口
│   │   │   ├── shipping.py     # 发货明细接口
│   │   │   └── exports.py      # Excel 导出接口
│   │   ├── models/             # SQLAlchemy 数据模型
│   │   ├── services/           # 业务逻辑
│   │   │   ├── report_service.py
│   │   │   ├── shipping_service.py
│   │   │   └── excel_service.py
│   │   ├── templates/          # Excel 模板文件 (.xlsx)
│   │   └── config.py           # 配置（DB 连接等）
│   ├── requirements.txt
│   └── alembic/                # 数据库迁移
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── pages/              # 页面组件
│   │   ├── components/         # 通用组件
│   │   └── api/                # API 调用封装
│   ├── package.json
│   └── vite.config.ts
├── docs/                       # 项目文档
│   ├── technical.md            # 技术文档（架构、部署、开发指南）
│   ├── requirements.md         # 需求文档（功能规格）
│   └── user-guide.md           # 操作手册（用户使用指南）
└── README.md
```

---

## 3. 数据模型

### 3.1 publication_schedule — 刊期表
存储全年出版计划，用于自动推算下一期期号。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| year | INT | 年份 |
| issue_number | INT | 期号 (如 2635) |
| publish_date | DATE | 出版日期 |
| is_suspended | BOOLEAN | 是否休刊 |

UNIQUE(year, issue_number)

### 3.2 issues — 期数记录
每期一条记录，记录状态和元数据。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| issue_number | INT | 期号 |
| publish_date | DATE | 出版日期 |
| status | ENUM | draft / confirmed / exported |
| notes | TEXT | 备注 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 3.3 report_item_templates — 数据项模板
定义所有报数项的元数据（配置中心）。新增数据项只需加一行，不用改代码。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| category | VARCHAR(50) | 渠道大类 (postal/retail/guangzhou/social_use/temp/other) |
| sub_category | VARCHAR(100) | 具体项目 (外埠/本市/东部/西部...) |
| display_name | VARCHAR(100) | 中文显示名 |
| default_value | INT | 固定项的默认值 |
| is_variable | BOOLEAN | 是否为每周变动项 |
| sort_order | INT | 显示顺序 |
| excel_sheet | VARCHAR(50) | 对应 Excel 的 Sheet 名 |
| excel_cell | VARCHAR(10) | 对应 Excel 的单元格位置 |

UNIQUE(category, sub_category)

### 3.4 report_entries — 报数数据
每期的所有印数数据，行式存储。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| issue_id | INT FK → issues | 所属期数 |
| category | VARCHAR(50) | 渠道大类 |
| sub_category | VARCHAR(100) | 具体项目 |
| value | INT | 数量 |
| is_variable | BOOLEAN | 是否为变动项 |

UNIQUE(issue_id, category, sub_category)

### 3.5 recipients — 收件人
收件人基本信息，不含订阅日期（由 subscriptions 管理）。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| name | VARCHAR(100) | 收件人姓名 |
| phone | VARCHAR(20) | 电话 |
| province | VARCHAR(50) | 省份 |
| city | VARCHAR(50) | 城市 |
| address | TEXT | 详细地址 |
| type | ENUM | corporate(对公) / reader(读者) / sample(样报) |
| frequency | ENUM | weekly / biweekly / monthly |
| status | ENUM | active / suspended |
| notes | TEXT | 备注 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

### 3.6 subscriptions — 订阅记录
每次新订/续订独立一条记录，保留完整历史，支持续订行为分析。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| recipient_id | INT FK → recipients | 所属收件人 |
| type | ENUM | new(新订) / renewal(续订) |
| start_date | DATE | 本次订阅起始 |
| end_date | DATE | 本次订阅截止 |
| duration_months | INT | 订阅时长（月） |
| quantity | INT | 本次订阅份数 |
| notes | TEXT | 备注 |
| created_at | DATETIME | 操作时间 |

INDEX(recipient_id, created_at)

### 3.7 shipping_records — 发货记录
每期每个收件人的实际发货记录。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INT PK | 自增主键 |
| issue_id | INT FK → issues | 所属期数 |
| recipient_id | INT FK → recipients | 所属收件人 |
| quantity | INT | 本期发货数量 |
| status | ENUM | pending(待发) / shipped(已发) |

UNIQUE(issue_id, recipient_id)

### 3.8 发货判断逻辑
系统生成发货明细时，按以下优先级判断收件人是否发货：
1. **手动停发优先**：`recipients.status = 'suspended'` → 不发货
2. **订阅有效期**：查询 `subscriptions` 最新记录，`end_date >= 出版日期` → 有效
3. **频率匹配**：
   - `weekly`：每期都发
   - `biweekly`：根据期号奇偶判断
   - `monthly`：当月最后一期才发

---

## 4. 页面设计

### 4.1 Dashboard（首页）
- 当前/下一期期号和出版日期
- 本期状态（草稿/已确认/已导出）
- 变动项待输入提醒
- 快捷操作入口
- 近期印数趋势简图

### 4.2 报数编辑
- 自动加载上期数据作为基础
- 变动项高亮标橙，固定项灰色显示
- 按渠道分组（邮发/报零/广州/社用/其他）
- 实时计算合计数
- 保存草稿 / 确认提交

### 4.3 收件人管理
- 收件人列表（搜索/筛选/分页）
- 新增 / 编辑 / 停发 / 恢复
- 续订操作（新增 subscription 记录 + 更新 end_date）
- 按类型分组：对公 / 读者 / 样报
- 按频率筛选：每周 / 双周 / 月底
- 随时可操作，不限于周五

### 4.4 发货明细预览
- 根据收件人名单 + 频率 + 订阅有效期自动生成
- 按 Sheet 分 Tab 展示（每周合计/对公/读者/上犹/停发-双周/月底-整月/样报缴送）
- 可手动调整个别发货数量
- 标注本期新增/停发的变化

### 4.5 Excel 导出
- 一键导出报数表（6 个 Sheet）
- 一键导出中通发货明细（7 个 Sheet）
- 打包下载两个文件
- 格式严格匹配原模板（模板驱动）
- 自动填入期号、日期
- 输出文件密码保护（0611）

### 4.6 历史与设置
- 历史期数列表（查看/对比任意期）
- 数据趋势图（按项目查看变化）
- 刊期表管理（查看/导入新年度）
- 数据项模板配置
- 系统设置（数据库连接等）

---

## 5. API 设计

```
# 期数管理
GET    /api/issues                    # 列出所有期（分页）
GET    /api/issues/next               # 获取下一期信息（自动推算）
POST   /api/issues                    # 创建新一期（复制上期数据）
GET    /api/issues/{id}               # 获取某期详情

# 报数数据
GET    /api/issues/{id}/report        # 获取某期报数
PUT    /api/issues/{id}/report        # 更新报数数据
POST   /api/issues/{id}/confirm       # 确认报数

# 收件人
GET    /api/recipients                # 收件人列表（筛选/搜索）
POST   /api/recipients                # 新增收件人
PUT    /api/recipients/{id}           # 修改收件人
PATCH  /api/recipients/{id}/status    # 停发/恢复

# 订阅
POST   /api/recipients/{id}/subscriptions       # 新增订阅/续订
GET    /api/recipients/{id}/subscriptions        # 查看订阅历史

# 发货明细
GET    /api/issues/{id}/shipping      # 获取某期发货明细
PUT    /api/issues/{id}/shipping      # 调整发货数量

# 导出
GET    /api/issues/{id}/export/report      # 导出报数 Excel
GET    /api/issues/{id}/export/shipping    # 导出发货明细 Excel
GET    /api/issues/{id}/export/all         # 打包下载两个文件

# 统计 & 配置
GET    /api/stats/trends              # 数据趋势
GET    /api/schedule                  # 刊期表
POST   /api/schedule/import           # 导入新年度刊期表
```

---

## 6. Excel 导出策略

### 6.1 模板驱动
- 后端保存原始 Excel 文件作为模板（保留所有格式、合并单元格、样式）
- 导出时用 openpyxl 打开模板 → 填入数据 → 另存为新文件
- `report_item_templates` 表中的 `excel_sheet` 和 `excel_cell` 字段定义数据写入位置

### 6.2 输出文件
- 报数表：`{年}年《中国经营报》第{X}期（总第{期号}期）报数.xlsx`
- 发货明细：`{年}年{月}月{日}日《中国经营报》中通快递发货明细（{期号}）.xlsx`
- 密码保护：`0611`

---

## 7. 数据校验

### 7.1 提醒级（黄色警告，不阻断）
- 变动项与上期差异超过 20%
- 有变动项未修改（可能忘了更新）
- 本期有即将到期的收件人

### 7.2 阻断级（红色错误，阻止导出）
- 必填变动项为空
- 数值为负数
- 合计数与明细不一致

---

## 8. 边界情况

| 场景 | 处理方式 |
|---|---|
| 休刊周 | 自动跳过，推算下一个非休刊期号 |
| 月底/整月发货 | 根据出版日期自动判断是否当月最后一期 |
| 双周发货 | 根据 frequency=biweekly 和期号奇偶判断 |
| 跨年 | 需导入新年度刊期表，系统提醒未导入时给出警告 |
| 首次使用 | 提供初始化向导：导入刊期表 → 录入基础数据 → 导入收件人 |

---

## 9. MVP 范围

### 第一版包含
- 刊期表管理 & 自动推算期号
- 报数编辑（变动项 + 固定项）
- 收件人管理（CRUD + 订阅记录）
- 发货明细自动生成
- Excel 导出（模板驱动，格式一致）
- 历史数据查看
- 项目文档（技术文档 + 需求文档 + 操作手册）

### 后期扩展
- OCR 识别传真/图片数据
- 数据趋势图 & 分析面板
- 续订率/流失分析
- 到期续订提醒
- CSV 批量导入收件人
- 部署到远程服务器

---

## 10. 2026 年刊期表数据

邮发代号：1-76，出版日期：周一，全年 49 期。

| 月 | 日期 | 期号 | 备注 |
|---|---|---|---|
| 1 | 5, 12, 19, 26 | 2635-2638 | |
| 2 | 2, 9 | 2639-2640 | |
| 2 | 16, 23 | — | 休刊 |
| 3 | 2, 9, 16, 23, 30 | 2641-2645 | |
| 4 | 6, 13, 20, 27 | 2646-2649 | |
| 5 | 4, 11, 18, 25 | 2650-2653 | |
| 6 | 1, 8, 15, 22, 29 | 2654-2658 | |
| 7 | 6, 13, 20, 27 | 2659-2662 | |
| 8 | 3, 10, 17, 24, 31 | 2663-2667 | |
| 9 | 7, 14, 21, 28 | 2668-2671 | |
| 10 | 5 | — | 休刊 |
| 10 | 12, 19, 26 | 2672-2674 | |
| 11 | 2, 9, 16, 23, 30 | 2675-2679 | |
| 12 | 7, 14, 21, 28 | 2680-2683 | |
