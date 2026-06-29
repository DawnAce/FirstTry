import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckOutlined,
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, TableProps } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  bulkConfirmOrders,
  bulkVoidOrders,
  confirmOrder,
  exportOrders,
  listOrders,
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
  canVoidOrder,
  driftColor,
  driftLabel,
  formatCoverage,
  formatCurrency,
  statusBadgeColor,
  statusLabel,
} from './orderUtils';
import EcommerceRules from './ecommerceRules';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const STATUS_OPTIONS: Array<{ label: string; value: OrderStatus }> = [
  { label: '草稿', value: 'draft' },
  { label: '生效', value: 'active' },
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
  status?: OrderStatus;
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

function buildQueryParams(filters: FilterState, page: number): ListOrdersParams {
  const params: ListOrdersParams = {
    skip: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
  if (filters.status) params.status = filters.status;
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
  if (filters.drift === 'with_drift') params.has_drift = true;
  if (filters.drift === 'no_drift') params.has_drift = false;
  if (filters.payment === 'unpaid') params.unpaid = true;
  if (filters.payment === 'paid') params.unpaid = false;
  return params;
}

export default function OrderList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FilterState>();
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [sorter, setSorter] = useState<{ field?: SortField; order?: 'asc' | 'desc' }>({});
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidingRow, setVoidingRow] = useState<OrderListRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [bulkVoidOpen, setBulkVoidOpen] = useState(false);
  const [bulkVoidReason, setBulkVoidReason] = useState('');
  const [exporting, setExporting] = useState(false);

  const queryParams = useMemo(() => {
    const p = buildQueryParams(filters, page);
    if (sorter.field) {
      p.sort = sorter.field;
      p.order = sorter.order ?? 'desc';
    }
    return p;
  }, [filters, page, sorter]);

  const ordersQuery = useQuery({
    queryKey: orderQueryKeys.list(queryParams),
    queryFn: async () => {
      const res = await listOrders(queryParams);
      return res.data;
    },
  });

  const rows = ordersQuery.data?.rows ?? [];

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
    setFilters({ ...INITIAL_FILTERS, ...values });
  };

  const handleResetFilters = () => {
    form.resetFields();
    setPage(1);
    setFilters(INITIAL_FILTERS);
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

  const columns: TableColumnsType<OrderListRow> = [
    {
      title: '订单编码',
      dataIndex: 'order_code',
      key: 'order_code',
      width: 140,
      render: (code: string | null) => code ?? <Tag color="default">未生成</Tag>,
    },
    {
      title: '来源单号',
      dataIndex: 'external_order_no',
      key: 'external_order_no',
      width: 140,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '下单日期',
      dataIndex: 'order_date',
      key: 'order_date',
      width: 110,
      sorter: true,
    },
    {
      title: '付款主体',
      dataIndex: 'payer_name',
      key: 'payer_name',
      width: 160,
      ellipsis: true,
    },
    {
      title: '渠道/平台',
      dataIndex: 'source_platform',
      key: 'source_platform',
      width: 140,
      render: (platform: string | null) => platform ?? '-',
    },
    {
      title: '活动',
      dataIndex: 'campaign',
      key: 'campaign',
      width: 120,
      render: (c: string | null) => (c ? <Tag color="magenta">{c}</Tag> : '-'),
    },
    {
      title: '份数',
      dataIndex: 'total_quantity',
      key: 'total_quantity',
      width: 80,
      align: 'right',
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 110,
      align: 'right',
      sorter: true,
      render: (v: string) => formatCurrency(v),
    },
    {
      title: '欠款',
      dataIndex: 'outstanding_amount',
      key: 'outstanding_amount',
      width: 110,
      align: 'right',
      sorter: true,
      render: (v: string) =>
        Number(v) > 0 ? (
          <Typography.Text type="danger">{formatCurrency(v)}</Typography.Text>
        ) : (
          '-'
        ),
    },
    {
      title: '覆盖期',
      key: 'coverage',
      width: 220,
      render: (_: unknown, row) =>
        formatCoverage(row.coverage_start_date, row.coverage_end_date),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (s: OrderStatus) => (
        <Badge status={statusBadgeColor(s)} text={statusLabel(s)} />
      ),
    },
    {
      title: '期数（已同步 / 预估）',
      key: 'progress',
      width: 200,
      render: (_: unknown, row) => {
        const synced = row.synced_count;
        const expected = row.expected_total;
        const drift = expected == null ? null : expected - synced;
        return (
          <Space size={4}>
            <span>
              {synced} / {expected ?? '-'}
            </span>
            {row.has_drift && (
              <Tag color={driftColor(drift) === 'error' ? 'red' : 'orange'}>
                偏差 {driftLabel(drift)}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      fixed: 'right',
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/orders/${row.id}`)}>
            查看
          </Button>
          {canConfirmOrder(row.status) && (
            <Button
              type="link"
              size="small"
              icon={<CheckOutlined />}
              loading={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate(row.id)}
            >
              确认生效
            </Button>
          )}
          {canVoidOrder(row.status) && (
            <Button
              type="link"
              size="small"
              danger
              icon={<StopOutlined />}
              onClick={() => handleVoidClick(row)}
            >
              作废
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          订单管理
        </Title>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => ordersQuery.refetch()}
            loading={ordersQuery.isFetching}
          >
            刷新
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport} loading={exporting}>
            导出
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/orders/new')}
          >
            新建订单
          </Button>
        </Space>
      </div>

      <EcommerceRules />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form<FilterState>
          form={form}
          layout="inline"
          initialValues={INITIAL_FILTERS}
          onFinish={handleApplyFilters}
        >
          <Form.Item name="search" label="单号">
            <Input allowClear placeholder="订单编码 / 来源单号" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              placeholder="全部"
              options={STATUS_OPTIONS}
              style={{ width: 140 }}
            />
          </Form.Item>
          <Form.Item name="payer_name_like" label="付款主体">
            <Input allowClear placeholder="模糊匹配" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="campaign" label="活动">
            <Input allowClear placeholder="如 2026-618" style={{ width: 150 }} />
          </Form.Item>
          <Form.Item name="source_platform" label="平台">
            <Select
              allowClear
              placeholder="全部"
              options={PLATFORM_OPTIONS}
              style={{ width: 140 }}
            />
          </Form.Item>
          <Form.Item name="order_date_range" label="下单日期">
            <RangePicker style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="coverage_range" label="覆盖期">
            <RangePicker style={{ width: 240 }} />
          </Form.Item>
          <Form.Item name="drift" label="期数偏差">
            <Select options={DRIFT_OPTIONS} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="payment" label="付款">
            <Select options={PAYMENT_OPTIONS} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button onClick={handleResetFilters}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {selectedKeys.length > 0 && (
        <Space style={{ marginBottom: 12 }}>
          <span>已选 {selectedKeys.length} 单：</span>
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
          <Button size="small" type="link" onClick={() => setSelectedKeys([])}>
            清除选择
          </Button>
        </Space>
      )}

      <Table<OrderListRow>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={ordersQuery.isLoading}
        scroll={{ x: 1500 }}
        onChange={handleTableChange}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
          preserveSelectedRowKeys: true,
        }}
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
            if (target.closest('button')) return;
            navigate(`/orders/${row.id}`);
          },
          style: { cursor: 'pointer' },
        })}
      />

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
