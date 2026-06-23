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
  Tooltip,
  Steps,
} from 'antd';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts/core';
import { LineChart as ELineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([ELineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
import {
  PlusOutlined,
  EditOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
  CalendarOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  InfoCircleOutlined,
  RightOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { getDashboard, createIssue, deleteIssue } from '../api/issues';
import type { Issue } from '../api/issues';
import { IssueDeleteConfirmButton } from '../components/IssueDeleteConfirmButton';

export default function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
      draft: { color: 'orange', icon: <ClockCircleOutlined />, text: '待确认' },
      confirmed: { color: 'green', icon: <CheckCircleOutlined />, text: '已确认' },
      exported: { color: 'blue', icon: <CheckCircleOutlined />, text: '已导出' },
    };
    const { color, icon, text } = statusMap[status];
    return <Tag color={color} icon={icon}>{text}</Tag>;
  };

  const formatPrintTotal = (value: number) => {
    return value.toLocaleString();
  };

  const columns: ColumnsType<Issue> = [
    {
      title: '期数',
      dataIndex: 'issue_number',
      key: 'issue_number',
      render: (num: number) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>第{num}期</span>,
    },
    {
      title: '报数日期',
      dataIndex: 'publish_date',
      key: 'publish_date',
      render: (date: string) => <span style={{ whiteSpace: 'nowrap' }}>{dayjs(date).format('YYYY-MM-DD')}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: Issue['status']) => getStatusTag(status),
    },
    {
      title: '印数（份）',
      dataIndex: 'print_total',
      key: 'print_total',
      render: (val: number) => <span style={{ whiteSpace: 'nowrap' }}>{val ? formatPrintTotal(val) : '-'}</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => <span style={{ whiteSpace: 'nowrap' }}>{date ? `创建于 ${dayjs(date).format('MM-DD HH:mm')}` : '-'}</span>,
    },
    {
      title: '更新人',
      key: 'updater',
      render: () => '管理员',
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: unknown, record: Issue) => (
        <Space size="small" style={{ whiteSpace: 'nowrap' }}>
          <Button
            type="link"
            size="small"
            onClick={(e) => { e.stopPropagation(); navigate(`/report/${record.id}`); }}
          >
            {record.status === 'draft' ? '去确认' : '编辑'}
          </Button>
          <Button
            type="link"
            size="small"
            onClick={(e) => { e.stopPropagation(); navigate(`/recipients?tab=shipping&issueId=${record.id}`); }}
          >
            明细
          </Button>
          <IssueDeleteConfirmButton
            issueNumber={record.issue_number}
            onConfirm={() => handleDeleteIssue(record)}
            buttonProps={{
              type: 'link',
              size: 'small',
              danger: true,
              onClick: (event) => event.stopPropagation(),
            }}
          />
        </Space>
      ),
    },
  ];

  const statCards = [
    {
      icon: <FileTextOutlined style={{ fontSize: 22, color: 'var(--color-accent)' }} />,
      bgColor: 'rgba(0, 113, 227, 0.08)',
      title: '已创建报数',
      value: stats.total,
      suffix: '期',
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 22, color: '#faad14' }} />,
      bgColor: 'rgba(250, 173, 20, 0.08)',
      title: '待确认报数',
      value: stats.draft,
      suffix: '期',
    },
    {
      icon: <BarChartOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
      bgColor: 'rgba(82, 196, 26, 0.08)',
      title: '本周印数',
      value: formatPrintTotal(weeklyStats.this_week_total),
      suffix: '份',
      change: weeklyStats.week_change,
      changeLabel: `较上周 ${weeklyStats.week_change >= 0 ? '↑' : '↓'} ${formatPrintTotal(Math.abs(weeklyStats.week_change))} 份`,
    },
    {
      icon: <CalendarOutlined style={{ fontSize: 22, color: '#722ed1' }} />,
      bgColor: 'rgba(114, 46, 209, 0.08)',
      title: '最近报数时间',
      value: latestReportTime ? dayjs(latestReportTime).format('YYYY-MM-DD HH:mm') : '-',
      suffix: '',
      subText: nextIssueNumber ? `第${nextIssueNumber}期报数已创建` : undefined,
    },
  ];

  return (
    <div className="dashboard-page">
      {/* Page Header */}
      <div className="dashboard-header">
        <h1 className="dashboard-title">
          印数报数
          <Tooltip title="管理每期报纸的印数报数、确认和导出">
            <InfoCircleOutlined style={{ fontSize: 16, color: 'var(--color-text-secondary)', marginLeft: 8 }} />
          </Tooltip>
        </h1>
      </div>

      {/* Statistics Cards - Full Width */}
      <Row gutter={16} className="dashboard-stat-row">
        {statCards.map((card, idx) => (
          <Col span={6} key={idx}>
            <Card loading={loading} className="dashboard-stat-card" size="small">
              <div className="dashboard-stat-card-inner">
                <div className="dashboard-stat-icon" style={{ background: card.bgColor }}>
                  {card.icon}
                </div>
                <div className="dashboard-stat-content">
                  <div className="dashboard-stat-label">{card.title}</div>
                  <div className="dashboard-stat-value">
                    {card.value}
                    {card.suffix && <span className="dashboard-stat-suffix"> {card.suffix}</span>}
                  </div>
                  {card.changeLabel && (
                    <div className={`dashboard-stat-change ${card.change && card.change >= 0 ? 'up' : 'down'}`}>
                      {card.change && card.change >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                      {' '}{card.changeLabel}
                    </div>
                  )}
                  {card.subText && (
                    <div className="dashboard-stat-sub">{card.subText}</div>
                  )}
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={20}>
        {/* Main Content */}
        <Col xs={24} lg={17}>
          {/* Create Section - unified container */}
          <div className="dashboard-create-wrapper" style={{ marginBottom: 20 }}>
            {nextIssue && (
              <div
                className="dashboard-create-main"
                onClick={() => handleCreateIssue(nextIssue.issue_number)}
                style={{ cursor: creating ? 'wait' : 'pointer' }}
              >
                <div className="dashboard-create-icon">
                  <PlusOutlined style={{ fontSize: 24, color: '#fff' }} />
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
            <div className="dashboard-backfill-section">
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
                      第 {item.issue_number} 期 ({dayjs(item.publish_date).format('MM-DD')})
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
            </div>
          </div>

          {/* Workflow Steps */}
          <Card size="small" style={{ marginBottom: 20 }} styles={{ body: { padding: 0 } }}>
            <div className="dashboard-workflow">
              <div className="dashboard-workflow-header">
                <span className="dashboard-workflow-title">报数流程</span>
                <span className="dashboard-workflow-desc">了解报数的标准流程</span>
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
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>近期印数</span>
                <Button type="link" onClick={() => navigate('/history')}>
                  查看全部 <RightOutlined />
                </Button>
              </div>
            }
          >
            <Table<Issue>
              dataSource={recentIssues.slice(0, 4)}
              columns={columns}
              rowKey="id"
              pagination={false}
              loading={loading}
              size="small"
              tableLayout="auto"
              onRow={(record) => ({
                onClick: () => navigate(`/report/${record.id}`),
                style: { cursor: 'pointer' },
              })}
            />
          </Card>

          {/* Trend Chart */}
          <Card
            size="small"
            style={{ marginTop: 20 }}
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  近期印数趋势
                  <Tooltip title="印数单位：份">
                    <InfoCircleOutlined style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginLeft: 6 }} />
                  </Tooltip>
                  <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 400, marginLeft: 8 }}>
                    印数单位：份
                  </span>
                </span>
              </div>
            }
          >
            {trendData.length > 0 ? (
              <ReactECharts
                style={{ height: 260 }}
                option={{
                  grid: { top: 30, right: 30, bottom: 30, left: 50 },
                  xAxis: {
                    type: 'category',
                    data: trendData.map(d => d.name),
                    axisLabel: { fontSize: 11, color: '#86868b' },
                    axisLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
                    axisTick: { show: false },
                  },
                  yAxis: {
                    type: 'value',
                    axisLabel: { fontSize: 11, color: '#86868b' },
                    axisLine: { show: false },
                    axisTick: { show: false },
                    splitLine: { lineStyle: { type: 'dashed', color: 'rgba(0,0,0,0.06)' } },
                  },
                  tooltip: {
                    trigger: 'axis',
                    formatter: (params: any) => {
                      const p = params[0];
                      return `${p.name}<br/>印数：<b>${p.value.toLocaleString()}</b> 份`;
                    },
                    backgroundColor: '#fff',
                    borderColor: 'transparent',
                    textStyle: { fontSize: 13 },
                    extraCssText: 'border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);',
                  },
                  series: [{
                    type: 'line',
                    data: trendData.map(d => d.value),
                    smooth: true,
                    symbolSize: 8,
                    itemStyle: { color: '#0071e3' },
                    lineStyle: { width: 2, color: '#0071e3' },
                    label: {
                      show: true,
                      position: 'top',
                      fontSize: 11,
                      color: '#1d1d1f',
                      fontWeight: 500,
                      formatter: (p: any) => p.value.toLocaleString(),
                    },
                  }],
                }}
              />
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
                ⚙️ 待处理事项
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
                  <div className="dashboard-pending-dot" style={{ background: '#ff4d4f' }} />
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
              <span className="dashboard-sidebar-title">💡 操作提示</span>
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
              <span className="dashboard-sidebar-title">🚀 快捷入口</span>
            </div>
            <div className="dashboard-quick-links">
              <div className="dashboard-quick-link" onClick={() => navigate('/history')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'rgba(82, 196, 26, 0.08)' }}>
                  <FileTextOutlined style={{ color: '#52c41a' }} />
                </div>
                <div className="dashboard-quick-link-text">
                  <div className="dashboard-quick-link-name">查看历史期数</div>
                  <div className="dashboard-quick-link-desc">查看所有历史报数记录</div>
                </div>
                <RightOutlined style={{ color: 'var(--color-text-secondary)', fontSize: 12 }} />
              </div>
              <div className="dashboard-quick-link" onClick={() => navigate('/templates')}>
                <div className="dashboard-quick-link-icon" style={{ background: 'rgba(0, 113, 227, 0.08)' }}>
                  <EditOutlined style={{ color: 'var(--color-accent)' }} />
                </div>
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
