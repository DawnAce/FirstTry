# 电商订单导入 — 项目进度备忘

> 最后更新：2026-06-27。围绕「把 CBJ 小程序 / 淘宝 等电商订单导入订单管理系统 + 下游统计」这条线。
> **状态：CBJ + 淘宝 端到端完成、已合并 main、已部署生产；商品库已规范化（三段式命名 + 结构化 code，生产 13 个稳定品）；新增「商学院按期发行量（单期 + 订阅）」并部署。2026-06-27 修了订单管理 5 个正确性 bug（见「正确性修复」节）+ 建了「退款闭环」（见同名节）+「按期批量排发」（见同名节）+「已发货回写 + 对账」（见同名节）+「收款 / 欠款追踪」（见同名节）+「列表增强：搜索/排序/批量/导出」（见同名节）+「端点权限 F」（见同名节）。后端 391 测试全绿、前端 `tsc -b && vite build` 通过。**

## 目标
把电商平台（首个：CBJ 小程序）的订单尽量自动、完整地导入：商品自动识别、状态/金额/收件人落库，支持近期单（要安排投递）和历史单（只补记录）两种模式。

## 已完成（全部已合并进 main）
| 阶段 | 内容 | 生产库 |
|---|---|---|
| 枚举修复 | 补 `ordereventtype` 遗漏的 `item_*`（修 V1.2 在严格模式 MySQL 上的潜在崩溃）| ✅ 已应用 |
| PR-B | 订单 `source_type` → `entry_method`（manual/excel_import/api_sync）| ✅ 已应用 |
| Phase 2 | 导入建单入口 `create_imported_order`；`order_code` 发号并发加固（MAX+1 + 批量块分配）| —（无迁移）|
| Phase 2.5 | **商品库** `products` 表 + 管理 CRUD API + seed（CBJ/商学院 商品，现 9 个）| ✅ 已建表 |
| 3a | **商品解析器** `resolve_product`：商品名→明细，套餐拆分，未识别进待确认 | —（无迁移）|
| 3b-1 | **商业状态** `commercial_status` + 原始串存档 + 历史归档标记 + 状态映射 | ✅ 已加列 |
| 3b-2 | **CBJ Excel 解析器**：多行产品拆分、X0 丢弃、运费/转中通、地址拆分 | —（无迁移）|
| 3b-3 | **导入大脑 + preview/commit API**：上传→预览→确认→批量建单 | —（无迁移）|
| 3c | **前端**：商品库管理页 `/products` + 电商导入页 `/orders/import`（两种模式）+ 修好前端 `tsc -b` 构建门（含一个会让订单编辑页崩的真 bug）| —（前端）|
| 3d（PR #24）| **导入内快速新增商品**：预览页「待确认商品汇总」（按商品名聚合 + 计数）+ 一键加入商品库（预填名称 + 智能默认）+ 保存后自动重新预览；点行→抽屉看详情。商品表单抽成共享组件 `ProductForm`。| —（前端）|
| 3d（PR #24）| **活动标签 + 赠品**：导入批次可设「活动标签 / 订期延长月 / 赠送刊物」→ 写到每张订单（`campaign` 列）+ 按活动统计；赠品作为一条免费明细记录（可追溯）；订阅覆盖期按延长月顺延。| ✅ 已加列 `f3b5d7c9e1a2` |
| 4a | **期次标识 `issue_label`**：`order_items.issue_label` 归一「无期号刊物」的单期身份 `YYYY-MM` / `YYYY-MM~MM`（主用商学院月刊）——年/月落在期次层（此列），**不写进商品名**；中国经营报单期仍用 `issue_number`（期号）。归一函数 `app/services/issue_label.py::normalize_business_school_issue_label()`。| ✅ 已加列 `b8e3a1c5d7f0`（`String(32)`，带索引）|
| 4b | **商学院月刊导入自动识别**（替代旧「人工把月刊快速新增为商品」思路）：导入时标题形如「2026年X月刊《…》」/「2026年2~3月合刊《…》」的未匹配行 → 自动识别为 **商学院·单期**（`publication=business_school`、`single_issue`、写 `issue_label`），**不**建年份名商品、**不**进待确认。守卫：须有「月刊/合刊」标记且标题**不含**「中国经营报」（带日期的中国经营报行仍排队待确认），真正未知品（如「2026年1月新春礼包」）仍 → 待确认；该单期 `delivery_method` 留空（不被订单级转中通覆盖盖戳）。| —（无迁移）|
| 4c | **原价落库 `original_amount`**：`orders.original_amount` 持久化 CBJ 导出「原价（折前标价）」列（旧版解析后丢弃，只写 `total_amount=实付`）；`total_amount` 仍跟实付。支撑「按活动统计」折扣列：原价合计 `= SUM(COALESCE(original_amount, paid))`，折扣额 `= 原价合计 − 实收`（无原价的单按无折扣计）。| ✅ 已加列 `c4f1a9e2b6d3`（`Numeric(10,2)`，可空）|
| 4d | **活动订单统计**（新模块）：前端「订单管理 → 活动订单统计」页（路由 `/analytics`，`frontend/src/pages/Analytics.tsx`），两张表均按**下单日期**区间筛、均**只计有效单**（草稿/待确认/作废不计）：①**按活动统计**（活动/订单数/原价合计/实收金额/折扣 省¥X 及百分比，仅含带活动标签的单）；②**按期统计**（刊物/期次 `issue_label`/销量份/销售额/行数，仅含带 `issue_label` 的单期行，主为商学院月刊）。后端（需鉴权）：`GET /api/analytics/campaigns?date_from&date_to`、`GET /api/analytics/issues?publication&date_from&date_to`。文件：`app/api/analytics.py`、`app/services/order_analytics_service.py`、`app/schemas/analytics.py`。| —（前端 + 后端）|
| 4e | **商品库 seed 调整**（`app/seeds/products.py`）：新增「《中国经营报》全年订阅（中通 月送）」`CBJ-SUB-1Y-ZTO-M` ¥240（区别于「中通 周送」¥390，频次落名/价而非 `DeliveryMethod` 枚举）；促销品改名为活动中性的「《中国经营报》全年订阅（促销价）」，「618促销活动 / 双十一订阅优惠 / 旧全名」保留为别名（具体活动 618/双十一/年份归 `order.campaign`、可聚合，不进品名）。| —（seed）|
| 4f | **页面内业务规则提示**：共享可折叠面板 `<EcommerceRules>`（`frontend/src/pages/ecommerceRules.tsx`，单一出处）→ 同时挂在**电商导入页** `/orders/import` 与**订单列表** `/orders`，统一展示电商业务规则（商品识别·定价 / 覆盖期 / 投递·运费 / 状态导入策略 / 去重 / **历史归档单**：不自动同步、需「补覆盖期 + 手动触发同步（仅中通）」才发货 / 活动标签·赠品 / 活动订单统计口径）。默认收起，改一处两页同步。| —（前端）|
| 4g | **「最新一期」自动判期号**：导入时 `最新一期`（`coverage_rule=latest_issue`）单期行按"付款时间 + 刊期表 + **周五约 22 点翻期**"自动判 `issue_number`（中国经营报周一出刊；某期在其出刊周一前的周五 22:00 起售）。`app/services/latest_issue_resolver.py`，翻期参数（周五/22点/±4h）可配。翻期点 **±4h 内的临界单标黄待核**（仍自动判 + 正常导入，只是提示核对）。预览里单期行显示「第 XXXX 期」。无迁移。| —（前后端）|
| 4h | **往期零售期号人工补 + 提醒**：往期单的具体期号靠客服按单告知、不在订单数据里 → 导入留空 `issue_number` 并**标黄「请补该单实际期号（客服确认）」**（条件：`coverage_rule=custom` 的单期、且无期号无期次标签，故不会误伤商学院月刊）。`guessDefaults` 也已识别"往期/零售"→ 单期 + 自定义。期号在订单「编辑 → 单期期号」补（单期必填）。无迁移。| —（前后端）|

