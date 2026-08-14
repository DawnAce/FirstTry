# 中国经营报 · 印数管理系统

每周五生成下周一出版的《中国经营报》印数管理表和中通快递发货明细的 Web 应用，并支持管理员上传年度刊期 PDF，预览校验后更新系统刊期表。报数编辑页支持把北京邮发、北京报零、广州日报和成都杂志铺的 PDF / 图片作为原始凭证归档，经 OCR 识别与人工确认后写入草稿数据；成都跨月补发独立计入结算与补发执行，不回写已经出刊的印数。系统从 V1.1 起还包含**订单管理**模块，V1.3 已支持手工录入、订阅套餐价、active 状态明细编辑、多版本履约方案，以及单订单按期号手动预览 / 应用同步到 `shipping_details`。并已上线**电商订单导入**（CBJ 小程序 + 淘宝，上传按表头自动识别平台）与**商品库**：商品库把电商商品名映射为履约属性（名称三段式规范、与匹配解耦——靠别名匹配，改名不影响识别），导入页支持上传 Excel → 预览（自动识别商品/状态/运费转中通/套餐拆分，未识别进待确认）→ 确认批量建单，含「近期 / 历史归档」两种模式。还提供**活动订单统计**（按活动 / 按期）与**商学院按期发行量**（单期 + 订阅展开）。

当前主链已经收敛为：

- 报数编辑页中的 **中通物流公司合计**
- 报数编辑页中的 **原始来源归档 → OCR 核对 → 刊期映射 → 成都补发结算 / 执行**
- 快递管理中的 **ZTO-MF 单期发货明细（`shipping_details`）**
- 报数/发货/打包导出时生成的 **审计快照**
- 订单管理中的 **订单 → 明细 → 履约目标 → 发货明细** 主链路（V1.3 支持单订单、按期号、手动预览 / 应用同步到 `shipping_details`）
- **电商订单导入（CBJ 小程序 + 淘宝，已完成并部署）**：上传按表头自动识别平台 → 商品库映射 + Excel 批量导入（预览/确认）+ 导入内快速新增商品 + 活动标签/赠品（按活动追溯统计）；商品库已规范化为三段式命名 + 结构化 code（名称与匹配解耦）；新增**商学院按期发行量**统计（单期 + 订阅按覆盖期展开、合刊去重）。详见 [进度备忘](docs/order-import-progress.md)。后续重点：财务对账、客户自助下单、其它平台

旧的 `/shipping/:issueId` 入口已重定向到当前的「快递管理 → 期数总览 → 单期详情」执行面。

## 技术栈
- **后端**: Python / FastAPI / SQLAlchemy / JWT 认证 / openpyxl / pypdf / pypdfium2 / RapidOCR / Pillow / cpca（地址解析）
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

如需统一检查和调整 UI，可启动 Storybook：

```bash
npm run storybook
```

顶部工具栏可全局切换亮/暗主题、舒适/紧凑密度和圆润/克制圆角。提交前可运行 `npm run build-storybook` 构建静态站点，并用 `npm run test:stories` 验证 Story。

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

管理员可从「业务首页 → 发行计划 → 刊期表管理」查看刊期表，并点击页面右上角「导入期刊表」进入上传页面：

- **期刊表**（`/schedule`）：按年份查看 📅 出版期数、☕ 休刊次数、📰 期号范围、⚠️ 异常版次等概览统计，支持按月份、日期、期号、状态（正常/休刊）筛选，按月份分组展示刊期明细。
- **导入期刊表**（`/schedule/import`）：管理员拖拽或选择年度文字版 PDF 后，系统会自动解析出版日期、期号和休刊行，先返回摘要、错误和按月份分组的预览结果；如需修正，可直接编辑预览行并点击「应用手动修正并重新校验」。确认无误且校验通过后点击「确认保存」写入 `publication_schedule`，作为创建期数和计算当年第几期的正式刊期表。系统会在 `publication_schedule_uploads` 保留上传记录、原始 PDF 保存路径、解析摘要、错误信息、上传人、提交时间和抽取文本，便于审计与排查。提交会保护已创建期数：如果新刊期表会删除已创建期号或修改其出版日期，系统会拒绝提交。

