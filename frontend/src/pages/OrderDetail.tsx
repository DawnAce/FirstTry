import { useEffect, useMemo, useRef, useState } from 'react';
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
  InputNumber,
  Modal,
  Row,
  Select,
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
  CloseCircleOutlined,
  DollarOutlined,
  EditOutlined,
  InboxOutlined,
  RollbackOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import {
  applyAllIssuesForOrder,
  applyOrderShippingSync,
  cancelOrder,
  getOrder,
  listOrderEvents,
  orderQueryKeys,
  previewOrderShippingSync,
  recordPayment,
  refundOrder,
  voidOrder,
} from '../api/orders';
import type {
  FulfillmentAllocationOut,
  FulfillmentTargetOut,
  OrderEventOut,
  OrderItemOut,
  OrderShippingSyncAction,
  OrderShippingSyncItem,
  OrderShippingSyncPreview,
  PaymentOut,
  PaymentPayload,
  RefundOut,
  RefundPayload,
} from '../api/orders';
import { getIssues } from '../api/issues';
import { useAuth } from '../contexts/AuthContext';
import {
  billingTypeLabel,
  canCancelOrder,
  canEditOrder,
  canRefundOrder,
  canVoidOrder,
  commercialStatusColor,
  commercialStatusLabel,
  deliveryMethodLabel,
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
  subscriptionTermLabel,
  targetStatusColor,
  targetStatusLabel,
} from './orderUtils';

const { Title, Text } = Typography;