**后端 306 测试、前端 80 测试全绿；`tsc -b` / `npm run build` 通过；真实 CBJ 文件（100 单）预览验证通过。**

## 试导验证（2026-06-21 真实文件干跑预览）
拿一份真实 CBJ 导出（100 单）做了**非破坏性 preview 干跑**（只预览、不 commit、用一次性内存库），上生产前验证：
- **结果**：补全商品库前 60 导入 / 40 待确认 → 补全后 **94 导入 / 6 待确认**（0 跳过；干跑用空库故 0 重复，真导会按 `external_order_no` 与库内老单去重，实际导入数更少）。
- **抓到并修了一个真 bug**：纯「《商学院》全年订阅」被双刊套餐名子串误匹配、`decision=导入` 且无告警地拆成「中国经营报 ¥240 + 商学院 ¥240」（影响 2 单，各 ¥480）。修法：套餐只走精确名/别名匹配——`product_resolver_service.match_product` 把 `is_bundle` 排除出最后的子串兜底档；并 seed 一个独立「《商学院》全年订阅」商品。危害是**无声导入错数据**，不是导不进。
- **补齐标准商品**：全年/半年 × 邮局/中通订阅、单期·往期零售（投递按品名定）。商品库 seed 由 3 → **9** 条。
- **仍需人工的 6 单**（设计如此，非缺陷）：
  - 4 单**商学院月刊单期**（"2026年X月刊《…》"，标题每月变、名里无"商学院"，无稳定商品库键）→ **现已导入时自动识别**为商学院·单期（写 `issue_label`、不进固定商品库、不进待确认；见「已完成」4b），不再需人工快速新增。
  - 2 单**纯运费补拍**（唯一行是"运费补拍邮局转中通"、无可订商品）→ 人工并入对应订阅单、投递改中通。

