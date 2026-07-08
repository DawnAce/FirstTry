import { useState, useMemo } from 'react';
import { Table, Button, Space, Card, Input, Select, Segmented, Tooltip, Row, Col, Tag } from 'antd';
import {
  SendOutlined,
  DownloadOutlined,
  SearchOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getPeriodsOverview } from '../api/logisticsOverview';
import type { PeriodRow, PeriodStatus } from '../api/logisticsOverview';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 单一「上传状态」→ antd Tag 预设色（house style：状态一律用 Tag）。
const statusTagColor: Record<PeriodStatus, string> = {
  已上传: 'green',
  异常: 'red',
  待上传: 'gold',
  草稿: 'orange',
  未创建: 'default',
};

function StatusTag({ status }: { status: PeriodStatus }) {
  return (
    <Tag color={statusTagColor[status]} style={{ marginInlineEnd: 0 }}>
      {status}
    </Tag>
  );
}

// 对账差值列（镜像单期页对账卡）：未传→—，一致→绿，少发→红「差N」，多发→红「多N」。
function renderDelta(row: PeriodRow) {
  if (row.detail_count === 0) {
    return <span style={{ color: '#86868b' }}>—</span>;
  }
  if (row.delta === 0) {
    return <span style={{ color: '#389e0d' }}>一致</span>;
  }
  const magnitude = Math.abs(row.delta).toLocaleString();
  return (
    <span style={{ color: '#cf1322', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {row.delta > 0 ? `差 ${magnitude} 份` : `多 ${magnitude} 份`}
    </span>
  );
}

// 待上传家族含未创建（决策②）。
function matchStatus(row: PeriodRow, filter: string): boolean {
  if (filter === 'all') return true;
  if (filter === '待上传') return row.status === '待上传' || row.status === '未创建';
  return row.status === filter;
}

export default function LogisticsIssues() {
  const navigate = useNavigate();
  const [searchNumber, setSearchNumber] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterYear, setFilterYear] = useState<number | 'all'>('all');

  const { data, isLoading: loading } = useQuery({
    queryKey: ['logistics-overview', 'periods'],
    queryFn: async () => (await getPeriodsOverview()).data,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const yearOptions = useMemo(() => {
    const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => b - a);
    return [
      { label: '全部年份', value: 'all' as number | 'all' },
      ...years.map((y) => ({ label: `${y} 年`, value: y as number | 'all' })),
    ];
  }, [rows]);

  const yearRows = useMemo(
    () => (filterYear === 'all' ? rows : rows.filter((r) => r.year === filterYear)),
    [rows, filterYear],
  );

  const counts = useMemo(() => {
    const c = { all: yearRows.length, 已上传: 0, 异常: 0, 待上传: 0, 草稿: 0 };
    yearRows.forEach((r) => {
      if (r.status === '已上传') c.已上传 += 1;
      else if (r.status === '异常') c.异常 += 1;
      else if (r.status === '草稿') c.草稿 += 1;
      else c.待上传 += 1; // 待上传 + 未创建
    });
    return c;
  }, [yearRows]);

  const filtered = useMemo(
    () =>
      yearRows.filter((r) => {
        if (searchNumber && !String(r.issue_number).includes(searchNumber)) return false;
        return matchStatus(r, filterStatus);
      }),
    [yearRows, searchNumber, filterStatus],
  );

  const statCards = [
    {
      icon: <FileTextOutlined style={{ fontSize: 21, color: 'var(--color-accent)' }} />,
      bg: 'rgba(0, 113, 227, 0.08)',
      label: '全部期数',
      value: counts.all,
      suffix: '期',
      sub: filterYear === 'all' ? '不含休刊' : `${filterYear} 年`,
      filter: 'all',
    },
    {
      icon: <CheckCircleOutlined style={{ fontSize: 21, color: '#52c41a' }} />,
      bg: 'rgba(82, 196, 26, 0.08)',
      label: '已上传',
      value: counts.已上传,
      suffix: '期',
      sub: '明细已录入',
      subColor: '#52c41a',
      filter: '已上传',
    },
    {
      icon: <ClockCircleOutlined style={{ fontSize: 21, color: '#fa8c16' }} />,
      bg: 'rgba(250, 173, 20, 0.08)',
      label: '待上传',
      value: counts.待上传,
      suffix: '期',
      sub: '● 含未创建，点此筛选',
      subColor: '#fa8c16',
      filter: '待上传',
    },
    {
      icon: <WarningOutlined style={{ fontSize: 21, color: '#cf1322' }} />,
      bg: 'rgba(207, 19, 34, 0.08)',
      label: '异常',
      value: counts.异常,
      suffix: '期',
      sub: '● 差值≠0，点此排查',
      subColor: '#cf1322',
      filter: '异常',
    },
    {
      icon: <EditOutlined style={{ fontSize: 21, color: '#722ed1' }} />,
      bg: 'rgba(114, 46, 209, 0.08)',
      label: '草稿',
      value: counts.草稿,
      suffix: '期',
      sub: '报数未确认',
      filter: '草稿',
    },
  ];

  const columns: TableColumnsType<PeriodRow> = [
    {
      title: '期号',
      dataIndex: 'issue_number',
      sorter: (a, b) => a.issue_number - b.issue_number,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>第 {r.issue_number} 期</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>{r.year} 年</div>
        </div>
      ),
    },
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      sorter: (a, b) => dayjs(a.publish_date).valueOf() - dayjs(b.publish_date).valueOf(),
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
      title: '报数份数',
      dataIndex: 'report_zt_total',
      align: 'right',
      render: (_, r) =>
        r.issue_id == null ? (
          <span style={{ color: '#86868b' }}>—</span>
        ) : (
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.report_zt_total.toLocaleString()}</span>
        ),
    },
    {
      title: '发货份数',
      dataIndex: 'shipping_total',
      align: 'right',
      render: (_, r) =>
        r.detail_count > 0 ? (
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.shipping_total.toLocaleString()}</span>
        ) : (
          <span style={{ color: '#86868b' }}>—</span>
        ),
    },
    {
      title: '对账差值',
      dataIndex: 'delta',
      align: 'right',
      sorter: (a, b) => a.delta - b.delta,
      render: (_, r) => renderDelta(r),
    },
    {
      title: '异常说明',
      dataIndex: 'exception_note',
      render: (_, r) => <span style={{ color: '#5a5a62' }}>{r.exception_note}</span>,
    },
    {
      title: '最后更新时间',
      dataIndex: 'last_updated_at',
      render: (_, r) => (
        <span style={{ whiteSpace: 'nowrap', color: '#5a5a62' }}>
          {r.last_updated_at ? dayjs(r.last_updated_at).format('YYYY-MM-DD HH:mm') : '—'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, r) =>
        r.issue_id == null ? (
          <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); navigate('/'); }}>
            去创建
          </Button>
        ) : (
          <Space size={4} style={{ whiteSpace: 'nowrap' }}>
            <Button
              size="small"
              type="link"
              icon={<SendOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/recipients?tab=shipping&issueId=${r.issue_id}`);
              }}
            >
              进入详情
            </Button>
            <Button
              size="small"
              type="text"
              icon={<DownloadOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                window.open(`/api/issues/${r.issue_id}/export/all`, '_blank');
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
      <div style={{ marginBottom: 20 }}>
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
          期数总览
          <Tooltip title="按期纵览 报数 / 发货 / 对账差值 / 状态，直达单期明细">
            <InfoCircleOutlined style={{ fontSize: 15, color: 'var(--color-text-secondary)' }} />
          </Tooltip>
        </h2>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
          查看所有期数上传进度与异常情况，进入单期处理具体发货数据。
        </p>
      </div>

      <Row gutter={16} style={{ marginBottom: 20 }}>
        {statCards.map((card, idx) => (
          <Col flex="1" key={idx} style={{ display: 'flex', minWidth: 150 }}>
            <Card
              loading={loading}
              className="dashboard-stat-card"
              size="small"
              style={{ flex: 1, cursor: 'pointer' }}
              onClick={() => setFilterStatus(card.filter)}
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
            value={filterStatus}
            onChange={(val) => setFilterStatus(String(val))}
            options={[
              { label: <span>全部<span className="history-seg-count">{counts.all}</span></span>, value: 'all' },
              { label: <span>已上传<span className="history-seg-count">{counts.已上传}</span></span>, value: '已上传' },
              { label: <span>异常<span className="history-seg-count">{counts.异常}</span></span>, value: '异常' },
              { label: <span>待上传<span className="history-seg-count">{counts.待上传}</span></span>, value: '待上传' },
              { label: <span>草稿<span className="history-seg-count">{counts.草稿}</span></span>, value: '草稿' },
            ]}
          />
          <Select
            value={filterYear}
            onChange={(val) => setFilterYear(val)}
            options={yearOptions}
            style={{ width: 130 }}
          />
          <Input
            placeholder="搜索期号"
            prefix={<SearchOutlined />}
            allowClear
            value={searchNumber}
            onChange={(e) => setSearchNumber(e.target.value)}
            style={{ width: 170 }}
          />
          <span className="history-toolbar-count">
            共 <b>{filtered.length}</b> 期
          </span>
        </div>
        <Table
          columns={columns}
          dataSource={filtered}
          rowKey="issue_number"
          loading={loading}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
          }}
          onRow={(record) => ({
            onClick: () => {
              if (record.issue_id == null) navigate('/');
              else navigate(`/recipients?tab=shipping&issueId=${record.issue_id}`);
            },
            style: { cursor: 'pointer' },
          })}
        />
      </Card>
    </div>
  );
}
