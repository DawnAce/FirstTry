# 中国经营报 · 印数管理系统

每周五生成下周一出版的《中国经营报》印数管理表和中通快递发货明细的 Web 应用，并支持管理员上传年度刊期 PDF，预览校验后更新系统刊期表。

当前主链已经收敛为：

- 报数编辑页中的 **中通物流公司合计**
- 收件人管理中的 **中通发货明细（`shipping_details`）**
- 报数/发货/打包导出时生成的 **审计快照**

旧的 `/shipping/:issueId` 入口已重定向到当前的「收件人管理 → 中通发货明细」执行面。

## 技术栈
- **后端**: Python / FastAPI / SQLAlchemy / JWT 认证 / openpyxl / pypdf / cpca（地址解析）
- **前端**: React / TypeScript / Vite / Ant Design / TanStack Query
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
访问 `http://localhost:5173`，使用默认管理员账户登录：
- **用户名**：`admin`
- **密码**：`admin123`

### 6. 初始化数据
管理员登录后调用种子数据接口：
```powershell
$token = (Invoke-RestMethod -Method Post http://localhost:8000/api/auth/login -ContentType "application/json" -Body (@{username="admin";password="admin123"} | ConvertTo-Json)).access_token
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

### 8. 生产部署
```bash
cd frontend && npm run build
cd ../backend && uvicorn app.main:app --port 8000
```
访问 `http://localhost:8000`

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
