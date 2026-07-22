# 交接说明 · 发行系统（FirstTry）

> 定稿：2026-07-22 ｜ 交接自 Claude Code → codex
> 本文件是接手入口，给出「现状 / 待办 / 约定」三件事。功能细节以 `requirements.md`（业务）、`technical.md`（技术）、`user-guide.md`（操作）为准，本文件不重复。

---

## 1. 一句话现状

系统已上生产（腾讯云 MySQL 库 `zgjyb`），核心闭环全部跑通。邮局管理已完成 7→3 信息架构重构。唯一挂起的功能是 **PR-E（邮局工单物理合表）**，见 §3。

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

## 3. 唯一未完成项：PR-E（邮局工单物理合表）📌 头号 backlog

**背景**：邮局管理已从 7 个二级菜单收敛为 3 个（投递名册 / 邮局订报生成 / 客服工单），重构的 PR-A/B/C（收款迁财务 #76 / 删月度快照 #77 / 合并客服工单 #78）与本轮文档收尾均已合并 main。

**PR-E 尚未实施**：投诉 / 改地址 / 回访目前仍是**三张独立表**（`PostalComplaint` / `PostalAddressChange` / `PostalFollowUp`），只在 API/前端层由 `GET /api/postal/tickets`（服务 `app/services/postal_ticket_service.py`，内存聚合分页）**呈现为「一个工单」**。

**PR-E 目标**：物理合表——设计通用 `PostalTicket` 基表（公共字段 类型/收报人/编号/状态/关联对象/时间线 + 类型专属字段），迁移三表数据、时间线归一，前端切到统一接口、下线三表读写。详细方案见 `docs/postal-restructure-plan.md` §5(PR-E) 与 §6.2。计划注明「视生产验证后再定」——接手前建议先确认生产上聚合接口表现无碍，再决定是否投入合表。

---

## 4. 开发约定（务必遵守）

1. **禁止直推 main**。main 受保护：必须开 PR、CI 全绿、`enforce_admins` 亦生效。CI 配置见 `.github/workflows/ci.yml`：后端 job 跑 `python -m pytest -q`（SQLite 内存库），前端 job 跑 `npx tsc -b`（仅类型检查）。改动务必本地先过这两项。
2. **迁移**：新增表用 Alembic；**downgrade 删表只用 `drop_table`，不要先 `drop_index`**（FK 依赖会报错，踩过两次）。
3. **PII 红线**：生产订单/收报人数据含真实个人信息。临时导出（如删单备份 `test-orders-backup.json`）已被 `.gitignore` 排除，**绝不入库**；`backend/uploads/` 同理。
4. **PR 方式**：本机无 `gh` CLI。开 PR 走 GitHub REST API（`https://api.github.com/repos/DawnAce/FirstTry/pulls`），PAT 从 `git credential fill` 取；CJK 标题/正文经环境变量传入纯 ASCII 的 node 脚本，避免 Git Bash 的 JSON 转义报错。
5. **中文**：仓库文档、PR、提交信息均用中文。

---

## 5. 分支现状

- `main`：生产主干，受保护。
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