## 已确定的业务规则
- **商品库**：电商商品名 → 履约属性（一行一商品）。别名归一活动后缀。
- **定价**：一律记**实付金额**（不套套餐价）。如「最新一期」零售 ¥5 + 运费 ¥5 = ¥10，开票按 ¥10 整体开，系统记 ¥10。商学院单本 ¥40 免运费 → CBJ 满 ¥40 不再显示运费（平台展示逻辑）。
- **套餐拆分**：中国经营报固定 ¥240，商学院拿余额（¥576→240+336，¥612→240+372）。
- **覆盖期（起投）**：人为按批设定，不是写死的 15 号。每批设：邮局/中通起投月 + 截止日（晚于截止→下月起投）；中通各批手设；可按月或按期号；**每单可改**。
- **运费补拍/转中通**：运费行金额并入订单总额（不建明细）；含「转中通」→ 投递自动改中通（高亮待核，漏检后果严重）。
- **运费识别**：产品名含「运费」**或「快递费用」**→ 识别为运费行（不当商品）；整单只有运费 → 待确认「无可识别商品行」，人工并入对应订阅单、投递改中通。
- **忽略名单**（`cbj_order_import_service._IGNORED_PRODUCT_KEYWORDS`）：长尾特殊品（家族企业/深潜/深度系列/电子刊/对公专用/一次性广告语单）**不进商品库、不导入、不进待确认**——导入时直接**跳过**；多商品单里忽略行被丢弃、其余照常导入。增删关键词改该常量即可。
- **订单状态**：建系统自己的干净枚举（待付款/已付款/已发货/已退款/部分退款/已取消，已发货含已完成）；CBJ 原始串存档参考。导入策略：已付款/已发货收；待付款/已取消跳过；退款收但标记；未识别状态默认已付款+标黄。可在预览前/导入后人为改。
- **历史归档模式**：保留下单日期，订期可补填可留空（不自动估算），打归档标记、**默认不自动同步**（不被硬拦，补齐后可手动同步）、列表可单独筛。
- **去重**：按 `external_order_no`；重复跳过。
- **活动 + 赠品（不按年拆商品库）**：每年 618 等活动的「价格差异」走实付、「基础履约」（618=全年/邮局）稳定 → 商品库一行兜住、不按年拆。每批导入设**活动标签**（如 `2026-618`，写到订单 `campaign`，供追溯 + 按活动统计）。活动赠品（CBJ 导出里没有，人为约定）落在订单上：**订期延长 N 月**顺延订阅覆盖期；**赠送刊物**记为一条免费明细（`gift`/`free_gift`，收件人同主单，可追溯）。赠品只给本批「含订阅」的单，单期不送。促销/活动归名：具体活动（618/双十一/年份）归 `order.campaign`（带年份、可聚合），**不进商品名**——商品库促销品用活动中性名 + 别名。
- **原价 vs 实付**：`orders.original_amount` 记 CBJ「原价（折前标价）」、`total_amount` 仍记实付；二者之差即折扣，供「按活动统计」算省额（无原价的单按无折扣计）。
- **期次标识**：无期号刊物（主用商学院月刊）的单期身份归一到 `order_items.issue_label`（`YYYY-MM` / `YYYY-MM~MM`），**不写进商品名**；中国经营报单期仍用 `issue_number`（期号）。
- **活动订单统计口径**：只计**有效单**（已确认/已导入）；草稿/待确认/作废不计。

## 部署到生产（让它真用上，3 步）
1. **后端**：代码已全部在 main（含导入增强 + 活动订单统计）。⚠️ **本次新增两条迁移 `b8e3a1c5d7f0`（`issue_label`）、`c4f1a9e2b6d3`（`original_amount`）尚未在生产应用——部署时须先 `alembic upgrade head` 再重启**（`start.sh`/`start.ps1` 已内置该步，见 README §8）；此前的 `f3b5d7c9e1a2`（`campaign`）等已应用。
2. **前端**：`cd frontend && npm run build` 出 `dist/` → 部署（`tsc -b` 现已能通过）。
3. **seed 商品库**：新装环境调一次 `POST /api/admin/seed` 即加好那批 CBJ/商学院 商品（现 **10** 个）。⚠️ **生产商品库已非空时 seed 不补新商品**（幂等只对空库生效）——需在 `/products` 页手动加齐尚缺的商品（含本次新增的「中通 月送」`CBJ-SUB-1Y-ZTO-M`），或导入时用「待确认一键快速新增」补。匹配器 bug 修复随发布即生效、无需数据操作。

之后：**订单管理 → 商品库 / 电商导入**，传 Excel → 预览 → 确认导入。

## 淘宝平台导入（已完成 · 已合并 main + 已部署生产，PR #25）
> 2026-06-25 完成，2026-06-26 合并 + 部署。把淘宝订单融进同一套订单管理（同表 / 同列表 / 同统计 / 同发货同步）。