export default function OrderDetail() {
  const { isAdmin } = useAuth();
  const params = useParams<{ id: string }>();
  const orderId = params.id ? Number(params.id) : NaN;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState<number | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const [refundItemId, setRefundItemId] = useState<number | undefined>(undefined);
  const [refundStopIssue, setRefundStopIssue] = useState<number | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | undefined>(undefined);
  const [paymentNotes, setPaymentNotes] = useState('');

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

  const serverDetail = (err: unknown): string | undefined =>
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;

  const refundMutation = useMutation({
    mutationFn: (payload: RefundPayload) => refundOrder(orderId, payload),
    onSuccess: () => {
      message.success('已记录退款');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
      setRefundModalOpen(false);
    },
    onError: (err: unknown) => {
      message.error(serverDetail(err) ?? '退款失败');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (reason: string) => cancelOrder(orderId, reason),
    onSuccess: () => {
      message.success('订单已取消');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
      setCancelModalOpen(false);
      setCancelReason('');
    },
    onError: (err: unknown) => {
      message.error(serverDetail(err) ?? '取消失败');
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (payload: PaymentPayload) => recordPayment(orderId, payload),
    onSuccess: () => {
      message.success('已记录收款');
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
      setPaymentModalOpen(false);
    },
    onError: (err: unknown) => {
      message.error(serverDetail(err) ?? '收款失败');
    },
  });

  if (!Number.isFinite(orderId)) {
    return (
      <Alert
        type="error"
        showIcon
        title="无效的订单 ID"
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
        title="加载订单失败"
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

  const openRefundModal = () => {
    setRefundAmount(null);
    setRefundReason('');
    setRefundItemId(undefined);
    setRefundStopIssue(null);
    setRefundModalOpen(true);
  };
  const handleRefundSubmit = () => {
    if (!refundAmount || refundAmount <= 0) {
      message.warning('请输入退款金额（大于 0）');
      return;
    }
    refundMutation.mutate({
      amount: refundAmount,
      reason: refundReason.trim() || null,
      order_item_id: refundItemId ?? null,
      stop_from_issue: refundStopIssue ?? null,
    });
  };
  const handleCancelSubmit = () => {
    const reason = cancelReason.trim();
    if (reason.length < 2) {
      message.warning('请填写取消理由（至少 2 个字符）');
      return;
    }
    cancelMutation.mutate(reason);
  };

  const openPaymentModal = () => {
    setPaymentAmount(null);
    setPaymentMethod(undefined);
    setPaymentNotes('');
    setPaymentModalOpen(true);
  };
  const handlePaymentSubmit = () => {
    if (!paymentAmount || paymentAmount <= 0) {
      message.warning('请输入收款金额（大于 0）');
      return;
    }
    paymentMutation.mutate({
      amount: paymentAmount,
      method: paymentMethod ?? null,
      notes: paymentNotes.trim() || null,
    });
  };

  const paymentColumns: TableColumnsType<PaymentOut> = [
    { title: '到账日期', dataIndex: 'collected_at', key: 'collected_at', width: 120 },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (v: string) => <Text type="success">{formatCurrency(v)}</Text>,
    },
    {
      title: '方式',
      dataIndex: 'method',
      key: 'method',
      width: 120,
      render: (v: string | null) => v ?? '-',
    },
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      render: (v: string | null) => v ?? '-',
    },
  ];

  const refundColumns: TableColumnsType<RefundOut> = [
    { title: '退款日期', dataIndex: 'refunded_at', key: 'refunded_at', width: 120 },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (v: string) => <Text type="danger">{formatCurrency(v)}</Text>,
    },
    {
      title: '范围',
      key: 'scope',
      width: 220,
      render: (_: unknown, r) => {
        if (r.order_item_id == null && r.stop_from_issue == null) {
          return <Tag>整单 / 纯退钱</Tag>;
        }
        const parts: string[] = [];
        if (r.order_item_id != null) parts.push(`明细 #${r.order_item_id}`);
        if (r.stop_from_issue != null) parts.push(`第 ${r.stop_from_issue} 期起停发`);
        return parts.join('；');
      },
    },
    {
      title: '原因',
      dataIndex: 'reason',
      key: 'reason',
      render: (v: string | null) => v ?? '-',
    },
  ];

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
          {order.commercial_status && (
            <Tag color={commercialStatusColor(order.commercial_status)}>
              {commercialStatusLabel(order.commercial_status)}
            </Tag>
          )}
          <Tag icon={<InboxOutlined />} color="default">
            {entryMethodLabel(order.entry_method)}
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
          {order.status === 'active' && (
            <Button icon={<DollarOutlined />} onClick={openPaymentModal}>
              记一笔收款
            </Button>
          )}
          {isAdmin && canRefundOrder(order.status, order.commercial_status) && (
            <Button icon={<RollbackOutlined />} onClick={openRefundModal}>
              退款
            </Button>
          )}
          {isAdmin && canCancelOrder(order.status, order.commercial_status) && (
            <Button
              danger
              icon={<CloseCircleOutlined />}
              onClick={() => {
                setCancelReason('');
                setCancelModalOpen(true);
              }}
            >
              取消订单
            </Button>
          )}
          {isAdmin && canVoidOrder(order.status) && (
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
          <Descriptions.Item label="营销活动">
            {order.campaign ? <Tag color="magenta">{order.campaign}</Tag> : '-'}
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
          <Descriptions.Item label="商业状态">
            {order.commercial_status ? (
              <Tag color={commercialStatusColor(order.commercial_status)}>
                {commercialStatusLabel(order.commercial_status)}
              </Tag>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="已退金额">
            {Number(order.refunded_amount) > 0 ? (
              <Text type="danger">{formatCurrency(order.refunded_amount)}</Text>
            ) : (
              '-'
            )}
          </Descriptions.Item>
          <Descriptions.Item label="欠款">
            {Number(order.outstanding_amount) > 0 ? (
              <Text type="danger">{formatCurrency(order.outstanding_amount)}</Text>
            ) : (
              <Text type="success">已付清</Text>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="开票">
            {order.invoice_required ? '是' : '否'}
          </Descriptions.Item>
          {order.invoice_required && (
            <>
              <Descriptions.Item label="发票抬头">
                {order.invoice_title ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="纳税人识别号">
                {order.invoice_tax_no ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="发票接收邮箱">
                {order.invoice_recipient_email ?? '-'}
              </Descriptions.Item>
            </>
          )}
          {order.notes && (
            <Descriptions.Item label="备注" span={3}>
              {order.notes}
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* Payment ledger */}
      {order.payments.length > 0 && (
        <Card size="small" title="收款台账" style={{ marginBottom: 16 }}>
          <Table<PaymentOut>
            rowKey="id"
            size="small"
            pagination={false}
            columns={paymentColumns}
            dataSource={order.payments}
          />
        </Card>
      )}

      {/* Refund ledger */}
      {order.refunds.length > 0 && (
        <Card size="small" title="退款台账" style={{ marginBottom: 16 }}>
          <Table<RefundOut>
            rowKey="id"
            size="small"
            pagination={false}
            columns={refundColumns}
            dataSource={order.refunds}
          />
        </Card>
      )}

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
            children: <ShippingSyncTab orderId={order.id} />,
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

      <Modal
        title={`退款 ${order.order_code ?? `#${order.id}`}`}
        open={refundModalOpen}
        onCancel={() => setRefundModalOpen(false)}
        onOk={handleRefundSubmit}
        okText="确认退款"
        okButtonProps={{ loading: refundMutation.isPending }}
        cancelText="取消"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text>
              退款金额（实付 {formatCurrency(order.paid_amount)}、已退{' '}
              {formatCurrency(order.refunded_amount)}）
            </Text>
            <InputNumber
              value={refundAmount}
              onChange={(v) => setRefundAmount(v as number | null)}
              min={0.01}
              precision={2}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="本次退款金额"
            />
          </div>
          <div>
            <Text type="secondary">退哪条明细（可选；留空 = 整单 / 纯退钱）</Text>
            <Select
              allowClear
              value={refundItemId}
              onChange={(v) => setRefundItemId(v)}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="不选 = 不针对单条明细"
              options={order.items.map((it) => ({
                value: it.id,
                label: `#${it.id} ${publicationLabel(it.publication)} · ${fulfillmentTypeLabel(
                  it.fulfillment_type,
                )}（${formatCurrency(it.subtotal)}）`,
              }))}
            />
          </div>
          <div>
            <Text type="secondary">从第几期起停发（可选；订阅中途退订填此项）</Text>
            <InputNumber
              value={refundStopIssue}
              onChange={(v) => setRefundStopIssue(v as number | null)}
              min={1}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="留空 = 不按期停发"
            />
          </div>
          <div>
            <Text type="secondary">退款原因</Text>
            <Input.TextArea
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="例如：客户少订一份 / 协商退差价"
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            退款累计达到实付即视为全额退款、整单停发；部分退款按上面的范围停发；都不填则纯退钱、履约不变。
          </Text>
        </Space>
      </Modal>

      <Modal
        title={`取消订单 ${order.order_code ?? `#${order.id}`}`}
        open={cancelModalOpen}
        onCancel={() => setCancelModalOpen(false)}
        onOk={handleCancelSubmit}
        okText="确认取消订单"
        okButtonProps={{ danger: true, loading: cancelMutation.isPending }}
        cancelText="返回"
      >
        <p style={{ marginBottom: 8 }}>
          取消将把订单标为「已取消」、把未退的实付（
          {formatCurrency(Number(order.paid_amount) - Number(order.refunded_amount))}
          ）记为一笔全额退款，并停掉所有未发货的快递明细。
        </p>
        <Input.TextArea
          value={cancelReason}
          onChange={(e) => setCancelReason(e.target.value)}
          rows={3}
          maxLength={255}
          showCount
          placeholder="取消理由"
        />
      </Modal>

      <Modal
        title={`记一笔收款 ${order.order_code ?? `#${order.id}`}`}
        open={paymentModalOpen}
        onCancel={() => setPaymentModalOpen(false)}
        onOk={handlePaymentSubmit}
        okText="确认收款"
        okButtonProps={{ loading: paymentMutation.isPending }}
        cancelText="取消"
      >
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Text>
              收款金额（应收 {formatCurrency(order.total_amount)}、已收{' '}
              {formatCurrency(order.paid_amount)}、欠款{' '}
              {formatCurrency(order.outstanding_amount)}）
            </Text>
            <InputNumber
              value={paymentAmount}
              onChange={(v) => setPaymentAmount(v as number | null)}
              min={0.01}
              precision={2}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="本次到账金额"
            />
          </div>
          <div>
            <Text type="secondary">收款方式（可选）</Text>
            <Select
              allowClear
              value={paymentMethod}
              onChange={(v) => setPaymentMethod(v)}
              style={{ width: '100%', marginTop: 4 }}
              placeholder="如 对公转账 / 微信 / 支付宝"
              options={[
                { value: '对公转账', label: '对公转账' },
                { value: '微信', label: '微信' },
                { value: '支付宝', label: '支付宝' },
                { value: '银行卡', label: '银行卡' },
                { value: '现金', label: '现金' },
                { value: '其他', label: '其他' },
              ]}
            />
          </div>
          <div>
            <Text type="secondary">备注（可选）</Text>
            <Input.TextArea
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="如 第一期定金 / 到账流水号"
            />
          </div>
        </Space>
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
      item.allocations
        .filter((a) => a.effective_until_issue == null)
        .sort((a, b) => b.version_no - a.version_no)[0]
      ?? [...item.allocations].sort((a, b) => b.version_no - a.version_no)[0],
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
      {item.allocations.length > 1 && (
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            履约方案版本历史：
          </Text>
          {item.allocations
            .sort((a, b) => a.version_no - b.version_no)
            .map((alloc) => (
              <Tag key={alloc.id} color={alloc.effective_until_issue ? 'default' : 'blue'}>
                v{alloc.version_no}
                {alloc.effective_from_issue != null && ` 第${alloc.effective_from_issue}期起`}
                {alloc.effective_until_issue != null && ` 至第${alloc.effective_until_issue}期`}
                {alloc.effective_until_issue == null && alloc.effective_from_issue != null && ' (当前)'}
              </Tag>
            ))}
        </div>
      )}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={16}>
          <Descriptions column={3} size="small" labelStyle={{ width: 90 }}>
            <Descriptions.Item label="覆盖期">
              {formatCoverage(item.coverage_start_date, item.coverage_end_date)}
            </Descriptions.Item>
            <Descriptions.Item label="订阅期限">
              {subscriptionTermLabel(item.subscription_term)}
            </Descriptions.Item>
            <Descriptions.Item label="投递方式">
              {deliveryMethodLabel(item.delivery_method)}
            </Descriptions.Item>
            <Descriptions.Item label="起始月份">
              {item.term_start_month ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="单期期号">
              {item.issue_number ?? '-'}
            </Descriptions.Item>
            <Descriptions.Item label="每期总份数">
              {item.total_quantity}
            </Descriptions.Item>
            <Descriptions.Item label="单份套餐价">
              {formatCurrency(item.unit_price)}
            </Descriptions.Item>
            <Descriptions.Item label="应收小计">
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
      <Row gutter={8} style={{ marginTop: 8 }}>
        <Col span={12}>
          <Statistic
            title="已发"
            value={progress.shipped_count}
            valueStyle={{ fontSize: 18 }}
          />
        </Col>
        <Col span={12}>
          <Statistic
            title="未发缺口"
            value={Math.max(0, progress.synced_count - progress.shipped_count)}
            valueStyle={{
              fontSize: 18,
              color:
                progress.synced_count - progress.shipped_count > 0 ? '#fa8c16' : '#3f8600',
            }}
          />
        </Col>
      </Row>
      {progress.skipped_count > 0 && (
        <Alert
          type="info"
          title={`跳过 ${progress.skipped_count} 期（休刊或缺数据）`}
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
        title="每条明细的履约方案按版本追踪。修改目标（收件人）时会自动创建新版本，旧版本保留历史记录。"
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
// Tab 3: Shipping sync
// =============================================================================

function ShippingSyncTab({ orderId }: { orderId: number }) {
  const queryClient = useQueryClient();
  const [selectedIssueNumber, setSelectedIssueNumber] = useState<number | null>(null);
  const selectedIssueNumberRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<OrderShippingSyncPreview | null>(null);

  useEffect(() => {
    selectedIssueNumberRef.current = null;
    setSelectedIssueNumber(null);
    setPreview(null);
  }, [orderId]);

  const issuesQuery = useQuery({
    queryKey: ['issues', 0, 100],
    queryFn: async () => {
      const res = await getIssues(0, 100);
      return res.data;
    },
  });

  const issueOptions = useMemo(
    () =>
      [...(issuesQuery.data ?? [])]
        .sort((a, b) => b.issue_number - a.issue_number)
        .map((issue) => ({
          value: issue.issue_number,
          label: `第 ${issue.issue_number} 期${issue.year_issue_label ? `（${issue.year_issue_label}）` : ''}`,
        })),
    [issuesQuery.data],
  );

  const previewMutation = useMutation({
    mutationFn: async (issueNumber: number) => {
      const res = await previewOrderShippingSync(orderId, issueNumber);
      return res.data;
    },
    onSuccess: (data, requestedIssueNumber) => {
      if (
        !isCurrentShippingSyncPreview(
          data,
          orderId,
          requestedIssueNumber,
          selectedIssueNumberRef.current,
        )
      ) {
        return;
      }
      setPreview(data);
      message.success('同步预览已生成');
    },
    onError: () => {
      message.error('生成同步预览失败');
    },
  });

  const applyMutation = useMutation({
    mutationFn: async (issueNumber: number) => {
      const res = await applyOrderShippingSync(orderId, issueNumber);
      return res.data;
    },
    onSuccess: (data, requestedIssueNumber) => {
      if (
        isCurrentShippingSyncPreview(
          data,
          orderId,
          requestedIssueNumber,
          selectedIssueNumberRef.current,
        )
      ) {
        setPreview(data);
        message.success('快递明细同步完成');
      }
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.events(orderId) });
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
      queryClient.invalidateQueries({ queryKey: ['shippingCompanies'] });
      queryClient.invalidateQueries({ queryKey: ['report'] });
    },
    onError: (error, requestedIssueNumber) => {
      const conflictPreview = getShippingSyncConflictPreview(error);
      if (conflictPreview) {
        if (
          !isCurrentShippingSyncPreview(
            conflictPreview,
            orderId,
            requestedIssueNumber,
            selectedIssueNumberRef.current,
          )
        ) {
          return;
        }
        setPreview(conflictPreview);
        message.warning('同步存在冲突，请处理后重试');
        return;
      }
      message.error('同步快递明细失败');
    },
  });

  const allIssuesMutation = useMutation({
    mutationFn: async () => {
      const res = await applyAllIssuesForOrder(orderId);
      return res.data;
    },
    onSuccess: (data) => {
      const parts = [`同步 ${data.issues_synced}/${data.issues_total} 期，建 ${data.rows_created} 行`];
      if (data.conflict_issues.length) parts.push(`冲突期 ${data.conflict_issues.join('、')}（人工改过，已跳过）`);
      if (data.issues_no_calendar.length) parts.push(`未建刊期 ${data.issues_no_calendar.join('、')}（先在刊期表建期）`);
      message.success(parts.join('；'));
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.detail(orderId) });
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.events(orderId) });
      queryClient.invalidateQueries({ queryKey: ['shippingDetails'] });
      setPreview(null);
    },
    onError: () => {
      message.error('同步全部期失败');
    },
  });

  const summary = preview?.summary;
  const hasConflicts = (summary?.conflicts ?? 0) > 0;
  const isPreviewCurrent = preview
    ? isCurrentShippingSyncPreview(preview, orderId, preview.issue_number, selectedIssueNumber)
    : false;
  const canApply =
    isPreviewCurrent && !hasConflicts && !previewMutation.isPending && !applyMutation.isPending;

  const columns: TableColumnsType<OrderShippingSyncItem> = [
    {
      title: '动作',
      dataIndex: 'action',
      key: 'action',
      width: 90,
      render: (action: OrderShippingSyncAction) => (
        <Tag color={shippingSyncActionColor(action)}>{shippingSyncActionLabel(action)}</Tag>
      ),
    },
    { title: '收件人', dataIndex: 'name', key: 'name', width: 140, render: nullableText },
    {
      title: '份数',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 80,
      align: 'right',
      render: nullableText,
    },
    {
      title: '订单明细',
      dataIndex: 'order_item_id',
      key: 'order_item_id',
      width: 100,
      render: nullableText,
    },
    {
      title: '履约目标',
      dataIndex: 'fulfillment_target_id',
      key: 'fulfillment_target_id',
      width: 100,
      render: nullableText,
    },
    { title: '原因', dataIndex: 'reason', key: 'reason', render: nullableText },
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small">
        <Space wrap>
          <Select<number>
            style={{ width: 220 }}
            loading={issuesQuery.isLoading}
            options={issueOptions}
            placeholder="选择目标期号"
            value={selectedIssueNumber}
            onChange={(value) => {
              selectedIssueNumberRef.current = value;
              setSelectedIssueNumber(value);
              setPreview(null);
            }}
          />
          <Button
            type="primary"
            disabled={selectedIssueNumber == null}
            loading={previewMutation.isPending}
            onClick={() => {
              if (selectedIssueNumber != null) previewMutation.mutate(selectedIssueNumber);
            }}
          >
            预览同步
          </Button>
          <Button
            disabled={!canApply}
            loading={applyMutation.isPending}
            onClick={() => {
              if (preview && isPreviewCurrent) applyMutation.mutate(preview.issue_number);
            }}
          >
            确认同步
          </Button>
          <Button
            loading={allIssuesMutation.isPending}
            onClick={() => allIssuesMutation.mutate()}
            title="把本单覆盖期内所有刊期一次排齐（仅同步已建的刊期；冲突单跳过）"
          >
            同步全部期
          </Button>
        </Space>
      </Card>

      {preview?.message && (
        <Alert type="warning" showIcon title={preview.message} />
      )}

      {hasConflicts && (
        <Alert
          type="error"
          showIcon
          title="存在同步冲突，请先处理发货明细中的手动改动后再确认同步。"
        />
      )}

      {summary && (
        <Row gutter={12}>
          <Col span={4}>
            <Statistic title="候选" value={summary.candidates} />
          </Col>
          <Col span={4}>
            <Statistic title="待新建" value={summary.to_create} />
          </Col>
          <Col span={4}>
            <Statistic title="待更新" value={summary.to_update} />
          </Col>
          <Col span={4}>
            <Statistic title="已跳过" value={summary.skipped} />
          </Col>
          <Col span={4}>
            <Statistic
              title="冲突"
              value={summary.conflicts}
              valueStyle={hasConflicts ? { color: '#cf1322' } : undefined}
            />
          </Col>
        </Row>
      )}

      <Table<OrderShippingSyncItem>
        rowKey={(row, index) =>
          `${row.action}-${row.order_item_id ?? 'item'}-${row.fulfillment_target_id ?? 'target'}-${index}`
        }
        size="small"
        columns={columns}
        dataSource={preview?.items ?? []}
        loading={previewMutation.isPending || applyMutation.isPending}
        pagination={false}
        locale={{ emptyText: '请选择期号并生成同步预览' }}
      />
    </Space>
  );
}

function nullableText(value: string | number | null | undefined) {
  return value ?? '-';
}

function getShippingSyncConflictPreview(error: unknown): OrderShippingSyncPreview | null {
  if (!isRecord(error)) return null;
  const response = error.response;
  if (!isRecord(response) || response.status !== 409) return null;
  const data = response.data;
  if (!isRecord(data)) return null;
  const detail = data.detail;
  return isOrderShippingSyncPreview(detail) ? detail : null;
}

function isCurrentShippingSyncPreview(
  preview: OrderShippingSyncPreview,
  currentOrderId: number,
  requestedIssueNumber: number,
  selectedIssueNumber: number | null,
): boolean {
  return (
    preview.order_id === currentOrderId
    && preview.issue_number === requestedIssueNumber
    && preview.issue_number === selectedIssueNumber
  );
}

function isOrderShippingSyncPreview(value: unknown): value is OrderShippingSyncPreview {
  if (!isRecord(value)) return false;
  if (typeof value.order_id !== 'number' || typeof value.issue_number !== 'number') {
    return false;
  }
  if (!Array.isArray(value.items)) return false;
  const summary = value.summary;
  return (
    isRecord(summary)
    && typeof summary.candidates === 'number'
    && typeof summary.to_create === 'number'
    && typeof summary.to_update === 'number'
    && typeof summary.skipped === 'number'
    && typeof summary.conflicts === 'number'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shippingSyncActionLabel(action: OrderShippingSyncAction): string {
  switch (action) {
    case 'create':
      return '新建';
    case 'update':
      return '更新';
    case 'skip':
      return '跳过';
    case 'conflict':
      return '冲突';
  }
}

function shippingSyncActionColor(action: OrderShippingSyncAction): string {
  switch (action) {
    case 'create':
      return 'green';
    case 'update':
      return 'blue';
    case 'skip':
      return 'default';
    case 'conflict':
      return 'red';
  }
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
    return <Alert type="error" showIcon title="加载事件失败" description={error} />;
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
              label: <Text type="secondary" style={{ fontSize: 12 }}>查看完整数据</Text>,
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
