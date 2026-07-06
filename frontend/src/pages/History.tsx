import { useState, useMemo } from 'react';
import { Table, Button, Space, Card, Input, DatePicker, Segmented, Tooltip, Row, Col } from 'antd';
import {
  EditOutlined,
  SendOutlined,
  DownloadOutlined,
  UploadOutlined,
  SearchOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getIssues } from '../api/issues';
import type { Issue } from '../api/issues';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

const { RangePicker } = DatePicker;

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const statusMeta: Record<Issue['status'], { label: string; className: string }> = {
  draft: { label: '草稿', className: 'history-status history-status--draft' },
  confirmed: { label: '已确认', className: 'history-status history-status--confirmed' },
  exported: { label: '已导出', className: 'history-status history-status--exported' },
};

function StatusTag({ status }: { status: Issue['status'] }) {
  const meta = statusMeta[status];
  return (
    <span className={meta.className}>
      <span className="history-status-dot" />
      {meta.label}
    </span>
  );
}

export default function History() {
  const navigate = useNavigate();
  const [searchNumber, setSearchNumber] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const { data: issues = [], isLoading: loading } = useQuery({
    queryKey: ['issues', 'history'],
    queryFn: async () => {
      const res = await getIssues(0, 100);
      return res.data;
    },
  });

  const statusCounts = useMemo(() => {
    const counts: Record<'all' | Issue['status'], number> = { all: issues.length, draft: 0, confirmed: 0, exported: 0 };
    issues.forEach((i) => {
      counts[i.status] += 1;
    });
    return counts;
  }, [issues]);

  const yearStats = useMemo(() => {
    const year = dayjs().year();
    const yearIssues = issues.filter((i) => dayjs(i.publish_date).year() === year);
    const total = yearIssues.reduce((sum, i) => sum + (i.print_total ?? 0), 0);
    const reported = yearIssues.filter((i) => (i.print_total ?? 0) > 0).length;
    return { year, total, reported };
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (searchNumber && !String(issue.issue_number).includes(searchNumber)) {
        return false;
      }
      if (filterStatus && issue.status !== filterStatus) {
        return false;
      }
      if (dateRange && dateRange[0] && dateRange[1]) {
        const publishDate = dayjs(issue.publish_date);
        if (publishDate.isBefore(dateRange[0], 'day') || publishDate.isAfter(dateRange[1], 'day')) {
          return false;
        }
      }
      return true;
    });
  }, [issues, searchNumber, filterStatus, dateRange]);

  const statCards = [
    {
      icon: <FileTextOutlined style={{ fontSize: 21, color: 'var(--color-accent)' }} />,
      bg: 'rgba(0, 113, 227, 0.08)',
      label: '总期数',
      value: statusCounts.all,
      suffix: '期',
      sub: '系统内已建报数',
    },
    {
      icon: <CheckCircleOutlined style={{ fontSize: 21, color: '#52c41a' }} />,
      bg: 'rgba(82, 196, 26, 0.08)',
      label: '已确认',
      value: statusCounts.confirmed,
      suffix: '期',
      sub: '已锁定可导出',
      subColor: '#52c41a',
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 21, color: '#fa8c16' }} />,
      bg: 'rgba(250, 173, 20, 0.08)',
      label: '草稿待确认',
      value: statusCounts.draft,
      suffix: '期',
      sub: '● 需处理，点此筛选',
      subColor: '#fa8c16',
      onClick: () => setFilterStatus('draft'),
    },
    {
      icon: <BarChartOutlined style={{ fontSize: 21, color: '#722ed1' }} />,
      bg: 'rgba(114, 46, 209, 0.08)',
      label: '本年累计印数',
      value: yearStats.total.toLocaleString(),
      suffix: '份',
      sub: `${yearStats.year} 年 · ${yearStats.reported} 期已报`,
    },
  ];

  const columns: TableColumnsType<Issue> = [
    {
      title: '期号',
      dataIndex: 'issue_number',
      sorter: (a, b) => a.issue_number - b.issue_number,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>第 {r.issue_number} 期</div>
          {r.year_issue_label ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {dayjs(r.publish_date).year()}年第{r.year_issue_label}期
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      render: (_, r) => (
        <div>
          <div style={{ whiteSpace: 'nowrap' }}>{dayjs(r.publish_date).format('YYYY-MM-DD')}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{WEEKDAYS[dayjs(r.publish_date).day()]}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (_, r) => <StatusTag status={r.status} />,
    },
    {
      title: '印数（份）',
      dataIndex: 'print_total',
      align: 'right',
      render: (_, r) =>
        r.print_total ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.print_total.toLocaleString()}</span>
        ) : (
          <span className="history-print-empty">待录入</span>
        ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      render: (_, r) => (
        <span style={{ whiteSpace: 'nowrap', color: '#5a5a62' }}>
          {r.created_at ? `创建于 ${dayjs(r.created_at).format('MM-DD HH:mm')}` : '—'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, r) => (
        <Space size={4} style={{ whiteSpace: 'nowrap' }}>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/report/${r.id}`);
            }}
          >
            {r.status === 'draft' ? '去报数' : '报数'}
          </Button>
          <Button
            size="small"
            type="text"
            icon={<SendOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/recipients?tab=shipping&issueId=${r.id}`);
            }}
          >
            中通明细
          </Button>
          <Button
            size="small"
            type="text"
            icon={<DownloadOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/api/issues/${r.id}/export/all`, '_blank');
            }}
          >
            导出
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="history-page">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: '#1d1d1f',
              margin: 0,
              letterSpacing: '-0.02em',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            历史印数期数
            <Tooltip title="检索所有历史报数期数，直达 报数 / 中通明细 / 导出">
              <InfoCircleOutlined style={{ fontSize: 15, color: 'var(--color-text-secondary)' }} />
            </Tooltip>
          </h2>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
            检索所有历史报数期数，直达 报数 / 中通明细 / 导出。
          </p>
        </div>
        <Button icon={<UploadOutlined />} onClick={() => navigate('/history-import')}>
          导入往期
        </Button>
      </div>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        {statCards.map((card, idx) => (
          <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
            <Card
              loading={loading}
              className="dashboard-stat-card"
              size="small"
              style={{ flex: 1, cursor: card.onClick ? 'pointer' : 'default' }}
              onClick={card.onClick}
            >
              <div className="dashboard-stat-card-inner">
                <div className="dashboard-stat-icon" style={{ background: card.bg }}>
                  {card.icon}
                </div>
                <div className="dashboard-stat-content">
                  <div className="dashboard-stat-label">{card.label}</div>
                  <div className="dashboard-stat-value">
                    {card.value}
                    {card.suffix && <span className="dashboard-stat-suffix"> {card.suffix}</span>}
                  </div>
                  <div className="dashboard-stat-sub" style={card.subColor ? { color: card.subColor } : undefined}>
                    {card.sub}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      <Card styles={{ body: { padding: 0 } }}>
        <div className="history-toolbar">
          <Segmented
            value={filterStatus ?? 'all'}
            onChange={(val) => setFilterStatus(val === 'all' ? undefined : String(val))}
            options={[
              { label: <span>全部<span className="history-seg-count">{statusCounts.all}</span></span>, value: 'all' },
              { label: <span>草稿<span className="history-seg-count">{statusCounts.draft}</span></span>, value: 'draft' },
              { label: <span>已确认<span className="history-seg-count">{statusCounts.confirmed}</span></span>, value: 'confirmed' },
              { label: <span>已导出<span className="history-seg-count">{statusCounts.exported}</span></span>, value: 'exported' },
            ]}
          />
          <Input
            placeholder="搜索期号"
            prefix={<SearchOutlined />}
            allowClear
            value={searchNumber}
            onChange={(e) => setSearchNumber(e.target.value)}
            style={{ width: 170 }}
          />
          <RangePicker
            placeholder={['开始日期', '结束日期']}
            value={dateRange}
            onChange={(dates) => setDateRange(dates)}
            style={{ width: 240 }}
          />
          <span className="history-toolbar-count">
            共 <b>{filteredIssues.length}</b> 期
          </span>
        </div>
        <Table
          columns={columns}
          dataSource={filteredIssues}
          rowKey="id"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
          }}
          onRow={(record) => ({
            onClick: () => navigate(`/report/${record.id}`),
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </div>
  );
}