**设计**：整条下游（商品解析 / 状态映射 / 去重 / 覆盖期 / 履约目标 / 单订单中通同步 / 统计）本就平台中立、原样复用；新增的只有「淘宝 Excel 解析器」一层。上传按表头**自动识别平台**（淘宝=订单编号+商品标题；CBJ=订单号+产品名称），订单写 `source_platform=淘宝` / `source_store=中国经营报发行部`。

**做了什么**
- `taobao_order_import_parser.py`：21 列→统一 `ParsedOrder`。投递/期次从 SKU「分册名」解析（全年-邮局-周投→邮局；全年-快递-月寄→中通；2026年5月刊→商学院期次）；实付=买家实付金额（含邮费），原价=总金额+邮费；收件人脱敏→留空。
- 分流：`cbj_order_import_service._detect_and_parse`（`is_taobao_export`/`is_cbj_export` 二选一，都不匹配报清晰错误）；`build_import_preview` 加 `source_platform/source_store` 参数（默认仍 CBJ，兼容旧调用）。
- 商品库：6 条淘宝别名（按 SKU 子串区分邮局/中通：全年-邮局 / 全年-快递-月寄 / 半年-邮局 …）+ 2 个新商品（商学院全年/季度·中通一期一发，custom 覆盖期）。生产用 `seeds.products.sync_catalog`（幂等 upsert：补别名 + 插新品，已挂到 `POST /api/admin/seed`，可重复跑）。
- 缺口补：淘宝多商品单里的商学院单期（导出无分册名→无月份）→ 仍按商学院单期落库、期次留空 + 标黄「请补期次」（守卫 `【YYYY单期】`+`商学院`+非中国经营报，不误伤 CBJ）。
- 前端：导入页文案去 CBJ 化（自动识别平台）；订单列表加「平台」筛选；规则面板加「淘宝平台」小节。
- 测试：解析器单测 + 端到端 + sync_catalog（+14 条），后端 **334 全绿**；`tsc -b` / `npm run build` 通过。

**脱敏工作流（与用户确认）**：淘宝导出收件人脱敏（只省市区+街道，无姓名/电话/详细地址、无独立收货人列）→ 导入只落记录、收件人留空；订阅单要发货则在订单详情**逐单补收件人 + 核实订期**，再手动触发中通同步（同历史归档：默认不自动同步、补齐后不被硬拦）。零售单已在淘宝自发货、只做记录/统计。

**真实文件干跑**：43 单 → **36 导入 / 6 跳过（交易关闭）/ 1 待确认**（唯一残留=一张多商品混合订阅单，无逐行信息，需人工）。投递（邮局/中通）、商学院期次、往期标黄、状态映射均验证正确。

## 商品库规范化（已合并 main + 已部署，PR #25 / #26）
> 2026-06-25/26。把商品库命名统一、并与「导入匹配」**解耦**，以后加品/改名不乱、不破识别。

- **三段式 `display_name`**「刊物 · 套餐 · 投递频次」（如 `中国经营报 · 全年订阅 · 邮局周投`）+ **结构化 `code`**（`CBJ-1Y-POST-WK` / `BS-1Y-ZTO` / `BUNDLE-CBJ-BS-1Y`）。
- **名称 ↔ 匹配解耦**：电商导出的原始名 / SKU 片段全部进 `aliases`，导入靠**别名**匹配 → **改 `display_name` 不影响识别**；`code` 不参与匹配。促销用**完整活动串**别名（裸「618」会让中国经营报/商学院互相误命中）。
- **生产库 13 个稳定品**：中国经营报 全年/半年 × 邮局/中通（+ 全年中通月送）+ 全年促销 + 单期最新/往期；商学院 全年/半年/季度/全年促销；双刊套餐。**月刊单期、运费补拍不建商品**（自动识别 / 解析器处理）。已验证 13/13 商品名路由正确、淘宝仍 36/0 待确认、CBJ 旧名经别名 10/10。
- ⚠️ **生产商品库是运营手工建的**（`code` 为随机串、与 seed 不一致）→ 改库/加品用「**按 `display_name` 精确匹配的定向脚本**」直接改；**别对生产库跑 by-code 的 `sync_catalog`**（会插重复，已从 `/api/admin/seed` 撤掉自动挂载）。`seeds/products.py` 已镜像这 13 个、`code` 现与 seed 一致。
- 商品库页顶部加了「命名规则」说明（单一出处）。

## 商学院按期发行量（已合并 main + 已部署，PR #27）
> 2026-06-26。回答「某期实际发/印多少本（**含订阅订户**）」——补上商学院月刊维度（中国经营报的按期印数本就是系统核心：印数报表 + 中通发货明细，**不在此列**）。

