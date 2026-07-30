import { useMemo } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDashboard } from '../api/issues';
import { getWorkbenchOverview } from '../api/logisticsOverview';
import { listOrders } from '../api/orders';
import { listCustomers } from '../api/customers';
import { listProducts } from '../api/products';
import { listContracts } from '../api/contracts';
import { listFinance } from '../api/finance';
import { getCampaignSummary, getOutstandingSummary } from '../api/analytics';
import { businessCenters, postalFunctions, type BusinessCenterKey } from '../businessPortalConfig';

type Metric = { label: string; value: string; caption: string };
type AnalysisRow = { label: string; value: string; percent: number };
type PortalData = { metrics: Metric[]; analysisTitle: string; analysis: AnalysisRow[]; guides: string[]; loading: boolean };

const loadingMetrics = (labels: string[]): Metric[] => labels.map((label) => ({ label, value: '…', caption: '正在读取' }));
const ratio = (value: number, total: number) => total > 0 ? Math.max(4, Math.round(value / total * 100)) : 0;
const money = (value: string | number | undefined) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';
  return amount >= 10000 ? `¥${(amount / 10000).toFixed(1)}万` : `¥${amount.toLocaleString('zh-CN')}`;
};

function distribution<T>(rows: T[], getLabel: (row: T) => string): AnalysisRow[] {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const label = getLabel(row);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, value: `${count} 条`, percent: ratio(count, rows.length) }));
}

