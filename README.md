# 中国经营报 · 印数报数系统

每周五生成下周一出版的《中国经营报》印数报数表和中通快递发货明细的 Web 应用。

## 技术栈
- **后端**: Python / FastAPI / SQLAlchemy / openpyxl / cpca（地址解析）
- **前端**: React / TypeScript / Vite / Ant Design
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
```bash
curl -X POST http://localhost:8000/api/admin/seed
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

## 文档
- [技术文档](docs/technical.md)
- [需求文档](docs/requirements.md)
- [操作手册](docs/user-guide.md)
