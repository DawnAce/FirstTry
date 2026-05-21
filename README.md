# 中国经营报 · 印数报数系统

每周五生成下周一出版的《中国经营报》印数报数表和中通快递发货明细的 Web 应用。

当前主链已经收敛为：

- 报数编辑页中的 **中通物流公司合计**
- 收件人管理中的 **中通发货明细（`shipping_details`）**
- 报数/发货/打包导出时生成的 **审计快照**

旧的 `/shipping/:issueId` 入口已重定向到当前的「收件人管理 → 中通发货明细」执行面。

## 技术栈
- **后端**: Python / FastAPI / SQLAlchemy / JWT 认证 / openpyxl / cpca（地址解析）
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

### 一键启动（推荐）

| 系统 | 命令 |
|------|------|
| Windows PowerShell | `.\dev.ps1` |
| Windows CMD | `dev.bat` |
| macOS / Linux | `./dev.sh` |

### 7. 生产部署
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

> **限制**：报数文件需使用系统模板或可识别的原始报数表；原始报数表如存在未处理临时加印、总印数不一致或未命中映射项，会在预览阶段阻断；中通发货文件支持系统单表模板和原始多工作表格式；两份文件必须属于同一期且目标期号不能已存在；导入成功后沿用现有确认、发货、导出流程。

## 文档
- [技术文档](docs/technical.md)
- [需求文档](docs/requirements.md)
- [操作手册](docs/user-guide.md)
