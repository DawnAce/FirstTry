export type BusinessCenterKey = 'planning' | 'fulfilment' | 'commerce' | 'finance' | 'analytics';

export interface BusinessModule {
  key: string;
  title: string;
  description: string;
  icon: string;
  path: string;
  matches: string[];
  detail?: string;
}

export interface BusinessCenter {
  key: BusinessCenterKey;
  title: string;
  description: string;
  icon: string;
  color: string;
  path: string;
  modules: BusinessModule[];
}

export const businessCenters: BusinessCenter[] = [
  {
    key: 'planning',
    title: '发行计划',
    description: '管理出版节奏与印刷计划，为订单履约提供基础数据。',
    icon: '计',
    color: '#7858d6',
    path: '/business/planning',
    modules: [
      { key: 'print', title: '印数管理', description: '管理各期印刷数量与调整记录', icon: '🖨️', path: '/print', matches: ['/print', '/report', '/history', '/templates'] },
      { key: 'schedule', title: '刊期表管理', description: '维护出版日期、期号与发行安排', icon: '🗓️', path: '/schedule', matches: ['/schedule'] },
    ],
  },
  {
    key: 'fulfilment',
    title: '发行履约',
    description: '负责订单生效后的渠道履约，统一组织邮局和快递两种履约方式。',
    icon: '履',
    color: '#1677ff',
    path: '/business/fulfilment',
    modules: [
      { key: 'postal', title: '邮局管理', description: '管理邮局渠道的订报、续投、投递与异常工单', icon: '📮', path: '/business/fulfilment/postal', matches: ['/business/fulfilment/postal', '/post-delivery'], detail: '包含：投递明细 · 待续投 · 订报转投 · 邮局工单' },
      { key: 'courier', title: '快递管理', description: '分别管理发货计划与实际发货', icon: '🚚', path: '/logistics/plans', matches: ['/recipients', '/logistics', '/shipping'], detail: '发货计划 · 实际发货' },
    ],
  },
  {
    key: 'commerce',
    title: '营销与交易',
    description: '维护商品和客户，完成订单创建、查询与售后处理。',
    icon: '销',
    color: '#15a06a',
    path: '/business/commerce',
    modules: [
      { key: 'products', title: '商品管理', description: '维护可售商品及价格', icon: '🛍️', path: '/products', matches: ['/products'] },
      { key: 'customers', title: '客户管理', description: '统一维护客户与收件信息', icon: '👥', path: '/customers', matches: ['/customers'] },
      { key: 'orders', title: '订单管理', description: '管理订单全生命周期', icon: '🧾', path: '/orders', matches: ['/orders'] },
    ],
  },
  {
    key: 'finance',
    title: '合同与财务',
    description: '统一管理业务合同、收付款、发票及渠道结算。',
    icon: '财',
    color: '#e8912d',
    path: '/business/finance',
    modules: [
      { key: 'contracts', title: '合同管理', description: '管理合同签订与执行', icon: '📄', path: '/contracts', matches: ['/contracts'] },
      { key: 'finance', title: '财务管理', description: '处理收款、开票与结算', icon: '💰', path: '/finance', matches: ['/finance'] },
    ],
  },
  {
    key: 'analytics',
    title: '经营分析',
    description: '集中查看经营指标、业务趋势与管理报表。',
    icon: '析',
    color: '#e04e73',
    path: '/business/analytics',
    modules: [
      { key: 'campaigns', title: '活动订单统计', description: '查看活动、期数与回款统计', icon: '📊', path: '/analytics', matches: ['/analytics'] },
    ],
  },
];

export const postalFunctions = [
  { title: '投递明细', icon: '📋', path: '/post-delivery/deliveries' },
  { title: '待续投', icon: '🗓️', path: '/post-delivery/renewals' },
  { title: '订报转投', icon: '🔄', path: '/post-delivery/subscription' },
  { title: '邮局工单', icon: '🎫', path: '/post-delivery/tickets' },
];

export const courierFunctions = [
  { title: '发货计划', icon: '📄', path: '/logistics/plans' },
  { title: '实际发货', icon: '🚚', path: '/logistics/shipments' },
];

const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`) || (prefix === '/history' && pathname.startsWith('/history-'));

export function findBusinessCenter(pathname: string): BusinessCenter | undefined {
  const portalCenter = businessCenters.find((center) => matchesPrefix(pathname, center.path));
  return portalCenter ?? businessCenters.find((center) => center.modules.some((module) => module.matches.some((prefix) => matchesPrefix(pathname, prefix))));
}

export function findBusinessModule(center: BusinessCenter | undefined, pathname: string): BusinessModule | undefined {
  return center?.modules.find((module) => module.matches.some((prefix) => matchesPrefix(pathname, prefix)));
}

export function findPostalFunction(pathname: string) {
  return postalFunctions.find((item) => matchesPrefix(pathname, item.path));
}

export function findCourierFunction(pathname: string, search = '') {
  const direct = courierFunctions.find((item) => matchesPrefix(pathname, item.path));
  if (direct) return direct;
  if (matchesPrefix(pathname, '/logistics/issues')) {
    if (pathname.includes('/waybills/import') || new URLSearchParams(search).get('section') === 'actual') {
      return courierFunctions[1];
    }
    return courierFunctions[0];
  }
  return undefined;
}

export function isPostalContext(pathname: string) {
  return matchesPrefix(pathname, '/business/fulfilment/postal') || matchesPrefix(pathname, '/post-delivery');
}

export function isCourierContext(pathname: string) {
  return matchesPrefix(pathname, '/logistics') || matchesPrefix(pathname, '/recipients') || matchesPrefix(pathname, '/shipping');
}