- **新表 `bs_issues`**（商学院刊期日历，迁移 `a3f1c8e2b5d9`）：`issue_label / year / 起止月`（合刊 2~3 月 = 一期）；seed 2024–2026（源自在售商品截图，11 期/年）。
- **`summarize_bs_circulation`**：订阅按 `[coverage_start, coverage_end]` 落到刊历展开成命中各期 —— **合刊靠 `issue_label` 去重**、每张计 `quantity` 份；缺覆盖期的订阅计入 `unexpanded_subscriptions` 单独提示；卖出过但不在刊历的期仍列出（`in_calendar=false`）。
- **`GET /api/analytics/bs-circulation?year=`**（需鉴权）→ 每期 单期 / 订阅 / 合计。前端「活动订单统计」加「按期发行量」卡片（年份切换）。
- 口径：只计 active 订单；订阅"覆盖到某月即算订该月刊"。测试 4 例（合刊去重 / 覆盖展开 / 空覆盖 / 不在刊历）。
- **报纸侧（顺带确认）**：中国经营报「某期印多少本」= 既有印数报表（人工填）+ 订单订阅按期号展开到中通发货明细 + 一致性对账，**已实现、不重做**。

## CBJ 真实文件验证 + 修复（2024–2026，740 单，PR #29/#30/#31）
> 2026-06-26。拿 2024/25/26 三份真实 CBJ 导出（共 740 单）干跑预览，发现并修了一串问题。

- 🔴 **嗅探 bug（PR #29，已部署）**：部分 CBJ 导出的 worksheet `<dimension>` 写成单列（数据实际跨 A:L），`is_cbj_export`/`is_taobao_export` 用 read_only 信任坏引用 → 只读到 1 列、看不到「产品名称」→ 误判"无法识别格式"、**真实 CBJ 文件 UI 导不进**。改用非 read_only（与解析器一致，按真实单元格重算维度）。加回归测试（造坏 dimension 文件）。
- **促销别名（PR #30）**：补真实促销名 —— 双十一/全年订阅优惠 → `CBJ-1Y-PROMO`；半年订阅优惠（实付 ¥100/120、备注"放邮箱"=邮局）→ `CBJ-6M-POST-WK`；商学院双十一 → `BS-1Y-PROMO`。
- **运费/忽略/套餐（PR #31）**：运费识别扩到「快递费用」+ 忽略名单（见「已确定的业务规则」）；组合订阅优惠 → 套餐别名 `BUNDLE-CBJ-BS-1Y`（=双刊 8 折 ¥576）。
- **结果**：740 单 → **725 导入 / 6 跳过 / 2 重复 / 7 待确认**（待确认全是纯运费单，人工并单）。识别率从「全部失败」（嗅探 bug 时）收敛到接近全收。

## 正确性修复（2026-06-27，订单管理 5 个 bug，单 commit）
> 来自一次订单管理全面审计（详见对话）。这 5 个是「已经在悄悄出错」的正确性/会误发问题，优先于补功能。后端 358 测试全绿、前端构建通过。

1. **退款/取消单仍发货 + 仍计营收** → 修：发货同步 `order_shipping_sync_service._build_candidates` 顶部按 `commercial_status ∈ {refunded, cancelled}` 整单跳过（停发）；统计 `order_analytics_service` 加 `_revenue_eligible()` 过滤，挂到 campaigns / issues / bs-circulation **全部 5 个查询**。手工单 `commercial_status=NULL` 照常计入；`partial_refund` 暂按毛额（净额冲减待退款模块）。
2. **作废订单不清发货明细、仍被中通导出** → 修：`order_service.void_order` 调 `_orphan_order_generated_details` 把该单 `order_generated` 行置 `sync_status=orphaned`（事件 payload 记 `orphaned_shipping_details` 计数）；`excel_service.export_shipping_excel` 改 `outerjoin Order` 排除 orphaned 行 + 任何 link 到 void 订单的行（兜底历史遗留）。
3. **`has_drift` 筛选破坏分页 + total 不符** → 修：`list_orders` 拆两路——无偏差筛走 SQL 分页（`total`=DB count）；有偏差筛取全集 → Python 过滤 → 内存分页（`total`=过滤后条数，每页满）。抽出 `_build_list_row` helper。
4. **下单日期筛选只在当前页客户端过滤** → 修：`list_orders` + `api/orders.py` 加 `order_date_start/end` 服务端参数；前端 `orders.ts` / `OrderList.tsx` 改服务端筛，删掉 `rowMatchesOrderDateRange` / `filteredRows` 客户端过滤。
5. **商学院月刊期数被当周刊高估 ~4.7×、污染 drift** → 修：`compute_expected_issues` 加 `publication` 参数，`business_school` 按 `bs_issues` 刊历数命中期数（全年=11 而非 ~52）；4 个调用点全传 `item.publication`。`publication=None` 仍走周报路径（兼容）。