> 上传解析依赖后端 `pypdf`；如果本地虚拟环境缺少依赖，请先在 `backend` 目录执行 `pip install -r requirements.txt` 并重启后端。PDF 文本抽取中出现粘连数字或无法匹配的日期数字时，系统会尽量拆分为日期/期号；仍无法识别时返回可核对的解析错误，不会写入正式刊期表。

### 8. 报数原始来源与补发凭证

在「发行计划 → 印数管理 → 某一期报数」右侧的「数据来源与调整」中，可为北京邮发、北京报零、广州日报和成都杂志铺上传 PDF、JPG、JPEG 或 PNG：

- 原文件先归档，系统按渠道模板识别日期、刊期和数量；同一渠道的相同文件通过 SHA-256 去重。
- OCR 只是录入建议，用户必须在抽屉中核对刊期映射与数量；`OCR待核对`、`渠道待确认` 会阻止报数确认。
- 北京邮发按来源中的本市、外埠与损失校验；损失为固定 20 份时，确认值分别加 10 份。手写合计识别不稳时保留人工核对提示，不静默写入。
- 成都月度图片可一次映射当月多期，尚未创建的未来期会在创建时应用已确认值；来源标记待定的刊期会持续提醒。
- 印数确认前，同渠道后续文件必须明确选择「追加」或对某一文件执行「重新上传」：追加会计入有效来源合计，重新上传只替换所选文件的贡献，其他来源不变。旧文件保留为「已替换」凭证。
- 成都补发凭证可以跨月份映射到多期，并区分「追加订数」「补损重发」「冲减」。结算数量与补发待发独立汇总，任何补发都不会修改已出刊印数。

部署此功能前需执行 `alembic upgrade head`，并通过 `pip install -r backend/requirements.txt` 安装 PDF 渲染与 OCR 依赖。

### 一键启动（推荐）

| 系统 | 命令 |
|------|------|
| Windows PowerShell | `.\dev.ps1` |
| Windows CMD | `dev.bat` |
| macOS / Linux | `./dev.sh` |

> `dev.ps1` / `dev.sh` 启动前会自动跑一次 `alembic upgrade head`（dev 下失败不阻断启动，仅告警）；拉了新代码后无需再手动迁移。Windows 下 `dev.ps1` 还会检查 Vite 是否完整，缺失时自动执行 `npm ci`；若 npm 报 `EPERM`，请先关闭占用 `node_modules` 的 Vite / Storybook 后重试。

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

### 9. 生产部署

一键脚本，会**同步锁定依赖 → 构建前端 → 应用数据库迁移（`alembic upgrade head`）→ 启动服务**：

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

> **限制**：报数文件需使用系统模板或可识别的原始报数表；原始报数表如存在未处理临时加印、总印数不一致或未命中映射项，会在预览阶段阻断；中通发货文件支持系统单表模板和原始多工作表格式，子渠道仅保留“监管 / 政府”，其他历史说明会移入备注并在预览中提示；两份文件必须属于同一期且目标期号不能已存在；报数中的“中通物流公司”合计必须与中通发货明细数量一致；导入成功后沿用现有确认、发货、导出流程。

已存在的期次如只需修正中通计划，管理员可在「快递管理 · ZTO-MF → 某一期 → 发货计划」点击「上传 / 替换计划」。系统先校验期号并预览替换前后条数、份数、抽样明细和逐条导入格式修正；存在格式修正时必须人工勾选确认。提交后只替换手工/历史导入行，不修改印数，也不覆盖订单生成和投诉补发行。已有运单、实发或核销记录的旧行会阻止整批替换，需先人工核对。

2026 年「上犹」的上犹县政府办（10 份）、上犹县人大办（11 份）、上犹县政协办（9 份）已按全部非休刊期固定列入发货计划，来源显示为「固定生成」。该规则仅适用于 2026 年：上传或替换发货计划时，预览会提示并忽略文件内重复的这 3 条、共 30 份明细；固定生成行不会被替换、清空、跨期复制或手工删除。上犹原始工作表继续沿用既有列解析规则，不新增 G/H 列版式。

## 文档
- [技术文档](docs/technical.md)
- [性能优化与基线记录](docs/performance-optimization-2026-08.md)
- [需求文档](docs/requirements.md)
- [操作手册](docs/user-guide.md)
- [电商订单导入·进度备忘](docs/order-import-progress.md)
