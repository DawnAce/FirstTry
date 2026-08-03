import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Empty,
  Form,
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
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
  RollbackOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
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
import {
  applyAddressChange,
  createAddressChange,
  getAddressChange,
  listDeliveries,
  listTickets,
} from '../api/postal';
import type {
  AddressChangePayload,
  PostalAddressChange,
  PostalDelivery,
  Ticket,
} from '../api/postal';
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
  entryMethodLabel,
  eventTypeLabel,
  fulfillmentTypeLabel,
  formatCoverage,
  formatCurrency,
  publicationLabel,
  statusBadgeColor,
  statusLabel,
  subscriptionTermLabel,
  targetStatusLabel,
} from './orderUtils';
import './OrderManagement.css';

const { Text } = Typography;

export default function OrderDetail() {
  const { isAdmin } = useAuth();
  const params = useParams<{ id: string }>();
  const orderId = params.id ? Number(params.id) : NaN;
  const navigate = useNavigate();
  const location = useLocation();
  const justActivated = Boolean((location.state as { justActivated?: boolean } | null)?.justActivated);
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
  const [addressFormDelivery, setAddressFormDelivery] = useState<PostalDelivery | null>(null);
  const [addressDetailId, setAddressDetailId] = useState<number | null>(null);

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

  const postalDeliveriesQuery = useQuery({
    queryKey: ['postalDeliveries', 'order', orderId],
    queryFn: () => listDeliveries({ order_id: orderId, page_size: 200 }).then((r) => r.data),
    enabled: Number.isFinite(orderId),
  });

  const addressTicketsQuery = useQuery({
    queryKey: ['postalTickets', 'order-address', orderId],
    queryFn: () => listTickets({ type: 'address', order_id: orderId, page_size: 200 }).then((r) => r.data),
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
  const progressSummary = computeOrderProgress(order.items);
  const termSummary = computeOrderTermSummary(order.items);
  const progressPercent = progressSummary.expected > 0
    ? Math.min(100, Math.round((progressSummary.shipped / progressSummary.expected) * 100))
    : 0;

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
    <div className="order-page order-detail-page">
      {justActivated && (
        <section className="order-detail-success">
          <div className="order-detail-success-icon"><CheckOutlined /></div>
          <div>
            <h3>订单已创建并生效</h3>
            <p>{order.order_code ?? `订单 #${order.id}`} · 履约方案已同步生成</p>
          </div>
          <Button onClick={() => navigate('/orders/new')}>再建一单</Button>
        </section>
      )}

      <header className="order-page-header">
        <div className="order-page-heading">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>
            返回列表
          </Button>
          <div>
            <div className="order-title-line">
              <h1>{order.order_code ?? `订单 #${order.id}`}</h1>
              <Badge status={statusBadgeColor(order.status)} text={statusLabel(order.status)} />
              {order.commercial_status && (
                <Tag color={commercialStatusColor(order.commercial_status)}>
                  {commercialStatusLabel(order.commercial_status)}
                </Tag>
              )}
              <Tag icon={<InboxOutlined />}>{entryMethodLabel(order.entry_method)}</Tag>
            </div>
            <p>
              {order.source_platform ?? '未知平台'} · {order.source_store ?? '未知店铺'} · {order.external_order_no ?? '无来源单号'}
            </p>
          </div>
        </div>
        <div className="order-detail-actions">
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
        </div>
      </header>

      <section className="order-detail-overview" aria-label="订单核心摘要">
        <div className="order-detail-overview-cell is-payer">
          <span>付款主体</span>
          <div className="order-detail-person">
            <i>{order.payer_name.slice(0, 1)}</i>
            <div><strong>{order.payer_name}</strong><small>{order.payer_contact || '未记录联系方式'}</small></div>
          </div>
        </div>
        <div className="order-detail-overview-cell is-amount"><span>订单总额</span><strong>{formatCurrency(order.total_amount)}</strong></div>
        <div className="order-detail-overview-cell"><span>订阅周期</span><strong>{termSummary}</strong></div>
        <div className="order-detail-overview-cell"><span>覆盖期</span><strong>{headerCoverage}</strong></div>
      </section>

      <section className="order-detail-progress-strip" aria-label="订单履约进度">
        <div><strong>履约进度</strong><span>{progressSummary.deliveryLabel} · {progressSummary.shipped > 0 ? '履约中' : '尚未开始'}</span></div>
        <div className="order-detail-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
        <div className="order-detail-progress-values">
          <span><small>已发</small><strong>{progressSummary.shipped} / {progressSummary.expected || '-'} 期</strong></span>
          <span><small>已同步</small><strong>{progressSummary.synced} 期</strong></span>
        </div>
      </section>

      <div className="order-detail-main-grid">
        <section className="order-detail-primary">
          <Tabs
            className="order-detail-content-tabs"
            defaultActiveKey="items"
            items={[
              {
                key: 'items',
                label: '订单内容',
                children: (
                  <ItemsTab
                    items={order.items}
                    deliveries={postalDeliveriesQuery.data?.rows ?? []}
                    addressTickets={addressTicketsQuery.data?.rows ?? []}
                    addressLoading={addressTicketsQuery.isLoading}
                    onStartAddressChange={setAddressFormDelivery}
                    onOpenAddressChange={setAddressDetailId}
                  />
                ),
              },
              {
                key: 'allocations',
                label: '履约方案',
                children: <AllocationsTab items={order.items} />,
              },
              {
                key: 'payments',
                label: '收款记录',
                children: (
                  <PaymentLedgerTab
                    payments={order.payments}
                    refunds={order.refunds}
                    paymentColumns={paymentColumns}
                    refundColumns={refundColumns}
                  />
                ),
              },
              {
                key: 'shipping',
                label: '关联快递',
                children: <ShippingSyncTab orderId={order.id} />,
              },
              {
                key: 'postal',
                label: '关联邮局',
                children: <PostalDeliveriesTab orderId={order.id} />,
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
        </section>

        <aside className="order-detail-side-column">
          <Card
            className="order-detail-side-card"
            title={<span><DollarOutlined />收款与发票</span>}
            extra={order.status === 'active' ? <Button type="link" onClick={openPaymentModal}>记一笔收款</Button> : null}
          >
            <div className="order-detail-money-panel">
              <div><span>订单应收</span><strong>{formatCurrency(order.total_amount)}</strong></div>
              <div><span>累计已付</span><strong className="is-paid">{formatCurrency(order.paid_amount)}</strong></div>
              <div><span>待收金额</span><strong className={Number(order.outstanding_amount) > 0 ? 'is-due' : 'is-paid'}>{Number(order.outstanding_amount) > 0 ? formatCurrency(order.outstanding_amount) : '已付清'}</strong></div>
            </div>
            <div className="order-detail-invoice-state">
              <span>发票状态</span>
              <strong>{order.invoice_required ? '需要发票 · 待开具' : '无需发票'}</strong>
            </div>
          </Card>

          <Card
            className="order-detail-side-card"
            title={<span><FileTextOutlined />订单信息</span>}
            extra={canEditOrder(order.status) ? <Button type="link" onClick={() => navigate(`/orders/${order.id}/edit`)}>编辑</Button> : null}
          >
            <dl className="order-detail-info-list">
              <div><dt>下单日期</dt><dd>{order.order_date}</dd></div>
              <div><dt>来源平台</dt><dd>{order.source_platform ?? '-'}</dd></div>
              <div><dt>来源店铺</dt><dd>{order.source_store ?? '-'}</dd></div>
              <div><dt>支付方式</dt><dd>{order.payment_method ?? '-'}</dd></div>
              <div><dt>收款经办</dt><dd>{order.payment_collector ?? '-'}</dd></div>
              {order.campaign && <div><dt>营销活动</dt><dd>{order.campaign}</dd></div>}
              {order.invoice_required && <div><dt>发票抬头</dt><dd>{order.invoice_title ?? '-'}</dd></div>}
              {order.invoice_required && <div><dt>发票邮箱</dt><dd>{order.invoice_recipient_email ?? '-'}</dd></div>}
              {order.notes && <div><dt>备注</dt><dd>{order.notes}</dd></div>}
            </dl>
          </Card>
        </aside>
      </div>

      <OrderAddressChangeFormModal
        orderCode={order.order_code ?? `订单 #${order.id}`}
        delivery={addressFormDelivery}
        onClose={() => setAddressFormDelivery(null)}
        onCreated={(change) => {
          setAddressFormDelivery(null);
          setAddressDetailId(change.id);
          queryClient.invalidateQueries({ queryKey: ['postalTickets', 'order-address', order.id] });
        }}
      />

      <OrderAddressChangeDetailModal
        addressId={addressDetailId}
        isAdmin={isAdmin}
        onClose={() => setAddressDetailId(null)}
        onApplied={() => {
          queryClient.invalidateQueries({ queryKey: orderQueryKeys.detail(order.id) });
          queryClient.invalidateQueries({ queryKey: ['postalDeliveries', 'order', order.id] });
          queryClient.invalidateQueries({ queryKey: ['postalTickets', 'order-address', order.id] });
        }}
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

function computeOrderProgress(items: OrderItemOut[]) {
  const expected = items.reduce(
    (sum, item) => sum + (item.progress.current_expected ?? item.progress.expected_at_creation ?? 0),
    0,
  );
  const synced = items.reduce((sum, item) => sum + item.progress.synced_count, 0);
  const shipped = items.reduce((sum, item) => sum + item.progress.shipped_count, 0);
  const deliveryLabels = [...new Set(items.map((item) => deliveryMethodLabel(item.delivery_method)).filter((label) => label !== '-'))];
  return {
    expected,
    synced,
    shipped,
    deliveryLabel: deliveryLabels.length === 1 ? deliveryLabels[0] : deliveryLabels.length > 1 ? '多种投递方式' : '待配置投递',
  };
}

function computeOrderTermSummary(items: OrderItemOut[]): string {
  const labels = [...new Set(items.map((item) => subscriptionTermLabel(item.subscription_term)).filter((label) => label !== '-'))];
  const expected = items.reduce(
    (sum, item) => sum + (item.progress.current_expected ?? item.progress.expected_at_creation ?? 0),
    0,
  );
  const term = labels.length === 1 ? labels[0] : labels.length > 1 ? '多种期限' : '单期';
  return expected > 0 ? `${term} · ${expected} 期` : term;
}

// =============================================================================
// Tab 1: Items
// =============================================================================

interface ItemsTabProps {
  items: OrderItemOut[];
  deliveries: PostalDelivery[];
  addressTickets: Ticket[];
  addressLoading: boolean;
  onStartAddressChange: (delivery: PostalDelivery) => void;
  onOpenAddressChange: (id: number) => void;
}

function ItemsTab({
  items,
  deliveries,
  addressTickets,
  addressLoading,
  onStartAddressChange,
  onOpenAddressChange,
}: ItemsTabProps) {
  if (items.length === 0) {
    return <Empty description="该订单没有明细" />;
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {items.map((item, idx) => (
        <ItemCard
          key={item.id}
          item={item}
          index={idx}
          deliveries={deliveries}
          addressTickets={addressTickets}
          addressLoading={addressLoading}
          onStartAddressChange={onStartAddressChange}
          onOpenAddressChange={onOpenAddressChange}
        />
      ))}
    </Space>
  );
}

function ItemCard({
  item,
  index,
  deliveries,
  addressTickets,
  addressLoading,
  onStartAddressChange,
  onOpenAddressChange,
}: {
  item: OrderItemOut;
  index: number;
  deliveries: PostalDelivery[];
  addressTickets: Ticket[];
  addressLoading: boolean;
  onStartAddressChange: (delivery: PostalDelivery) => void;
  onOpenAddressChange: (id: number) => void;
}) {
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
      className="order-detail-tab-card"
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
      <div className="order-detail-item-facts">
        <div><span>覆盖期</span><strong>{formatCoverage(item.coverage_start_date, item.coverage_end_date)}</strong></div>
        <div><span>投递方式</span><strong>{deliveryMethodLabel(item.delivery_method)}</strong></div>
        <div><span>起始月份</span><strong>{item.term_start_month ?? '-'}</strong></div>
        <div><span>每期总份数</span><strong>{item.total_quantity} 份</strong></div>
        <div><span>单份套餐价</span><strong>{formatCurrency(item.unit_price)}</strong></div>
        <div><span>应收小计</span><strong>{formatCurrency(subtotal)}</strong></div>
      </div>

      <div className="order-detail-target-title">
        <span><UserOutlined />履约目标</span><Tag>{targets.length} 位</Tag>
      </div>
      <TargetsList
        targets={targets}
        itemId={item.id}
        deliveries={deliveries}
        addressTickets={addressTickets}
        loading={addressLoading}
        onStartAddressChange={onStartAddressChange}
        onOpenAddressChange={onOpenAddressChange}
      />
    </Card>
  );
}

function TargetsList({
  targets,
  itemId,
  deliveries,
  addressTickets,
  loading,
  onStartAddressChange,
  onOpenAddressChange,
}: {
  targets: FulfillmentTargetOut[];
  itemId: number;
  deliveries: PostalDelivery[];
  addressTickets: Ticket[];
  loading: boolean;
  onStartAddressChange: (delivery: PostalDelivery) => void;
  onOpenAddressChange: (id: number) => void;
}) {
  if (targets.length === 0) return <Empty description="无履约目标" />;
  return (
    <div className="order-detail-target-list">
      {targets.map((target) => {
        const delivery = deliveries.find((row) => row.fulfillment_target_id === target.id)
          ?? deliveries.find((row) => row.order_item_id === itemId && row.recipient_name === target.recipient_name);
        const tickets = delivery
          ? addressTickets.filter((ticket) => ticket.postal_delivery_id === delivery.id)
          : [];
        const pending = tickets.find((ticket) => ticket.status === 'pending' || ticket.status === 'unmatched');
        const applied = tickets.filter((ticket) => ticket.status === 'applied' || ticket.status === 'recipient_pending');
        const latest = pending ?? tickets[0];
        return (
          <div className="order-detail-target" key={target.id}>
            <div><span>收报人</span><strong>{target.recipient_name}</strong></div>
            <div><span>联系电话</span><strong>{target.recipient_phone ?? '-'}</strong></div>
            <div className="is-address"><span>当前投递地址</span><strong>{target.recipient_address}</strong></div>
            <div className="order-detail-target-actions">
              {loading ? (
                <Tag>变更状态加载中</Tag>
              ) : pending ? (
                <Tag color="orange">地址变更处理中</Tag>
              ) : applied.length > 0 ? (
                <Tag color="blue">地址已变更 · {applied.length} 次</Tag>
              ) : (
                <Tag>{targetStatusLabel(target.status)}</Tag>
              )}
              {latest && (
                <Button type="link" icon={<HistoryOutlined />} onClick={() => onOpenAddressChange(latest.id)}>
                  {pending ? '查看处理进度' : '查看变更记录'}
                </Button>
              )}
              {!pending && delivery && (
                <Button type="link" icon={<EnvironmentOutlined />} onClick={() => onStartAddressChange(delivery)}>
                  修改收件信息
                </Button>
              )}
              {!pending && !delivery && (
                <Tooltip title="需先生成或关联邮局投递记录">
                  <Button type="link" icon={<EnvironmentOutlined />} disabled>修改收件信息</Button>
                </Tooltip>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaymentLedgerTab({
  payments,
  refunds,
  paymentColumns,
  refundColumns,
}: {
  payments: PaymentOut[];
  refunds: RefundOut[];
  paymentColumns: TableColumnsType<PaymentOut>;
  refundColumns: TableColumnsType<RefundOut>;
}) {
  if (payments.length === 0 && refunds.length === 0) {
    return <Empty description="暂无收款或退款记录" />;
  }
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {payments.length > 0 && (
        <Card className="order-detail-ledger-card" size="small" title={`收款台账（${payments.length}）`}>
          <Table<PaymentOut> rowKey="id" size="small" pagination={false} columns={paymentColumns} dataSource={payments} />
        </Card>
      )}
      {refunds.length > 0 && (
        <Card className="order-detail-ledger-card" size="small" title={`退款台账（${refunds.length}）`}>
          <Table<RefundOut> rowKey="id" size="small" pagination={false} columns={refundColumns} dataSource={refunds} />
        </Card>
      )}
    </Space>
  );
}

interface AddressChangeFormValues {
  new_name?: string;
  new_phone?: string;
  new_address: string;
  effective_date: Dayjs;
  reason: string;
}

function postalErrorText(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? fallback;
}

function OrderAddressChangeFormModal({
  orderCode,
  delivery,
  onClose,
  onCreated,
}: {
  orderCode: string;
  delivery: PostalDelivery | null;
  onClose: () => void;
  onCreated: (change: PostalAddressChange) => void;
}) {
  const [form] = Form.useForm<AddressChangeFormValues>();
  useEffect(() => {
    if (!delivery) return;
    form.setFieldsValue({
      new_name: delivery.recipient_name,
      new_phone: delivery.recipient_phone ?? undefined,
      new_address: '',
      effective_date: dayjs().add(1, 'day'),
      reason: '',
    });
  }, [delivery, form]);

  const createMutation = useMutation({
    mutationFn: (values: AddressChangeFormValues) => {
      if (!delivery) throw new Error('未选择邮局投递记录');
      const payload: AddressChangePayload = {
        year: delivery.year,
        delivery_no: delivery.delivery_no,
        change_date: dayjs().toISOString(),
        old_name: delivery.recipient_name,
        old_phone: delivery.recipient_phone,
        old_address: delivery.recipient_address,
        old_copies: delivery.copies,
        new_name: values.new_name?.trim() || null,
        new_phone: values.new_phone?.trim() || null,
        new_address: values.new_address.trim(),
        new_copies: delivery.copies,
        original_start_month: delivery.coverage_start_date
          ? dayjs(delivery.coverage_start_date).format('MMDD')
          : null,
        effective_start_month: values.effective_date.format('MMDD'),
        notes: values.reason.trim(),
      };
      return createAddressChange(payload).then((response) => response.data);
    },
    onSuccess: (change) => {
      message.success('收件信息变更工单已创建');
      onCreated(change);
    },
    onError: (error) => message.error(postalErrorText(error, '创建收件信息变更失败')),
  });

  return (
    <Modal
      title={(
        <div className="complaint-form-title">
          <span className="complaint-form-title-icon" aria-hidden>📬</span>
          <div className="complaint-form-title-copy">
            <strong>新建收件信息变更</strong>
            <div className="complaint-form-meta">
              <span>由订单详情发起</span><i>·</i><span>{orderCode}</span>
            </div>
          </div>
          <span className="complaint-form-status status-address">信息变更</span>
        </div>
      )}
      open={delivery != null}
      onCancel={onClose}
      width={820}
      centered
      destroyOnHidden
      className="complaint-form-modal address-form-modal order-address-change-modal"
      rootClassName="complaint-form-modal-root"
      footer={(
        <div className="complaint-form-footer">
          <span className="complaint-form-save-tip"><b>✓</b>保存后生成待应用工单，不会立即覆盖当前地址</span>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={createMutation.isPending} onClick={() => form.submit()}>创建变更工单</Button>
        </div>
      )}
    >
      {delivery && (
        <Form<AddressChangeFormValues>
          form={form}
          layout="vertical"
          className="complaint-form address-change-form"
          onFinish={(values) => createMutation.mutate(values)}
        >
          <section className="complaint-form-section complaint-form-reader">
            <h3><span aria-hidden>🔗</span>来源订单与收报人</h3>
            <div className="order-address-source-grid">
              <div><span>来源订单</span><strong>{orderCode}</strong></div>
              <div><span>投递编号</span><strong>{delivery.year}-{delivery.delivery_no}</strong></div>
              <div><span>收报人</span><strong>{delivery.recipient_name} · {delivery.copies} 份</strong></div>
            </div>
            <div className="complaint-form-source-note"><span aria-hidden>✓</span><span>已关联邮局投递记录；工单应用后会同步更新订单履约目标</span></div>
          </section>

          <section className="complaint-form-section">
            <h3><span aria-hidden>↔️</span>变更前后对比</h3>
            <Form.Item label="原投递地址">
              <Input value={delivery.recipient_address} disabled />
            </Form.Item>
            <Form.Item name="new_address" label="新投递地址" rules={[{ required: true, message: '请填写新投递地址' }]}>
              <Input placeholder="请输入完整省、市、区及详细地址" />
            </Form.Item>
            <div className="complaint-form-grid">
              <Form.Item name="new_name" label="收报人姓名"><Input /></Form.Item>
              <Form.Item name="new_phone" label="联系电话"><Input /></Form.Item>
              <Form.Item name="effective_date" label="生效日期" rules={[{ required: true, message: '请选择生效日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </div>
            <Form.Item name="reason" label="变更原因" rules={[{ required: true, message: '请填写变更原因' }]}>
              <Input.TextArea rows={3} placeholder="例如：客户搬家，从下一期开始投递至新地址" />
            </Form.Item>
            <div className="complaint-form-source-note"><span aria-hidden>💡</span><span>订单详情继续展示当前有效地址；应用工单后才切换为新地址并保留本次记录</span></div>
          </section>
        </Form>
      )}
    </Modal>
  );
}

function OrderAddressChangeDetailModal({
  addressId,
  isAdmin,
  onClose,
  onApplied,
}: {
  addressId: number | null;
  isAdmin: boolean;
  onClose: () => void;
  onApplied: () => void;
}) {
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ['postalAddrDetail', addressId],
    queryFn: () => getAddressChange(addressId as number).then((response) => response.data),
    enabled: addressId != null,
  });
  const applyMutation = useMutation({
    mutationFn: () => applyAddressChange(addressId as number).then((response) => response.data),
    onSuccess: () => {
      message.success('收件信息变更已应用并同步至订单');
      queryClient.invalidateQueries({ queryKey: ['postalAddrDetail', addressId] });
      onApplied();
    },
    onError: (error) => message.error(postalErrorText(error, '应用收件信息变更失败')),
  });
  const change = detailQuery.data;
  const pending = change && !change.applied_to_order;
  return (
    <Modal
      title={(
        <div className="complaint-form-title">
          <span className="complaint-form-title-icon" aria-hidden>📬</span>
          <div className="complaint-form-title-copy">
            <strong>收件信息变更工单 #{addressId ?? '-'}</strong>
            <div className="complaint-form-meta">
              <span>{change?.old_name || change?.new_name || '收报人'}</span><i>·</i>
              <span>{change?.external_order_no || '投递编号待关联'}</span>
            </div>
          </div>
          <span className={`complaint-form-status ${pending ? 'status-open' : 'status-resolved'}`}>
            {pending ? '处理中' : '已完成'}
          </span>
        </div>
      )}
      open={addressId != null}
      onCancel={onClose}
      width={820}
      centered
      destroyOnHidden
      className="complaint-form-modal address-form-modal order-address-change-modal"
      rootClassName="complaint-form-modal-root"
      footer={(
        <div className="complaint-form-footer">
          <span className="complaint-form-save-tip"><b>✓</b>{pending ? '应用后同步更新邮局投递记录与订单履约目标' : '当前地址已同步，原地址仅在工单历史中保留'}</span>
          <Button onClick={onClose}>关闭</Button>
          {pending && isAdmin && (
            <Button type="primary" loading={applyMutation.isPending} onClick={() => applyMutation.mutate()}>确认完成并应用</Button>
          )}
        </div>
      )}
    >
      {detailQuery.isLoading && <div className="order-address-loading"><Spin /></div>}
      {change && (
        <div className="complaint-form address-change-form">
          <section className="complaint-form-section complaint-form-reader">
            <h3><span aria-hidden>🔗</span>关联与生效</h3>
            <div className="order-address-source-grid">
              <div><span>变更登记</span><strong>{change.change_date ? dayjs(change.change_date).format('YYYY-MM-DD HH:mm') : '-'}</strong></div>
              <div><span>生效日期</span><strong>{formatEffectiveDate(change)}</strong></div>
              <div><span>应用状态</span><strong>{change.applied_to_order ? `已于 ${change.applied_at ? dayjs(change.applied_at).format('YYYY-MM-DD HH:mm') : '当前'} 应用` : '等待处理确认'}</strong></div>
            </div>
          </section>
          <section className="complaint-form-section">
            <h3><span aria-hidden>↔️</span>变更前后对比</h3>
            <div className="address-form-compare">
              <div className="address-form-card before">
                <div className="address-form-card-head"><strong>变更前</strong>原投递信息快照</div>
                <div className="address-form-person-grid">
                  <div className="address-source-field"><span>姓名</span><strong>{change.old_name || '-'}</strong></div>
                  <div className="address-source-field"><span>电话</span><strong>{change.old_phone || '-'}</strong></div>
                  <div className="address-source-field"><span>份数</span><strong>{change.old_copies ?? '-'}</strong></div>
                </div>
                <div className="address-source-field address-form-address"><span>地址</span><strong>{change.old_address || '-'}</strong></div>
              </div>
              <div className="address-form-card after">
                <div className="address-form-card-head"><strong>变更后</strong>{pending ? '等待应用的新信息' : '当前有效投递信息'}</div>
                <div className="address-form-person-grid">
                  <div className="address-source-field"><span>姓名</span><strong className="changed">{change.new_name || change.old_name || '-'}</strong></div>
                  <div className="address-source-field"><span>电话</span><strong className="changed">{change.new_phone || change.old_phone || '-'}</strong></div>
                  <div className="address-source-field"><span>份数</span><strong className="changed">{change.new_copies ?? change.old_copies ?? '-'}</strong></div>
                </div>
                <div className="address-source-field address-form-address"><span>地址</span><strong className="changed">{change.new_address || change.old_address || '-'}</strong></div>
              </div>
            </div>
            {change.notes && <div className="complaint-form-source-note"><span aria-hidden>📝</span><span>变更原因：{change.notes}</span></div>}
          </section>
        </div>
      )}
    </Modal>
  );
}

function formatEffectiveDate(change: PostalAddressChange): string {
  if (!change.effective_start_month) return '-';
  const year = change.change_date ? dayjs(change.change_date).format('YYYY') : String(dayjs().year());
  const raw = change.effective_start_month.replace(/\D/g, '');
  return raw.length === 4 ? `${year}-${raw.slice(0, 2)}-${raw.slice(2, 4)}` : change.effective_start_month;
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

function PostalDeliveriesTab({ orderId }: { orderId: number }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['postalDeliveries', 'order', orderId],
    queryFn: () => listDeliveries({ order_id: orderId, page_size: 200 }).then((r) => r.data),
  });
  const columns: TableColumnsType<PostalDelivery> = [
    { title: '投递编号', key: 'number', width: 140, render: (_: unknown, row) => (
      <Button type="link" className="postal-inline-link" onClick={() => navigate(`/post-delivery/deliveries?delivery_id=${row.id}`)}>
        {row.year}-{row.delivery_no}
      </Button>
    ) },
    { title: '收报人', key: 'recipient', width: 160, render: (_: unknown, row) => (
      <Space direction="vertical" size={0}>
        <Text strong>{row.recipient_name}</Text>
        <Text type="secondary">{row.recipient_phone || '未记录电话'} · {row.copies}份</Text>
      </Space>
    ) },
    { title: '年度投递段', key: 'coverage', render: (_: unknown, row) => `${row.coverage_start_date || '—'} — ${row.coverage_end_date || '—'}` },
    { title: '分段金额', dataIndex: 'amount', width: 110, render: (amount: string | null) => amount == null ? '—' : `¥${amount}` },
    { title: '来源', key: 'source', width: 110, render: (_: unknown, row) => row.source_type === 'order_generated' ? <Tag color="blue">订单生成</Tag> : <Tag>名册补链</Tag> },
  ];
  if (!q.isLoading && !q.data?.rows.length) {
    return (
      <Card>
        <Empty description="尚无正式关联的邮局投递记录；历史名册可在“待续投”中补齐来源关联。">
          <Button type="primary" onClick={() => navigate('/post-delivery/renewals')}>前往待续投</Button>
        </Empty>
      </Card>
    );
  }
  return (
    <Card
      size="small"
      title={`邮局年度投递段（${q.data?.total ?? 0}）`}
      extra={<Button type="link" onClick={() => navigate('/post-delivery/deliveries')}>打开投递明细</Button>}
    >
      <Table<PostalDelivery> rowKey="id" size="small" loading={q.isLoading} pagination={false} columns={columns} dataSource={q.data?.rows ?? []} />
    </Card>
  );
}

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
              valueStyle={hasConflicts ? { color: 'var(--color-danger)' } : undefined}
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
                    background: 'var(--color-bg-subtle)',
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
