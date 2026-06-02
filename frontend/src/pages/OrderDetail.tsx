import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Input,
  Modal,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  InboxOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import {
  getOrder,
  listOrderEvents,
  orderQueryKeys,
  voidOrder,
} from '../api/orders';
import type {
  FulfillmentAllocationOut,
  FulfillmentTargetOut,
  OrderEventOut,
  OrderItemOut,
} from '../api/orders';
import {
  billingTypeLabel,
  canEditOrder,
  canVoidOrder,
  driftColor,
  driftLabel,
  entryMethodLabel,
  eventTypeLabel,
  fulfillmentTypeLabel,
  formatCoverage,
  formatCurrency,
  publicationLabel,
  statusBadgeColor,
  statusLabel,
  targetStatusColor,
  targetStatusLabel,
} from './orderUtils';

const { Title, Text } = Typography;

export default function OrderDetail() {
  const params = useParams<{ id: string }>();
  const orderId = params.id ? Number(params.id) : NaN;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const orderQuery = useQuery({
    queryKey: orderQueryKeys.detail(orderId),
    queryFn: async () => {
      const res = await getOrder(orderId);
      return res.data;
    },
    enabled: Number.isFinite(orderId),
  });

  const eventsQuery = useQuery({
    queryKey: orderQueryKeys.events(orderId),
    queryFn: async () => {
      const res = await listOrderEvents(orderId);
      return res.data;
    },
    enabled: Number.isFinite(orderId),
  });

  const voidMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => voidOrder(id, reason),
    onSuccess: () => {
      message.success('订单已作废');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
      setVoidModalOpen(false);
      setVoidReason('');
    },
    onError: () => {
      message.error('作废失败');
    },
  });

  if (!Number.isFinite(orderId)) {
    return (
      <Alert
        type="error"
        showIcon
        message="无效的订单 ID"
        action={
          <Button type="primary" size="small" onClick={() => navigate('/orders')}>
            返回列表
          </Button>
        }
      />
    );
  }

  if (orderQuery.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin tip="正在加载订单..." />
      </div>
    );
  }

  if (orderQuery.isError || !orderQuery.data) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载订单失败"
        description={String(orderQuery.error ?? '订单不存在')}
        action={
          <Space>
            <Button onClick={() => orderQuery.refetch()} size="small">
              重试
            </Button>
            <Button type="primary" size="small" onClick={() => navigate('/orders')}>
              返回列表
            </Button>
          </Space>
        }
      />
    );
  }

  const order = orderQuery.data;
  const headerCoverage = computeOrderCoverage(order.items);

  const handleVoidClick = () => {
    setVoidReason('');
    setVoidModalOpen(true);
  };
  const handleVoidSubmit = () => {
    const reason = voidReason.trim();
    if (reason.length < 2) {
      message.warning('请填写作废理由（至少 2 个字符）');
      return;
    }
    voidMutation.mutate({ id: order.id, reason });
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
        }}
      >
        <Space size="middle">
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>
            返回列表
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            {order.order_code ?? `订单 #${order.id}`}
          </Title>
          <Badge status={statusBadgeColor(order.status)} text={statusLabel(order.status)} />
          <Tag icon={<InboxOutlined />} color="default">
            {entryMethodLabel(order.source_type)}
          </Tag>
        </Space>
        <Space>
          {canEditOrder(order.status) && (
            <Button
              icon={<EditOutlined />}
              onClick={() => navigate(`/orders/${order.id}/edit`)}
            >
              编辑
            </Button>
          )}
          {canVoidOrder(order.status) && (
            <Button danger icon={<StopOutlined />} onClick={handleVoidClick}>
              作废
            </Button>
          )}
        </Space>
      </div>

      {/* Summary card */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic title="付款主体" value={order.payer_name} valueStyle={{ fontSize: 18 }} />
          </Col>
          <Col span={6}>
            <Statistic
              title="下单日期"
              value={order.order_date}
              valueStyle={{ fontSize: 18 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="覆盖期"
              value={headerCoverage}
              valueStyle={{ fontSize: 18 }}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title="订单总金额"
              value={formatCurrency(order.total_amount)}
              valueStyle={{ fontSize: 18, color: 'var(--color-accent, #1677ff)' }}
            />
          </Col>
        </Row>
        <Descriptions
          column={3}
          size="small"
          style={{ marginTop: 16 }}
          labelStyle={{ width: 100 }}
        >
          <Descriptions.Item label="来源平台">
            {order.source_platform ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源店铺">
            {order.source_store ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="来源单号">
            {order.external_order_no ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="付款联系人">
            {order.payer_contact ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="支付方式">
            {order.payment_method ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="收款经办人">
            {order.payment_collector ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="已付金额">
            {formatCurrency(order.paid_amount)}
          </Descriptions.Item>
          <Descriptions.Item label="开票">
            {order.invoice_required ? '是' : '否'}
            {order.invoice_required && order.invoice_title
              ? `（抬头：${order.invoice_title}）`
              : ''}
          </Descriptions.Item>
          {order.notes && (
            <Descriptions.Item label="备注" span={3}>
              {order.notes}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* Tabs */}
      <Tabs
        defaultActiveKey="items"
        items={[
          {
            key: 'items',
            label: '订单明细',
            children: <ItemsTab items={order.items} />,
          },
          {
            key: 'allocations',
            label: '分配方案版本',
            children: <AllocationsTab items={order.items} />,
          },
          {
            key: 'shipping',
            label: '关联快递明细',
            children: (
              <Empty
                description={
                  <span>
                    该订单尚未参与中通明细同步。
                    <br />
                    同步功能将在 V1.3 上线。
                  </span>
                }
              />
            ),
          },
          {
            key: 'events',
            label: '事件流',
            children: (
              <EventsTab
                events={eventsQuery.data ?? []}
                loading={eventsQuery.isLoading}
                error={eventsQuery.isError ? String(eventsQuery.error) : null}
              />
            ),
          },
        ]}
      />

      <Modal
        title={`作废订单 ${order.order_code ?? `#${order.id}`}`}
        open={voidModalOpen}
        onCancel={() => setVoidModalOpen(false)}
        onOk={handleVoidSubmit}
        okText="确认作废"
        okButtonProps={{ danger: true, loading: voidMutation.isPending }}
        cancelText="取消"
      >
        <p style={{ marginBottom: 8 }}>请输入作废理由：</p>
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

// =============================================================================
// Helpers
// =============================================================================

function computeOrderCoverage(items: OrderItemOut[]): string {
  const dates = items
    .flatMap((it) => [it.coverage_start_date, it.coverage_end_date])
    .filter((d): d is string => !!d);
  if (dates.length === 0) return '-';
  const sorted = [...dates].sort();
  return formatCoverage(sorted[0], sorted[sorted.length - 1]);
}

// =============================================================================
// Tab 1: Items
// =============================================================================

function ItemsTab({ items }: { items: OrderItemOut[] }) {
  if (items.length === 0) {
    return <Empty description="该订单没有明细" />;
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {items.map((item, idx) => (
        <ItemCard key={item.id} item={item} index={idx} />
      ))}
    </Space>
  );
}

function ItemCard({ item, index }: { item: OrderItemOut; index: number }) {
  const activeAllocation = useMemo<FulfillmentAllocationOut | undefined>(
    () =>
      item.allocations.find((a) => a.version_no === 1) ?? item.allocations[0],
    [item.allocations],
  );
  const targets = activeAllocation?.targets ?? [];

  const subtotal = useMemo(
    () => Number(item.subtotal) || Number(item.unit_price) * item.total_quantity,
    [item.subtotal, item.unit_price, item.total_quantity],
  );

  return (
    <Card
      size="small"
      title={
        <Space size="small">
          <Text strong>明细 {index + 1}</Text>
          <Tag color="blue">{publicationLabel(item.publication)}</Tag>
          <Tag color="purple">{fulfillmentTypeLabel(item.fulfillment_type)}</Tag>
          <Tag>{billingTypeLabel(item.billing_type)}</Tag>
        </Space>
      }
    >
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Descriptions column={3} size="small" labelStyle={{ width: 90 }}>
            <Descriptions.Item label="覆盖期">
              {formatCoverage(item.coverage_start_date, item.coverage_end_date)}
            </Descriptions.Item>
            <Descriptions.Item label="单期期号">
              {item.issue_number ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="总份数">
              {item.total_quantity}
            </Descriptions.Item>
            <Descriptions.Item label="单价">
              {formatCurrency(item.unit_price)}
            </Descriptions.Item>
            <Descriptions.Item label="小计">
              {formatCurrency(subtotal)}
            </Descriptions.Item>
            <Descriptions.Item label="备注">{item.notes ?? '-'}</Descriptions.Item>
          </Descriptions>
        </Col>
        <Col span={8}>
          <ProgressPanel item={item} />
        </Col>
      </Row>

      <Title level={5} style={{ marginTop: 0, marginBottom: 8 }}>
        履约目标（{targets.length}）
      </Title>
      <TargetsTable targets={targets} />
    </Card>
  );
}

function ProgressPanel({ item }: { item: OrderItemOut }) {
  const progress = item.progress;
  const driftValue = progress.drift;
  return (
    <Card
      size="small"
      style={{ background: 'var(--color-bg-subtle, #f6f8fa)' }}
      title={
        <Text type="secondary" style={{ fontSize: 12 }}>
          履约进度
        </Text>
      }
    >
      <Row gutter={8}>
        <Col span={12}>
          <Statistic
            title="创建时预估"
            value={progress.expected_at_creation ?? '-'}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col span={12}>
          <Statistic
            title="当前预估"
            value={progress.current_expected ?? '-'}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
      </Row>
      <Row gutter={8} style={{ marginTop: 8 }}>
        <Col span={12}>
          <Statistic
            title="已同步"
            value={progress.synced_count}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col span={12}>
          <Statistic
            title="偏差"
            value={driftLabel(driftValue)}
            valueStyle={{
              fontSize: 18,
              color:
                driftColor(driftValue) === 'error'
                  ? '#cf1322'
                  : driftColor(driftValue) === 'warning'
                  ? '#fa8c16'
                  : driftColor(driftValue) === 'success'
                  ? '#3f8600'
                  : undefined,
            }}
          />
        </Col>
      </Row>
      {progress.skipped_count > 0 && (
        <Alert
          type="info"
          message={`跳过 ${progress.skipped_count} 期（休刊或缺数据）`}
          showIcon
          style={{ marginTop: 8 }}
        />
      )}
    </Card>
  );
}

function TargetsTable({ targets }: { targets: FulfillmentTargetOut[] }) {
  const columns: TableColumnsType<FulfillmentTargetOut> = [
    { title: '收件人', dataIndex: 'recipient_name', key: 'recipient_name', width: 140 },
    {
      title: '电话',
      dataIndex: 'recipient_phone',
      key: 'recipient_phone',
      width: 140,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '收件地址',
      dataIndex: 'recipient_address',
      key: 'recipient_address',
      ellipsis: true,
    },
    {
      title: '邮编',
      dataIndex: 'recipient_postal_code',
      key: 'recipient_postal_code',
      width: 100,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '份数',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s: FulfillmentTargetOut['status']) => (
        <Tag color={targetStatusColor(s)}>{targetStatusLabel(s)}</Tag>
      ),
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 160,
      render: (v: string | null) => v ?? '-',
    },
  ];
  if (targets.length === 0) {
    return <Empty description="无履约目标" />;
  }
  return (
    <Table<FulfillmentTargetOut>
      rowKey="id"
      size="small"
      columns={columns}
      dataSource={targets}
      pagination={false}
    />
  );
}

// =============================================================================
// Tab 2: Allocation versions (flattened across all items)
// =============================================================================

interface AllocationRow {
  key: string;
  itemIndex: number;
  itemLabel: string;
  version_no: number;
  effective_from_issue: number | null;
  effective_until_issue: number | null;
  change_reason: string | null;
  created_at: string;
  target_count: number;
}

function AllocationsTab({ items }: { items: OrderItemOut[] }) {
  const rows = useMemo<AllocationRow[]>(() => {
    const out: AllocationRow[] = [];
    items.forEach((item, idx) => {
      item.allocations.forEach((alloc) => {
        out.push({
          key: `${item.id}-${alloc.id}`,
          itemIndex: idx,
          itemLabel: `明细 ${idx + 1}（${fulfillmentTypeLabel(item.fulfillment_type)}）`,
          version_no: alloc.version_no,
          effective_from_issue: alloc.effective_from_issue,
          effective_until_issue: alloc.effective_until_issue,
          change_reason: alloc.change_reason,
          created_at: alloc.created_at,
          target_count: alloc.targets.length,
        });
      });
    });
    return out;
  }, [items]);

  const columns: TableColumnsType<AllocationRow> = [
    { title: '明细', dataIndex: 'itemLabel', key: 'itemLabel', width: 200 },
    {
      title: '版本号',
      dataIndex: 'version_no',
      key: 'version_no',
      width: 90,
      render: (v: number) => <Tag color="blue">v{v}</Tag>,
    },
    {
      title: '生效起期号',
      dataIndex: 'effective_from_issue',
      key: 'effective_from_issue',
      width: 110,
      render: (v: number | null) => v ?? '-',
    },
    {
      title: '生效止期号',
      dataIndex: 'effective_until_issue',
      key: 'effective_until_issue',
      width: 110,
      render: (v: number | null) => v ?? '-',
    },
    {
      title: '目标数',
      dataIndex: 'target_count',
      key: 'target_count',
      width: 90,
      align: 'right',
    },
    {
      title: '变更原因',
      dataIndex: 'change_reason',
      key: 'change_reason',
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v: string) => v.replace('T', ' ').slice(0, 19),
    },
  ];

  if (rows.length === 0) {
    return <Empty description="尚无分配方案" />;
  }

  return (
    <>
      <Alert
        type="info"
        message="V1.1 每条明细只有 v1 一个分配方案。当履约目标变更（替换/暂停）时会生成新版本，能力将在 V1.2 提供。"
        showIcon
        style={{ marginBottom: 12 }}
      />
      <Table<AllocationRow>
        rowKey="key"
        size="small"
        columns={columns}
        dataSource={rows}
        pagination={false}
      />
    </>
  );
}

// =============================================================================
// Tab 4: Event stream
// =============================================================================

interface EventsTabProps {
  events: OrderEventOut[];
  loading: boolean;
  error: string | null;
}

function EventsTab({ events, loading, error }: EventsTabProps) {
  if (error) {
    return <Alert type="error" showIcon message="加载事件失败" description={error} />;
  }
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }
  if (events.length === 0) {
    return <Empty description="暂无事件记录" />;
  }
  const sorted = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return (
    <Timeline
      mode="left"
      items={sorted.map((evt) => ({
        color: eventTimelineColor(evt.event_type),
        label: (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {evt.created_at.replace('T', ' ').slice(0, 19)}
          </Text>
        ),
        children: <EventCard event={evt} />,
      }))}
    />
  );
}

function eventTimelineColor(eventType: OrderEventOut['event_type']): string {
  switch (eventType) {
    case 'created':
    case 'imported':
      return 'blue';
    case 'confirmed':
      return 'green';
    case 'modified':
    case 'allocation_updated':
    case 'target_added':
    case 'target_replaced':
    case 'target_suspended':
    case 'split':
      return 'orange';
    case 'voided':
    case 'shipping_sync_conflict':
      return 'red';
    case 'synced_to_shipping':
      return 'green';
    default:
      return 'gray';
  }
}

function EventCard({ event }: { event: OrderEventOut }) {
  const summary = summarizeEventPayload(event.payload_json);
  const hasPayload = event.payload_json && Object.keys(event.payload_json).length > 0;
  return (
    <Card size="small" style={{ marginBottom: 8 }}>
      <Space size="small" style={{ marginBottom: 4 }}>
        <Tag color={eventTimelineColor(event.event_type)}>
          {eventTypeLabel(event.event_type)}
        </Tag>
        {event.operator_id != null && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            操作者 #{event.operator_id}
          </Text>
        )}
      </Space>
      {summary && <div style={{ marginBottom: 4 }}>{summary}</div>}
      {hasPayload && (
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'payload',
              label: <Text type="secondary" style={{ fontSize: 12 }}>查看完整 payload</Text>,
              children: (
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    background: 'var(--color-bg-subtle, #f6f8fa)',
                    fontSize: 12,
                    borderRadius: 4,
                    overflow: 'auto',
                    maxHeight: 240,
                  }}
                >
                  {JSON.stringify(event.payload_json, null, 2)}
                </pre>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

function summarizeEventPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (typeof payload.reason === 'string') return `原因：${payload.reason}`;
  if (typeof payload.order_code === 'string') return `订单编码：${payload.order_code}`;
  if (payload.diff && typeof payload.diff === 'object') {
    const keys = Object.keys(payload.diff as Record<string, unknown>);
    if (keys.length > 0) return `变更字段：${keys.join(', ')}`;
  }
  return null;
}
