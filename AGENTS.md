# AGENTS.md

本文件是 Codex 在本仓库中的项目级工作规则，适用于仓库根目录及全部子目录。若子目录以后增加 `AGENTS.override.md` 或 `AGENTS.md`，以更靠近目标文件的规则为准。

## 项目定位

这是《中国经营报》发行系统（印数管理系统）。系统负责刊期、报数、邮局业务、中通发货、订单、订阅、财务及相关 Excel/PDF 导入导出，并保留必要的校验与审计记录。

技术栈：

- 后端：Python、FastAPI、SQLAlchemy、Alembic，位于 `backend/`。
- 前端：React、TypeScript、Vite、Ant Design、TanStack Query，位于 `frontend/`。
- 数据库：MySQL；自动化测试主要使用 SQLite 内存库，CI 另用空 MySQL 验证完整迁移链。
- 文件处理：openpyxl、pypdf、pypdfium2、RapidOCR、Pillow。

## 开始工作前

1. 先执行 `git status --short`，保留用户已有修改，不覆盖、不清理无关文件。
2. 阅读与任务直接相关的代码和文档；不要仅凭旧截图、旧计划或单个接口推断当前行为。
3. 功能现状优先参考 `README.md`，业务定义参考 `docs/requirements.md`，技术实现参考 `docs/technical.md`，用户流程参考 `docs/user-guide.md`。
4. 涉及订单导入时同时查看 `docs/order-import-progress.md`；涉及性能时查看 `docs/performance-optimization-2026-08.md`；涉及人工验收时查看 `docs/manual-test-plan.md`。
5. 先定位根因和影响范围，再做最小且完整的修改。避免顺手重构无关代码。

## 核心业务不变量

- `publication_schedule` 是刊期计算的正式来源。不得静默删除已创建期数对应的刊期，也不得无保护地修改其出版日期。
- 报数中的“中通物流公司”合计、`shipping_details` 单期发货明细以及相关导出必须保持可核对的一致性。
- 原始报数文件和 OCR 结果属于录入建议与审计凭证；存在“待核对”或“渠道待确认”时，不得绕过人工确认直接完成报数确认。
- 成都跨月补发的结算数量、补发执行和已出刊印数彼此独立；补发不得回写已经出刊的印数。
- 订单主链为“订单 → 明细 → 履约分配/目标 → 发货明细”。修改状态、履约或同步逻辑时必须保留版本关系、来源字段和审计事件。
- 导入类功能遵循“上传/解析 → 预览校验 → 人工确认 → 正式写入”。解析不确定、期号冲突或数量不一致时应阻断并给出可操作提示，不能静默猜测。
- 删除、替换、批量同步和状态流转必须遵守现有权限、幂等、冲突检测及审计约束。
- Excel 导入导出是模板驱动流程。修改模板、列顺序、工作表名、数字格式或公式前，先检查现有解析器、导出器和回归测试。

## 后端约定

- `backend/app/api/` 负责 HTTP 参数、鉴权、响应模型和状态码；业务规则优先放入 `backend/app/services/`。
- `backend/app/schemas/` 保存 API 输入输出类型；`backend/app/models/` 保存 SQLAlchemy 模型。接口、schema、模型和前端类型要同步演进。
- Python 新代码使用类型标注，并沿用相邻模块的命名、事务和异常处理方式。
- 写操作要明确事务边界。多表更新必须保持原子性；失败时不得留下半完成状态。
- 涉及订单、报数、发货、邮局工单或财务状态的写操作，检查是否需要写入现有审计日志/事件表。
- 列表和总览接口优先在数据库侧筛选、聚合和分页；避免 N+1 查询、无界全表加载和为展示少量统计而拉取完整明细。
- 修改接口行为时同步更新 response model、API docstring、相关 service 和测试，不随意破坏已有返回结构。

## 数据库与迁移

- 所有 schema 变更必须新增 Alembic migration；不得只改 ORM 模型，也不得直接手工修改生产库来代替迁移。
- 新迁移应同时验证 upgrade 路径以及合理可行的 downgrade 路径，并保持 `backend/app/models/` 与迁移后的 schema 一致。
- MySQL downgrade 删除表时直接使用 `drop_table`，不要先手动 `drop_index`；外键依赖曾因此导致降级失败。
- 涉及迁移时至少运行相关迁移测试；交付前应尽量像 CI 一样在空 MySQL 上执行完整 `python -m alembic upgrade head`。
- 未经用户明确授权，不连接、写入、迁移、清理或修复生产数据库。

