import { useState, useMemo } from 'react';
import { Table, Button, Space, Card, Input, DatePicker, Segmented, Row, Col } from 'antd';
import {
  EditOutlined,
  SendOutlined,
  DownloadOutlined,
  UploadOutlined,
  SearchOutlined,
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
import { MetricCard, PageHeader, StatusPill } from '../components/UiPrimitives';

const { RangePicker } = DatePicker;

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const statusMeta = {
  draft: { label: '草稿', tone: 'warning' as const },
  confirmed: { label: '已确认', tone: 'success' as const },
  exported: { label: '已导出', tone: 'info' as const },
};

function StatusTag({ status }: { status: Issue['status'] }) {
  const meta = statusMeta[status];
  return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
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
      tone: 'info' as const,
      label: '总期数',
      value: statusCounts.all,
      suffix: '期',
      sub: '系统内已建报数',
    },
    {
      icon: <CheckCircleOutlined style={{ fontSize: 21, color: 'var(--color-success)' }} />,
      tone: 'success' as const,
      label: '已确认',
      value: statusCounts.confirmed,
      suffix: '期',
      sub: '已锁定可导出',
      subColor: 'var(--color-success)',
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 21, color: 'var(--color-warning)' }} />,
      tone: 'warning' as const,
      label: '草稿待确认',
      value: statusCounts.draft,
      suffix: '期',
      sub: '● 需处理，点此筛选',
      subColor: 'var(--color-warning)',
      onClick: () => setFilterStatus('draft'),
    },
    {
      icon: <BarChartOutlined style={{ fontSize: 21, color: 'var(--color-purple)' }} />,
      tone: 'purple' as const,
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
        <span style={{ whiteSpace: 'nowrap', color: 'var(--color-text-tertiary)' }}>
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
              navigate(`/logistics/issues/${r.id}`);
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
      <PageHeader
        title="历史印数期数"
        description="检索所有历史报数期数，直达报数、中通明细与导出。"
        actions={<Button icon={<UploadOutlined />} onClick={() => navigate('/history-import')}>导入往期</Button>}
      />

      <Row gutter={16} style={{ marginBottom: 20 }}>
        {statCards.map((card, idx) => (
          <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
            <MetricCard
              loading={loading}
              onClick={card.onClick}
              icon={card.icon}
              tone={card.tone}
              label={card.label}
              value={card.value}
              suffix={card.suffix}
              note={card.sub}
              noteTone={card.subColor ? card.tone : undefined}
            />
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
