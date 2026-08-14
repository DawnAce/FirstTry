import { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, Progress, Segmented, Select, Space, Table, Tag } from 'antd';
import {
  DownloadOutlined,
  RightOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import { getPeriodsOverview } from '../api/logisticsOverview';
import type { PeriodRow, PlanStatus, WaybillStatus } from '../api/logisticsOverview';
import { PageHeader } from '../components/UiPrimitives';
import { useAuth } from '../contexts/AuthContext';

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

export type LogisticsIssuesMode = 'plan' | 'actual';

export default function LogisticsIssues({ mode = 'plan' }: { mode?: LogisticsIssuesMode }) {
  const navigate = useNavigate();
  const { isAdmin, canMutate } = useAuth();
  const [searchNumber, setSearchNumber] = useState('');
  const [planFilter, setPlanFilter] = useState<'all' | PlanStatus>('all');
  const [waybillFilter, setWaybillFilter] = useState<'all' | WaybillStatus>('all');
  const [filterYear, setFilterYear] = useState<number | 'all'>('all');

  const { data, isLoading, isError, refetch } = useQuery({
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
  const actualRows = useMemo(
    () => yearRows.filter((row) => row.detail_count > 0 || row.shipping_total > 0),
    [yearRows],
  );
  const planCounts = useMemo(
    () => countBy(yearRows, 'plan_status', ['待导入', '已就绪', '有差异', '有变更', '草稿', '未创建']),
    [yearRows],
  );
  const waybillCounts = useMemo(
    () => countBy(actualRows, 'waybill_status', ['待上传', '部分完成', '已完成', '需核对', '未开始']),
    [actualRows],
  );
  const sourceRows = mode === 'plan' ? yearRows : actualRows;
  const filtered = useMemo(() => sourceRows.filter((row) => {
    if (searchNumber && !String(row.issue_number).includes(searchNumber.trim())) return false;
    if (mode === 'plan' && planFilter !== 'all' && row.plan_status !== planFilter) return false;
    if (mode === 'actual' && waybillFilter !== 'all' && row.waybill_status !== waybillFilter) return false;
    return true;
  }), [mode, planFilter, searchNumber, sourceRows, waybillFilter]);

  if (isError) {
    return (
      <div className="history-page logistics-periods-page">
        <PageHeader
          title={mode === 'plan' ? '发货计划' : '实际发货'}
          description="计划是发货依据，实际发货补充运单和实发结果；两者关联但互不覆盖。"
        />
        <Alert
          type="error"
          showIcon
          message="数据加载失败"
          description="当前无法读取快递数据。这不代表数据为空，请检查服务后重新加载。"
          action={<Button size="small" onClick={() => void refetch()}>重新加载</Button>}
        />
      </div>
    );
  }

  const openIssue = (row: PeriodRow, section: LogisticsIssuesMode = mode) => {
    if (row.issue_id == null) return;
    navigate(`/logistics/issues/${row.issue_id}?section=${section}`);
  };

  const commonColumns: TableColumnsType<PeriodRow> = [
    {
      title: '期数',
      dataIndex: 'issue_number',
      width: 112,
      sorter: (a, b) => a.issue_number - b.issue_number,
      render: (_, row) => <div className="logistics-period-cell"><strong>第 {row.issue_number} 期</strong></div>,
    },
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      width: 122,
      sorter: (a, b) => dayjs(a.publish_date).valueOf() - dayjs(b.publish_date).valueOf(),
      render: (value: string) => <div className="logistics-date-cell"><span>{dayjs(value).format('YYYY-MM-DD')}</span></div>,
    },
  ];

  const planColumns: TableColumnsType<PeriodRow> = [
    ...commonColumns,
    {
      title: '计划状态',
      dataIndex: 'plan_status',
      width: 104,
      render: (status: PlanStatus) => <Tag color={planStatusColor[status]}>{status}</Tag>,
    },
    {
      title: '计划应发',
      dataIndex: 'report_zt_total',
      width: 104,
      align: 'right',
      render: (value: number) => <span className="logistics-number">{value.toLocaleString()} 份</span>,
    },
    {
      title: '计划明细',
      dataIndex: 'shipping_total',
      width: 104,
      align: 'right',
      render: (value: number, row) => row.detail_count
        ? <span className="logistics-number">{value.toLocaleString()} 份</span>
        : <span className="logistics-muted">尚未导入</span>,
    },
    {
      title: '收件明细',
      dataIndex: 'detail_count',
      width: 96,
      align: 'right',
      render: (value: number) => <span className="logistics-number">{value.toLocaleString()} 条</span>,
    },
    {
      title: '数量差异',
      dataIndex: 'delta',
      width: 96,
      align: 'right',
      render: (value: number) => value
        ? <span className="logistics-number is-warning">{value > 0 ? `少 ${value.toLocaleString()}` : `多 ${Math.abs(value).toLocaleString()}`} 份</span>
        : <span className="logistics-muted">无差异</span>,
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
      width: 154,
      render: (_, row) => row.issue_id == null ? <span className="logistics-muted">尚未开期</span> : (
        <Space size={0}>
          <Button type="link" size="small" icon={!row.detail_count && isAdmin ? <UploadOutlined /> : undefined} onClick={(event) => {
            event.stopPropagation();
            if (!row.detail_count && isAdmin) navigate(`/logistics/issues/${row.issue_id}?section=plan&action=import`);
            else openIssue(row, 'plan');
          }}>{row.detail_count ? (['有差异', '有变更'].includes(row.plan_status) ? '处理计划' : '查看计划') : isAdmin ? '导入计划' : '查看计划'} <RightOutlined /></Button>
          <Button type="text" size="small" icon={<DownloadOutlined />} aria-label="导出本期计划" onClick={(event) => {
            event.stopPropagation();
            window.open(`/api/issues/${row.issue_id}/export/all`, '_blank');
          }} />
        </Space>
      ),
    },
  ];

  const actualColumns: TableColumnsType<PeriodRow> = [
    ...commonColumns,
    {
      title: '实际发货状态',
      dataIndex: 'waybill_status',
      width: 118,
      render: (status: WaybillStatus) => <Tag color={waybillStatusColor[status]}>{status}</Tag>,
    },
    {
      title: '计划明细',
      dataIndex: 'detail_count',
      width: 96,
      align: 'right',
      render: (value: number) => <span className="logistics-number">{value.toLocaleString()} 条</span>,
    },
    {
      title: '实际发货进度',
      key: 'progress',
      width: 260,
      render: (_, row) => {
        const percent = row.shipping_total ? Math.min(100, Math.round((row.handled_total / row.shipping_total) * 100)) : 0;
        return (
          <div className="logistics-progress-cell">
            <div>
              <strong>{row.actual_shipped_total.toLocaleString()}</strong>
              <span> / {row.shipping_total.toLocaleString()} 份实际寄出</span>
              {row.handled_total !== row.actual_shipped_total && <small>已处理 {row.handled_total.toLocaleString()} 份</small>}
            </div>
            <Progress percent={percent} showInfo={false} size="small" status={row.waybill_status === '需核对' ? 'exception' : 'normal'} />
          </div>
        );
      },
    },
    {
      title: '待处理',
      dataIndex: 'pending_quantity',
      width: 92,
      align: 'right',
      render: (value: number) => <span className={value ? 'logistics-number is-warning' : 'logistics-number'}>{value.toLocaleString()} 份</span>,
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
      width: 156,
      render: (_, row) => (
        <Space size={0}>
          <Button type="link" size="small" onClick={(event) => {
            event.stopPropagation();
            if (canMutate && ['待上传', '未开始', '部分完成'].includes(row.waybill_status)) {
              navigate(`/logistics/issues/${row.issue_id}/waybills/import`);
            } else openIssue(row, 'actual');
          }}>
            {!canMutate ? '查看发货' : row.waybill_status === '待上传' || row.waybill_status === '未开始'
              ? '上传运单'
              : row.waybill_status === '部分完成'
                ? '继续处理'
                : row.waybill_status === '需核对' ? '去核对' : '查看发货'} <RightOutlined />
          </Button>
          <Button type="text" size="small" icon={<DownloadOutlined />} aria-label="导出实际发货" onClick={(event) => {
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
        title={mode === 'plan' ? '发货计划' : '实际发货'}
        description={mode === 'plan'
          ? '维护收件人、地址与计划应发份数，不含运单信息。'
          : '沿用发货计划信息，补充运单、实际收件调整与实发结果。'}
      />

      <div className="logistics-summary-grid">
        {mode === 'plan' ? <>
          <Card size="small" className="logistics-summary-card"><span>已就绪</span><strong>{planCounts.已就绪 ?? 0}<small> 期</small></strong><em>可进入实际发货</em></Card>
          <Card size="small" className="logistics-summary-card"><span>待导入</span><strong>{planCounts.待导入 ?? 0}<small> 期</small></strong><em>尚无计划明细</em></Card>
          <Card size="small" className="logistics-summary-card is-neutral"><span>差异 / 变更</span><strong>{(planCounts.有差异 ?? 0) + (planCounts.有变更 ?? 0)}<small> 期</small></strong><em>需要核对计划</em></Card>
        </> : <>
          <Card size="small" className="logistics-summary-card"><span>已完成</span><strong>{waybillCounts.已完成 ?? 0}<small> 期</small></strong><em>实际发货已处理</em></Card>
          <Card size="small" className="logistics-summary-card"><span>待上传 / 部分完成</span><strong>{(waybillCounts.待上传 ?? 0) + (waybillCounts.部分完成 ?? 0)}<small> 期</small></strong><em>继续补充运单</em></Card>
          <Card size="small" className="logistics-summary-card is-neutral"><span>需核对</span><strong>{waybillCounts.需核对 ?? 0}<small> 期</small></strong><em>计划变化或数据冲突</em></Card>
        </>}
      </div>

      <Card className="logistics-list-card" styles={{ body: { padding: 0 } }}>
        <div className="logistics-filter-panel">
          <div className="logistics-filter-row">
            <span className="logistics-filter-label">{mode === 'plan' ? '计划状态' : '发货状态'}</span>
            {mode === 'plan' ? <Segmented
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
            /> : <Segmented
              value={waybillFilter}
              onChange={(value) => setWaybillFilter(value as 'all' | WaybillStatus)}
              options={[
                { label: `全部 ${waybillCounts.all}`, value: 'all' },
                { label: `待上传 ${waybillCounts.待上传 ?? 0}`, value: '待上传' },
                { label: `部分完成 ${waybillCounts.部分完成 ?? 0}`, value: '部分完成' },
                { label: `已完成 ${waybillCounts.已完成 ?? 0}`, value: '已完成' },
                { label: `需核对 ${waybillCounts.需核对 ?? 0}`, value: '需核对' },
              ]}
            />}
          </div>
          <div className="logistics-filter-tools">
            <Select value={filterYear} onChange={setFilterYear} options={yearOptions} style={{ width: 118 }} />
            <Input placeholder="搜索期号" prefix={<SearchOutlined />} allowClear value={searchNumber} onChange={(event) => setSearchNumber(event.target.value)} style={{ width: 150 }} />
            <span>共 <b>{filtered.length}</b> 期</span>
          </div>
        </div>
        <Table
          className="logistics-period-table"
          columns={mode === 'plan' ? planColumns : actualColumns}
          dataSource={filtered}
          rowKey="issue_number"
          loading={isLoading}
          scroll={{ x: mode === 'plan' ? 1080 : 1030 }}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => `共 ${total} 期` }}
          onRow={(row) => ({
            onClick: row.issue_id == null ? undefined : () => openIssue(row),
            className: row.issue_id == null ? 'is-disabled' : 'is-clickable',
          })}
        />
      </Card>
    </div>
  );
}
