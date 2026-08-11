import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Row,
  Col,
  Button,
  Tag,
  Space,
  message,
  Select,
  Table,
  Steps,
} from 'antd';
import {
  PlusOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getDashboard, createIssue, deleteIssue } from '../api/issues';
import type { Issue } from '../api/issues';
import { IssueDeleteConfirmButton } from '../components/IssueDeleteConfirmButton';
import { MetricCard, PageHeader, StatusPill } from '../components/UiPrimitives';
import { useAuth } from '../contexts/AuthContext';

function PrintTrendChart({ data }: { data: Array<{ name: string; value: number }> }) {
  const width = 720;
  const height = 260;
  const plot = { left: 54, right: 22, top: 30, bottom: 52 };
  const values = data.map((item) => item.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.2, high * 0.03, 1);
  const min = Math.max(0, low - padding);
  const max = high + padding;
  const innerWidth = width - plot.left - plot.right;
  const innerHeight = height - plot.top - plot.bottom;
  const points = data.map((item, index) => ({
    ...item,
    x: plot.left + (data.length === 1 ? innerWidth / 2 : index * innerWidth / (data.length - 1)),
    y: plot.top + (max - item.value) / (max - min) * innerHeight,
  }));
  const gridValues = Array.from({ length: 4 }, (_unused, index) => min + (max - min) * index / 3);

  return (
    <svg className="dashboard-light-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最近五期印数趋势">
      {gridValues.map((value) => {
        const y = plot.top + (max - value) / (max - min) * innerHeight;
        return <g key={value}>
          <line x1={plot.left} x2={width - plot.right} y1={y} y2={y} className="dashboard-light-chart-grid" />
          <text x={plot.left - 8} y={y + 4} textAnchor="end" className="dashboard-light-chart-axis">{Math.round(value).toLocaleString()}</text>
        </g>;
      })}
      <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} className="dashboard-light-chart-line" />
      {points.map((point) => {
        const [issueLabel, dateLabel] = point.name.split('\n');
        return <g key={point.name}>
          <circle cx={point.x} cy={point.y} r="5" className="dashboard-light-chart-dot">
            <title>{`${issueLabel} ${dateLabel}：${point.value.toLocaleString()} 份`}</title>
          </circle>
          <text x={point.x} y={point.y - 12} textAnchor="middle" className="dashboard-light-chart-value">{point.value.toLocaleString()}</text>
          <text x={point.x} y={height - 25} textAnchor="middle" className="dashboard-light-chart-axis">
            <tspan x={point.x}>{issueLabel}</tspan>
            <tspan x={point.x} dy="14">{dateLabel}</tspan>
          </text>
        </g>;
      })}
    </svg>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canMutate } = useAuth();
  const [creating, setCreating] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<string | undefined>(undefined);

  const { data, isLoading: loading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await getDashboard();
      return res.data;
    },
    select: (data) => {
      if (!selectedIssue) {
        if (data.next_issue) {
          setSelectedIssue(String(data.next_issue.issue_number));
        } else if (data.available_issues.length > 0) {
          setSelectedIssue(String(data.available_issues[0].issue_number));
        }
      }
      return data;
    },
  });

  const nextIssue = data?.next_issue ?? null;
  const availableIssues = data?.available_issues ?? [];
  const recentIssues = data?.recent_issues ?? [];
  const stats = data?.stats ?? { total: 0, draft: 0 };
  const weeklyStats = data?.weekly_stats ?? { this_week_total: 0, last_week_total: 0, week_change: 0 };
  const latestReportTime = data?.latest_report_time;
  const nextIssueNumber = data?.next_issue_number;

  // Prepare trend chart data (last 6 issues, sorted ascending)
  const trendData = useMemo(() => {
    return [...recentIssues]
      .slice(0, 5)
      .reverse()
      .map(issue => ({
        name: `第${issue.issue_number}期\n${dayjs(issue.publish_date).format('MM-DD')}`,
        value: issue.print_total ?? 0,
      }));
  }, [recentIssues]);

  const handleCreateIssue = async (issueNum?: number) => {
    const num = issueNum ?? (selectedIssue ? Number(selectedIssue) : null);
    if (!num) return;
    const chosen = availableIssues.find(i => i.issue_number === num);
    if (!chosen) return;

    setCreating(true);
    try {
      const res = await createIssue({
        issue_number: chosen.issue_number,
        publish_date: chosen.publish_date,
      });
      message.success(`报数第 ${res.data.issue_number} 期创建成功`);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
      navigate(`/report/${res.data.id}`);
    } catch (error: any) {
      message.error(error.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteIssue = async (issue: Issue) => {
    try {
      await deleteIssue(issue.id);
      message.success(`第 ${issue.issue_number} 期已删除`);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['issues'] });
    } catch (error: any) {
      message.error(error.response?.data?.detail || '删除失败');
    }
  };

  const getStatusTag = (status: Issue['status']) => {
    const statusMap = {
      draft: { icon: <ClockCircleOutlined />, text: '待确认', tone: 'warning' as const },
      confirmed: { icon: <CheckCircleOutlined />, text: '已确认', tone: 'success' as const },
      exported: { icon: <CheckCircleOutlined />, text: '已导出', tone: 'info' as const },
    };
    const { icon, text, tone } = statusMap[status];
    return <StatusPill tone={tone} icon={icon}>{text}</StatusPill>;
  };

  const formatPrintTotal = (value: number) => {
    return value.toLocaleString();
  };

  const columns: ColumnsType<Issue> = [
    {
      title: '期刊信息',
      dataIndex: 'issue_number',
      key: 'issue_number',
      width: 190,
      render: (num: number, record) => (
        <div className="dashboard-issue-cell">
          <span>
            <strong>第{num}期</strong>
            <small>{dayjs(record.publish_date).format('YYYY-MM-DD')} 报数</small>
          </span>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: Issue['status']) => getStatusTag(status),
    },
    {
      title: '印数',
      dataIndex: 'print_total',
      key: 'print_total',
      width: 120,
      render: (val: number) => (
        <span className="dashboard-print-total">
          <strong>{val ? formatPrintTotal(val) : '-'}</strong>
          {val ? <small>份</small> : null}
        </span>
      ),
    },
    {
      title: '更新信息',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 150,
      render: (date: string) => (
        <span className="dashboard-update-info">
          <span>{date ? dayjs(date).format('MM-DD HH:mm') : '-'}</span>
          <small>管理员创建</small>
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 210,
      align: 'right',
      render: (_: unknown, record: Issue) => (
        <Space size={4} className="dashboard-table-actions">
          <Button
            type={record.status === 'draft' ? 'primary' : 'default'}
            size="small"
            onClick={(e) => { e.stopPropagation(); navigate(`/report/${record.id}`); }}
          >
            {canMutate ? (record.status === 'draft' ? '去确认' : '编辑') : '查看'}
          </Button>
          <Button
            type="text"
            size="small"
            onClick={(e) => { e.stopPropagation(); navigate(`/logistics/issues/${record.id}`); }}
          >
            明细
          </Button>
          {canMutate && (
            <IssueDeleteConfirmButton
              issueNumber={record.issue_number}
              onConfirm={() => handleDeleteIssue(record)}
              buttonProps={{
                type: 'text',
                size: 'small',
                danger: true,
                onClick: (event) => event.stopPropagation(),
              }}
            />
          )}
        </Space>
      ),
    },
  ];

  const statCards = [
    {
      icon: <span aria-hidden>📝</span>,
      tone: 'info' as const,
      title: '已创建报数',
      value: stats.total,
      suffix: '期',
    },
    {
      icon: <span aria-hidden>⏳</span>,
      tone: 'warning' as const,
      title: '待确认报数',
      value: stats.draft,
      suffix: '期',
    },
    {
      icon: <span aria-hidden>📰</span>,
      tone: 'success' as const,
      title: '本周印数',
      value: formatPrintTotal(weeklyStats.this_week_total),
      suffix: '份',
      change: weeklyStats.week_change,
      changeLabel: `较上周 ${weeklyStats.week_change >= 0 ? '↑' : '↓'} ${formatPrintTotal(Math.abs(weeklyStats.week_change))} 份`,
    },
    {
      icon: <span aria-hidden>📅</span>,
      tone: 'purple' as const,
      title: '最近报数时间',
      value: latestReportTime ? dayjs(latestReportTime).format('YYYY-MM-DD HH:mm') : '-',
      suffix: '',
      subText: nextIssueNumber ? `第${nextIssueNumber}期报数已创建` : undefined,
    },
  ];

  return (
    <div className="dashboard-page">
      {/* Page Header */}
      <PageHeader
        title="印数管理"
        description="管理每期报纸的印数报数、确认与导出"
        actions={<StatusPill tone="info">报数工作台</StatusPill>}
      />

      {/* Statistics Cards - Full Width */}
      <Row gutter={16} className="dashboard-stat-row">
        {statCards.map((card, idx) => (
          <Col xs={12} lg={6} key={idx}>
            <MetricCard
              loading={loading}
              icon={card.icon}
              tone={card.tone}
              label={card.title}
              value={card.value}
              suffix={card.suffix}
              note={card.changeLabel
                ? <>{card.change && card.change >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {card.changeLabel}</>
                : card.subText}
              noteTone={card.changeLabel ? (card.change && card.change >= 0 ? 'success' : 'danger') : undefined}
            />
          </Col>
        ))}
      </Row>

      <Row gutter={20}>
        {/* Main Content */}
        <Col xs={24} lg={17}>
          {/* Create Section - unified container */}
          <div className="dashboard-create-wrapper" style={{ marginBottom: 20 }}>
            {canMutate && nextIssue && (
              <div
                className="dashboard-create-main"
                onClick={() => handleCreateIssue(nextIssue.issue_number)}
                style={{ cursor: creating ? 'wait' : 'pointer' }}
              >
                <div className="dashboard-create-icon">
                  <PlusOutlined style={{ fontSize: 24, color: 'var(--color-on-accent)' }} />
                </div>
                <div className="dashboard-create-text">
                  <div className="dashboard-create-title">
                    一键创建第 {nextIssue.issue_number} 期（{dayjs(nextIssue.publish_date).format('MM-DD')}）报数
                  </div>
                  <div className="dashboard-create-desc">
                    快速创建当前最新期数的报数并进入录入
                  </div>
                </div>
              </div>
            )}
            {canMutate && <div className="dashboard-backfill-section">
              <div className="dashboard-backfill-title">补录其他期数</div>
              <div className="dashboard-backfill-body">
                <Select
                  style={{ flex: 1 }}
                  placeholder="选择期数"
                  value={selectedIssue}
                  onChange={(val) => setSelectedIssue(val)}
                  showSearch
                >
                  {availableIssues.map((item) => (
                    <Select.Option key={item.issue_number} value={String(item.issue_number)}>
                      第 {item.issue_number} 期（出刊日期：{dayjs(item.publish_date).format('YYYY-MM-DD')}）
                    </Select.Option>
                  ))}
                </Select>
                <Button
                  type="primary"
                  onClick={() => handleCreateIssue()}
                  loading={creating}
                  disabled={!selectedIssue}
                >
                  创建
                </Button>
              </div>
              <div className="dashboard-backfill-hint">选择历史期数进行补录，便于完善历史数据</div>
            </div>}
          </div>

          {/* Workflow Steps */}
          <Card size="small" className="dashboard-section-card dashboard-workflow-card" style={{ marginBottom: 20 }} styles={{ body: { padding: 0 } }}>
            <div className="dashboard-workflow">
              <div className="dashboard-workflow-header">
                <span>
                  <strong className="dashboard-workflow-title">报数流程</strong>
                  <small className="dashboard-workflow-desc">从创建期数到同步物流的标准流程</small>
                </span>
              </div>
              <Steps
                size="small"
                items={[
                  { title: '创建期数', description: '创建本期期数' },
                  { title: '录入明细', description: '录入报数明细' },
                  { title: '校验', description: '数据校验检查' },
                  { title: '确认', description: '确认并锁定数据' },
                  { title: '同步物流', description: '数据同步物流系统' },
                ]}
              />
            </div>
          </Card>

          {/* Recent Issues Table */}
          <Card
            size="small"
            className="dashboard-section-card dashboard-recent-card"
            title={
              <div className="dashboard-panel-heading">
                <span className="dashboard-panel-heading-copy">
                  <strong>近期印数</strong>
                  <small>最近 5 期报数与处理状态</small>
                </span>
                <Button type="link" onClick={() => navigate('/history')}>
                  查看全部 <RightOutlined />
                </Button>
              </div>
            }
          >
            <Table<Issue>
              dataSource={recentIssues.slice(0, 5)}
              columns={columns}
              rowKey="id"
              pagination={false}
              loading={loading}
              size="small"
              tableLayout="fixed"
              scroll={{ x: 760 }}
              onRow={(record) => ({
                onClick: () => navigate(`/report/${record.id}`),
                style: { cursor: 'pointer' },
              })}
            />
          </Card>

          {/* Trend Chart */}
          <Card
            size="small"
            className="dashboard-section-card dashboard-trend-card"
            style={{ marginTop: 20 }}
            title={
              <div className="dashboard-panel-heading">
                <span className="dashboard-panel-heading-copy">
                  <strong>
                    近期印数趋势
                  </strong>
                  <small>
                    最近 5 期变化
                  </small>
                </span>
                <span className="dashboard-panel-unit">单位：份</span>
              </div>
            }
          >
            {trendData.length > 0 ? (
              <PrintTrendChart data={trendData} />
            ) : (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-secondary)' }}>
                暂无趋势数据
              </div>
            )}
          </Card>
        </Col>

        {/* Right Sidebar */}
        <Col xs={24} lg={7}>
          {/* Pending Actions */}
          <Card size="small" className="dashboard-sidebar-card" style={{ marginBottom: 16 }}>
            <div className="dashboard-sidebar-header">
              <span className="dashboard-sidebar-title">
                <span className="dashboard-mini-icon" aria-hidden>⚙️</span>待处理事项
              </span>
              <Tag color="red" style={{ borderRadius: 10, fontSize: 11 }}>
                {stats.draft}
              </Tag>
            </div>
            <div className="dashboard-pending-list">
              {recentIssues.filter(i => i.status === 'draft').map(issue => (
                <div
                  key={issue.id}
                  className="dashboard-pending-item"
                  onClick={() => navigate(`/report/${issue.id}`)}
                >
                  <div className="dashboard-pending-dot" style={{ background: 'var(--color-danger)' }} />
                  <div className="dashboard-pending-content">
                    <div className="dashboard-pending-name">第{issue.issue_number}期待确认</div>
                    <div className="dashboard-pending-desc">
                      印数 {issue.print_total ? formatPrintTotal(issue.print_total) : '-'} 份
                    </div>
                  </div>
                  <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
                </div>
              ))}
              {stats.draft === 0 && (
                <div style={{ color: 'var(--color-text-secondary)', fontSize: 13, padding: '8px 0' }}>
                  暂无待处理事项 ✓
                </div>
              )}
            </div>
          </Card>

          {/* Quick Tips */}
          <Card size="small" className="dashboard-sidebar-card" style={{ marginBottom: 16 }}>
            <div className="dashboard-sidebar-header">
              <span className="dashboard-sidebar-title"><span className="dashboard-mini-icon" aria-hidden>💡</span>操作提示</span>
            </div>
            <div className="dashboard-tips-list">
              <div className="dashboard-tip-item">1. 点击"一键创建"快速创建最新期数报数。</div>
              <div className="dashboard-tip-item">2. 录入明细后请校验数据，确保准确无误。</div>
              <div className="dashboard-tip-item">3. 确认后数据将锁定，并可同步至物流系统。</div>
              <div className="dashboard-tip-item">4. 如需修改已确认数据，请先取消确认。</div>
            </div>
          </Card>

          {/* Quick Links */}
          <Card size="small" className="dashboard-sidebar-card">
            <div className="dashboard-sidebar-header">
              <span className="dashboard-sidebar-title"><span className="dashboard-mini-icon" aria-hidden>🚀</span>快捷入口</span>
            </div>
            <div className="dashboard-quick-links">
              <div className="dashboard-quick-link" onClick={() => navigate('/history')}>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">查看历史期数</div>
                  <div className="dashboard-quick-link-desc">查看所有历史报数记录</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/templates')}>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">下载报数模板</div>
                  <div className="dashboard-quick-link-desc">获取最新报数模板文件</div>
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