## 前端约定

- TypeScript 开启了 `verbatimModuleSyntax`；纯类型导入使用 `import type`。
- API 调用集中放在 `frontend/src/api/`，页面和组件不要各自复制请求与类型定义。
- 服务端数据使用 TanStack Query，并采用稳定、可复用的 query key。所有 create/update/delete/apply 类 mutation 成功后，必须失效所有受影响的查询缓存。
- 遵循当前 Ant Design API：`Form.Item.name`、`Modal/Drawer.open`、`Table.dataSource`、`Popconfirm.onConfirm`，菜单使用 `items`。
- 复用 `frontend/src/index.css` 中的主题变量和现有 UI primitives，避免硬编码重复的颜色、圆角、阴影与间距。
- 新 UI 同时检查亮/暗主题、舒适/紧凑密度、加载/空/错误/禁用状态、键盘操作和基本可访问性。
- 路由在 `frontend/src/App.tsx`，布局在 `frontend/src/components/AppLayout.tsx`；新增页面时同时检查权限、导航入口和懒加载边界。

## 数据与安全

- `.env`、密码、JWT 密钥、PAT、数据库连接信息不得提交、复制到文档、测试夹具、日志或回复中。
- 订单、收报人、电话、地址、身份证明、上传附件和导出文件可能包含真实个人信息。不得把真实数据写入测试、截图、日志或 Git。
- `backend/uploads/`、`backups/`、临时导出和删除前备份不得入库；测试使用合成数据并做必要脱敏。
- 不在终端输出完整凭据或真实业务数据。排错只展示解决问题所需的最小字段。
- 任何不可逆删除、批量覆盖、生产数据修复或外部发布操作都需要用户明确确认。

## 常用命令

首次安装：

```bash
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements-dev.txt
cd ../frontend && npm ci
```

本地启动：

```bash
./dev.sh
# 或分别启动
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000
cd frontend && npm run dev
```

后端检查：

```bash
cd backend
python -m pytest -q tests/test_orders_api.py  # 示例：替换为受影响模块的测试文件
python -m pytest -q
python -m alembic upgrade head
```

前端检查：

```bash
cd frontend
npm run lint
npm test
npm run build
```

Storybook/UI 相关修改按需追加：

```bash
cd frontend
npm run test:stories
npm run build-storybook
```

## 测试与验收

- 修复缺陷时先补能复现问题的回归测试；功能变更覆盖正常路径、边界条件和失败路径。
- 后端小改先跑对应测试文件；影响共享模型、迁移、订单/发货/报数主链时跑后端全量测试。
- 前端改动至少跑受影响单测和 `npm run build`；交付前尽量完成 CI 同款的 `npm run lint && npm test && npm run build`。
- UI 变化除自动化检查外，还要人工核对关键页面状态；高风险业务流程参考 `docs/manual-test-plan.md`。
- Excel/PDF/OCR 变更必须用最小脱敏样例验证解析、预览、确认和导出结果，不能只验证函数无异常。
- 若因环境或外部依赖无法运行某项检查，交付时明确写出未执行项、原因和风险，不得声称已经通过。

## 文档同步

- 安装、启动、部署或总体架构变化：更新 `README.md`。
- API、数据库 schema、模块边界或技术方案变化：更新 `docs/technical.md`。
- 功能范围、业务规则或验收标准变化：更新 `docs/requirements.md`。
- 用户可见流程、界面或操作步骤变化：更新 `docs/user-guide.md`。
- 不为纯重构或无用户影响的内部修改制造无意义文档改动，但必须确保现有文档不再误导。

## Git 与交付

- `main` 是受保护的生产主干。不得直接向 `main` 提交或推送；需要提交时先使用独立分支并通过 PR。
- 不改动或清理用户的无关未提交文件；不使用破坏性 Git 命令。
- 仓库文档、提交信息和 PR 默认使用中文，代码标识符沿用现有英文风格。
- 不自行提交、推送、创建 PR、部署或发布，除非用户明确要求。
- 交付说明应列出：修改内容、关键影响、实际运行的检查及结果、尚未验证的事项。
