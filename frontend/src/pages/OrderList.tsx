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
  Tooltip,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  listOrders,
  orderQueryKeys,
  voidOrder,
} from '../api/orders';
import type {
  ListOrdersParams,
  OrderListRow,
  OrderSourceType,
  OrderStatus,
} from '../api/orders';
import {
  canVoidOrder,
  driftColor,
  driftLabel,
  formatCoverage,
  formatCurrency,
  sourceTypeLabel,
  statusBadgeColor,
  statusLabel,
} from './orderUtils';

const { Title } = Typography;
const { RangePicker } = DatePicker;

const STATUS_OPTIONS: Array<{ label: string; value: OrderStatus }> = [
  { label: '草稿', value: 'draft' },
  { label: '待确认', value: 'pending_confirmation' },
  { label: '生效', value: 'active' },
  { label: '已作废', value: 'void' },
];

const SOURCE_TYPE_OPTIONS: Array<{ label: string; value: OrderSourceType }> = [
  { label: '电商', value: 'ecommerce' },
  { label: '对公转账', value: 'corporate_transfer' },
  { label: 'VIP 赠阅', value: 'vip_gift' },
  { label: '手工录入', value: 'manual' },
  { label: '邮局全年', value: 'mail_annual' },
];

type DriftFilter = 'all' | 'with_drift' | 'no_drift';

const DRIFT_OPTIONS: Array<{ label: string; value: DriftFilter }> = [
  { label: '全部', value: 'all' },
  { label: '含偏差', value: 'with_drift' },
  { label: '无偏差', value: 'no_drift' },
];

interface FilterState {
  status?: OrderStatus;
  source_type?: OrderSourceType;
  payer_name_like?: string;
  order_date_range?: [Dayjs, Dayjs] | null;
  coverage_range?: [Dayjs, Dayjs] | null;
  drift: DriftFilter;
}

const INITIAL_FILTERS: FilterState = { drift: 'all' };

const PAGE_SIZE = 20;

function buildQueryParams(filters: FilterState, page: number): ListOrdersParams {
  const params: ListOrdersParams = {
    skip: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
  };
  if (filters.status) params.status = filters.status;
  if (filters.source_type) params.source_type = filters.source_type;
  if (filters.payer_name_like) params.payer_name_like = filters.payer_name_like.trim();
  if (filters.coverage_range?.[0]) {
    params.coverage_start = filters.coverage_range[0].format('YYYY-MM-DD');
  }
  if (filters.coverage_range?.[1]) {
    params.coverage_end = filters.coverage_range[1].format('YYYY-MM-DD');
  }
  if (filters.drift === 'with_drift') params.has_drift = true;
  if (filters.drift === 'no_drift') params.has_drift = false;
  return params;
}

function rowMatchesOrderDateRange(row: OrderListRow, range: FilterState['order_date_range']) {
  if (!range || !range[0] || !range[1]) return true;
  const d = row.order_date;
  return d >= range[0].format('YYYY-MM-DD') && d <= range[1].format('YYYY-MM-DD');
}

export default function OrderList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FilterState>();
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [page, setPage] = useState(1);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidingRow, setVoidingRow] = useState<OrderListRow | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const queryParams = useMemo(() => buildQueryParams(filters, page), [filters, page]);

  const ordersQuery = useQuery({
    queryKey: orderQueryKeys.list(queryParams),
    queryFn: async () => {
      const res = await listOrders(queryParams);
      return res.data;
    },
  });

  const filteredRows = useMemo(() => {
    const rows = ordersQuery.data?.rows ?? [];
    return rows.filter((r) => rowMatchesOrderDateRange(r, filters.order_date_range));
  }, [ordersQuery.data, filters.order_date_range]);

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
    },
    {
      title: '付款主体',
      dataIndex: 'payer_name',
      key: 'payer_name',
      width: 160,
      ellipsis: true,
    },
    {
      title: '来源',
      dataIndex: 'source_type',
      key: 'source_type',
      width: 110,
      render: (t: OrderSourceType, row) => {
        const label = sourceTypeLabel(t);
        return row.source_platform ? (
          <Tooltip title={row.source_platform}>{label}</Tooltip>
        ) : (
          label
        );
      },
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
      render: (v: string) => formatCurrency(v),
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
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/orders/new')}
          >
            新建订单
          </Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Form<FilterState>
          form={form}
          layout="inline"
          initialValues={INITIAL_FILTERS}
          onFinish={handleApplyFilters}
        >
          <Form.Item name="status" label="状态">
            <Select
              allowClear
              placeholder="全部"
              options={STATUS_OPTIONS}
              style={{ width: 140 }}
            />
          </Form.Item>
          <Form.Item name="source_type" label="来源">
            <Select
              allowClear
              placeholder="全部"
              options={SOURCE_TYPE_OPTIONS}
              style={{ width: 140 }}
            />
          </Form.Item>
          <Form.Item name="payer_name_like" label="付款主体">
            <Input allowClear placeholder="模糊匹配" style={{ width: 180 }} />
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

      <Table<OrderListRow>
        rowKey="id"
        columns={columns}
        dataSource={filteredRows}
        loading={ordersQuery.isLoading}
        scroll={{ x: 1500 }}
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
    </div>
  );
}