**新增/改动测试**：新建 `test_order_list_filters.py`（真 SQLite 跑 #3/#4 分页 + 日期筛正确性）；`test_expected_issues_calculator.py` 加商学院期数 6 例；`test_order_shipping_sync_service.py` 加退款/取消跳过 + 作废孤儿/导出排除；`test_campaign_analytics.py` 加退款/取消排除、部分退款仍计；`test_order_service.py` 修正两个旧 has_drift 断言（它们断言的正是被修掉的错误 total）。

**遗留边界**（刻意留给退款模块）：`partial_refund` 仍发货、仍按毛额计；bug #1 只挡「导入即退款」的单（它们从没同步过），「先同步后退款」要等退款域操作落地时一并 orphan 已生成行。

## 退款闭环（2026-06-27，拆 2 个 commit）
> 审计里排第一的高价值缺口。把「退款这件事发生后，状态/停发/营收/审计每层都跟着反应」做成闭环。后端 369 测试全绿、前端构建通过。

**统一模型**：一张 `refunds` 子表，两个范围旋钮覆盖三种部分退款场景——`order_item_id` 空 + `stop_from_issue` 空 = 纯退钱（履约不动）；`order_item_id` 有值 = 退某条明细（那条停发）；`stop_from_issue` 有值 = 订阅从该期起停发。全额退/取消 = 范围都空 + 整单停发。

- **数据层**：`refunds` 表（迁移 `f7a2c4e6b8d0`，当前 head）+ `orders.refunded_amount` 列 + `OrderEventType` 加 `refunded`/`cancelled`（MySQL 枚举 ALTER，与 `test_order_event_enum_migration_consistency` 对齐）。
- **服务层**：`order_service.refund_order(amount, reason?, order_item_id?, stop_from_issue?)` —— 累加 `refunded_amount`、推 `commercial_status`（累计≥实付→`refunded`，否则 `partial_refund`）、按范围 orphan 已生成发货行（**闭合「先同步后退款」**）、超退余额报 422。`cancel_order(reason)` —— 标 `cancelled` + 把未退实付记一笔全额退款（**用户拍板「cancel 顺手全额退」**）+ 整单停发。`_orphan_order_generated_details` 通用化（带 `order_item_id` / `from_issue` 范围）。两者**只改 `commercial_status`，不动 `OrderStatus`**（退款是正常业务，不是录错作废）。
- **接口**：`POST /api/orders/{id}/refund`、`/cancel`，返回带 `commercial_status` / `refunded_amount` / `refunds` 台账的完整订单。
- **统计**：`summarize_campaigns` 实收改 **净额（实付−退款）** + 暴露 `total_refunded`；折扣仍按折前−毛实付。⚠️ **按份数的口径**（按期统计 / 商学院发行量）退款净额**留作后续**（要动覆盖期展开）。
- **前端**：订单详情页加「退款」「取消订单」按钮 + 弹窗（金额/原因/可选明细/可选起停期）+「退款台账」表 + 头部商业状态标签 + 已退金额展示（`OrderDetail.tsx` / `orderUtils.ts` / `api/orders.ts`）。
- **测试 +11**（358→369）：全退/部分退/三场景停发/超退防呆/退款拒作废单/cancel 全额退/cancel 接部分退/cancel 幂等/营收净额/API 往返。

## 按期批量排发（2026-06-27）
> 审计 backlog 第二项（履约闭环）。每期出刊后把几百张订阅单的这一期排进中通发货——原来逐单逐期点、极易漏期。**零迁移、纯复用现有单订单×单期同步包一层。**

- **3 个操作**(`order_shipping_batch_service.py`)：
  - `gap_report(issue_number)` —— 某期「谁该排却没排」**只读报表**：候选单逐单分类为 待排/需更新/冲突/已同步/跳过(带原因)。
  - `apply_all_for_issue(issue_number)` —— 某期**一键排发所有活跃订单**；冲突单(人工改过)只报告、不覆盖、**不中断整批**；每单独立提交；幂等。
  - `apply_all_issues_for_order(order_id)` —— **单订单覆盖期内所有期一次排齐**（仅 `issues` 表已存在的期；推出但无刊期行的计入 `issues_no_calendar`）。补录老订阅单后用。
- **订单集合** = `active` + **非历史归档**(按现有业务规则排除) + 有 active 纸刊明细覆盖该期。已退款/取消单被整单 skip 自然挡掉。
- **接口**：`GET /orders/shipping-sync/issues/{n}/gap-report`、`POST …/apply-all`、`POST /orders/{id}/shipping-sync/apply-all-issues`。
- **前端**：新增「订单管理 → 按期排发」页(`IssueDispatch.tsx`，路由 `/orders/dispatch`)：选期 → 漏期报表(待排/冲突/跳过分区表 + 统计卡) → 一键排发本期 → 结果汇总；订单详情「关联快递明细」Tab 加「同步全部期」按钮。
- **自动化**：用户拍板**先只做手动一键 + 漏期报表，不做调度器**（手动按钮+报表已摁住漏期风险；定时为后续可选）。
- **测试 +12**(369→381)：批量(全排/幂等/历史排除/冲突不中断/休刊/跳过原因聚合)、漏期报表(分类/缺覆盖期/休刊)、本单全部期(∩Issue表/no_calendar)、API 往返(路由不被 /{order_id} 抢占)。

