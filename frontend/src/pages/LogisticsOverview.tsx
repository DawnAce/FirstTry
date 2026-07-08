import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Button, Tag, Table, Empty } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  CalendarOutlined,
  RightOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import { getWorkbenchOverview } from '../api/logisticsOverview';
import type { PeriodRow, PeriodStatus } from '../api/logisticsOverview';
import { getRecentOperationLogs } from '../api/operationLogs';
import type { OperationLog } from '../api/operationLogs';

const statusTagColor: Record<PeriodStatus, string> = {
  已上传: 'green', 异常: 'red', 待上传: 'gold', 草稿: 'orange', 未创建: 'default',
};

export default function LogisticsOverview() {
  const navigate = useNavigate();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['logistics-overview', 'workbench'],
    queryFn: async () => (await getWorkbenchOverview()).data,
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ['operationLogs', 'recent-workbench'],
    queryFn: async () => (await getRecentOperationLogs({ limit: 6 })).data,
  });

  const kpi = data?.kpi ?? { total: 0, uploaded: 0, pending: 0, uncreated: 0, exception: 0, draft: 0 };
  const extras = data?.extras ?? null;
  const pendingFamily = kpi.pending + kpi.uncreated; // 待上传含未创建（决策②）
  const latest = extras?.latest_this_month ?? null;
  const pct = (v: number) => (kpi.total > 0 ? `占本年 ${Math.round((v / kpi.total) * 1000) / 10}%` : '—');

  const goDetail = (row: PeriodRow) => {
    if (row.issue_id != null) navigate(`/logistics/issues/${row.issue_id}`);
  };

  const statCards: { icon: ReactNode; bg: string; label: string; value: ReactNode; suffix?: string; sub: string; valueColor?: string }[] = [
    {
      icon: <CheckCircleOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
      bg: 'rgba(82, 196, 26, 0.08)',
      label: '已上传期数',
      value: kpi.uploaded,
      suffix: '期',
      sub: pct(kpi.uploaded),
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 22, color: '#faad14' }} />,
      bg: 'rgba(250, 173, 20, 0.08)',
      label: '待上传期数',
      value: pendingFamily,
      suffix: '期',
      sub: pct(pendingFamily),
    },
    {
      icon: <WarningOutlined style={{ fontSize: 22, color: '#cf1322' }} />,
      bg: 'rgba(207, 19, 34, 0.08)',
      label: '异常期数',
      value: kpi.exception,
      suffix: '期',
      sub: pct(kpi.exception),
      valueColor: kpi.exception > 0 ? '#cf1322' : undefined,
    },
    {
      icon: <CalendarOutlined style={{ fontSize: 22, color: '#722ed1' }} />,
      bg: 'rgba(114, 46, 209, 0.08)',
      label: '本月最新更新',
      value: latest ? dayjs(latest.last_updated_at).format('YYYY-MM-DD') : '—',
      suffix: '',
      sub: latest ? `第 ${latest.issue_number} 期（ZTO-MF）` : '本月暂无更新',
    },
  ];

  const reminderItems = [
    { label: '尚未上传发货明细', desc: '需补录发货明细', count: extras?.reminders.no_shipping_count ?? 0, color: '#fa8c16' },
    { label: '报数与发货差异', desc: '报数与发货明细不一致', count: extras?.reminders.delta_diff_count ?? 0, color: '#cf1322' },
    { label: '草稿未确认', desc: '草稿数据待确认提交', count: extras?.reminders.draft_unconfirmed_count ?? 0, color: '#722ed1' },
  ];

  const recent = extras?.recent_issues ?? [];
  const upcoming = extras?.upcoming_issues ?? [];

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
          cursor: clickable ? 'pointer' : 'default', border: '1px solid var(--color-border, #eee)', borderRadius: 10,
          padding: '10px 12px', minWidth: 128, flex: '1 1 128px', background: '#fff',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 13 }}>第 {row.issue_number} 期</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '2px 0 6px' }}>
          {dayjs(row.publish_date).format('YYYY-MM-DD')}
        </div>
        <Tag color={statusTagColor[row.status]} style={{ marginInlineEnd: 0 }}>{row.status}</Tag>
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="dashboard-title">物流工作台 · ZTO-MF</h1>
        <Button type="primary" icon={<BarChartOutlined />} onClick={() => navigate('/logistics/issues')}>
          查看期数总览
        </Button>
      </div>

      <Row gutter={16} className="dashboard-stat-row">
        {statCards.map((card, idx) => (
          <Col xs={12} lg={6} key={idx}>
            <Card loading={loading} className="dashboard-stat-card" size="small">
              <div className="dashboard-stat-card-inner">
                <div className="dashboard-stat-icon" style={{ background: card.bg }}>{card.icon}</div>
                <div className="dashboard-stat-content">
                  <div className="dashboard-stat-label">{card.label}</div>
                  <div className="dashboard-stat-value" style={card.valueColor ? { color: card.valueColor } : undefined}>
                    {card.value}
                    {card.suffix && <span className="dashboard-stat-suffix"> {card.suffix}</span>}
                  </div>
                  <div className="dashboard-stat-sub">{card.sub}</div>
                </div>
              </div>
            </Card>
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
                <Button type="link" onClick={() => navigate('/logistics/issues')}>查看全部期数 <RightOutlined /></Button>
              </div>
            }
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5a5a62', marginBottom: 8 }}>最近期数</div>
            {recent.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>{recent.map(renderPeriodCard)}</div>
            ) : (
              <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 16 }}>暂无已开期数</div>
            )}
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5a5a62', marginBottom: 8 }}>后续期数</div>
            {upcoming.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{upcoming.map(renderPeriodCard)}</div>
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
              <span className="dashboard-sidebar-title">⚙️ 待处理提醒</span>
            </div>
            <div className="dashboard-pending-list">
              {reminderItems.map((item, idx) => (
                <div key={idx} className="dashboard-pending-item" onClick={() => navigate('/logistics/issues')}>
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
              <div className="dashboard-quick-link" onClick={() => navigate('/logistics/issues')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'rgba(0, 113, 227, 0.08)' }}>
                  <UnorderedListOutlined style={{ color: 'var(--color-accent)' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">期数总览</div>
                  <div className="dashboard-quick-link-desc">全量期数上传与对账状态</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/analytics')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'rgba(82, 196, 26, 0.08)' }}>
                  <BarChartOutlined style={{ color: '#52c41a' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">数据报表</div>
                  <div className="dashboard-quick-link-desc">查看统计与分析报表</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'rgba(114, 46, 209, 0.08)' }}>
                  <FileTextOutlined style={{ color: '#722ed1' }} />
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
    </div>
  );
}
