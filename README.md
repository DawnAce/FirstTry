# 中国经营报 · 印数管理系统

每周五生成下周一出版的《中国经营报》印数管理表和中通快递发货明细的 Web 应用，并支持管理员上传年度刊期 PDF，预览校验后更新系统刊期表。系统从 V1.1 起还包含**订单管理**模块，V1.3 已支持手工录入、订阅套餐价、active 状态明细编辑、多版本履约方案，以及单订单按期号手动预览 / 应用同步到 `shipping_details`。并已上线**电商订单导入**（CBJ 小程序 + 淘宝，上传按表头自动识别平台）与**商品库**：商品库把电商商品名映射为履约属性（名称三段式规范、与匹配解耦——靠别名匹配，改名不影响识别），导入页支持上传 Excel → 预览（自动识别商品/状态/运费转中通/套餐拆分，未识别进待确认）→ 确认批量建单，含「近期 / 历史归档」两种模式。还提供**活动订单统计**（按活动 / 按期）与**商学院按期发行量**（单期 + 订阅展开）。

当前主链已经收敛为：

- 报数编辑页中的 **中通物流公司合计**
- 收件人管理中的 **中通发货明细（`shipping_details`）**
- 报数/发货/打包导出时生成的 **审计快照**
- 订单管理中的 **订单 → 明细 → 履约目标 → 发货明细** 主链路（V1.3 支持单订单、按期号、手动预览 / 应用同步到 `shipping_details`）
- **电商订单导入（CBJ 小程序 + 淘宝，已完成并部署）**：上传按表头自动识别平台 → 商品库映射 + Excel 批量导入（预览/确认）+ 导入内快速新增商品 + 活动标签/赠品（按活动追溯统计）；商品库已规范化为三段式命名 + 结构化 code（名称与匹配解耦）；新增**商学院按期发行量**统计（单期 + 订阅按覆盖期展开、合刊去重）。详见 [进度备忘](docs/order-import-progress.md)。后续重点：财务对账、客户自助下单、其它平台

旧的 `/shipping/:issueId` 入口已重定向到当前的「收件人管理 → 中通发货明细」执行面。

## 技术栈
- **后端**: Python / FastAPI / SQLAlchemy / JWT 认证 / openpyxl / pypdf / cpca（地址解析）
- **前端**: React / TypeScript / Vite / Ant Design / TanStack Query / ECharts（图表）
- **数据库**: MySQL

## 快速开始

### 1. 环境准备
- Python 3.11+
- Node.js 18+
- MySQL 数据库

### 2. 配置
在项目根目录创建 `.env` 文件：
```env
MYSQL_HOST=your_host
MYSQL_PORT=3306
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
JWT_SECRET=replace_with_a_random_value_of_at_least_32_characters
```

### 3. 后端启动
```bash
cd backend
python -m venv venv
# Windows
venv\Scripts\activate
# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 4. 前端启动（开发模式）
```bash
cd frontend
npm install
npm run dev
```

### 5. 登录系统
系统不再提供默认密码。首次部署或需要轮换密码时，在 `backend` 目录执行：

```bash
python -m scripts.set_admin_password admin
```

按提示设置至少 12 位的新密码，然后访问 `http://localhost:5173` 登录。

### 6. 初始化数据
管理员登录后调用种子数据接口：
```powershell
$token = (Invoke-RestMethod -Method Post http://localhost:8000/api/auth/login -ContentType "application/json" -Body (@{username="admin";password="<你的管理员密码>"} | ConvertTo-Json)).access_token
Invoke-RestMethod -Method Post http://localhost:8000/api/admin/seed -Headers @{Authorization="Bearer $token"}
```

### 7. 年度刊期表上传

管理员可以在侧边栏展开「刊期表管理」子菜单，包含两个页面：

