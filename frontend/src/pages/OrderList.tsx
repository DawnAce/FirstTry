import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DatePicker,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import {
  CheckOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EllipsisOutlined,
  FilterOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StopOutlined,
  TruckOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { MenuProps, TableColumnsType, TableProps } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  bulkConfirmOrders,
  bulkDeleteOrders,
  bulkVoidOrders,
  confirmOrder,
  deleteOrder,
  exportOrders,
  getOrder,
  listOrders,
  listOrderEvents,
  orderQueryKeys,
  voidOrder,
} from '../api/orders';
import type {
  ListOrdersParams,
  OrderListRow,
  OrderStatus,
} from '../api/orders';
import {
  canConfirmOrder,
  canDeleteOrder,
  canVoidOrder,
  deliveryMethodLabel,
  driftColor,
  driftLabel,
  eventTypeLabel,
  formatCoverage,
  formatCurrency,
  publicationLabel,
  statusLabel,
  subscriptionTermLabel,
} from './orderUtils';
import EcommerceRules from './ecommerceRules';
import { useAuth } from '../contexts/AuthContext';
import { DrawerTitle, PageHeader, StatusPill } from '../components/UiPrimitives';
import './OrderManagement.css';

const { RangePicker } = DatePicker;

type OrderView = 'all' | 'active' | 'pending_confirmation' | 'draft' | 'attention' | 'void';

const ORDER_VIEWS: Array<{ label: string; value: OrderView }> = [
  { label: '全部', value: 'all' },
  { label: '履约中', value: 'active' },
  { label: '待确认', value: 'pending_confirmation' },
  { label: '草稿', value: 'draft' },
  { label: '需关注', value: 'attention' },
  { label: '已作废', value: 'void' },
];

type DriftFilter = 'all' | 'with_drift' | 'no_drift';

const DRIFT_OPTIONS: Array<{ label: string; value: DriftFilter }> = [
  { label: '全部', value: 'all' },
  { label: '含偏差', value: 'with_drift' },
  { label: '无偏差', value: 'no_drift' },
];

type PaymentFilter = 'all' | 'unpaid' | 'paid';

const PAYMENT_OPTIONS: Array<{ label: string; value: PaymentFilter }> = [
  { label: '全部', value: 'all' },
  { label: '未付清', value: 'unpaid' },
  { label: '已付清', value: 'paid' },
];

interface FilterState {
  search?: string;
  payer_name_like?: string;
  campaign?: string;
  source_platform?: string;
  order_date_range?: [Dayjs, Dayjs] | null;
  coverage_range?: [Dayjs, Dayjs] | null;
  drift: DriftFilter;
  payment: PaymentFilter;
}

type SortField = NonNullable<ListOrdersParams['sort']>;

// Distinct source_platform strings the system writes (imports: CBJ小程序 / 淘宝;
// manual: the OrderEditor dropdown). Exact-match filter for the unified list.
const PLATFORM_OPTIONS = [
  { label: '淘宝', value: '淘宝' },
  { label: 'CBJ小程序', value: 'CBJ小程序' },
  { label: '微信小程序', value: '微信小程序' },
  { label: '有赞', value: '有赞' },
];

const INITIAL_FILTERS: FilterState = { drift: 'all', payment: 'all' };

const PAGE_SIZE = 20;

function buildQueryParams(filters: FilterState, page: number, view: OrderView): ListOrdersParams {
  const params: ListOrdersParams = {
    skip: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
  if (view !== 'all' && view !== 'attention') params.status = view;
  if (filters.search) params.search = filters.search.trim();
  if (filters.payer_name_like) params.payer_name_like = filters.payer_name_like.trim();
  if (filters.campaign) params.campaign = filters.campaign.trim();
  if (filters.source_platform) params.source_platform = filters.source_platform;
  if (filters.order_date_range?.[0]) {
    params.order_date_start = filters.order_date_range[0].format('YYYY-MM-DD');
  }
  if (filters.order_date_range?.[1]) {
    params.order_date_end = filters.order_date_range[1].format('YYYY-MM-DD');
  }
  if (filters.coverage_range?.[0]) {
    params.coverage_start = filters.coverage_range[0].format('YYYY-MM-DD');
  }
  if (filters.coverage_range?.[1]) {
    params.coverage_end = filters.coverage_range[1].format('YYYY-MM-DD');
  }
  if (view === 'attention') params.needs_attention = true;
  else if (filters.drift === 'with_drift') params.has_drift = true;
  else if (filters.drift === 'no_drift') params.has_drift = false;
  if (filters.payment === 'unpaid') params.unpaid = true;
  if (filters.payment === 'paid') params.unpaid = false;
  return params;
}

function progressPercent(row: OrderListRow): number {
  if (!row.expected_total || row.expected_total <= 0) return 0;
  return Math.min(100, Math.round(((row.fulfilled_count ?? row.synced_count) / row.expected_total) * 100));
}

function orderStatusTone(status: OrderStatus): 'neutral' | 'info' | 'success' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'pending_confirmation') return 'info';
  if (status === 'void') return 'danger';
  return 'neutral';
}

