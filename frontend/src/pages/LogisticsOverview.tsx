import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Button, Tag, Table, Empty } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  SendOutlined,
  RightOutlined,
  FileTextOutlined,
  LinkOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import { getWorkbenchOverview } from '../api/logisticsOverview';
import type { PeriodRow, PlanStatus, WaybillStatus } from '../api/logisticsOverview';
import { getRecentOperationLogs } from '../api/operationLogs';
import type { OperationLog } from '../api/operationLogs';
import { getPendingShippingDeferrals } from '../api/shippingWaybills';
import { MetricCard, PageHeader } from '../components/UiPrimitives';
import ShippingDeferralModal from './ShippingDeferralModal';
import { summarizeShippingDeferrals } from './shippingDeferralUtils';

const planStatusColor: Record<PlanStatus, string> = {
  未创建: 'default', 草稿: 'orange', 待导入: 'gold', 有差异: 'red', 有变更: 'orange', 已就绪: 'green',
};
const waybillStatusColor: Record<WaybillStatus, string> = {
  未开始: 'default', 待上传: 'gold', 部分完成: 'orange', 已完成: 'green', 需核对: 'red',
};

export default function LogisticsOverview() {
  const navigate = useNavigate();
  const [deferralModalOpen, setDeferralModalOpen] = useState(false);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['logistics-overview', 'workbench'],
    queryFn: async () => (await getWorkbenchOverview()).data,
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ['operationLogs', 'recent-workbench'],
    queryFn: async () => (await getRecentOperationLogs({ limit: 6 })).data,
  });

  const { data: pendingDeferrals = [], isLoading: pendingDeferralsLoading } = useQuery({
    queryKey: ['shippingDeferrals', 'pending'],
    queryFn: async () => (await getPendingShippingDeferrals()).data,
  });
  const deferralSummary = useMemo(
    () => summarizeShippingDeferrals(pendingDeferrals, dayjs().format('YYYY-MM-DD')),
    [pendingDeferrals],
  );

  const kpi = data?.kpi ?? { total: 0, uploaded: 0, pending: 0, uncreated: 0, exception: 0, draft: 0 };
  const extras = data?.extras ?? null;
  const scopeRows = data?.rows ?? [];
  const planReady = scopeRows.filter((row) => row.plan_status === '已就绪').length;
  const planPending = scopeRows.filter((row) => !['已就绪', '未创建'].includes(row.plan_status)).length;
  const actualComplete = scopeRows.filter((row) => row.waybill_status === '已完成').length;
  const actualPending = scopeRows.filter((row) => ['待上传', '部分完成', '需核对'].includes(row.waybill_status)).length;
  const pct = (v: number) => (kpi.total > 0 ? `占本年 ${Math.round((v / kpi.total) * 1000) / 10}%` : '—');

  const goDetail = (row: PeriodRow) => {
    if (row.issue_id != null) navigate(`/logistics/issues/${row.issue_id}`);
  };

  const statCards: { icon: ReactNode; tone: 'success' | 'warning' | 'danger'; label: string; value: ReactNode; suffix?: string; sub: string }[] = [
    {
      icon: <CheckCircleOutlined style={{ fontSize: 22, color: 'var(--color-success)' }} />,
      tone: 'success',
      label: '计划已就绪',
      value: planReady,
      suffix: '期',
      sub: pct(planReady),
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 22, color: 'var(--color-warning)' }} />,
      tone: 'warning',
      label: '计划待处理',
      value: planPending,
      suffix: '期',
      sub: pct(planPending),
    },
    {
      icon: <SendOutlined style={{ fontSize: 22, color: 'var(--color-success)' }} />,
      tone: 'success',
      label: '实际发货已完成',
      value: actualComplete,
      suffix: '期',
      sub: pct(actualComplete),
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 22, color: 'var(--color-warning)' }} />,
      tone: 'warning',
      label: '实际发货待处理',
      value: actualPending,
      suffix: '期',
      sub: pct(actualPending),
    },
  ];

  const reminderItems = [
    { label: '计划待导入', desc: '本期尚未形成发货计划', count: scopeRows.filter((row) => row.plan_status === '待导入').length, color: 'var(--color-warning)' },
    { label: '实际发货待上传', desc: '已有计划，尚未上传运单', count: scopeRows.filter((row) => row.waybill_status === '待上传').length, color: 'var(--color-warning)' },
    { label: '实际发货需核对', desc: '计划变化后需复核原运单', count: scopeRows.filter((row) => row.waybill_status === '需核对').length, color: 'var(--color-danger)' },
  ];

  const recent = (extras?.recent_issues ?? []).slice(0, 5);
  const upcoming = (extras?.upcoming_issues ?? []).slice(0, 5);

  const logColumns: ColumnsType<OperationLog> = [
    { title: '时间', dataIndex: 'created_at', render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{dayjs(v).format('MM-DD HH:mm')}</span> },
    { title: '操作人', dataIndex: 'username', render: (v: string | null) => v || '系统' },
    { title: '操作内容', dataIndex: 'action_label' },
    { title: '期数', dataIndex: 'issue_number', render: (v: number | null) => (v ? `第${v}期` : '—') },
    { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'failed' ? 'red' : 'green'}>{v === 'failed' ? '失败' : '成功'}</Tag> },
  ];

  const renderPeriodCard = (row: PeriodRow) => {
    const clickable = row.issue_id != null;
    return (
      <div
        key={row.issue_number}
        onClick={clickable ? () => goDetail(row) : undefined}
        style={{
          cursor: clickable ? 'pointer' : 'default', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-input)',
          padding: '10px 12px', minWidth: 0, flex: '1 1 0', background: 'var(--color-card)',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>第 {row.issue_number} 期</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 6px' }}>
          {dayjs(row.publish_date).format('YYYY-MM-DD')}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Tag color={planStatusColor[row.plan_status]} style={{ marginInlineEnd: 0 }}>计划·{row.plan_status}</Tag>
          <Tag color={waybillStatusColor[row.waybill_status]} style={{ marginInlineEnd: 0 }}>运单·{row.waybill_status}</Tag>
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <PageHeader
        title="快递管理"
        description="发货计划与实际发货分开管理，计划变化不会覆盖已导入运单。"
        actions={<Button type="primary" icon={<BarChartOutlined />} onClick={() => navigate('/logistics/plans')}>进入发货计划</Button>}
      />

      <Row gutter={16} className="dashboard-stat-row">
        {statCards.map((card, idx) => (
          <Col xs={12} lg={6} key={idx}>
            <MetricCard
              loading={loading}
              icon={card.icon}
              tone={card.tone}
              label={card.label}
              value={card.value}
              suffix={card.suffix}
              note={card.sub}
            />
          </Col>
        ))}
      </Row>

      <Row gutter={20}>
        {/* 主列 */}
        <Col xs={24} lg={17}>
          <Card
            size="small"
            style={{ marginBottom: 20 }}
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>期数状态总览</span>
                <Button type="link" onClick={() => navigate('/logistics/plans')}>查看发货计划 <RightOutlined /></Button>
              </div>
            }
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>最近期数</div>
            {recent.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 10, marginBottom: 16 }}>{recent.map(renderPeriodCard)}</div>
            ) : (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 16 }}>暂无已开期数</div>
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>后续期数</div>
            {upcoming.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 10 }}>{upcoming.map(renderPeriodCard)}</div>
            ) : (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>暂无后续期数</div>
            )}
          </Card>

          <Card size="small" title={<span style={{ fontWeight: 700, fontSize: 16 }}>最近操作记录</span>}>
            {recentLogs.length > 0 ? (
              <Table<OperationLog>
                dataSource={recentLogs}
                columns={logColumns}
                rowKey="id"
                pagination={false}
                size="small"
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无操作记录" />
            )}
          </Card>
        </Col>

        {/* 右侧栏 */}
        <Col xs={24} lg={7}>
          <Card size="small" className="dashboard-sidebar-card" style={{ marginBottom: 16 }}>
            <div className="dashboard-sidebar-header">
              <span className="dashboard-sidebar-title"><LinkOutlined /> 合寄待办</span>
            </div>
            <button
              type="button"
              className="dashboard-pending-item"
              style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }}
              onClick={() => setDeferralModalOpen(true)}
            >
              <div className="dashboard-pending-dot" style={{ background: 'var(--color-warning)' }} />
              <div className="dashboard-pending-content">
                <div className="dashboard-pending-name">
                  全部未完成 {pendingDeferralsLoading ? '—' : `${deferralSummary.recordCount}条 / ${deferralSummary.quantity.toLocaleString()}份`}
                </div>
                <div className="dashboard-pending-desc">
                  逾期 {deferralSummary.overdueCount} · 每月两次 {deferralSummary.twiceMonthlyCount} · 月底 {deferralSummary.monthEndCount} · 历史未分批 {deferralSummary.legacyCount}
                </div>
              </div>
              <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12, marginLeft: 8 }} />
            </button>
          </Card>

          <Card size="small" className="dashboard-sidebar-card" style={{ marginBottom: 16 }}>
            <div className="dashboard-sidebar-header">
              <span className="dashboard-sidebar-title">⚙️ 待处理提醒</span>
            </div>
            <div className="dashboard-pending-list">
              {reminderItems.map((item, idx) => (
                <div key={idx} className="dashboard-pending-item" onClick={() => navigate(item.label.includes('实际发货') ? '/logistics/shipments' : '/logistics/plans')}>
                  <div className="dashboard-pending-dot" style={{ background: item.color }} />
                  <div className="dashboard-pending-content">
                    <div className="dashboard-pending-name">{item.label}</div>
                    <div className="dashboard-pending-desc">{item.desc}</div>
                  </div>
                  <span style={{ fontWeight: 700, color: item.color }}>{item.count}</span>
                  <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12, marginLeft: 8 }} />
                </div>
              ))}
            </div>
          </Card>

          <Card size="small" className="dashboard-sidebar-card">
            <div className="dashboard-sidebar-header">
              <span className="dashboard-sidebar-title">🚀 快捷操作</span>
            </div>
            <div className="dashboard-quick-links">
              <div className="dashboard-quick-link" onClick={() => navigate('/logistics/plans')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'var(--color-accent-soft)' }}>
                  <UnorderedListOutlined style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">发货计划</div>
                  <div className="dashboard-quick-link-desc">维护收件信息与计划应发份数</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/logistics/shipments')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'var(--color-success-soft)' }}>
                  <UnorderedListOutlined style={{ color: 'var(--color-success)' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">实际发货</div>
                  <div className="dashboard-quick-link-desc">上传运单并处理待核销明细</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/analytics')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'var(--color-success-soft)' }}>
                  <BarChartOutlined style={{ color: 'var(--color-success)' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">数据报表</div>
                  <div className="dashboard-quick-link-desc">查看统计与分析报表</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/print')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'var(--color-purple-soft)' }}>
                  <FileTextOutlined style={{ color: 'var(--color-purple)' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">印数报数</div>
                  <div className="dashboard-quick-link-desc">前往印数报数首页</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
            </div>
          </Card>
        </Col>
      </Row>
      <ShippingDeferralModal
        open={deferralModalOpen}
        title="全部未完成合寄待办"
        items={pendingDeferrals}
        loading={pendingDeferralsLoading}
        scope="global"
        onClose={() => setDeferralModalOpen(false)}
      />
    </div>
  );
}