function useCenterPortalData(key?: BusinessCenterKey): PortalData {
  const planning = useQuery({ queryKey: ['business-portal', 'planning'], queryFn: async () => (await getDashboard()).data, enabled: key === 'planning' });
  const fulfilment = useQuery({ queryKey: ['business-portal', 'fulfilment'], queryFn: async () => (await getWorkbenchOverview()).data, enabled: key === 'fulfilment' });
  const orders = useQuery({ queryKey: ['business-portal', 'orders'], queryFn: async () => (await listOrders({ limit: 100 })).data, enabled: key === 'commerce' });
  const pendingOrders = useQuery({ queryKey: ['business-portal', 'orders', 'pending'], queryFn: async () => (await listOrders({ status: 'pending_confirmation', limit: 1 })).data, enabled: key === 'commerce' });
  const customers = useQuery({ queryKey: ['business-portal', 'customers'], queryFn: async () => (await listCustomers({ page: 1, page_size: 1 })).data, enabled: key === 'commerce' });
  const products = useQuery({ queryKey: ['business-portal', 'products'], queryFn: async () => (await listProducts({ active: true })).data, enabled: key === 'commerce' });
  const contracts = useQuery({ queryKey: ['business-portal', 'contracts'], queryFn: async () => (await listContracts()).data, enabled: key === 'finance' });
  const finance = useQuery({ queryKey: ['business-portal', 'finance'], queryFn: async () => (await listFinance({ page: 1, page_size: 1 })).data, enabled: key === 'finance' });
  const campaigns = useQuery({ queryKey: ['business-portal', 'campaigns'], queryFn: async () => (await getCampaignSummary()).data, enabled: key === 'analytics' });
  const outstanding = useQuery({ queryKey: ['business-portal', 'outstanding'], queryFn: async () => (await getOutstandingSummary()).data, enabled: key === 'analytics' });

  return useMemo(() => {
    if (key === 'planning') {
      const data = planning.data;
      if (!data) return { metrics: loadingMetrics(['已创建报数', '待确认报数', '本周印数', '下期出版']), analysisTitle: '近期印数趋势', analysis: [], guides: ['正在读取发行计划数据'], loading: planning.isLoading };
      const recent = [...data.recent_issues].slice(0, 4).reverse();
      const max = Math.max(...recent.map((item) => item.print_total ?? 0), 1);
      return {
        metrics: [
          { label: '已创建报数', value: `${data.stats.total} 期`, caption: '全部期数' },
          { label: '待确认报数', value: `${data.stats.draft} 期`, caption: data.stats.draft ? '需要处理' : '当前已清零' },
          { label: '本周印数', value: `${data.weekly_stats.this_week_total.toLocaleString()} 份`, caption: `较上周 ${data.weekly_stats.week_change >= 0 ? '+' : ''}${data.weekly_stats.week_change.toLocaleString()}` },
          { label: '下期出版', value: data.next_issue?.publish_date ?? '—', caption: data.next_issue ? `第 ${data.next_issue.issue_number} 期` : '暂无排期' },
        ],
        analysisTitle: '近期印数趋势',
        analysis: recent.map((item) => ({ label: `第${item.issue_number}期`, value: `${(item.print_total ?? 0).toLocaleString()} 份`, percent: ratio(item.print_total ?? 0, max) })),
        guides: [data.stats.draft ? `确认 ${data.stats.draft} 期待处理报数` : '当前没有待确认报数', data.next_issue ? `准备第 ${data.next_issue.issue_number} 期报数` : '检查后续刊期安排', '刊期变化后及时同步印数计划'],
        loading: false,
      };
    }

    if (key === 'fulfilment') {
      const data = fulfilment.data;
      if (!data) return { metrics: loadingMetrics(['年度期数', '已上传', '待处理', '异常']), analysisTitle: '履约状态分布', analysis: [], guides: ['正在读取履约数据'], loading: fulfilment.isLoading };
      const kpi = data.kpi;
      const reminders = data.extras?.reminders;
      return {
        metrics: [
          { label: '年度期数', value: `${kpi.total} 期`, caption: data.year ? `${data.year} 年` : '全部年份' },
          { label: '已上传', value: `${kpi.uploaded} 期`, caption: '快递明细已完成' },
          { label: '待处理', value: `${kpi.pending + kpi.uncreated} 期`, caption: '待上传或未建期' },
          { label: '异常', value: `${kpi.exception} 期`, caption: kpi.exception ? '需要核对' : '当前正常' },
        ],
        analysisTitle: '履约状态分布',
        analysis: [
          { label: '已上传', value: `${kpi.uploaded} 期`, percent: ratio(kpi.uploaded, kpi.total) },
          { label: '待上传', value: `${kpi.pending} 期`, percent: ratio(kpi.pending, kpi.total) },
          { label: '未创建', value: `${kpi.uncreated} 期`, percent: ratio(kpi.uncreated, kpi.total) },
          { label: '异常', value: `${kpi.exception} 期`, percent: ratio(kpi.exception, kpi.total) },
        ],
        guides: [`处理 ${reminders?.no_shipping_count ?? 0} 期未上传明细`, `核对 ${reminders?.delta_diff_count ?? 0} 期报数差异`, `确认 ${reminders?.draft_unconfirmed_count ?? 0} 期草稿`],
        loading: false,
      };
    }

    if (key === 'commerce') {
      const loading = orders.isLoading || pendingOrders.isLoading || customers.isLoading || products.isLoading;
      const rows = orders.data?.rows ?? [];
      return {
        metrics: orders.data ? [
          { label: '订单总数', value: `${orders.data.total} 单`, caption: '当前筛选口径' },
          { label: '客户总数', value: customers.data ? `${customers.data.total} 位` : '—', caption: '当前在订客户' },
          { label: '在售商品', value: products.data ? `${products.data.length} 个` : '—', caption: '有效商品' },
          { label: '待确认订单', value: pendingOrders.data ? `${pendingOrders.data.total} 单` : '—', caption: pendingOrders.data?.total ? '需要处理' : '当前已清零' },
        ] : loadingMetrics(['订单总数', '客户总数', '在售商品', '待确认订单']),
        analysisTitle: '近期订单渠道分布',
        analysis: distribution(rows, (row) => row.source_platform || '手工录入'),
        guides: [pendingOrders.data?.total ? `审核 ${pendingOrders.data.total} 笔待确认订单` : '当前没有待确认订单', '定期检查商品价格和有效状态', '维护客户收件信息，避免履约退回'],
        loading,
      };
    }

    if (key === 'finance') {
      const rows = contracts.data ?? [];
      const active = rows.filter((item) => item.status === 'active');
      const loading = contracts.isLoading || finance.isLoading;
      return {
        metrics: contracts.data ? [
          { label: '合同总数', value: `${rows.length} 份`, caption: '全部合作合同' },
          { label: '执行中合同', value: `${active.length} 份`, caption: `${active.filter((item) => item.is_expiring).length} 份即将到期` },
          { label: '收款记录', value: finance.data ? `${finance.data.total} 条` : '—', caption: finance.data ? money(finance.data.summary.total_amount) : '正在读取' },
          { label: '未挂单', value: finance.data ? `${finance.data.summary.unlinked_count} 条` : '—', caption: finance.data?.summary.unlinked_count ? '需要核对' : '当前正常' },
        ] : loadingMetrics(['合同总数', '执行中合同', '收款记录', '未挂单']),
        analysisTitle: '合同状态分布',
        analysis: distribution(rows, (row) => ({ active: '执行中', expired: '已到期', archived: '已归档', void: '已作废' })[row.status]),
        guides: [`跟进 ${active.filter((item) => item.is_expiring).length} 份即将到期合同`, `核对 ${finance.data?.summary.unlinked_count ?? 0} 条未挂单收款`, '完成渠道对账后及时登记结算'],
        loading,
      };
    }

    const rows = campaigns.data?.rows ?? [];
    const maxPaid = Math.max(...rows.map((row) => Number(row.total_paid)), 1);
    return {
      metrics: campaigns.data ? [
        { label: '营销活动', value: `${campaigns.data.total_campaigns} 个`, caption: '当前统计范围' },
        { label: '活动订单', value: `${campaigns.data.grand_total_orders} 单`, caption: '汇总订单' },
        { label: '活动实付', value: money(campaigns.data.grand_total_paid), caption: '累计实收' },
        { label: '未收金额', value: outstanding.data ? money(outstanding.data.total_outstanding) : '—', caption: outstanding.data ? `${outstanding.data.unpaid_orders} 笔订单` : '正在读取' },
      ] : loadingMetrics(['营销活动', '活动订单', '活动实付', '未收金额']),
      analysisTitle: '活动实付金额排行',
      analysis: [...rows].sort((a, b) => Number(b.total_paid) - Number(a.total_paid)).slice(0, 4).map((row) => ({ label: row.campaign || '未命名活动', value: money(row.total_paid), percent: ratio(Number(row.total_paid), maxPaid) })),
      guides: [outstanding.data?.unpaid_orders ? `关注 ${outstanding.data.unpaid_orders} 笔未结清订单` : '当前没有未结清订单', '对比活动实付与标价差异', '结合期数发行量评估活动效果'],
      loading: campaigns.isLoading || outstanding.isLoading,
    };
  }, [campaigns.data, campaigns.isLoading, contracts.data, contracts.isLoading, customers.data, customers.isLoading, finance.data, finance.isLoading, fulfilment.data, fulfilment.isLoading, key, orders.data, orders.isLoading, outstanding.data, outstanding.isLoading, pendingOrders.data, pendingOrders.isLoading, planning.data, planning.isLoading, products.data, products.isLoading]);
}