- **期刊表**（`/schedule`）：按年份查看出版期数、休刊次数、期号范围等概览统计，支持按月份、日期、期号、状态（正常/休刊）筛选，按月份分组展示刊期明细。
- **导入期刊表**（`/schedule/import`）：管理员拖拽或选择年度文字版 PDF 后，系统会自动解析出版日期、期号和休刊行，先返回摘要、错误和按月份分组的预览结果；如需修正，可直接编辑预览行并点击「应用手动修正并重新校验」。确认无误且校验通过后点击「确认保存」写入 `publication_schedule`，作为创建期数和计算当年第几期的正式刊期表。系统会在 `publication_schedule_uploads` 保留上传记录、原始 PDF 保存路径、解析摘要、错误信息、上传人、提交时间和抽取文本，便于审计与排查。提交会保护已创建期数：如果新刊期表会删除已创建期号或修改其出版日期，系统会拒绝提交。

> 上传解析依赖后端 `pypdf`；如果本地虚拟环境缺少依赖，请先在 `backend` 目录执行 `pip install -r requirements.txt` 并重启后端。PDF 文本抽取中出现粘连数字或无法匹配的日期数字时，系统会尽量拆分为日期/期号；仍无法识别时返回可核对的解析错误，不会写入正式刊期表。

### 一键启动（推荐）

| 系统 | 命令 |
|------|------|
| Windows PowerShell | `.\dev.ps1` |
| Windows CMD | `dev.bat` |
| macOS / Linux | `./dev.sh` |

> `dev.ps1` / `dev.sh` 启动前会自动跑一次 `alembic upgrade head`（dev 下失败不阻断启动，仅告警）；拉了新代码后无需再手动迁移。

### 多账号 GitHub 切换（可选）

如果本机同时登录了多个 GitHub 账号（例如 Copilot CLI 注入的 `GH_TOKEN`
属于个人账号，但本仓库需要以 `DawnAce` 身份创建 PR / 调用 GitHub API），
可在 PowerShell 里 dot-source 一次：

```powershell
. .\scripts\use-dawnace.ps1   # 仅覆盖当前窗口的 GH_TOKEN
gh pr create ...              # 此后 gh / API 调用都是 DawnAce 身份
```

脚本会从 Git Credential Manager 取 token，**只影响当前 shell**，不写
User/Machine 环境变量，关闭窗口后自动恢复。

### 8. 生产部署

一键脚本，会**构建前端 → 应用数据库迁移（`alembic upgrade head`）→ 启动服务**：

| 系统 | 命令 |
|------|------|
| Windows PowerShell | `.\start.ps1` |
| macOS / Linux | `./start.sh` |

端口默认 8000（可用环境变量 `PORT` 覆盖）；`SKIP_BUILD=1` 可跳过前端构建只做迁移+起服务。访问 `http://<host>:8000`。

> ⚠️ **每次部署/升级新版本都要应用迁移**：代码新增的数据库列（如 `order_items.issue_label`、`orders.original_amount`）必须靠 `alembic upgrade head` 补到生产库，漏了会让导入/统计接口报 `Unknown column` 500。脚本已内置这步（幂等，已应用过的会跳过）；如需手动执行：`cd backend && alembic upgrade head`。

手动等价步骤：
```bash
cd frontend && npm run build
cd ../backend && alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 往期导入工作流

对于系统上线前已有的历史期次，可通过「往期导入」功能一次性补录：

1. 在首页点击「导入往期」按钮，进入独立的历史导入页
2. 下载系统提供的「印数导入模板」和「中通发货导入模板」，按格式填写数据；印数文件可直接上传可识别的原始报数表，中通发货也可直接上传原始多工作表文件
3. 上传两份已填好的文件，点击「预览导入」执行识别与校验
4. 校验通过后，点击「确认导入」一次性生成草稿期数，再返回报数编辑页继续复核、确认和导出

> **限制**：报数文件需使用系统模板或可识别的原始报数表；原始报数表如存在未处理临时加印、总印数不一致或未命中映射项，会在预览阶段阻断；中通发货文件支持系统单表模板和原始多工作表格式；两份文件必须属于同一期且目标期号不能已存在；报数中的“中通物流公司”合计必须与中通发货明细数量一致；导入成功后沿用现有确认、发货、导出流程。

## 文档
- [技术文档](docs/technical.md)
- [需求文档](docs/requirements.md)
- [操作手册](docs/user-guide.md)
- [电商订单导入·进度备忘](docs/order-import-progress.md)
