# 交接说明 · 发行系统（FirstTry）

> 定稿：2026-07-23 ｜ 交接自 Claude Code → codex
> 本文件是接手入口，给出「现状 / 待办 / 约定」三件事。功能细节以 `requirements.md`（业务）、`technical.md`（技术）、`user-guide.md`（操作）为准，本文件不重复。

---

## 1. 一句话现状

系统已上生产（腾讯云 MySQL 库 `zgjyb`），核心闭环全部跑通。邮局管理已完成 7→3 信息架构重构；**PR-E（邮局工单物理合表）已通过 PR #80 于 2026-07-23 合并 `main`**，当前无挂起的邮局重构功能。

---

## 2. 技术栈与本地起服务

| 层 | 技术 |
|---|---|
| 后端 | FastAPI + SQLAlchemy + Alembic（MySQL；测试用 SQLite 内存库） |
| 前端 | React + TypeScript + Vite + Ant Design（Vitest 单测 + Storybook） |

目录：`backend/`（`app/` 业务 + `alembic/` 迁移 + `tests/`）、`frontend/`（`src/pages` 页面、`src/api` 接口封装）、`docs/`（全部设计文档）。

本地跑测试（等同 CI）：
- 后端：`cd backend && python -m pytest -q`（`app.config.Settings` 需要 `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE` 环境变量才能导入，给假值即可；测试用 SQLite 内存库、不真连 MySQL）
- 前端类型检查：`cd frontend && npx tsc -b`
- 前端单测：`cd frontend && npm run test`（`npm run test:stories` 跑 Storybook 用例）

---

## 3. PR-E 已完成：邮局工单物理合表

投诉 / 改地址 / 回访已统一落到 `postal_tickets`（模型 `PostalTicket` 单表继承），处理记录与关联回访统一落到 `postal_ticket_events`。迁移 `d4e6f8a0b2c4` 负责三表数据复制、投诉处理时间线迁移、关联回访并入投诉时间线及可逆降级。

前端读写、详情、处理、应用地址和导入均切到 `/api/postal/tickets*`；`GET /api/postal/tickets` 已改为数据库筛选、排序和分页，不再内存聚合。旧类型路径暂留后端兼容，实际也只读写统一表。

**发布边界**：PR #80 合并只代表代码进入主干；本次未连接或修改生产数据库，也未执行生产 Alembic 迁移。部署前须先备份，再核对三类旧工单及处理记录的迁移前后数量，随后执行 `d4e6f8a0b2c4`。本地后端全量测试为 526 passed，GitHub CI 的后端 pytest 与前端 TypeScript 检查均通过；本机 Vitest 在初始化阶段无输出挂起，尚需在另一环境复跑。

---

## 4. 开发约定（务必遵守）

1. **禁止直推 main**。main 受保护：必须开 PR、CI 全绿、`enforce_admins` 亦生效。CI 配置见 `.github/workflows/ci.yml`：后端 job 跑 `python -m pytest -q`（SQLite 内存库），前端 job 跑 `npx tsc -b`（仅类型检查）。改动务必本地先过这两项。
2. **迁移**：新增表用 Alembic；**downgrade 删表只用 `drop_table`，不要先 `drop_index`**（FK 依赖会报错，踩过两次）。
3. **PII 红线**：生产订单/收报人数据含真实个人信息。临时导出（如删单备份 `test-orders-backup.json`）已被 `.gitignore` 排除，**绝不入库**；`backend/uploads/` 同理。
4. **PR 方式**：本机无 `gh` CLI。开 PR 走 GitHub REST API（`https://api.github.com/repos/DawnAce/FirstTry/pulls`），PAT 从 `git credential fill` 取；CJK 标题/正文经环境变量传入纯 ASCII 的 node 脚本，避免 Git Bash 的 JSON 转义报错。
5. **中文**：仓库文档、PR、提交信息均用中文。

---

## 5. 分支现状

- `main`：生产主干，受保护；已包含 PR #80（邮局工单物理合表）。
- `staging`（若存在于远程）：部署环境分支，落后 main、无独有提交，**别动**（可能挂 CD）。
- 邮局重构的功能分支（`feat/postal-*`）合并后已清理。

---

## 6. 文档地图

| 文档 | 内容 |
|---|---|
| `requirements.md` | 业务需求 / 各模块功能定义（§10 有已实现清单、§5C 邮局管理） |
| `technical.md` | 技术架构 / 目录 / 各模块实现（§3.17 邮局管理） |
| `user-guide.md` | 面向使用者的操作说明 |
| `postal-restructure-plan.md` | 邮局 7→3 重构完整方案（PR-E 方案在此） |
| `postal-restructure-mockup.html` | 邮局重构可交互视觉稿（本地起服务预览） |
| `manual-test-plan.md` | 人工测试清单（自动化测不到、必须人工跑的用例，标 P0/P1/P2） |
