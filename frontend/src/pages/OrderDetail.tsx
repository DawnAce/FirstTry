import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ApartmentOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  MailOutlined,
  RollbackOutlined,
  StopOutlined,
  SyncOutlined,
  TruckOutlined,
  UserOutlined,
  WalletOutlined,
  WarningOutlined,
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
  listComplaintMakeups,
  listDeliveries,
  listTickets,
} from '../api/postal';
import type {
  AddressChangePayload,
  ComplaintMakeupTask,
  PostalAddressChange,
  PostalDelivery,
  Ticket,
} from '../api/postal';
import { useAuth } from '../contexts/AuthContext';
import { SuccessCheckIcon } from '../components/UiPrimitives';
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
  const { isAdmin, canMutate } = useAuth();
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

  const postalTicketsQuery = useQuery({
    queryKey: ['postalTickets', 'order', orderId],
    queryFn: () => listTickets({ order_id: orderId, page_size: 200 }).then((r) => r.data),
    enabled: Number.isFinite(orderId),
  });

  const makeupsQuery = useQuery({
    queryKey: ['postalMakeups', 'order', orderId],
    queryFn: () => listComplaintMakeups({ order_id: orderId }).then((r) => r.data),
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
  const allocationCount = order.items.reduce((sum, item) => sum + item.allocations.length, 0);
  const ledgerCount = order.payments.length + order.refunds.length;
  const progressPercent = progressSummary.expected > 0
    ? Math.min(100, Math.round((progressSummary.fulfilled / progressSummary.expected) * 100))
    : 0;
  const postalTickets = postalTicketsQuery.data?.rows ?? [];
  const addressTickets = postalTickets.filter((ticket) => ticket.type === 'address');
  const complaintTickets = postalTickets.filter((ticket) => ticket.type === 'complaint');
  const fulfillmentRecordCount = addressTickets.length + complaintTickets.length;
  const makeupTasks = makeupsQuery.data?.rows ?? [];
  const activeMakeups = makeupTasks.filter((task) => task.status === 'ready' || task.status === 'shipped');

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

  return (
    <div className="order-page order-detail-page">
      {justActivated && (
        <section className="order-detail-success">
          <div className="order-detail-success-icon"><SuccessCheckIcon /></div>
          <div>
            <h3>订单已创建并生效</h3>
            <p>{order.order_code ?? `订单 #${order.id}`} · 履约方案已同步生成</p>
          </div>
          {canMutate && <Button onClick={() => navigate('/orders/new')}>再建一单</Button>}
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
          {canMutate && canEditOrder(order.status) && (
            <Button
              icon={<EditOutlined />}
              onClick={() => navigate(`/orders/${order.id}/edit`)}
            >
              编辑
            </Button>
          )}
          {canMutate && order.status === 'active' && (
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

      {(complaintTickets.length > 0 || activeMakeups.length > 0) && (
        <section className="order-detail-exception-strip" aria-label="邮局异常处理">
          <div className="order-detail-exception-icon"><WarningOutlined /></div>
          <div>
            <strong>该订单存在邮局投递异常处理</strong>
            <span>投诉工单 {complaintTickets.length} 张{activeMakeups.length ? ` · 中通补发处理中 ${activeMakeups.length} 个` : ''}；补发不重复计入上方履约进度。</span>
          </div>
          <Button type="link" onClick={() => navigate('/post-delivery/tickets')}>前往邮局工单</Button>
        </section>
      )}

      <section className="order-detail-progress-strip" aria-label="订单履约进度">
        <div><strong>履约进度</strong><span>{progressSummary.deliveryLabel} · {progressSummary.fulfilled > 0 ? '履约中' : '尚未开始'}</span></div>
        <div className="order-detail-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
        <div className="order-detail-progress-values">
          <span><small>{progressSummary.postalOnly ? '已履约' : '已发'}</small><strong>{progressSummary.fulfilled} / {progressSummary.expected || '-'} 期</strong></span>
          {progressSummary.postalOnly ? (
            <span>
              <small>邮局投递</small>
              <strong>{postalDeliveriesQuery.isLoading ? '-' : postalDeliveriesQuery.data?.total ? `已关联 · ${postalDeliveriesQuery.data.total} 条` : '未关联'}</strong>
            </span>
          ) : (
            <span><small>已同步</small><strong>{progressSummary.synced} 期</strong></span>
          )}
        </div>
      </section>

      <div className="order-detail-main-grid">
        <section className="order-detail-primary">
          <Tabs
            className="order-detail-content-tabs"
            defaultActiveKey="items"
            tabBarGutter={10}
            items={[
              {
                key: 'items',
                label: <DetailTabLabel icon={<InboxOutlined />} label="订单内容" />,
                children: (
                  <ItemsTab
                    items={order.items}
                    deliveries={postalDeliveriesQuery.data?.rows ?? []}
                    addressTickets={addressTickets}
                    complaintTickets={complaintTickets}
                    makeupTasks={makeupTasks}
                    addressLoading={postalTicketsQuery.isLoading}
                  />
                ),
              },
              {
                key: 'allocations',
                label: <DetailTabLabel icon={<ApartmentOutlined />} label="履约方案" count={allocationCount} />,
                children: <AllocationsTab items={order.items} />,
              },
              {
                key: 'fulfillment-dossier',
                label: <DetailTabLabel icon={<FileTextOutlined />} label="履约档案" count={fulfillmentRecordCount} />,
                children: (
                  <FulfillmentDossierTab
                    items={order.items}
                    deliveries={postalDeliveriesQuery.data?.rows ?? []}
                    addressTickets={addressTickets}
                    complaintTickets={complaintTickets}
                    loading={postalDeliveriesQuery.isLoading || postalTicketsQuery.isLoading}
                    canMutate={canMutate}
                    onStartAddressChange={setAddressFormDelivery}
                    onOpenAddressChange={setAddressDetailId}
                  />
                ),
              },
              {
                key: 'payments',
                label: <DetailTabLabel icon={<WalletOutlined />} label="收款记录" count={ledgerCount} />,
                children: (
                  <PaymentLedgerTab
                    payments={order.payments}
                    refunds={order.refunds}
                    totalAmount={order.total_amount}
                    paidAmount={order.paid_amount}
                    outstandingAmount={order.outstanding_amount}
                    canRecordPayment={canMutate && order.status === 'active'}
                    onRecordPayment={openPaymentModal}
                  />
                ),
              },
              {
                key: 'shipping',
                label: <DetailTabLabel icon={<TruckOutlined />} label="关联快递" count={makeupTasks.length || undefined} />,
                children: <ShippingSyncTab orderId={order.id} items={order.items} makeups={makeupTasks} canMutate={canMutate} />,
              },
              {
                key: 'postal',
                label: <DetailTabLabel icon={<MailOutlined />} label="关联邮局" count={postalDeliveriesQuery.data?.total} />,
                children: <PostalDeliveriesTab orderId={order.id} tickets={postalTickets} makeups={makeupTasks} />,
              },
              {
                key: 'events',
                label: <DetailTabLabel icon={<HistoryOutlined />} label="事件流" count={eventsQuery.data?.length} />,
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
            extra={canMutate && order.status === 'active' ? <Button type="link" onClick={openPaymentModal}>记一笔收款</Button> : null}
          >
            <div className="order-detail-money-panel">
              <div><span>订单应收</span><strong>{formatCurrency(order.total_amount)}</strong></div>
              <div><span>累计已付</span><strong className="is-paid">{formatCurrency(order.paid_amount)}</strong></div>
              <div><span>待收金额</span><strong className={Number(order.outstanding_amount) > 0 ? 'is-due' : 'is-paid'}>{Number(order.outstanding_amount) > 0 ? formatCurrency(order.outstanding_amount) : '已付清'}</strong></div>
            </div>
            <div className={`order-detail-invoice-state is-${order.invoice_state}`}>
              <span>发票状态</span>
              <div>
                <strong>
                  {order.invoice_state === 'not_required' && '无需发票'}
                  {order.invoice_state === 'issued' && '已开具'}
                  {order.invoice_state === 'needs_red_reversal' && '需冲红'}
                  {order.invoice_state === 'pending' && (
                    Number(order.normal_invoiced_amount) > 0 ? '部分开票' : '需要发票 · 待开具'
                  )}
                </strong>
                {order.invoice_state === 'issued' && (
                  <small>累计已开 {formatCurrency(order.normal_invoiced_amount)}</small>
                )}
                {order.invoice_state === 'pending' && (
                  <small>
                    {Number(order.normal_invoiced_amount) > 0
                      ? `已开 ${formatCurrency(order.normal_invoiced_amount)} · 待开 ${formatCurrency(order.remaining_invoice_amount)}`
                      : `待开 ${formatCurrency(order.remaining_invoice_amount)}`}
                  </small>
                )}
                {order.invoice_state === 'needs_red_reversal' && (
                  <small>已开 {formatCurrency(order.normal_invoiced_amount)} · 已退款 {formatCurrency(order.refunded_amount)}</small>
                )}
              </div>
            </div>
          </Card>

          <Card
            className="order-detail-side-card"
            title={<span><FileTextOutlined />订单信息</span>}
            extra={canMutate && canEditOrder(order.status) ? <Button type="link" onClick={() => navigate(`/orders/${order.id}/edit`)}>编辑</Button> : null}
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
          queryClient.invalidateQueries({ queryKey: ['postalTickets', 'order', order.id] });
          queryClient.invalidateQueries({ queryKey: orderQueryKeys.events(order.id) });
        }}
      />

      <OrderAddressChangeDetailModal
        addressId={addressDetailId}
        isAdmin={isAdmin}
        onClose={() => setAddressDetailId(null)}
        onApplied={() => {
          queryClient.invalidateQueries({ queryKey: orderQueryKeys.detail(order.id) });
          queryClient.invalidateQueries({ queryKey: ['postalDeliveries', 'order', order.id] });
          queryClient.invalidateQueries({ queryKey: ['postalTickets', 'order', order.id] });
          queryClient.invalidateQueries({ queryKey: orderQueryKeys.events(order.id) });
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

function DetailTabLabel({
  icon,
  label,
  count,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <span className="order-detail-tab-label">
      {icon}
      <span>{label}</span>
      {count != null && count > 0 && <em>{count}</em>}
    </span>
  );
}

function TabSectionHeader({
  kicker,
  title,
  description,
  action,
  status,
}: {
  kicker: string;
  title: string;
  description: string;
  action?: ReactNode;
  status?: ReactNode;
}) {
  return (
    <header className="order-detail-tab-heading">
      <div><span>{kicker}</span><h2>{title}</h2><p>{description}</p></div>
      {(action || status) && <aside>{status}{action}</aside>}
    </header>
  );
}

function TabEmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="order-detail-tab-empty">
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

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
  const fulfilled = items.reduce((sum, item) => sum + item.progress.shipped_count, 0);
  const postalOnly = items.length > 0 && items.every((item) => item.delivery_method === 'post_office');
  const deliveryLabels = [...new Set(items.map((item) => deliveryMethodLabel(item.delivery_method)).filter((label) => label !== '-'))];
  return {
    expected,
    synced,
    fulfilled,
    postalOnly,
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
  complaintTickets: Ticket[];
  makeupTasks: ComplaintMakeupTask[];
  addressLoading: boolean;
}

function ItemsTab({
  items,
  deliveries,
  addressTickets,
  complaintTickets,
  makeupTasks,
  addressLoading,
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
          complaintTickets={complaintTickets}
          makeupTasks={makeupTasks}
          addressLoading={addressLoading}
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
  complaintTickets,
  makeupTasks,
  addressLoading,
}: {
  item: OrderItemOut;
  index: number;
  deliveries: PostalDelivery[];
  addressTickets: Ticket[];
  complaintTickets: Ticket[];
  makeupTasks: ComplaintMakeupTask[];
  addressLoading: boolean;
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
        complaintTickets={complaintTickets}
        makeupTasks={makeupTasks}
        loading={addressLoading}
      />
    </Card>
  );
}

function TargetsList({
  targets,
  itemId,
  deliveries,
  addressTickets,
  complaintTickets,
  makeupTasks,
  loading,
}: {
  targets: FulfillmentTargetOut[];
  itemId: number;
  deliveries: PostalDelivery[];
  addressTickets: Ticket[];
  complaintTickets: Ticket[];
  makeupTasks: ComplaintMakeupTask[];
  loading: boolean;
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
        const complaints = delivery
          ? complaintTickets.filter((ticket) => ticket.postal_delivery_id === delivery.id)
          : [];
        const targetMakeups = delivery
          ? makeupTasks.filter((task) => task.postal_delivery_id === delivery.id)
          : [];
        const activeTargetMakeups = targetMakeups.filter((task) => task.status === 'ready' || task.status === 'shipped');
        const effectiveName = delivery?.recipient_name || target.recipient_name;
        const effectivePhone = delivery?.recipient_phone || target.recipient_phone;
        const effectiveAddress = delivery?.recipient_address || target.recipient_address;
        return (
          <article className="order-detail-target" key={target.id}>
            <div className="order-detail-target-main">
              <div className="order-detail-target-person">
                <span>收报人</span>
                <strong>{effectiveName}</strong>
                <small>{effectivePhone ?? '未记录电话'}</small>
              </div>
              <div className={`order-detail-target-current ${delivery ? 'is-linked' : 'is-unlinked'}`}>
                <div className="order-detail-target-current-head">
                  <span>{delivery ? '当前有效投递信息' : '订单收件信息'}</span>
                  <Tag color={delivery ? 'green' : 'default'}>{delivery ? '已生效' : '待关联投递'}</Tag>
                </div>
                <strong>{effectiveAddress}</strong>
                <small>
                  {delivery
                    ? `邮局投递 ${delivery.year}-${delivery.delivery_no} · ${delivery.copies} 份`
                    : '尚未生成或关联邮局投递记录，暂按订单履约目标展示'}
                </small>
              </div>
              <div className="order-detail-target-records">
                <span>履约记录</span>
                {loading ? (
                  <strong>正在加载</strong>
                ) : pending ? (
                  <strong className="is-pending">地址变更处理中</strong>
                ) : applied.length + complaints.length > 0 ? (
                  <strong>地址变更 {applied.length} · 投诉 {complaints.length}</strong>
                ) : (
                  <strong>暂无变更或投诉</strong>
                )}
                {activeTargetMakeups.length > 0 && <small>中通补发 {activeTargetMakeups.length} 条</small>}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function FulfillmentDossierTab({
  items,
  deliveries,
  addressTickets,
  complaintTickets,
  loading,
  canMutate,
  onStartAddressChange,
  onOpenAddressChange,
}: {
  items: OrderItemOut[];
  deliveries: PostalDelivery[];
  addressTickets: Ticket[];
  complaintTickets: Ticket[];
  loading: boolean;
  canMutate: boolean;
  onStartAddressChange: (delivery: PostalDelivery) => void;
  onOpenAddressChange: (id: number) => void;
}) {
  const addressDetailQueries = useQueries({
    queries: addressTickets.map((ticket) => ({
      queryKey: ['postalAddrDetail', ticket.id],
      queryFn: () => getAddressChange(ticket.id).then((response) => response.data),
    })),
  });
  const addressDetails = addressDetailQueries
    .map((query) => query.data)
    .filter((detail): detail is PostalAddressChange => detail != null);
  const addressDetailById = new Map(addressDetails.map((detail) => [detail.id, detail]));

  const targetRows = items.flatMap((item, itemIndex) => {
    const allocation = item.allocations
      .filter((candidate) => candidate.effective_until_issue == null)
      .sort((a, b) => b.version_no - a.version_no)[0]
      ?? [...item.allocations].sort((a, b) => b.version_no - a.version_no)[0];
    return (allocation?.targets ?? []).map((target) => {
      const delivery = deliveries.find((row) => row.fulfillment_target_id === target.id)
        ?? deliveries.find((row) => row.order_item_id === item.id && row.recipient_name === target.recipient_name);
      const targetAddressTickets = delivery
        ? addressTickets.filter((ticket) => ticket.postal_delivery_id === delivery.id)
        : [];
      const pendingTicket = targetAddressTickets.find(
        (ticket) => ticket.status === 'pending' || ticket.status === 'unmatched',
      );
      const appliedDetails = addressDetails
        .filter((detail) => detail.postal_delivery_id === delivery?.id && detail.applied_to_order)
        .sort((a, b) => (b.applied_at ?? b.change_date ?? '').localeCompare(a.applied_at ?? a.change_date ?? ''));
      const latestApplied = appliedDetails[0];
      return {
        item,
        itemIndex,
        target,
        delivery,
        pendingTicket,
        latestUpdatedAt: latestApplied?.applied_at ?? latestApplied?.change_date,
      };
    });
  });

  return (
    <section className="order-detail-tab-section order-detail-dossier">
      <TabSectionHeader
        kicker="FULFILLMENT DOSSIER"
        title="履约档案"
        description="集中查看当前有效投递信息、地址变更与投诉处理记录。"
        status={<i className="order-detail-soft-status is-neutral">服务记录 {addressTickets.length + complaintTickets.length} 条</i>}
      />

      {loading ? (
        <div className="order-detail-tab-loading"><Spin /></div>
      ) : targetRows.length === 0 ? (
        <TabEmptyState icon={<UserOutlined />} title="暂无履约目标" description="订单生成履约目标后，会在这里建立独立档案。" />
      ) : (
        <div className="order-detail-dossier-current-list">
          {targetRows.map(({ item, itemIndex, target, delivery, pendingTicket, latestUpdatedAt }) => (
            <article className="order-detail-dossier-current" key={target.id}>
              <div className="order-detail-dossier-current-head">
                <div>
                  <strong>当前有效投递信息</strong>
                  <span>明细 {itemIndex + 1} · {publicationLabel(item.publication)}</span>
                </div>
                <Tag color={delivery ? 'green' : 'default'}>{delivery ? '已生效' : '待关联投递'}</Tag>
              </div>
              <div className="order-detail-dossier-current-grid">
                <div>
                  <span>收报人</span>
                  <strong>{delivery?.recipient_name || target.recipient_name}</strong>
                  <small>{delivery?.recipient_phone || target.recipient_phone || '未记录电话'}</small>
                </div>
                <div>
                  <span>投递地址</span>
                  <strong>{delivery?.recipient_address || target.recipient_address || '未记录投递地址'}</strong>
                  {latestUpdatedAt && <small>最近更新：{dayjs(latestUpdatedAt).format('YYYY-MM-DD')}</small>}
                </div>
                <div>
                  <span>{delivery ? '邮局投递' : '投递方式'}</span>
                  <strong>{delivery ? `${delivery.year}-${delivery.delivery_no}` : deliveryMethodLabel(item.delivery_method)}</strong>
                  <small>每期 {delivery?.copies ?? target.quantity} 份</small>
                </div>
              </div>
              <div className="order-detail-dossier-current-action">
                {pendingTicket ? (
                  <Tag color="orange">地址变更处理中</Tag>
                ) : delivery && canMutate ? (
                  <Button type="primary" icon={<EnvironmentOutlined />} onClick={() => onStartAddressChange(delivery)}>
                    修改收件信息
                  </Button>
                ) : !delivery ? (
                  <Button disabled>需先关联邮局投递</Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="order-detail-dossier-workspace">
        <section className="order-detail-dossier-panel">
          <div className="order-detail-dossier-panel-head">
            <h3>地址变更</h3>
            <span>{addressTickets.length} 条</span>
          </div>
          {addressTickets.length === 0 ? (
            <div className="order-detail-dossier-empty">暂无地址变更记录</div>
          ) : (
            <div className="order-detail-dossier-address-list">
              {addressTickets.map((ticket) => {
                const detail = addressDetailById.get(ticket.id);
                const pending = ticket.status === 'pending' || ticket.status === 'unmatched';
                return (
                  <article className="order-detail-dossier-address" key={ticket.id}>
                    <div className="order-detail-dossier-record-head">
                      <div>
                        <strong>{pending ? '投递信息变更处理中' : '投递信息变更已生效'}</strong>
                        <span>{ticket.ticket_date || detail?.change_date?.slice(0, 10) || '未记录日期'}</span>
                      </div>
                      <Button type="link" onClick={() => onOpenAddressChange(ticket.id)}>查看处理详情</Button>
                    </div>
                    {detail ? (
                      <div className="order-detail-dossier-diff">
                        <div><span>变更前</span><strong>{detail.old_address || '未记录原地址'}</strong></div>
                        <div className="is-after"><span>变更后</span><strong>{detail.new_address || detail.old_address || '未记录新地址'}</strong></div>
                      </div>
                    ) : (
                      <p>{ticket.summary || '变更详情加载中'}</p>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="order-detail-dossier-panel">
          <div className="order-detail-dossier-panel-head">
            <h3>投诉记录</h3>
            <span>{complaintTickets.length} 条</span>
          </div>
          {complaintTickets.length === 0 ? (
            <div className="order-detail-dossier-empty">暂无投诉记录</div>
          ) : (
            <div className="order-detail-dossier-complaints">
              {complaintTickets.map((ticket) => (
                <article key={ticket.id}>
                  <div className="order-detail-dossier-record-head">
                    <div><strong>投诉 #{ticket.id}</strong><span>{ticket.ticket_date || '未记录日期'}</span></div>
                    <Tag color={complaintTicketStatusColor(ticket.status)}>{complaintTicketStatusLabel(ticket.status)}</Tag>
                  </div>
                  <p>{ticket.summary || '未记录投诉摘要'}</p>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function complaintTicketStatusLabel(status: string | null): string {
  return { resolved: '已处理', in_progress: '处理中', open: '待处理' }[status ?? ''] ?? '待确认';
}

function complaintTicketStatusColor(status: string | null): string {
  return { resolved: 'green', in_progress: 'blue', open: 'orange' }[status ?? ''] ?? 'default';
}

function PaymentLedgerTab({
  payments,
  refunds,
  totalAmount,
  paidAmount,
  outstandingAmount,
  canRecordPayment,
  onRecordPayment,
}: {
  payments: PaymentOut[];
  refunds: RefundOut[];
  totalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  canRecordPayment: boolean;
  onRecordPayment: () => void;
}) {
  return (
    <section className="order-detail-tab-section">
      <TabSectionHeader
        kicker="PAYMENT LEDGER"
        title="收款记录"
        description="订单应收、实收与退款流水集中核对。"
        action={canRecordPayment ? (
          <Button type="primary" icon={<DollarOutlined />} onClick={onRecordPayment}>记一笔收款</Button>
        ) : null}
      />

      <div className="order-detail-ledger-summary">
        <div><span>订单应收</span><strong>{formatCurrency(totalAmount)}</strong></div>
        <div><span>累计已收</span><strong className="is-positive">{formatCurrency(paidAmount)}</strong></div>
        <div><span>待收金额</span><strong className={Number(outstandingAmount) > 0 ? 'is-negative' : 'is-positive'}>{formatCurrency(outstandingAmount)}</strong></div>
        <div><span>账款状态</span><strong><i className={`order-detail-soft-status ${Number(outstandingAmount) > 0 ? 'is-warning' : 'is-success'}`}>{Number(outstandingAmount) > 0 ? '待收款' : '已付清'}</i></strong></div>
      </div>

      <div className="order-detail-ticket-list">
        {payments.map((payment) => (
          <article className="order-detail-work-ticket is-blue" key={`payment-${payment.id}`}>
            <div className="order-detail-ledger-entry">
              <span className="order-detail-entry-icon is-success"><CheckOutlined /></span>
              <div>
                <small>收款流水 #{payment.id}</small>
                <strong>{payment.method || '未记录方式'} · {formatCurrency(payment.amount)}</strong>
                <p>{payment.collected_at} · {payment.operator_id != null ? `操作人 #${payment.operator_id}` : '未记录操作人'}{payment.notes ? ` · ${payment.notes}` : ''}</p>
              </div>
              <i className="order-detail-soft-status is-success">已到账</i>
            </div>
          </article>
        ))}
      </div>

      {payments.length === 0 && <TabEmptyState icon={<WalletOutlined />} title="暂无收款记录" description="记录收款后会在这里形成完整流水。" />}

      <div className="order-detail-subsection-title">
        <span><RollbackOutlined />退款记录</span><small>{refunds.length} 条</small>
      </div>
      {refunds.length > 0 ? (
        <div className="order-detail-ticket-list">
          {refunds.map((refund) => (
            <article className="order-detail-work-ticket is-red" key={`refund-${refund.id}`}>
              <div className="order-detail-ledger-entry">
                <span className="order-detail-entry-icon is-refund"><RollbackOutlined /></span>
                <div>
                  <small>退款流水 #{refund.id}</small>
                  <strong>{formatCurrency(refund.amount)} · {refundScopeLabel(refund)}</strong>
                  <p>{refund.refunded_at}{refund.reason ? ` · ${refund.reason}` : ''}</p>
                </div>
                <i className="order-detail-soft-status is-danger">已退款</i>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="order-detail-inline-empty"><RollbackOutlined /><span><strong>暂无退款记录</strong><small>发生退款后会在这里保留完整流水。</small></span></div>
      )}
    </section>
  );
}

function refundScopeLabel(refund: RefundOut): string {
  if (refund.order_item_id == null && refund.stop_from_issue == null) return '整单退款';
  const parts: string[] = [];
  if (refund.order_item_id != null) parts.push(`明细 #${refund.order_item_id}`);
  if (refund.stop_from_issue != null) parts.push(`第 ${refund.stop_from_issue} 期起停发`);
  return parts.join(' · ');
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

function AllocationsTab({ items }: { items: OrderItemOut[] }) {
  const allocationCount = items.reduce((sum, item) => sum + item.allocations.length, 0);
  if (allocationCount === 0) {
    return <TabEmptyState icon={<ApartmentOutlined />} title="尚无履约方案" description="确认订单后会在这里生成首个履约版本。" />;
  }

  return (
    <section className="order-detail-tab-section">
      <TabSectionHeader
        kicker="FULFILLMENT PLAN"
        title="履约方案"
        description="按版本记录履约目标变化，当前生效版本优先展示。"
        action={<Button icon={<ClockCircleOutlined />}>查看版本说明</Button>}
      />
      <div className="order-detail-tab-notice"><InfoCircleOutlined /><span>修改收件目标时自动生成新版本，历史版本永久保留，不覆盖原记录。</span></div>

      <div className="order-detail-ticket-list">
        {items.flatMap((item, itemIndex) => {
          const allocations = [...item.allocations].sort((a, b) => b.version_no - a.version_no);
          return allocations.map((allocation, allocationIndex) => {
            const current = allocationIndex === 0;
            return (
              <article className={`order-detail-work-ticket ${current ? 'is-green' : 'is-muted'}`} key={`${item.id}-${allocation.id}`}>
                <div className="order-detail-ticket-head">
                  <div>
                    <strong>{current ? '当前履约方案' : `历史履约方案 V${allocation.version_no}`}</strong>
                    <span>明细 {itemIndex + 1} · {publicationLabel(item.publication)}{item.subscription_term ? ` · ${subscriptionTermLabel(item.subscription_term)}` : ''}</span>
                  </div>
                  <div><i className={`order-detail-soft-status ${current ? 'is-success' : 'is-neutral'}`}>{current ? '当前生效' : '历史版本'}</i><b className="order-detail-version-badge">V{allocation.version_no}</b></div>
                </div>

                <div className="order-detail-plan-facts">
                  <div><span>生效范围</span><strong>{allocationEffectiveRange(allocation)}</strong></div>
                  <div><span>履约目标</span><strong>{allocation.targets.length} 位收报人</strong></div>
                  <div><span>变更原因</span><strong>{allocationReasonLabel(allocation.change_reason)}</strong></div>
                  <div><span>创建时间</span><strong>{formatOrderTimestamp(allocation.created_at)}</strong></div>
                </div>

                <div className="order-detail-subsection-title">
                  <span><UserOutlined />履约目标</span><small>共 {allocation.targets.length} 位</small>
                </div>
                <div className="order-detail-plan-targets">
                  {allocation.targets.map((target) => (
                    <div className="order-detail-plan-target" key={target.id}>
                      <span className="order-detail-target-avatar">{target.recipient_name.slice(0, 1)}</span>
                      <div className="order-detail-plan-target-main">
                        <small>收报人 / 联系电话</small>
                        <strong>{target.recipient_name} · {target.recipient_phone || '未记录电话'}</strong>
                        <p>{target.recipient_address || '未记录投递地址'}</p>
                      </div>
                      <div className="order-detail-delivery-config">
                        <span>{item.delivery_method === 'post_office' ? <MailOutlined /> : <TruckOutlined />}</span>
                        <div><small>投递方式</small><strong>{deliveryMethodLabel(item.delivery_method)}</strong></div>
                        <i />
                        <div><small>目标份数</small><strong>{target.quantity} 份</strong></div>
                      </div>
                      {target.status !== 'active' && <i className="order-detail-soft-status is-warning">{targetStatusLabel(target.status)}</i>}
                    </div>
                  ))}
                </div>

                <div className="order-detail-version-foot">
                  <span></span><div><strong>V{allocation.version_no} {allocationReasonLabel(allocation.change_reason)}</strong><small>{formatOrderTimestamp(allocation.created_at)}</small></div><i className="order-detail-soft-status is-neutral">{current ? '当前版本' : '历史记录'}</i>
                </div>
              </article>
            );
          });
        })}
      </div>
    </section>
  );
}

function allocationEffectiveRange(allocation: FulfillmentAllocationOut): string {
  if (allocation.effective_from_issue == null && allocation.effective_until_issue == null) return '全订阅周期';
  const start = allocation.effective_from_issue == null ? '首期' : `第 ${allocation.effective_from_issue} 期`;
  const end = allocation.effective_until_issue == null ? '订阅结束' : `第 ${allocation.effective_until_issue} 期`;
  return `${start} ~ ${end}`;
}

function allocationReasonLabel(reason: string | null): string {
  if (!reason || reason === 'initial') return '初始方案';
  return reason;
}

function formatOrderTimestamp(value: string): string {
  return value.replace('T', ' ').slice(0, 16);
}

// =============================================================================
// Tab 3: Shipping sync
// =============================================================================

function PostalDeliveriesTab({ orderId, tickets, makeups }: { orderId: number; tickets: Ticket[]; makeups: ComplaintMakeupTask[] }) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: ['postalDeliveries', 'order', orderId],
    queryFn: () => listDeliveries({ order_id: orderId, page_size: 200 }).then((r) => r.data),
  });
  if (!q.isLoading && !q.data?.rows.length) {
    return (
      <section className="order-detail-tab-section">
        <TabSectionHeader kicker="POSTAL LINK" title="关联邮局" description="当前订单关联的邮局投递记录与有效覆盖期。" />
        <TabEmptyState
          icon={<MailOutlined />}
          title="尚无正式关联的邮局投递记录"
          description="历史名册可在待续投中补齐来源关联。"
          action={<Button type="primary" onClick={() => navigate('/post-delivery/renewals')}>前往待续投</Button>}
        />
      </section>
    );
  }
  return (
    <section className="order-detail-tab-section">
      <TabSectionHeader
        kicker="POSTAL LINK"
        title="关联邮局"
        description="当前订单关联的邮局投递记录与有效覆盖期。"
        action={<Button icon={<LinkOutlined />} onClick={() => navigate('/post-delivery/deliveries')}>打开投递明细</Button>}
        status={<i className="order-detail-soft-status is-success">已关联 {q.data?.total ?? 0} 条</i>}
      />
      {q.isLoading ? <div className="order-detail-tab-loading"><Spin /></div> : (
        <div className="order-detail-ticket-list">
          {(q.data?.rows ?? []).map((row) => (
            <article className="order-detail-work-ticket is-blue" key={row.id}>
              <div className="order-detail-ticket-head">
                <div><strong>邮局投递 #{row.delivery_no}</strong><span>{row.year} 年度投递段 · {row.source_type === 'order_generated' ? '订单自动生成' : '历史名册补链'}</span></div>
                <i className="order-detail-soft-status is-success">关联正常</i>
              </div>
              <div className="order-detail-plan-facts">
                <div><span>收报人</span><strong>{row.recipient_name}</strong></div>
                <div><span>覆盖期</span><strong>{row.coverage_start_date || '—'} ~ {row.coverage_end_date || '—'}</strong></div>
                <div><span>产品 / 份数</span><strong>{row.product || '未记录产品'} · {row.copies} 份</strong></div>
                <div><span>来源渠道</span><strong>{row.source_channel || '未记录来源'}</strong></div>
              </div>
              <div className="order-detail-postal-address">
                <EnvironmentOutlined />
                <div><small>当前有效投递地址</small><strong>{row.recipient_address}</strong><span>{row.recipient_phone || '未记录电话'}{row.amount != null ? ` · 分段金额 ¥${row.amount}` : ''}</span></div>
                <Button type="link" onClick={() => navigate(`/post-delivery/deliveries?delivery_id=${row.id}`)}>查看投递详情</Button>
              </div>
              {(tickets.some((ticket) => ticket.postal_delivery_id === row.id) || makeups.some((task) => task.postal_delivery_id === row.id)) && (
                <div className="order-detail-postal-exceptions">
                  <span>异常处理同步</span>
                  {tickets.filter((ticket) => ticket.postal_delivery_id === row.id && ticket.type === 'complaint').map((ticket) => <Tag color="volcano" key={`ticket-${ticket.id}`}>投诉 #{ticket.id} · {ticket.status === 'resolved' ? '已解决' : '处理中'}</Tag>)}
                  {makeups.filter((task) => task.postal_delivery_id === row.id).map((task) => <Tag color={task.status === 'completed' ? 'green' : task.status === 'cancelled' ? 'default' : 'blue'} key={`makeup-${task.id}`}>中通补发 #{task.id} · {makeupStatusLabel(task.status)}</Tag>)}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function makeupStatusLabel(status: ComplaintMakeupTask['status']): string {
  return { ready: '待发出', shipped: '已发出', completed: '已完成', cancelled: '已取消' }[status];
}

function OrderMakeupCards({ makeups }: { makeups: ComplaintMakeupTask[] }) {
  return (
    <div className="order-detail-ticket-list order-detail-makeup-list">
      {makeups.map((task) => (
        <article className={`order-detail-work-ticket order-detail-makeup-ticket is-${task.status}`} key={task.id}>
          <div className="order-detail-ticket-head">
            <div><strong>投诉补发 #{task.id}</strong><span>来源邮局工单 #{task.complaint_id}{task.postal_delivery_id ? ` · 邮局投递 #${task.postal_delivery_id}` : ''}</span></div>
            <i className={`order-detail-soft-status ${task.status === 'completed' ? 'is-success' : task.status === 'cancelled' ? 'is-neutral' : 'is-warning'}`}>{makeupStatusLabel(task.status)}</i>
          </div>
          <div className="order-detail-plan-facts">
            <div><span>补发期次</span><strong>{task.items.map((item) => `第 ${item.issue_number} 期`).join('、')}</strong></div>
            <div><span>补发份数</span><strong>{task.items.reduce((sum, item) => sum + item.quantity, 0)} 份</strong></div>
            <div><span>中通运单</span><strong>{task.tracking_no || '待登记'}</strong></div>
            <div><span>发出时间</span><strong>{task.shipped_at?.replace('T', ' ').slice(0, 16) || '待发出'}</strong></div>
          </div>
          <div className="order-detail-postal-address">
            <TruckOutlined />
            <div><small>投诉补发收件信息</small><strong>{task.recipient_name} · {task.recipient_phone || '未记录电话'}</strong><span>{task.recipient_address}</span></div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ShippingSyncTab({ orderId, items, makeups, canMutate }: { orderId: number; items: OrderItemOut[]; makeups: ComplaintMakeupTask[]; canMutate: boolean }) {
  const queryClient = useQueryClient();
  const postalOnly = items.length > 0 && items.every((item) => item.delivery_method === 'post_office');
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

  if (postalOnly) {
    return (
      <section className="order-detail-tab-section">
        <TabSectionHeader kicker="EXPRESS LINK" title="关联快递" description="原订单采用邮局投递；这里只展示投诉产生的中通补发，不改变原履约方式。" status={<i className={`order-detail-soft-status ${makeups.length ? 'is-warning' : 'is-neutral'}`}>{makeups.length ? `补发 ${makeups.length} 个` : '无补发'}</i>} />
        {makeups.length ? <OrderMakeupCards makeups={makeups} /> : <TabEmptyState icon={<TruckOutlined />} title="本订单采用邮局投递" description="当前没有投诉补发快递；正常履约不会生成中通明细。" />}
      </section>
    );
  }

  return (
    <section className="order-detail-tab-section">
      <TabSectionHeader kicker="EXPRESS LINK" title="关联快递" description="选择刊期预览并同步订单履约目标到中通发货明细。" />
      {makeups.length > 0 && <><Alert type="warning" showIcon title="下方投诉补发独立于订单正常快递履约，不参与应发与已发进度统计。" /><OrderMakeupCards makeups={makeups} /></>}
      <div className="order-detail-sync-stack">
      {canMutate && <Card size="small" className="order-detail-sync-controls">
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
      </Card>}

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
        <div className="order-detail-sync-summary">
          <div><span>候选</span><strong>{summary.candidates}</strong></div>
          <div><span>待新建</span><strong>{summary.to_create}</strong></div>
          <div><span>待更新</span><strong>{summary.to_update}</strong></div>
          <div><span>已跳过</span><strong>{summary.skipped}</strong></div>
          <div className={hasConflicts ? 'is-conflict' : ''}><span>冲突</span><strong>{summary.conflicts}</strong></div>
        </div>
      )}

      <Table<OrderShippingSyncItem>
        className="order-detail-sync-table"
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
      </div>
    </section>
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
  const sorted = [...events].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return (
    <section className="order-detail-tab-section">
      <TabSectionHeader
        kicker="ORDER EVENTS"
        title="事件流"
        description="按时间追溯订单、收款、履约与信息变更。"
        status={events.length > 0 ? <i className="order-detail-soft-status is-blue">{events.length} 条记录</i> : null}
      />
      {error && <Alert type="error" showIcon title="加载事件失败" description={error} />}
      {loading && <div className="order-detail-tab-loading"><Spin /></div>}
      {!loading && !error && events.length === 0 && <TabEmptyState icon={<HistoryOutlined />} title="暂无事件记录" description="订单发生操作后会在这里形成可追溯记录。" />}
      {!loading && !error && sorted.length > 0 && (
        <div className="order-detail-event-stream">
          {sorted.map((event, index) => <EventCard key={event.stream_id ?? `order:${event.id}`} event={event} latest={index === 0} />)}
        </div>
      )}
    </section>
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
    case 'postal_address_change_created':
      return 'orange';
    case 'postal_complaint_created':
    case 'postal_complaint_handled':
      return 'red';
    case 'voided':
    case 'cancelled':
    case 'refunded':
    case 'shipping_sync_conflict':
      return 'red';
    case 'synced_to_shipping':
    case 'payment_recorded':
    case 'postal_address_change_applied':
    case 'postal_complaint_followed_up':
    case 'postal_follow_up_created':
    case 'postal_makeup_created':
    case 'postal_makeup_shipped':
    case 'postal_makeup_completed':
    case 'postal_makeup_cancelled':
      return 'green';
    default:
      return 'gray';
  }
}

function EventCard({ event, latest }: { event: OrderEventOut; latest: boolean }) {
  const summary = summarizeEventPayload(event.payload_json);
  return (
    <article className={`order-detail-event-entry ${latest ? 'is-latest' : ''}`}>
      <span className={`order-detail-event-icon is-${eventTimelineColor(event.event_type)}`}>{eventGlyph(event.event_type)}</span>
      <div className="order-detail-event-card">
        <div className="order-detail-event-head"><strong>{eventTypeLabel(event.event_type)}</strong><time>{formatOrderTimestamp(event.created_at)}</time></div>
        {summary && <p>{summary}</p>}
        <small>{event.operator_id != null ? `操作者 #${event.operator_id}` : '系统自动处理'}</small>
      </div>
    </article>
  );
}

function eventGlyph(eventType: OrderEventOut['event_type']): ReactNode {
  switch (eventType) {
    case 'confirmed':
      return <CheckCircleOutlined />;
    case 'synced_to_shipping':
      return <SyncOutlined />;
    case 'payment_recorded':
      return <DollarOutlined />;
    case 'refunded':
      return <RollbackOutlined />;
    case 'cancelled':
      return <CloseCircleOutlined />;
    case 'modified':
    case 'allocation_updated':
    case 'target_added':
    case 'target_replaced':
    case 'target_suspended':
    case 'postal_address_change_created':
    case 'postal_address_change_applied':
      return <EditOutlined />;
    case 'postal_complaint_created':
    case 'postal_complaint_handled':
      return <WarningOutlined />;
    case 'postal_complaint_followed_up':
    case 'postal_follow_up_created':
      return <HistoryOutlined />;
    case 'created':
    case 'imported':
      return <FileTextOutlined />;
    default:
      return <ClockCircleOutlined />;
  }
}

function summarizeEventPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const details: string[] = [];
  if (typeof payload.order_code === 'string') details.push(`订单编码：${payload.order_code}`);
  if (typeof payload.entry_method === 'string') details.push(`录入方式：${eventEntryMethodLabel(payload.entry_method)}`);
  if (typeof payload.items_count === 'number') details.push(`订单明细：${payload.items_count} 条`);
  if (typeof payload.delivery_no === 'string') details.push(`投递编号：${payload.delivery_no}`);
  if (typeof payload.ticket_id === 'number') details.push(`工单 #${payload.ticket_id}`);
  if (typeof payload.recipient_name === 'string' && payload.recipient_name) details.push(`收报人：${payload.recipient_name}`);
  if (typeof payload.summary === 'string' && payload.summary) details.push(payload.summary);
  if (typeof payload.action === 'string' && payload.action) details.push(`处理：${payload.action}`);
  if (typeof payload.follow_result === 'string' && payload.follow_result) details.push(`结果：${payload.follow_result}`);
  if (typeof payload.business_date === 'string' && payload.business_date) details.push(`业务日期：${payload.business_date.slice(0, 10)}`);
  if (typeof payload.new_address === 'string' && payload.new_address) {
    const oldAddress = typeof payload.old_address === 'string' && payload.old_address ? `${payload.old_address} → ` : '';
    details.push(`地址：${oldAddress}${payload.new_address}`);
  }
  if (typeof payload.issue_number === 'number') details.push(`期号：第 ${payload.issue_number} 期`);
  if (typeof payload.created_count === 'number') details.push(`新增快递明细：${payload.created_count} 条`);
  if (typeof payload.updated_count === 'number') details.push(`更新快递明细：${payload.updated_count} 条`);
  if (typeof payload.conflict_count === 'number') details.push(`冲突：${payload.conflict_count} 条`);
  if (typeof payload.amount === 'string' || typeof payload.amount === 'number') details.push(`金额：${formatCurrency(payload.amount)}`);
  if (typeof payload.method === 'string' && payload.method) details.push(`方式：${payload.method}`);
  if (typeof payload.reason === 'string' && payload.reason) details.push(`原因：${payload.reason}`);
  if (payload.diff && typeof payload.diff === 'object') {
    const keys = Object.keys(payload.diff as Record<string, unknown>);
    if (keys.length > 0) details.push(`变更内容：${keys.map(orderEventFieldLabel).join('、')}`);
  }
  if (payload.field_diff && typeof payload.field_diff === 'object') {
    const keys = Object.keys(payload.field_diff as Record<string, unknown>);
    if (keys.length > 0) details.push(`明细变更：${keys.map(orderEventFieldLabel).join('、')}`);
  }
  if (typeof payload.effective_from_issue === 'number') details.push(`生效期号：第 ${payload.effective_from_issue} 期`);
  if (typeof payload.change_reason === 'string' && payload.change_reason) details.push(`变更原因：${payload.change_reason}`);
  return details.length > 0 ? details.join(' · ') : '系统已记录本次操作';
}

const ORDER_EVENT_FIELD_LABELS: Record<string, string> = {
  payer_name: '付款主体',
  payer_contact: '付款主体联系方式',
  external_order_no: '来源单号',
  source_platform: '来源平台',
  source_store: '来源店铺',
  payment_method: '付款方式',
  payment_collector: '收款经办人',
  total_amount: '订单总额',
  paid_amount: '已付金额',
  invoice_required: '开票需求',
  invoice_title: '发票抬头',
  invoice_tax_no: '纳税人识别号',
  invoice_recipient_email: '发票邮箱',
  notes: '备注',
  publication: '刊物',
  fulfillment_type: '履约类型',
  delivery_method: '投递方式',
  coverage_start_date: '覆盖开始日期',
  coverage_end_date: '覆盖结束日期',
  total_quantity: '每期总份数',
  unit_price: '单价',
};

function orderEventFieldLabel(field: string): string {
  return ORDER_EVENT_FIELD_LABELS[field] ?? '订单信息';
}

function eventEntryMethodLabel(value: string): string {
  switch (value) {
    case 'manual': return '手工录入';
    case 'excel_import': return '电商导入';
    case 'api_sync': return '接口同步';
    default: return '系统录入';
  }
}