## 已发货回写 + 应发vs实发对账（2026-06-28）
> 审计 backlog 第三项（履约闭环收尾）。A 让订单「排进」中通发货明细,但**排了 ≠ 发了**——中通发完不回流,系统不知道实际发出去没有。B 补"已发"维度 + 应发/已发/缺口对账。整条链:**应订 → 已排(A) → 已发(B) → 缺口对账**。

- **Schema(迁移 `a9c3e5f70b21`)**:`shipping_details` 加 `shipped_quantity`(实发份数,可空) + `tracking_no`(运单号,可空)。「已发」标记 = `shipped_at` 非空(复用现有列,不加状态枚举)。⚠️ **部署需 `alembic upgrade head`**。
- **标已发(人工为主,无中通回执导入)**:
  - `POST /orders/shipping-sync/issues/{n}/ship-all` —— 按期一键标已发(中通发完整期),只标本期已生成且未发的行,实发=计划份数。
  - `POST /shipping-details/{id}/ship` `…/unship` —— 逐行标(可调实发/补运单)/撤销。shipped_at 非 SYNC_FIELD,标已发不会把 order_generated 行置 manually_modified。
- **对账** `reconcile_issue`(`GET /orders/shipping-sync/issues/{n}/reconciliation`):某期 **应发(Σ计划份数)/已发(Σ实发)/缺口** + **未发清单**(已排但未标已发的行,带订单/收件人)。
- **进度** `compute_fulfillment_progress` 加 `shipped_count`(已发行数),订单详情进度卡显示 已发 + 未发缺口。
- **前端**:「按期排发」页加「本期对账」(应发/已发/缺口卡 + 一键标已发 + 未发清单逐行标);订单详情进度卡加 已发/缺口。
- **决策**(用户拍板):已发**人工标记为主**(不做中通回执导入)、v1**只对账报缺口**(不做自动补寄)。
- **测试 +4**(381→385):标已发(一键/部分实发/撤销/幂等)、对账(应发/已发/缺口/未发清单)、进度 shipped_count、API 往返。

## 收款 / 欠款追踪（2026-06-29，财务对账 C1）
> 审计 backlog「财务对账」的核心半:应收→实付→欠款(退款净额那半已在退款闭环做)。`paid_amount` 原来几乎没业务读它,欠款追不动、对公分期没台账。

- **口径**:应收=`total_amount`、实付=`paid_amount`、已退=`refunded_amount`;**欠款 = max(0, 应收−实付)**;净收 = 实付−已退。电商单导入 `total=paid` → 欠款 0;**欠款主要在对公/手工单**。
- **Schema(迁移 `c1d3f5a7b9e2`)**:`payment_collections` 子表(一笔到账一行:金额/方式/到账日/经办人/备注),与退款台账 `refunds` 对称;`OrderEventType` 加 `payment_recorded`。`paid_amount` 仍是冗余合计。⚠️ **部署需 `alembic upgrade head`**。
- **收款**:`record_payment` + `POST /orders/{id}/payments` —— 建流水行 + 累加实付 + 记事件。商业事件、不动 `OrderStatus`;允许超付(不硬拦)。
- **欠款追踪**:`list_orders` 加 `unpaid` 筛选(`paid </>= total`);`OrderListRow`/`OrderOut` 加 `outstanding_amount`;`GET /api/analytics/outstanding` 欠款汇总(应收/实付/欠款逐单 clamp 求和/未付清单数)。
- **前端**:订单列表「未付清」筛选 + 欠款列;订单详情金额区(应收/实付/已退/欠款,已付清提示)+ 收款台账 + 「记一笔收款」弹窗;Analytics 页欠款汇总卡。(OrderEditor 本就有「已付金额」字段,无需补。)
- **决策**(用户拍板):建收款流水子表、这轮只做欠款追踪核心。**月度营收走势/同比、统计 CSV/Excel 导出 留后续**。
- **测试 +2**(385→387):收款累加/台账/欠款/未付清筛选/欠款汇总逐单 clamp(超付不抵销、void/退款排除)、API 往返。

## 列表增强：搜索 / 排序 / 批量 / 导出（2026-06-29，审计 E）
> 运营每天用列表干活的基础能力。零迁移。