export function BusinessHome() {
  const navigate = useNavigate();
  const moduleCount = businessCenters.reduce((sum, center) => sum + center.modules.length, 0);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';

  return (
    <div className="business-home">
      <section className="business-hero">
        <h1>{greeting}，欢迎进入发行系统</h1>
        <p>从业务中心进入工作场景。菜单按职责归类，原有业务页面和数据处理流程保持不变。</p>
        <div className="business-hero-stats"><div><b>{businessCenters.length}</b><span>业务中心</span></div><div><b>{moduleCount}</b><span>业务模块</span></div><div><b>统一</b><span>业务入口</span></div></div>
      </section>

      <div className="business-section-heading"><div><h2>业务中心</h2><p>选择一个业务大类，进入专属工作区</p></div><small>按业务职责划分</small></div>
      <div className="business-center-grid">
        {businessCenters.map((center) => (
          <button className={`business-center-card ${center.key === 'fulfilment' ? 'is-featured' : ''}`} key={center.key} onClick={() => navigate(center.path)}>
            {center.key === 'fulfilment' && <span className="business-card-tag">履约主链路</span>}
            <span className="business-center-head"><span className="business-center-icon" style={{ background: center.color }}>{center.icon}</span><span><b>{center.title}</b><small>{center.modules.length} 个业务模块</small></span></span>
            <span className="business-center-description">{center.description}</span>
            <span className="business-center-modules">{center.modules.map((module) => module.title).join('　·　')}</span>
            <span className="business-center-enter">进入业务中心 →</span>
          </button>
        ))}
      </div>

      <div className="business-home-panels">
        <section className="business-panel"><h3>常用入口</h3><div className="business-quick-links"><button onClick={() => navigate('/orders')}>🧾 订单查询</button><button onClick={() => navigate('/post-delivery/deliveries')}>📋 投递明细</button><button onClick={() => navigate('/post-delivery/tickets')}>🎫 邮局工单</button><button onClick={() => navigate('/finance')}>💰 财务管理</button></div></section>
        <section className="business-panel"><h3>导航说明</h3><p className="business-note">左侧只显示当前业务中心的功能，返回业务首页即可切换大类。</p><p className="business-note">这次调整仅改变入口与归类，不改变原有页面的数据和操作。</p></section>
      </div>
    </div>
  );
}

