import { Collapse, Typography } from 'antd';
import type { ReactNode } from 'react';

const { Text } = Typography;

/**
 * Single-source operating-rules panel for the e-commerce order flow.
 *
 * Rendered (collapsed by default) on both the import page (/orders/import) and the
 * order list (/orders) so operators see the same rules in both places. Edit the
 * rules HERE only — both pages pick the change up.
 */
const SECTIONS: Array<{ h: string; items: ReactNode[] }> = [
  {
    h: '商品识别与定价',
    items: [
      '电商商品名 → 商品库「一行一商品」（别名归一活动后缀）；未识别的进「待确认」，一键加入商品库后自动重新识别，绝不乱猜、绝不丢单。',
      <>一律记 <Text strong>实付金额</Text>（不套套餐价）；CBJ「原价（折前标价）」单独存档，供「按活动统计」算折扣。</>,
      '套餐自动拆分：中国经营报固定 ¥240、商学院拿余额（¥576 → 240 + 336）。',
      '商学院月刊（标题形如「2026年X月刊 /  2~3月合刊《…》」）自动识别为「商学院 · 单期」（记期次 issue_label），不进商品库、不进待确认。',
    ],
  },
  {
    h: '淘宝平台（自动识别）',
    items: [
      <>上传时按表头<Text strong>自动识别平台</Text>（CBJ 小程序 / 淘宝），无需手动选择；订单写 <Text code>source_platform=淘宝</Text>，列表「平台」列 / 筛选可区分。</>,
      <>淘宝导出<Text strong>收件人脱敏</Text>（只有省市区 + 街道，无姓名 / 电话 / 详细地址）→ 导入<Text strong>只落记录、收件人留空</Text>；要发货须在订单详情<Text strong>逐单补收件人</Text>再手动触发同步（同「历史归档单」流程）。</>,
      <>投递方式 / 期次从 SKU「<Text strong>分册名</Text>」解析：全年-邮局-周投 → 邮局；全年-快递-月寄 → 中通；2026年5月刊 → 商学院期次。</>,
      '单期零售《中国经营报》无期号 → 标黄「请补期号」；商学院多商品单无分册名 → 期次留空标黄「请补期次」。',
      '多商品订单淘宝只给总额 → 系统按标题均摊单价，需人工核对拆分。',
      <>原价 = 总金额 + 邮费（淘宝邮费单列、恒收）；<Text strong>实付含邮费</Text>。</>,
    ],
  },
  {
    h: '覆盖期（起投时间）',
    items: [
      <>按批设定：邮局 / 中通起投月 + 截止日（晚于截止日付款 → 下月起投）；<Text strong>每单可改</Text>。</>,
      '历史归档模式：覆盖期留空（可后续在订单明细补填），系统不自动估算。',
    ],
  },
  {
    h: '投递与运费',
    items: [
      '运费补拍金额并入订单总额（不单建明细）。',
      <>含「转中通」的行 → 投递<Text strong>自动改中通</Text>并高亮「请核对」（漏检后果严重）。</>,
    ],
  },
  {
    h: '订单状态导入策略',
    items: [
      '已付款 / 已发货 → 收；待付款 / 已取消 → 跳过；退款 → 收但标记；状态未识别 → 默认「已付款」+ 标黄。预览前 / 导入后均可人为改。',
    ],
  },
  {
    h: '去重',
    items: [<>按来源单号 <Text code>external_order_no</Text> 去重；与库内已有单重复则跳过。</>],
  },
  {
    h: '历史归档单（重要）',
    items: [
      '保留下单日期、覆盖期可留空、不进发货同步；归档标记只是「筛选标签」，不锁单。',
      <>
        <Text strong>没有自动同步</Text>：导入或编辑订单都<Text strong>不会</Text>自动把它推给中通 / 邮局。要让历史单真发货，需两步：① 在订单明细<Text strong>补上覆盖期起止</Text>；② 到该单<Text strong>手动触发发货同步</Text>（仅中通；邮局不在系统同步范围内）。
      </>,
    ],
  },
  {
    h: '活动标签与赠品',
    items: [
      '活动标签写到订单 campaign（带年份，可按活动统计）；具体活动（618 / 双十一）不写进商品名。',
      '赠品只给本批「含订阅」的订单（单期不送）：订期延长 N 月顺延覆盖期；赠送刊物记为一条免费明细（收件人同主单，可追溯）。',
    ],
  },
  {
    h: '活动订单统计（报表）',
    items: [
      <>
        「订单管理 → <Text strong>活动订单统计</Text>」是只读销售报表，按下单日期筛、<Text strong>只计有效单</Text>（草稿 / 待确认 / 作废不计），是导入的「下游」——导入时填了活动标签、或导入了商学院月刊，这页就自动出数。
      </>,
      <>
        <Text strong>按活动统计</Text>：带活动标签的单按 campaign 分组，看 订单数 / 原价合计 / 实收 / 折扣（折扣 = 原价 − 实收；退款暂不抵扣）。
      </>,
      <>
        <Text strong>按期统计</Text>：带期次 issue_label 的单期行（主为商学院月刊），看 销量份 / 销售额。
      </>,
    ],
  },
];

export default function EcommerceRules() {
  return (
    <Collapse
      size="small"
      style={{ marginBottom: 16 }}
      items={[
        {
          key: 'rules',
          label: '📋 电商导入 · 业务规则说明（点开查看）',
          children: (
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              {SECTIONS.map((s) => (
                <div key={s.h} style={{ marginBottom: 8 }}>
                  <Text strong>{s.h}</Text>
                  <ul style={{ margin: '2px 0 0', paddingInlineStart: 20 }}>
                    {s.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ),
        },
      ]}
    />
  );
}
