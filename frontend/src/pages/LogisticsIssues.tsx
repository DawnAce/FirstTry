import { useMemo, useState } from 'react';
import { Button, Card, Input, Progress, Segmented, Select, Space, Table, Tag } from 'antd';
import { DownloadOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { getPeriodsOverview } from '../api/logisticsOverview';
import type { PeriodRow, PlanStatus, WaybillStatus } from '../api/logisticsOverview';
import { PageHeader } from '../components/UiPrimitives';

const planStatusColor: Record<PlanStatus, string> = {
  未创建: 'default',
  草稿: 'orange',
  待导入: 'gold',
  有差异: 'red',
  有变更: 'orange',
  已就绪: 'green',
};

const waybillStatusColor: Record<WaybillStatus, string> = {
  未开始: 'default',
  待上传: 'gold',
  部分完成: 'orange',
  已完成: 'green',
  需核对: 'red',
};

function countBy<T extends string>(rows: PeriodRow[], field: 'plan_status' | 'waybill_status', values: T[]) {
  return values.reduce<Record<string, number>>((result, value) => {
    result[value] = rows.filter((row) => row[field] === value).length;
    return result;
  }, { all: rows.length });
}

export default function LogisticsIssues() {
  const navigate = useNavigate();
  const [searchNumber, setSearchNumber] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | PlanStatus>('all');
  const [waybillFilter, setWaybillFilter] = useState<'all' | WaybillStatus>('all');
  const [filterYear, setFilterYear] = useState<number | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['logistics-overview', 'periods'],
    queryFn: async () => (await getPeriodsOverview()).data,
  });

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const yearOptions = useMemo(() => {
    const years = Array.from(new Set(rows.map((row) => row.year))).sort((a, b) => b - a);
    return [
      { label: '全部年份', value: 'all' as const },
      ...years.map((year) => ({ label: `${year} 年`, value: year })),
    ];
  }, [rows]);
  const yearRows = useMemo(
    () => (filterYear === 'all' ? rows : rows.filter((row) => row.year === filterYear)),
    [filterYear, rows],
  );
  const planCounts = useMemo(
    () => countBy(yearRows, 'plan_status', ['待导入', '已就绪', '有差异', '有变更', '草稿', '未创建']),
    [yearRows],
  );
  const waybillCounts = useMemo(
    () => countBy(yearRows, 'waybill_status', ['待上传', '部分完成', '已完成', '需核对', '未开始']),
    [yearRows],
  );
  const filtered = useMemo(() => yearRows.filter((row) => {
    if (searchNumber && !String(row.issue_number).includes(searchNumber.trim())) return false;
    if (planFilter !== 'all' && row.plan_status !== planFilter) return false;
    if (waybillFilter !== 'all' && row.waybill_status !== waybillFilter) return false;
    return true;
  }), [planFilter, searchNumber, waybillFilter, yearRows]);

  const columns: TableColumnsType<PeriodRow> = [
    {
      title: '期数',
      dataIndex: 'issue_number',
      width: 116,
      sorter: (a, b) => a.issue_number - b.issue_number,
      render: (_, row) => (
        <div className="logistics-period-cell">
          <strong>第 {row.issue_number} 期</strong>
        </div>
      ),
    },
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      width: 126,
      sorter: (a, b) => dayjs(a.publish_date).valueOf() - dayjs(b.publish_date).valueOf(),
      render: (value: string) => (
        <div className="logistics-date-cell">
          <span>{dayjs(value).format('YYYY-MM-DD')}</span>
        </div>
      ),
    },
    {
      title: '计划状态',
      dataIndex: 'plan_status',
      width: 104,
      render: (status: PlanStatus) => <Tag color={planStatusColor[status]}>{status}</Tag>,
    },
    {
      title: '计划份数',
      dataIndex: 'shipping_total',
      width: 104,
      align: 'right',
      render: (value: number, row) => row.detail_count
        ? <span className="logistics-number">{value.toLocaleString()}</span>
        : <span className="logistics-muted">—</span>,
    },
    {
      title: '实际发货状态',
      dataIndex: 'waybill_status',
      width: 118,
      render: (status: WaybillStatus) => <Tag color={waybillStatusColor[status]}>{status}</Tag>,
    },
    {
      title: '实际发货进度',
      key: 'progress',
      width: 210,
      render: (_, row) => {
        if (!row.shipping_total) return <span className="logistics-muted">尚无发货计划</span>;
        const percent = Math.min(100, Math.round((row.handled_total / row.shipping_total) * 100));
        return (
          <div className="logistics-progress-cell">
            <div>
              <strong>{row.actual_shipped_total.toLocaleString()}</strong>
              <span> / {row.shipping_total.toLocaleString()} 份实际寄出</span>
              {row.handled_total !== row.actual_shipped_total && <small>已核销 {row.handled_total.toLocaleString()} 份</small>}
            </div>
            <Progress percent={percent} showInfo={false} size="small" status={row.waybill_status === '需核对' ? 'exception' : 'normal'} />
          </div>
        );
      },
    },
    {
      title: '待处理',
      dataIndex: 'pending_quantity',
      width: 88,
      align: 'right',
      render: (value: number) => (
        <span className={value ? 'logistics-number is-warning' : 'logistics-number'}>{value.toLocaleString()}</span>
      ),
    },
    {
      title: '最后更新',
      dataIndex: 'last_updated_at',
      width: 142,
      render: (value: string | null) => <span className="logistics-muted">{value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—'}</span>,
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 136,
      render: (_, row) => row.issue_id == null ? <span className="logistics-muted">尚未开期</span> : (
        <Space size={0}>
          <Button type="link" size="small" onClick={(event) => {
            event.stopPropagation();
            navigate(`/logistics/issues/${row.issue_id}`);
          }}>查看 <RightOutlined /></Button>
          <Button type="text" size="small" icon={<DownloadOutlined />} aria-label="导出本期" onClick={(event) => {
            event.stopPropagation();
            window.open(`/api/issues/${row.issue_id}/export/all`, '_blank');
          }} />
        </Space>
      ),
    },
  ];

  return (
    <div className="history-page logistics-periods-page">
      <PageHeader
        title="快递管理"
        description="发货计划与实际发货分开管理；上传运单不会修改计划。"
      />

      <div className="logistics-summary-grid">
        <Card size="small" className="logistics-summary-card">
          <span>发货计划</span>
          <strong>{(planCounts.已就绪 ?? 0).toLocaleString()} <small>期已就绪</small></strong>
          <em>{(planCounts.待导入 ?? 0) + (planCounts.有差异 ?? 0) + (planCounts.有变更 ?? 0)} 期待处理</em>
        </Card>
        <Card size="small" className="logistics-summary-card">
          <span>实际发货</span>
          <strong>{(waybillCounts.已完成 ?? 0).toLocaleString()} <small>期已完成</small></strong>
          <em>{(waybillCounts.待上传 ?? 0) + (waybillCounts.部分完成 ?? 0) + (waybillCounts.需核对 ?? 0)} 期待处理</em>
        </Card>
        <Card size="small" className="logistics-summary-card is-neutral">
          <span>当前范围</span>
          <strong>{yearRows.length.toLocaleString()} <small>期</small></strong>
          <em>计划、运单可组合筛选</em>
        </Card>
      </div>

      <Card styles={{ body: { padding: 0 } }}>
        <div className="logistics-filter-panel">
          <div className="logistics-filter-row">
            <span className="logistics-filter-label">计划状态</span>
            <Segmented
              value={planFilter}
              onChange={(value) => setPlanFilter(value as 'all' | PlanStatus)}
              options={[
                { label: `全部 ${planCounts.all}`, value: 'all' },
                { label: `待导入 ${planCounts.待导入 ?? 0}`, value: '待导入' },
                { label: `已就绪 ${planCounts.已就绪 ?? 0}`, value: '已就绪' },
                { label: `有差异 ${planCounts.有差异 ?? 0}`, value: '有差异' },
                { label: `有变更 ${planCounts.有变更 ?? 0}`, value: '有变更' },
                { label: `草稿 ${planCounts.草稿 ?? 0}`, value: '草稿' },
                { label: `未创建 ${planCounts.未创建 ?? 0}`, value: '未创建' },
              ]}
            />
          </div>
          <div className="logistics-filter-row">
            <span className="logistics-filter-label">运单状态</span>
            <Segmented
              value={waybillFilter}
              onChange={(value) => setWaybillFilter(value as 'all' | WaybillStatus)}
              options={[
                { label: `全部 ${waybillCounts.all}`, value: 'all' },
                { label: `待上传 ${waybillCounts.待上传 ?? 0}`, value: '待上传' },
                { label: `部分完成 ${waybillCounts.部分完成 ?? 0}`, value: '部分完成' },
                { label: `已完成 ${waybillCounts.已完成 ?? 0}`, value: '已完成' },
                { label: `需核对 ${waybillCounts.需核对 ?? 0}`, value: '需核对' },
                { label: `未开始 ${waybillCounts.未开始 ?? 0}`, value: '未开始' },
              ]}
            />
          </div>
          <div className="logistics-filter-tools">
            <Select value={filterYear} onChange={setFilterYear} options={yearOptions} style={{ width: 124 }} />
            <Input
              placeholder="搜索期号"
              prefix={<SearchOutlined />}
              allowClear
              value={searchNumber}
              onChange={(event) => setSearchNumber(event.target.value)}
              style={{ width: 160 }}
            />
            <span>共 <b>{filtered.length}</b> 期</span>
          </div>
        </div>
        <Table
          className="logistics-period-table"
          columns={columns}
          dataSource={filtered}
          rowKey="issue_number"
          loading={isLoading}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 期` }}
          onRow={(row) => ({
            onClick: row.issue_id == null ? undefined : () => navigate(`/logistics/issues/${row.issue_id}`),
            className: row.issue_id == null ? 'is-disabled' : 'is-clickable',
          })}
        />
      </Card>
    </div>
  );
}