export function BusinessCenterPortal() {
  const navigate = useNavigate();
  const { centerKey } = useParams<{ centerKey: string }>();
  const center = businessCenters.find((item) => item.key === centerKey);
  const data = useCenterPortalData(center?.key);
  if (!center) return <Navigate to="/" replace />;

  return (
    <div className="business-portal-page">
      <header className="business-page-heading"><h1>{center.title}</h1><p>{center.description}</p><span>左侧仅显示当前大类下的功能</span></header>
      <div className="business-metric-grid">
        {data.metrics.map((metric) => <section className="business-metric" key={metric.label}><span>{metric.label}</span><b>{metric.value}</b><small>{metric.caption}</small></section>)}
      </div>
      <div className="business-overview-grid">
        <section className="business-panel"><div className="business-panel-heading"><h3>{data.analysisTitle}</h3>{data.loading && <span>读取中</span>}</div><div className="business-analysis-list">{data.analysis.length ? data.analysis.map((row) => <div className="business-analysis-row" key={row.label}><span>{row.label}</span><i><i style={{ width: `${row.percent}%` }} /></i><b>{row.value}</b></div>) : <div className="business-empty">暂无可分析数据</div>}</div></section>
        <section className="business-panel"><div className="business-panel-heading"><h3>{center.key === 'analytics' ? '经营提示' : '工作指引'}</h3><span>当前</span></div>{data.guides.map((guide) => <div className="business-guide" key={guide}><i />{guide}</div>)}</section>
      </div>
      {center.key === 'fulfilment' && <div className="business-flow"><div><b>订单生效</b><small>订单管理</small></div><span>→</span><div><b>履约分流</b><small>按订单渠道</small></div><span>→</span><div><b>邮局管理 / 快递管理</b><small>两个同级履约模块</small></div><span>→</span><div><b>投递完成</b><small>跟踪与异常处理</small></div></div>}
      <div className="business-section-heading"><div><h2>{center.key === 'fulfilment' ? '履约模块' : '功能模块'}</h2><p>选择具体功能开始工作</p></div></div>
      <div className="business-module-grid">
        {center.modules.map((module) => <button className="business-module-card" key={module.key} onClick={() => navigate(module.path)}><span>{module.icon}</span><div><b>{module.title}</b><p>{module.description}</p>{module.detail && <small>{module.detail}</small>}</div><i>›</i></button>)}
      </div>
    </div>
  );
}

const postalDescriptions: Record<string, string> = {
  '投递明细': '查询订单形成的邮局投递台账',
  '待续投': '核对目标月份缺口并生成跨年投递段',
  '订报转投': '生成并交接邮局订报数据',
  '邮局工单': '处理缺报、改址等邮局投递异常',
};

export function PostalPortal() {
  const navigate = useNavigate();
  return (
    <div className="business-portal-page">
      <header className="business-page-heading"><h1>邮局管理</h1><p>管理邮局渠道下的订报生成、跨年续投、投递台账与异常工单。</p><span>左侧仅显示邮局管理下的子功能</span></header>
      <div className="business-flow"><div><b>订单生效</b><small>订单管理</small></div><span>→</span><div><b>缺口核对</b><small>待续投</small></div><span>→</span><div><b>订报转投</b><small>生成邮局数据</small></div><span>→</span><div><b>投递明细</b><small>跟踪台账</small></div><span>→</span><div><b>邮局工单</b><small>异常处理</small></div></div>
      <div className="business-section-heading"><div><h2>邮局业务功能</h2><p>投递明细、待续投、订报转投和邮局工单同属邮局管理</p></div></div>
      <div className="business-module-grid">
        {postalFunctions.map((item) => <button className="business-module-card" key={item.path} onClick={() => navigate(item.path)}><span>{item.icon}</span><div><b>{item.title}</b><p>{postalDescriptions[item.title]}</p></div><i>›</i></button>)}
      </div>
    </div>
  );
}