export default function OrderList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, canMutate } = useAuth();
  const [form] = Form.useForm<FilterState>();
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [view, setView] = useState<OrderView>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sorter, setSorter] = useState<{ field?: SortField; order?: 'asc' | 'desc' }>({});
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidingRow, setVoidingRow] = useState<OrderListRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [bulkVoidOpen, setBulkVoidOpen] = useState(false);
  const [bulkVoidReason, setBulkVoidReason] = useState('');
  const [exporting, setExporting] = useState(false);
  const [previewRow, setPreviewRow] = useState<OrderListRow | null>(null);

  const queryParams = useMemo(() => {
    const p = buildQueryParams(filters, page, view);
    if (sorter.field) {
      p.sort = sorter.field;
      p.order = sorter.order ?? 'desc';
    }
    return p;
  }, [filters, page, sorter, view]);

  const ordersQuery = useQuery({
    queryKey: orderQueryKeys.list(queryParams),
    queryFn: async () => {
      const res = await listOrders(queryParams);
      return res.data;
    },
  });

  const rows = ordersQuery.data?.rows ?? [];

  const viewCountQueries = useQueries({
    queries: ORDER_VIEWS.map((item) => {
      const params = buildQueryParams(filters, 1, item.value);
      params.skip = 0;
      params.limit = 1;
      return {
        queryKey: [...orderQueryKeys.list(params), 'count'],
        queryFn: async () => (await listOrders(params)).data.total,
        staleTime: 30_000,
      };
    }),
  });

  const previewOrderId = previewRow?.id ?? NaN;
  const previewOrderQuery = useQuery({
    queryKey: orderQueryKeys.detail(previewOrderId),
    queryFn: async () => (await getOrder(previewOrderId)).data,
    enabled: Number.isFinite(previewOrderId),
  });
  const previewEventsQuery = useQuery({
    queryKey: orderQueryKeys.events(previewOrderId),
    queryFn: async () => (await listOrderEvents(previewOrderId)).data,
    enabled: Number.isFinite(previewOrderId),
  });

  // 选中项里真正可删的（草稿/作废且无发货明细）——批量删除只对这些生效。
  const deletableSelectedIds = useMemo(
    () =>
      rows
        .filter((r) => selectedKeys.includes(r.id) && canDeleteOrder(r.status, r.synced_count))
        .map((r) => r.id),
    [rows, selectedKeys],
  );

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => voidOrder(id, reason),
    onSuccess: () => {
      message.success('订单已作废');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
      setVoidModalOpen(false);
      setVoidingRow(null);
      setVoidReason('');
    },
    onError: () => {
      message.error('作废失败');
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (id: number) => confirmOrder(id),
    onSuccess: () => {
      message.success('订单已确认生效');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
    },
    onError: () => message.error('确认失败'),
  });

  const reportBulk = (res: { succeeded: number[]; failed: Array<{ order_id: number; detail: string }> }, verb: string) => {
    if (res.failed.length === 0) {
      message.success(`已${verb} ${res.succeeded.length} 单`);
    } else {
      message.warning(`${verb} ${res.succeeded.length} 单成功，${res.failed.length} 单失败（如状态不符）`);
    }
    setSelectedKeys([]);
    queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
  };

  const bulkConfirmMutation = useMutation({
    mutationFn: (ids: number[]) => bulkConfirmOrders(ids).then((r) => r.data),
    onSuccess: (res) => reportBulk(res, '确认'),
    onError: () => message.error('批量确认失败'),
  });

  const bulkVoidMutation = useMutation({
    mutationFn: ({ ids, reason }: { ids: number[]; reason: string }) =>
      bulkVoidOrders(ids, reason).then((r) => r.data),
    onSuccess: (res) => {
      reportBulk(res, '作废');
      setBulkVoidOpen(false);
      setBulkVoidReason('');
    },
    onError: () => message.error('批量作废失败'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteOrder(id).then((r) => r.data),
    onSuccess: () => {
      message.success('订单已删除');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
    },
    onError: () => message.error('删除失败'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: number[]) => bulkDeleteOrders(ids).then((r) => r.data),
    onSuccess: (res) => reportBulk(res, '删除'),
    onError: () => message.error('批量删除失败'),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      // skip/limit 透传给 /export 会被后端忽略（导出取全量），无需剥离。
      const res = await exportOrders(queryParams);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `订单导出_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleTableChange: NonNullable<TableProps<OrderListRow>['onChange']> = (
    _pagination,
    _filters,
    srt,
  ) => {
    const s = Array.isArray(srt) ? srt[0] : srt;
    const keyMap: Record<string, SortField> = {
      order_date: 'order_date',
      total_amount: 'total_amount',
      outstanding_amount: 'outstanding',
    };
    if (s && s.order && typeof s.columnKey === 'string' && keyMap[s.columnKey]) {
      setPage(1);
      setSorter({ field: keyMap[s.columnKey], order: s.order === 'ascend' ? 'asc' : 'desc' });
    } else {
      setSorter({});
    }
  };

  const handleApplyFilters = (values: FilterState) => {
    setPage(1);
    setFilters({
      ...INITIAL_FILTERS,
      ...values,
      search: quickSearch.trim() || undefined,
    });
    setFilterOpen(false);
  };

  const handleResetFilters = () => {
    form.resetFields();
    setQuickSearch('');
    setPage(1);
    setFilters(INITIAL_FILTERS);
  };

  const handleQuickSearch = () => {
    setPage(1);
    setFilters((current) => ({ ...current, search: quickSearch.trim() || undefined }));
  };

  const handleViewChange = (nextView: OrderView) => {
    setView(nextView);
    setPage(1);
  };

  const removeFilter = (key: keyof FilterState) => {
    const fallback = key === 'drift' || key === 'payment' ? 'all' : undefined;
    form.setFieldValue(key, fallback);
    if (key === 'search') setQuickSearch('');
    setPage(1);
    setFilters((current) => ({ ...current, [key]: fallback }));
  };

  const handleVoidClick = (row: OrderListRow) => {
    setVoidingRow(row);
    setVoidReason('');
    setVoidModalOpen(true);
  };

  const handleVoidSubmit = () => {
    if (!voidingRow) return;
    const reason = voidReason.trim();
    if (reason.length < 2) {
      message.warning('请填写作废理由（至少 2 个字符）');
      return;
    }
    voidMutation.mutate({ id: voidingRow.id, reason });
  };

  const handleDeleteClick = (row: OrderListRow) => {
    Modal.confirm({
      title: `删除订单 ${row.order_code ?? `#${row.id}`}`,
      icon: <DeleteOutlined />,
      content: '将永久删除该订单及其明细、收款和事件记录，不可恢复。仅用于清理草稿、误建或测试数据。',
      okText: '确认删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => deleteMutation.mutateAsync(row.id),
    });
  };

  const activeFilters = useMemo(() => {
    const chips: Array<{ key: keyof FilterState; label: string }> = [];
    if (filters.search) chips.push({ key: 'search', label: `关键词：${filters.search}` });
    if (filters.payer_name_like) chips.push({ key: 'payer_name_like', label: `付款主体：${filters.payer_name_like}` });
    if (filters.campaign) chips.push({ key: 'campaign', label: `活动：${filters.campaign}` });
    if (filters.source_platform) chips.push({ key: 'source_platform', label: filters.source_platform });
    if (filters.order_date_range) {
      chips.push({ key: 'order_date_range', label: `下单：${filters.order_date_range[0].format('YYYY-MM-DD')} ～ ${filters.order_date_range[1].format('YYYY-MM-DD')}` });
    }
    if (filters.coverage_range) {
      chips.push({ key: 'coverage_range', label: `覆盖：${filters.coverage_range[0].format('YYYY-MM-DD')} ～ ${filters.coverage_range[1].format('YYYY-MM-DD')}` });
    }
    if (filters.drift !== 'all') chips.push({ key: 'drift', label: filters.drift === 'with_drift' ? '含期数偏差' : '无期数偏差' });
    if (filters.payment !== 'all') chips.push({ key: 'payment', label: filters.payment === 'paid' ? '已付清' : '未付清' });
    return chips;
  }, [filters]);

  const previewOrder = previewOrderQuery.data;
  const previewRecipient = useMemo(() => {
    if (!previewOrder) return null;
    for (const item of previewOrder.items) {
      for (const allocation of item.allocations) {
        const target = allocation.targets.find((candidate) => candidate.status === 'active');
        if (target) return target;
      }
    }
    return null;
  }, [previewOrder]);

  const previewProducts = useMemo(() => {
    if (!previewOrder) return '-';
    const names = [...new Set(previewOrder.items.map((item) => (
      `${publicationLabel(item.publication)}${item.subscription_term ? `（${subscriptionTermLabel(item.subscription_term)}）` : ''}`
    )))];
    return names.join('、') || '-';
  }, [previewOrder]);

  const previewDelivery = useMemo(() => {
    if (!previewOrder) return '-';
    const methods = [...new Set(previewOrder.items.map((item) => deliveryMethodLabel(item.delivery_method)))];
    return methods.join('、') || '-';
  }, [previewOrder]);

  const actionMenu = (row: OrderListRow): MenuProps['items'] => {
    const items: MenuProps['items'] = [];
    if (canMutate && canConfirmOrder(row.status)) {
      items.push({ key: 'confirm', icon: <CheckOutlined />, label: '确认生效', onClick: () => confirmMutation.mutate(row.id) });
    }
    if (isAdmin && canVoidOrder(row.status)) {
      items.push({ key: 'void', icon: <StopOutlined />, danger: true, label: '作废订单', onClick: () => handleVoidClick(row) });
    }
    if (isAdmin && canDeleteOrder(row.status, row.synced_count)) {
      items.push({ key: 'delete', icon: <DeleteOutlined />, danger: true, label: '永久删除', onClick: () => handleDeleteClick(row) });
    }
    return items;
  };

  const columns: TableColumnsType<OrderListRow> = [
    {
      title: '订单信息',
      key: 'order_date',
      width: 330,
      sorter: true,
      render: (_: unknown, row) => (
        <div className="order-list-order-cell">
          <div className="order-list-code-line">
            <Button type="link" onClick={() => setPreviewRow(row)}>{row.order_code ?? `草稿 #${row.id}`}</Button>
            <Tag>{row.source_platform ?? '手工订单'}</Tag>
          </div>
          <div className="order-list-source">来源单号 {row.external_order_no ?? '—'} · {row.order_date} 下单</div>
          <div className="order-list-product">
            <span>{row.campaign || '常规订阅'}</span>
            <small>共 {row.total_quantity} 份</small>
          </div>
        </div>
      ),
    },
    {
      title: '客户 / 收款',
      key: 'total_amount',
      width: 220,
      sorter: true,
      render: (_: unknown, row) => {
        const paid = Number(row.outstanding_amount) <= 0;
        return (
          <div className="order-list-customer-cell">
            <strong>{row.payer_name}</strong>
            <small>付款主体</small>
            <div><b>{formatCurrency(row.total_amount)}</b><span className={paid ? 'is-paid' : 'is-unpaid'}>{paid ? '已付清' : `欠 ${formatCurrency(row.outstanding_amount)}`}</span></div>
          </div>
        );
      },
    },
    {
      title: '履约概况',
      key: 'fulfillment',
      width: 310,
      render: (_: unknown, row) => {
        const fulfilled = row.fulfilled_count ?? row.synced_count;
        const expected = row.expected_total;
        const drift = expected == null ? null : expected - fulfilled;
        return (
          <div className="order-list-fulfillment-cell">
            <div className="order-list-progress-line">
              <strong>{row.status === 'active' ? '履约进行中' : statusLabel(row.status)}</strong>
              <span>{fulfilled} / {expected ?? '—'} 期</span>
            </div>
            <Progress percent={progressPercent(row)} showInfo={false} strokeColor="#1677ff" railColor="#e8edf4" size="small" />
            <div className="order-list-coverage">{formatCoverage(row.coverage_start_date, row.coverage_end_date)}</div>
            {row.has_drift && <Tag color={driftColor(drift) === 'error' ? 'red' : 'orange'}>期数偏差 {driftLabel(drift)}</Tag>}
          </div>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: OrderStatus, row) => (
        <div className="order-list-status-cell">
          <StatusPill tone={orderStatusTone(status)}>{status === 'active' ? '履约中' : statusLabel(status)}</StatusPill>
          {row.has_drift && <small>需要核对期数</small>}
          {!row.has_drift && Number(row.outstanding_amount) > 0 && <small>存在待收款</small>}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_: unknown, row) => {
        const menuItems = actionMenu(row);
        return (
          <div className="order-list-actions" onClick={(event) => event.stopPropagation()}>
            <Button type="link" size="small" onClick={() => setPreviewRow(row)}>查看</Button>
            {menuItems && menuItems.length > 0 && (
              <Dropdown menu={{ items: menuItems }} trigger={['click']}>
                <Button type="text" size="small" icon={<EllipsisOutlined />} aria-label="更多订单操作" />
              </Dropdown>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="order-list-page">
      <PageHeader
        title="订单管理"
        description="统一查看订单、履约、收款与售后状态"
        actions={<Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => ordersQuery.refetch()}
            loading={ordersQuery.isFetching}
          >
            刷新
          </Button>
          {isAdmin && (
            <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exporting}>
              导出
            </Button>
          )}
          {canMutate && <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/orders/new')}
          >
            新建订单
          </Button>}
        </Space>}
      />

      <div className="order-list-rules"><EcommerceRules /></div>

      <section className="order-list-workspace">
        <div className="order-list-views" role="tablist" aria-label="订单状态视图">
          {ORDER_VIEWS.map((item, index) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={view === item.value}
              className={view === item.value ? 'is-active' : ''}
              onClick={() => handleViewChange(item.value)}
            >
              {item.label}
              <span className={item.value === 'attention' ? 'is-warning' : ''}>{viewCountQueries[index].data ?? '—'}</span>
            </button>
          ))}
        </div>

        <div className="order-list-search-row">
          <Input
            value={quickSearch}
            onChange={(event) => setQuickSearch(event.target.value)}
            onPressEnter={handleQuickSearch}
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索订单编号、来源单号或付款主体"
            aria-label="搜索订单"
          />
          <Button type="primary" onClick={handleQuickSearch}>搜索</Button>
          <Button
            icon={<FilterOutlined />}
            className={filterOpen ? 'is-active' : ''}
            onClick={() => setFilterOpen((open) => !open)}
          >
            筛选{activeFilters.length > 0 && <span className="order-list-filter-count">{activeFilters.length}</span>}
          </Button>
        </div>

        {filterOpen && (
          <div className="order-list-filter-panel">
            <Form<FilterState>
              form={form}
              layout="vertical"
              initialValues={INITIAL_FILTERS}
              onFinish={handleApplyFilters}
            >
              <Form.Item name="payer_name_like" label="付款主体">
                <Input allowClear placeholder="输入名称模糊匹配" />
              </Form.Item>
              <Form.Item name="campaign" label="活动">
                <Input allowClear placeholder="如 2026-618" />
              </Form.Item>
              <Form.Item name="source_platform" label="渠道 / 平台">
                <Select allowClear placeholder="全部平台" options={PLATFORM_OPTIONS} />
              </Form.Item>
              <Form.Item name="order_date_range" label="下单日期">
                <RangePicker />
              </Form.Item>
              <Form.Item name="coverage_range" label="覆盖期">
                <RangePicker />
              </Form.Item>
              <Form.Item name="drift" label="期数偏差">
                <Select options={DRIFT_OPTIONS} />
              </Form.Item>
              <Form.Item name="payment" label="付款状态">
                <Select options={PAYMENT_OPTIONS} />
              </Form.Item>
              <div className="order-list-filter-actions">
                <Button type="link" onClick={handleResetFilters}>重置全部</Button>
                <Button type="primary" htmlType="submit">应用筛选</Button>
              </div>
            </Form>
          </div>
        )}

        {activeFilters.length > 0 && (
          <div className="order-list-active-filters">
            {activeFilters.map((chip) => (
              <Tag key={chip.key} closable onClose={(event) => { event.preventDefault(); removeFilter(chip.key); }}>{chip.label}</Tag>
            ))}
            <Button type="link" size="small" onClick={handleResetFilters}>清空</Button>
          </div>
        )}

        <Table<OrderListRow>
          className="order-list-table"
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={ordersQuery.isLoading}
          scroll={{ x: 1080 }}
          onChange={handleTableChange}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到匹配的订单" /> }}
          rowSelection={
            isAdmin
              ? {
                  selectedRowKeys: selectedKeys,
                  onChange: (keys) => setSelectedKeys(keys as number[]),
                  preserveSelectedRowKeys: true,
                }
              : undefined
          }
          pagination={{
            current: page,
            pageSize: PAGE_SIZE,
            total: ordersQuery.data?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: setPage,
          }}
          onRow={(row) => ({
            onClick: (event) => {
              const target = event.target as HTMLElement;
              if (target.closest('button, a, input, .ant-dropdown')) return;
              setPreviewRow(row);
            },
            style: { cursor: 'pointer' },
          })}
        />
      </section>

      {isAdmin && selectedKeys.length > 0 && (
        <div className="order-list-bulk-bar">
          <span>已选择 <strong>{selectedKeys.length}</strong> 笔订单</span>
          <Button
            size="small"
            icon={<CheckOutlined />}
            loading={bulkConfirmMutation.isPending}
            onClick={() => bulkConfirmMutation.mutate(selectedKeys)}
          >
            批量确认生效
          </Button>
          <Button
            size="small"
            danger
            icon={<StopOutlined />}
            onClick={() => {
              setBulkVoidReason('');
              setBulkVoidOpen(true);
            }}
          >
            批量作废
          </Button>
          <Popconfirm
            title={`批量删除 ${deletableSelectedIds.length} 单`}
            description={
              <span>
                将永久删除选中项中可删的 {deletableSelectedIds.length} 单
                {selectedKeys.length > deletableSelectedIds.length && (
                  <>（{selectedKeys.length - deletableSelectedIds.length} 单不可删，将跳过）</>
                )}
                ，不可恢复。确定？
              </span>
            }
            okText="确认删除"
            okButtonProps={{ danger: true, loading: bulkDeleteMutation.isPending }}
            cancelText="取消"
            disabled={deletableSelectedIds.length === 0}
            onConfirm={() => bulkDeleteMutation.mutate(deletableSelectedIds)}
          >
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={deletableSelectedIds.length === 0}
            >
              批量删除{deletableSelectedIds.length > 0 ? ` (${deletableSelectedIds.length})` : ''}
            </Button>
          </Popconfirm>
          <Button size="small" type="link" onClick={() => setSelectedKeys([])}>
            取消选择
          </Button>
        </div>
      )}

      <Drawer
        className="order-list-preview-drawer"
        size={440}
        open={Boolean(previewRow)}
        onClose={() => setPreviewRow(null)}
        title={previewRow ? (
          <DrawerTitle
            icon={<FileTextOutlined />}
            title={previewRow.order_code ?? `草稿 #${previewRow.id}`}
            description="订单快速预览"
            status={<StatusPill tone={orderStatusTone(previewRow.status)}>{previewRow.status === 'active' ? '履约中' : statusLabel(previewRow.status)}</StatusPill>}
          />
        ) : null}
        footer={previewRow ? (
          <div className="order-list-preview-footer">
            <Button onClick={() => setPreviewRow(null)}>关闭</Button>
            <Button type="primary" onClick={() => navigate(`/orders/${previewRow.id}`)}>进入完整详情</Button>
          </div>
        ) : null}
      >
        {!previewRow || previewOrderQuery.isLoading ? <div className="order-list-preview-loading"><Spin /></div> : (
          <div className="order-list-preview-body">
            <section className="order-list-preview-progress">
              <div><span><TruckOutlined /> 履约进度</span><strong>{previewRow.fulfilled_count ?? previewRow.synced_count} / {previewRow.expected_total ?? '—'}期</strong></div>
              <Progress percent={progressPercent(previewRow)} showInfo={false} strokeColor="#1677ff" railColor="#dfe8f3" />
              <small>{formatCoverage(previewRow.coverage_start_date, previewRow.coverage_end_date)}</small>
            </section>

            {(previewRow.has_drift || Number(previewRow.outstanding_amount) > 0) ? (
              <section className="order-list-preview-attention">
                <WarningOutlined />
                <div><strong>当前需处理</strong><small>{previewRow.has_drift ? '刊期计划发生变化，请核对订单期数' : `仍有 ${formatCurrency(previewRow.outstanding_amount)} 待收款`}</small></div>
              </section>
            ) : (
              <section className="order-list-preview-clear"><CheckOutlined /><span>当前没有待处理异常</span></section>
            )}

            <section className="order-list-preview-section">
              <h3>订单摘要</h3>
              <dl>
                <div><dt>收件人</dt><dd>{previewRecipient?.recipient_name ?? previewOrder?.payer_name ?? previewRow.payer_name}</dd></div>
                <div><dt>付款主体</dt><dd>{previewOrder?.payer_name ?? previewRow.payer_name}</dd></div>
                <div><dt>付款金额</dt><dd>{formatCurrency(previewOrder?.total_amount ?? previewRow.total_amount)}</dd></div>
                <div><dt>订阅产品</dt><dd>{previewProducts}</dd></div>
                <div><dt>履约方式</dt><dd>{previewDelivery}</dd></div>
                <div><dt>来源平台</dt><dd>{previewOrder?.source_platform ?? previewRow.source_platform ?? '手工订单'}</dd></div>
              </dl>
            </section>

            <section className="order-list-preview-section">
              <h3>最近动态</h3>
              {previewEventsQuery.isLoading ? <Spin size="small" /> : previewEventsQuery.data?.length ? (
                <ol className="order-list-preview-timeline">
                  {previewEventsQuery.data.slice(0, 3).map((event) => (
                    <li key={event.id}><i /><div><strong>{eventTypeLabel(event.event_type)}</strong><small>{new Date(event.created_at).toLocaleString('zh-CN', { hour12: false })}</small></div></li>
                  ))}
                </ol>
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" />}
            </section>
          </div>
        )}
      </Drawer>

      <Modal
        title={voidingRow ? `作废订单 ${voidingRow.order_code ?? `#${voidingRow.id}`}` : '作废订单'}
        open={voidModalOpen}
        onCancel={() => {
          setVoidModalOpen(false);
          setVoidingRow(null);
        }}
        onOk={handleVoidSubmit}
        okText="确认作废"
        okButtonProps={{ danger: true, loading: voidMutation.isPending }}
        cancelText="取消"
      >
        <p style={{ marginBottom: 8 }}>请输入作废理由，提交后订单将变为「已作废」状态：</p>
        <Input.TextArea
          value={voidReason}
          onChange={(e) => setVoidReason(e.target.value)}
          rows={3}
          maxLength={500}
          showCount
          placeholder="例如：客户取消、重复下单……"
        />
      </Modal>

      <Modal
        title={`批量作废 ${selectedKeys.length} 单`}
        open={bulkVoidOpen}
        onCancel={() => setBulkVoidOpen(false)}
        onOk={() => {
          const reason = bulkVoidReason.trim();
          if (reason.length < 2) {
            message.warning('请填写作废理由（至少 2 个字符）');
            return;
          }
          bulkVoidMutation.mutate({ ids: selectedKeys, reason });
        }}
        okText="确认批量作废"
        okButtonProps={{ danger: true, loading: bulkVoidMutation.isPending }}
        cancelText="取消"
      >
        <p style={{ marginBottom: 8 }}>
          将对选中的 {selectedKeys.length} 单统一作废（已作废的会跳过）。请输入作废理由：
        </p>
        <Input.TextArea
          value={bulkVoidReason}
          onChange={(e) => setBulkVoidReason(e.target.value)}
          rows={3}
          maxLength={500}
          showCount
          placeholder="例如：批量重复下单、活动取消……"
        />
      </Modal>
    </div>
  );
}