- **按单号搜索**:`list_orders?search=` 按 `order_code` / `external_order_no` ilike;前端搜索框。
- **服务端排序**:`sort`(`order_date`/`total_amount`/`outstanding`,仅 DB 列;偏差/份数是 Python 聚合算的不进 SQL)+ `order`(asc/desc);前端列头点排序 → 服务端(`Table onChange`,重置到第 1 页)。
- **批量确认/作废**:`bulk_confirm_orders`/`bulk_void_orders`(逐单独立提交、单个失败收进 `failed`、不中断整批)+ `POST /orders/bulk-confirm` `/bulk-void`;前端多选 `rowSelection`(跨页保留)+ 工具栏(批量确认生效 / 批量作废带理由弹窗)。
- **行内确认生效**:列表草稿行直接「确认生效」(复用现有 `confirmOrder`,原来埋在编辑器里)。
- **订单导出**:`GET /orders/export` 按相同筛选/排序导全量 .xlsx(`excel_service.export_orders_excel`,上限 5 万行);前端「导出」按钮(blob 下载,文件名带日期)。
- **测试 +3**(387→390):搜索/排序、批量确认(成功+全失败不中断)/作废、导出 smoke、API 往返。

## 端点权限（2026-06-29，审计 F）
> 安全加固。原来订单所有路由仅"登录即可",任何登录用户都能退款/作废/批量导入/导出。

- **简单版模型**(用户拍板):只在敏感路由加 `require_admin`(非管理员 403),不做 `created_by` 归属细分。
- **仅管理员**:`POST /orders/{id}/refund` `/cancel` `/void`、`POST /orders/bulk-confirm` `/bulk-void`、`GET /orders/export`、`POST /api/order-import/commit`。`require_admin` 返回 user,沿用作 operator_id。
- **运营(登录即可)**:看列表/详情/统计、建单/改单/确认/收款/发货同步/标已发/导入预览。
- 测试 +1:operator 命中敏感端点 403、日常操作放行。后端 390→391。
- **前端按角色隐藏管理员按钮**(`useAuth().isAdmin`):订单列表(行内作废 / 批量确认作废工具栏 + 多选框 / 导出)、订单详情(退款 / 取消订单 / 作废)、电商导入(确认导入按钮→非管理员显示「需管理员权限」)。运营看不到这些按钮,不会再点出 403。前端 build 通过。
- 遗留(F 之外,可后续):`exports.py` 的印数/发货导出路由仍仅靠路由级登录、未加 require_admin(印数域,不在订单端点范围)。

## 待办 / 后续
- **真导一批（CBJ / 淘宝）**：代码 + 商品库（13 品）+ 刊历都**已部署生产**；干跑预览验证过（CBJ 94/6、淘宝 36/6/1）。待业务真导：传 Excel → 预览 → 确认导入 → 订阅单在详情页补收件人 / 订期再同步中通。淘宝遗留：多商品单单价按标题均摊（需人工核拆）；商家备注里起止期未自动解析（批次起投月 + 逐单核）；季度用 custom 建模。
- **商学院按期发行量数据**：功能已上线；等真导商学院订单后数字自动填（当前生产 0 单 active 商学院订单）。
- **后续平台**：有赞网店（运费逻辑不同：恒有运费 + 折扣）、第三方平台 API 同步。当前暂不考虑。
- **更后期**：财务对账（实付/应收/退款）、客户自助下单（见 requirements.md 第 11 节）。
- **可选清理**：导入预览的逐单编辑目前在订单页/商品库做；若需「预览页内逐行改起止/状态再提交」，可在 commit 接口加 overrides。
- **覆盖期算法 `coverage_rule` 暂不动（2026-06-24 选 C）**：它只在**电商导入**时生效（`cbj_order_import_service._coverage_for`），给订单行算覆盖期（起止日期）；手工新建/确认都不经过它。只有「按起投月算」`term_from_month` 真正算（批次起投月 + 时长），订阅行恒用它；「最新一期」/「自定义」导入时留空。⚠️ **「固定日期」`explicit` 目前没接上**——`_coverage_for` 对它返回空，商品上那对固定起止日期从不被读取，选了≈自定义留空（schema 仍强校验那对日期，但无人消费）。以后清理（可选）：按「履约类型」自动带默认 + 去掉没实现的「固定日期」（option A），或把固定日期真正接上（option B）。

## 关键接口
- `POST /api/order-import/preview`（上传 Excel + 批次设置：mode、邮局/中通起投月、截止日、**活动标签 campaign、延长月 bonus_months、赠品刊物 gift_publication + 说明 gift_note**）→ 预览（每单决策 + session_id）
- `POST /api/order-import/commit`（session_id）→ 批量建单
- `GET /api/orders?campaign=2026-618` → 按活动筛订单（统计基础）
- `GET /api/analytics/campaigns?date_from&date_to`（需鉴权）→ 按活动统计（订单数/原价合计/实收/折扣）
- `GET /api/analytics/issues?publication&date_from&date_to`（需鉴权）→ 按期统计（刊物/期次/销量/销售额/行数，单期口径）
- `GET /api/analytics/bs-circulation?year=`（需鉴权）→ 商学院按期发行量（单期 + 覆盖该期的订阅，含合刊去重）
- `GET/POST/PUT /api/products`、`DELETE /api/products/{id}`（硬删除）、`POST /api/products/{id}/deactivate`（软停用）→ 商品库管理
