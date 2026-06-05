import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  confirmOrder,
  createOrder,
  getOrder,
  orderQueryKeys,
  previewOrderPricing,
  updateOrder,
  updateOrderItems,
} from '../api/orders';
import type {
  BillingType,
  DeliveryMethod,
  FulfillmentType,
  OrderCreatePayload,
  OrderItemIn,
  OrderItemUpdate,
  OrderOut,
  OrderPaymentMethod,
  OrderStatus,
  OrderUpdatePayload,
  Publication,
  SubscriptionTerm,
} from '../api/orders';
import {
  formatCurrency,
  statusBadgeColor,
  statusLabel,
} from './orderUtils';

const { Title } = Typography;
const { TextArea } = Input;

// V1.1：「来源类型」字段已 UX 解耦为「录入方式」，前端表单完全隐藏，
// 后端 OrderCreate.source_type 默认 'manual'。原 5 项枚举混杂了 4 个维度的概念
// （销售渠道=ecommerce / 付款方式=corporate_transfer / 业务性质=vip_gift /
//   录入方式=manual / 历史渠道=mail_annual），与已有的 source_platform /
// payment_method / billing_type 重复。PR-B 计划做 schema rename → entry_method。

// 来源平台 / 来源店铺：使用 1:1 映射的固定选项
// 数据库字段仍是自由文本，老数据非标值（如"天猫"）仍可读取展示，但下拉只列以下标准选项
const SOURCE_PLATFORM_OPTIONS: Array<{ label: string; value: string }> = [
  { label: '微信小程序', value: '微信小程序' },
  { label: '淘宝', value: '淘宝' },
  { label: '有赞', value: '有赞' },
];

const SOURCE_STORE_OPTIONS: Array<{ label: string; value: string; platform: string }> = [
  { label: 'CBJ+', value: 'CBJ+', platform: '微信小程序' },
  { label: '中国经营报发行部', value: '中国经营报发行部', platform: '淘宝' },
  { label: '中国经营报微店', value: '中国经营报微店', platform: '有赞' },
];

// 平台 → 默认店铺（1:1）。切换平台时自动填店铺。
const PLATFORM_DEFAULT_STORE: Record<string, string> = SOURCE_STORE_OPTIONS.reduce(
  (acc, opt) => ({ ...acc, [opt.platform]: opt.value }),
  {},
);

const PAYMENT_METHOD_OPTIONS: Array<{ label: string; value: OrderPaymentMethod }> = [
  { label: '微信', value: 'wechat' },
  { label: '支付宝', value: 'alipay' },
  { label: '银行卡', value: 'bank_card' },
  { label: '对公转账', value: 'corporate_transfer' },
  { label: '现金', value: 'cash' },
  { label: '冲抵', value: 'offset' },
  { label: '其他', value: 'other' },
];

const PUBLICATION_OPTIONS: Array<{ label: string; value: Publication }> = [
  { label: '中国经营报', value: 'cbj' },
  { label: '商学院', value: 'business_school' },
  { label: '其他', value: 'other' },
];

const FULFILLMENT_TYPE_OPTIONS: Array<{ label: string; value: FulfillmentType }> = [
  { label: '订阅', value: 'subscription' },
  { label: '单期', value: 'single_issue' },
  { label: '赠阅', value: 'gift' },
  { label: '补寄', value: 'makeup' },
  { label: '续订', value: 'extension' },
  { label: '换订', value: 'replacement' },
];

const BILLING_TYPE_OPTIONS: Array<{ label: string; value: BillingType }> = [
  { label: '付费', value: 'paid' },
  { label: '免费赠阅', value: 'free_gift' },
  { label: '搭赠', value: 'bundle_gift' },
];

const COVERAGE_REQUIRED_TYPES = new Set<FulfillmentType>(['subscription', 'extension']);

// 把"期限 + 起始日"转换为 [start, end]（end = start + N 个月 - 1 天）。
function computeCoverageRange(term: SubscriptionTerm, start: Dayjs): [Dayjs, Dayjs] {
  const months = term === 'half_year' ? 6 : 12;
  return [start, start.add(months, 'month').subtract(1, 'day')];
}

// 从已有覆盖期日期反向推断"期限"。容差 ±3 天，避免大小月与闰年抖动。
function inferSubscriptionTerm(
  start: Dayjs | null | undefined,
  end: Dayjs | null | undefined,
): SubscriptionTerm {
  if (!start || !end) return 'custom';
  const halfEnd = start.add(6, 'month').subtract(1, 'day');
  const fullEnd = start.add(1, 'year').subtract(1, 'day');
  if (Math.abs(end.diff(halfEnd, 'day')) <= 3) return 'half_year';
  if (Math.abs(end.diff(fullEnd, 'day')) <= 3) return 'one_year';
  return 'custom';
}

const SUBSCRIPTION_TERM_OPTIONS: Array<{ label: string; value: SubscriptionTerm }> = [
  { label: '半年', value: 'half_year' },
  { label: '一年', value: 'one_year' },
  { label: '自定义', value: 'custom' },
];

const DELIVERY_METHOD_OPTIONS: Array<{ label: string; value: DeliveryMethod }> = [
  { label: '邮局投递（半年120 / 一年240）', value: 'post_office' },
  { label: 'ZTO-MF 快递（半年195 / 一年390）', value: 'zto_mf' },
];

// Fields that remain editable when an order has reached active status.
// Mirrors backend ACTIVE_EDITABLE_FIELDS in order_service.py.
const ACTIVE_EDITABLE_FIELDS = new Set<keyof OrderFormValues>([
  'notes',
  'payer_contact',
  'invoice_required',
  'invoice_title',
  'invoice_tax_no',
  'invoice_recipient_email',
  'payment_method',
  'payment_collector',
  'external_order_no',
  'source_platform',
  'source_store',
  'total_amount',
  'paid_amount',
]);

export interface TargetFormValues {
  recipient_name: string;
  recipient_phone?: string | null;
  recipient_address: string;
  recipient_postal_code?: string | null;
  quantity: number;
  notes?: string | null;
}

export interface ItemFormValues {
  id?: number | null;
  publication: Publication;
  fulfillment_type: FulfillmentType;
  billing_type: BillingType;
  coverage_range?: [Dayjs, Dayjs] | null;
  subscription_term?: SubscriptionTerm | null;
  delivery_method?: DeliveryMethod | null;
  // 预设期限（半年/一年）的起始月份；自定义期限时从 coverage_range[0] 派生。
  start_month?: Dayjs | null;
  issue_number?: number | null;
  total_quantity: number;
  unit_price: number;
  notes?: string | null;
  targets: TargetFormValues[];
}

export interface OrderFormValues {
  order_date: Dayjs;
  // NOTE: source_type removed from form — V1.1 UI hides it; backend defaults to 'manual'.
  source_platform?: string | null;
  source_store?: string | null;
  external_order_no?: string | null;
  payer_name: string;
  payer_contact?: string | null;
  payment_method?: OrderPaymentMethod | null;
  payment_collector?: string | null;
  total_amount?: number | null;
  paid_amount?: number | null;
  invoice_required: boolean;
  invoice_title?: string | null;
  invoice_tax_no?: string | null;
  invoice_recipient_email?: string | null;
  notes?: string | null;
  effective_from_issue?: number | null;
  change_reason?: string | null;
  items: ItemFormValues[];
}

function buildBlankTarget(): TargetFormValues {
  return {
    recipient_name: '',
    recipient_phone: null,
    recipient_address: '',
    recipient_postal_code: null,
    quantity: 1,
    notes: null,
  };
}

function buildBlankItem(): ItemFormValues {
  const start = dayjs().startOf('month');
  const [s, e] = computeCoverageRange('half_year', start);
  return {
    publication: 'cbj',
    fulfillment_type: 'subscription',
    billing_type: 'paid',
    coverage_range: [s, e],
    subscription_term: 'half_year',
    delivery_method: 'zto_mf',
    start_month: start,
    issue_number: null,
    total_quantity: 1,
    unit_price: 195,
    notes: null,
    targets: [buildBlankTarget()],
  };
}

function buildInitialValues(): Partial<OrderFormValues> {
  return {
    order_date: dayjs(),
    payer_name: '',
    invoice_required: false,
    total_amount: 0,
    paid_amount: 0,
    items: [],
  };
}

function detailToFormValues(detail: OrderOut): Partial<OrderFormValues> {
  return {
    order_date: dayjs(detail.order_date),
    source_platform: detail.source_platform,
    source_store: detail.source_store,
    external_order_no: detail.external_order_no,
    payer_name: detail.payer_name,
    payer_contact: detail.payer_contact,
    payment_method: detail.payment_method,
    payment_collector: detail.payment_collector,
    total_amount: Number(detail.total_amount),
    paid_amount: Number(detail.paid_amount),
    invoice_required: detail.invoice_required,
    invoice_title: detail.invoice_title,
    invoice_tax_no: detail.invoice_tax_no,
    invoice_recipient_email: detail.invoice_recipient_email,
    notes: detail.notes,
    items: detail.items.map<ItemFormValues>((it) => {
      // Select current active allocation (open-ended), falling back to highest version
      const activeAllocation =
        it.allocations
          .filter((a) => a.effective_until_issue == null)
          .sort((a, b) => b.version_no - a.version_no)[0]
        ?? [...it.allocations].sort((a, b) => b.version_no - a.version_no)[0];
      const coverageRange: [Dayjs, Dayjs] | null =
        it.coverage_start_date && it.coverage_end_date
          ? [dayjs(it.coverage_start_date), dayjs(it.coverage_end_date)]
          : null;
      const isCoverageType = COVERAGE_REQUIRED_TYPES.has(it.fulfillment_type);
      return {
        id: it.id,
        publication: it.publication,
        fulfillment_type: it.fulfillment_type,
        billing_type: it.billing_type,
        coverage_range: coverageRange,
        subscription_term: it.subscription_term ?? (isCoverageType
          ? inferSubscriptionTerm(coverageRange?.[0], coverageRange?.[1])
          : null),
        delivery_method: it.delivery_method,
        start_month: coverageRange?.[0]?.startOf('month') ?? null,
        issue_number: it.issue_number,
        total_quantity: it.total_quantity,
        unit_price: Number(it.unit_price),
        notes: it.notes,
        targets:
          activeAllocation?.targets.map((t) => ({
            recipient_name: t.recipient_name,
            recipient_phone: t.recipient_phone,
            recipient_address: t.recipient_address,
            recipient_postal_code: t.recipient_postal_code,
            quantity: t.quantity,
            notes: t.notes,
          })) ?? [],
      };
    }),
  };
}

function isFieldDisabled(field: keyof OrderFormValues, status: OrderStatus | null): boolean {
  if (status !== 'active') return false;
  return !ACTIVE_EDITABLE_FIELDS.has(field);
}

// =============================================================================
// Form values → payload converters
// =============================================================================

function itemToCreatePayload(item: ItemFormValues): OrderItemIn {
  const totalQty = Number(item.total_quantity) || 0;
  const unitPrice = Number(item.unit_price) || 0;
  const isCoverageType = COVERAGE_REQUIRED_TYPES.has(item.fulfillment_type);
  const [start, end] = item.coverage_range ?? [];
  return {
    publication: item.publication,
    publication_format: 'paper',
    fulfillment_type: item.fulfillment_type,
    billing_type: item.billing_type,
    subscription_term: item.subscription_term ?? null,
    delivery_method: item.delivery_method ?? null,
    term_start_month: item.start_month ? item.start_month.format('YYYY-MM') : null,
    coverage_start_date: isCoverageType && start ? start.format('YYYY-MM-DD') : null,
    coverage_end_date: isCoverageType && end ? end.format('YYYY-MM-DD') : null,
    issue_number: item.issue_number ?? null,
    total_quantity: totalQty,
    unit_price: unitPrice,
    subtotal: Math.round(totalQty * unitPrice * 100) / 100,
    notes: item.notes ?? null,
    targets: item.targets.map((t) => ({
      recipient_name: t.recipient_name,
      recipient_phone: t.recipient_phone ?? null,
      recipient_address: t.recipient_address,
      recipient_postal_code: t.recipient_postal_code ?? null,
      quantity: Number(t.quantity) || 0,
      notes: t.notes ?? null,
    })),
  };
}

function itemToUpdatePayload(item: ItemFormValues): OrderItemUpdate {
  return {
    id: item.id ?? undefined,
    ...itemToCreatePayload(item),
  };
}

function formValuesToCreatePayload(values: OrderFormValues): OrderCreatePayload {
  return {
    external_order_no: values.external_order_no ?? null,
    order_date: values.order_date.format('YYYY-MM-DD'),
    // source_type 不传：后端默认 'manual'（V1.1 录入方式 provenance）
    source_platform: values.source_platform ?? null,
    source_store: values.source_store ?? null,
    payer_name: values.payer_name,
    payer_contact: values.payer_contact ?? null,
    payment_method: values.payment_method ?? null,
    payment_collector: values.payment_collector ?? null,
    total_amount: Number(values.total_amount) || 0,
    paid_amount: Number(values.paid_amount) || 0,
    invoice_required: values.invoice_required,
    invoice_title: values.invoice_title ?? null,
    invoice_tax_no: values.invoice_tax_no ?? null,
    invoice_recipient_email: values.invoice_recipient_email ?? null,
    notes: values.notes ?? null,
    items: values.items.map(itemToCreatePayload),
  };
}

function formValuesToUpdatePayload(
  values: OrderFormValues,
  isActive: boolean,
): OrderUpdatePayload {
  const all: OrderUpdatePayload = {
    order_date: values.order_date.format('YYYY-MM-DD'),
    // source_type 不传：V1.1 起 provenance 元数据不可改（后端 OrderUpdate 也已移除该字段）
    source_platform: values.source_platform ?? null,
    source_store: values.source_store ?? null,
    external_order_no: values.external_order_no ?? null,
    payer_name: values.payer_name,
    payer_contact: values.payer_contact ?? null,
    payment_method: values.payment_method ?? null,
    payment_collector: values.payment_collector ?? null,
    total_amount: Number(values.total_amount) || 0,
    paid_amount: Number(values.paid_amount) || 0,
    invoice_required: values.invoice_required,
    invoice_title: values.invoice_title ?? null,
    invoice_tax_no: values.invoice_tax_no ?? null,
    invoice_recipient_email: values.invoice_recipient_email ?? null,
    notes: values.notes ?? null,
  };
  if (!isActive) return all;
  // Active orders: only send whitelisted fields to satisfy backend guard.
  const filtered: OrderUpdatePayload = {};
  (Object.keys(all) as Array<keyof OrderUpdatePayload>).forEach((k) => {
    if (ACTIVE_EDITABLE_FIELDS.has(k as keyof OrderFormValues)) {
      (filtered as Record<string, unknown>)[k] = all[k];
    }
  });
  return filtered;
}

// =============================================================================
// Business-rule validation (beyond Form.Item rules)
// =============================================================================

function validateBusinessRules(values: OrderFormValues): string[] {
  const errors: string[] = [];
  if (!values.items || values.items.length === 0) {
    errors.push('至少需要 1 条订单明细。');
    return errors;
  }
  values.items.forEach((item, idx) => {
    const label = `明细 ${idx + 1}`;
    const totalQty = Number(item.total_quantity) || 0;
    const targetSum = (item.targets ?? []).reduce(
      (acc, t) => acc + (Number(t?.quantity) || 0),
      0,
    );
    if (!item.targets || item.targets.length === 0) {
      errors.push(`${label}：至少需要 1 个履约目标。`);
    } else if (targetSum !== totalQty) {
      errors.push(`${label}：履约目标份数合计 ${targetSum} ≠ 明细总份数 ${totalQty}。`);
    }
    if (
      COVERAGE_REQUIRED_TYPES.has(item.fulfillment_type) &&
      (!item.coverage_range || !item.coverage_range[0] || !item.coverage_range[1])
    ) {
      errors.push(`${label}：订阅 / 续订履约类型必须填写覆盖期。`);
    }
    if (item.fulfillment_type === 'single_issue' && !item.issue_number) {
      errors.push(`${label}：单期履约类型必须填写期号。`);
    }
  });
  return errors;
}

// =============================================================================
// Error helpers
// =============================================================================

function showValidationErrors(errors: string[]): void {
  Modal.error({
    title: '请修正以下问题',
    content: (
      <ul style={{ marginTop: 8, paddingLeft: 20 }}>
        {errors.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
    ),
  });
}

function extractApiError(err: unknown): string {
  if (err && typeof err === 'object') {
    const anyErr = err as {
      response?: { data?: { detail?: unknown } };
      message?: string;
    };
    const detail = anyErr.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) => (typeof d === 'string' ? d : JSON.stringify(d)))
        .join('；');
    }
    if (anyErr.message) return anyErr.message;
  }
  return '未知错误';
}

export default function OrderEditor() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const orderId = params.id ? Number(params.id) : null;
  const isEditMode = orderId !== null && !Number.isNaN(orderId);
  const [form] = Form.useForm<OrderFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const detailQuery = useQuery({
    queryKey: isEditMode ? orderQueryKeys.detail(orderId!) : ['orders', 'detail', 'new'],
    queryFn: async () => {
      if (!isEditMode) return null;
      const res = await getOrder(orderId!);
      return res.data;
    },
    enabled: isEditMode,
  });

  const status: OrderStatus | null = detailQuery.data?.status ?? null;
  const isVoid = status === 'void';
  const isActive = status === 'active';
  const itemsReadOnly = isVoid;

  // 来源平台变化时联动来源店铺：1:1 自动填默认值；切到未识别平台 / 清空则清掉店铺
  const sourcePlatform = Form.useWatch<string | null | undefined>('source_platform', form);
  const storeOptions = useMemo(
    () =>
      sourcePlatform
        ? SOURCE_STORE_OPTIONS.filter((o) => o.platform === sourcePlatform)
        : [],
    [sourcePlatform],
  );
  const handlePlatformChange = (next: string | null | undefined) => {
    if (next && PLATFORM_DEFAULT_STORE[next]) {
      form.setFieldValue('source_store', PLATFORM_DEFAULT_STORE[next]);
    } else {
      form.setFieldValue('source_store', null);
    }
  };

  useEffect(() => {
    if (isEditMode && detailQuery.data) {
      form.setFieldsValue(detailToFormValues(detailQuery.data) as OrderFormValues);
    } else if (!isEditMode) {
      form.setFieldsValue(buildInitialValues() as OrderFormValues);
    }
  }, [isEditMode, detailQuery.data, form]);

  const headerTitle = useMemo(() => {
    if (!isEditMode) return '新建订单';
    if (detailQuery.data?.order_code) return `编辑订单 ${detailQuery.data.order_code}`;
    if (detailQuery.data) return `编辑订单 #${detailQuery.data.id}`;
    return '编辑订单';
  }, [isEditMode, detailQuery.data]);

  const createMutation = useMutation({
    mutationFn: (payload: OrderCreatePayload) => createOrder(payload),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: OrderUpdatePayload }) =>
      updateOrder(id, payload),
  });
  const confirmMutation = useMutation({
    mutationFn: (id: number) => confirmOrder(id),
  });

  const invalidateAndRefetch = (id?: number) => {
    queryClient.invalidateQueries({ queryKey: orderQueryKeys.all });
    if (id) {
      queryClient.invalidateQueries({ queryKey: orderQueryKeys.detail(id) });
    }
  };

  /**
   * Persists base fields (and items on create). Returns the resulting order id
   * if successful, otherwise null. Caller handles navigation / messaging.
   */
  const persistOrder = async (
    values: OrderFormValues,
    options: { requireItemValidation: boolean },
  ): Promise<number | null> => {
    if (options.requireItemValidation) {
      const errors = validateBusinessRules(values);
      if (errors.length > 0) {
        showValidationErrors(errors);
        return null;
      }
    }
    try {
      if (isEditMode) {
        const payload = formValuesToUpdatePayload(values, isActive);
        const res = await updateMutation.mutateAsync({ id: orderId!, payload });

        // Active orders: also update items via dedicated endpoint
        if (isActive && values.items.length > 0) {
          const itemsPayload = {
            effective_from_issue: values.effective_from_issue!,
            change_reason: values.change_reason ?? undefined,
            items: values.items.map(itemToUpdatePayload),
          };
          await updateOrderItems(orderId!, itemsPayload);
        }

        return res.data.id;
      }
      const payload = formValuesToCreatePayload(values);
      const res = await createMutation.mutateAsync(payload);
      return res.data.id;
    } catch (err) {
      const detail = extractApiError(err);
      message.error(`保存失败：${detail}`);
      return null;
    }
  };

  const handleSaveDraft = async () => {
    let values: OrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      message.warning('请先修正表单错误');
      return;
    }
    setSubmitting(true);
    try {
      const id = await persistOrder(values, { requireItemValidation: !isEditMode });
      if (id == null) return;
      invalidateAndRefetch(id);
      if (isEditMode) {
        message.success('已保存修改');
      } else {
        message.success('草稿已保存');
        navigate(`/orders/${id}/edit`, { replace: true });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async () => {
    let values: OrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      message.warning('请先修正表单错误');
      return;
    }
    setSubmitting(true);
    try {
      const id = await persistOrder(values, { requireItemValidation: !isEditMode });
      if (id == null) return;
      try {
        await confirmMutation.mutateAsync(id);
      } catch (err) {
        const detail = extractApiError(err);
        message.error(`确认生效失败：${detail}`);
        invalidateAndRefetch(id);
        return;
      }
      invalidateAndRefetch(id);
      message.success('订单已确认生效');
      navigate(`/orders/${id}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (isEditMode && detailQuery.isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin tip="正在加载订单..." />
      </div>
    );
  }

  if (isEditMode && detailQuery.isError) {
    return (
      <Alert
        type="error"
        showIcon
        message="加载订单失败"
        description={String(detailQuery.error)}
        action={
          <Button onClick={() => detailQuery.refetch()} type="primary" size="small">
            重试
          </Button>
        }
      />
    );
  }

  return (
    <div style={{ paddingBottom: 80 }}>
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
            {headerTitle}
          </Title>
          {isEditMode && status && (
            <Badge status={statusBadgeColor(status)} text={statusLabel(status)} />
          )}
        </Space>
      </div>

      {isVoid && (
        <Alert
          type="error"
          showIcon
          message="该订单已作废"
          description="已作废订单不可再编辑。"
          style={{ marginBottom: 16 }}
        />
      )}
      {isActive && (
        <Alert
          type="info"
          showIcon
          message="正在编辑已生效订单"
          description="生效订单的非结构字段（备注、金额等）可直接编辑。修改明细目标（收件人）将创建新版本的履约方案，需要填写生效起始期号。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Form<OrderFormValues>
        form={form}
        layout="vertical"
        disabled={isVoid}
        initialValues={buildInitialValues()}
      >
        <Card title="订单基本信息" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="order_date"
                label="下单日期"
                rules={[{ required: true, message: '请选择下单日期' }]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  disabled={isFieldDisabled('order_date', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              {/* V1.1：来源类型字段已隐藏。后端默认 manual。
                  渠道信息走下方「来源平台」/「来源店铺」。 */}
              <Form.Item name="source_platform" label="来源平台">
                <Select
                  options={SOURCE_PLATFORM_OPTIONS}
                  placeholder="选择来源平台"
                  allowClear
                  onChange={(v) => handlePlatformChange(v)}
                  disabled={isFieldDisabled('source_platform', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="source_store" label="来源店铺">
                <Select
                  options={storeOptions}
                  placeholder={sourcePlatform ? '选择店铺' : '请先选择来源平台'}
                  allowClear
                  notFoundContent={sourcePlatform ? '该平台暂无对应店铺' : '请先选择来源平台'}
                  disabled={!sourcePlatform || isFieldDisabled('source_store', status)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="external_order_no" label="来源单号">
                <Input
                  maxLength={100}
                  placeholder="电商订单号/外部单号"
                  disabled={isFieldDisabled('external_order_no', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="payer_name"
                label="付款主体"
                rules={[{ required: true, message: '请填写付款主体' }]}
              >
                <Input
                  maxLength={200}
                  placeholder="单位名称或个人姓名"
                  disabled={isFieldDisabled('payer_name', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="payer_contact" label="付款联系人">
                <Input
                  maxLength={100}
                  placeholder="姓名 / 电话"
                  disabled={isFieldDisabled('payer_contact', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="payment_method" label="支付方式">
                <Select
                  allowClear
                  options={PAYMENT_METHOD_OPTIONS}
                  disabled={isFieldDisabled('payment_method', status)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item name="payment_collector" label="收款经办人">
                <Input
                  maxLength={100}
                  disabled={isFieldDisabled('payment_collector', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="total_amount" label="订单总金额">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  step={0.01}
                  prefix="¥"
                  disabled={isFieldDisabled('total_amount', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="paid_amount" label="已付金额">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  step={0.01}
                  prefix="¥"
                  disabled={isFieldDisabled('paid_amount', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="invoice_required"
                label="是否开票"
                valuePropName="checked"
              >
                <Switch
                  checkedChildren="是"
                  unCheckedChildren="否"
                  disabled={isFieldDisabled('invoice_required', status)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="invoice_title" label="发票抬头">
                <Input
                  maxLength={200}
                  placeholder="如：东莞农村商业银行股份有限公司"
                  disabled={isFieldDisabled('invoice_title', status)}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="invoice_tax_no"
                label="纳税人识别号"
                tooltip="统一社会信用代码（USCC，常见 18 位字母数字）。个人发票可留空。"
              >
                <Input
                  maxLength={64}
                  placeholder="如：914419007829859746"
                  disabled={isFieldDisabled('invoice_tax_no', status)}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="invoice_recipient_email"
                label="发票接收邮箱"
                rules={[
                  {
                    type: 'email',
                    message: '请输入有效的邮箱地址',
                  },
                ]}
              >
                <Input
                  maxLength={128}
                  placeholder="如：finance@example.com"
                  disabled={isFieldDisabled('invoice_recipient_email', status)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="notes" label="备注">
                <TextArea
                  rows={2}
                  maxLength={500}
                  showCount
                  disabled={isFieldDisabled('notes', status)}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card title="订单明细" size="small" style={{ marginBottom: 16 }}>
          {!itemsReadOnly && (
            <Alert
              type="info"
              message={
                <div>
                  每条明细对应一笔履约（订阅/单期/赠阅等）；每条明细下至少 1 个履约目标。
                  <br />
                  <strong>份数语义</strong>：明细「总份数」与目标「份数」都指<strong>每期</strong>份数（如订阅，每订户每期 1 份 → 2 个订户即总份数 2），与覆盖期长度无关。
                  <br />
                  <strong>单价语义</strong>：订阅时为单订户覆盖期内的订阅费（先选「订阅期限」=半年/一年，单价标签会自动变成「半年订阅单价 / 户」等）；零售时为每份零售价。
                </div>
              }
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          {isActive && (
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={6}>
                <Form.Item
                  name="effective_from_issue"
                  label="生效起始期号"
                  rules={[{ required: true, message: '请填写生效起始期号' }]}
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1}
                    precision={0}
                    placeholder="如 2660"
                  />
                </Form.Item>
              </Col>
              <Col span={18}>
                <Form.Item name="change_reason" label="变更原因（可选）">
                  <Input maxLength={255} placeholder="如：客户要求换地址" />
                </Form.Item>
              </Col>
            </Row>
          )}
          <Form.List
            name="items"
            rules={
              itemsReadOnly
                ? undefined
                : [
                    {
                      validator: async (_, items: ItemFormValues[]) => {
                        if (!items || items.length === 0) {
                          return Promise.reject(new Error('至少添加 1 条订单明细'));
                        }
                      },
                    },
                  ]
            }
          >
            {(fields, { add, remove }, { errors }) => (
              <>
                {fields.map((field, idx) => (
                  <ItemBlock
                    key={field.key}
                    field={field}
                    index={idx}
                    onRemove={() => remove(field.name)}
                    disabled={itemsReadOnly}
                  />
                ))}
                {!itemsReadOnly && (
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => add(buildBlankItem())}
                  >
                    添加明细
                  </Button>
                )}
                <Form.ErrorList errors={errors} />
              </>
            )}
          </Form.List>
        </Card>

        <Divider />
      </Form>

      {/* Sticky action bar */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '12px 24px',
          background: 'var(--color-bg, #fff)',
          borderTop: '1px solid var(--color-border, #f0f0f0)',
          boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.04)',
          zIndex: 10,
          textAlign: 'right',
        }}
      >
        <Space>
          <Button onClick={() => navigate(isEditMode ? `/orders/${orderId}` : '/orders')}>
            取消
          </Button>
          <Button
            icon={<SaveOutlined />}
            onClick={handleSaveDraft}
            disabled={isVoid || submitting}
            loading={submitting}
          >
            保存草稿
          </Button>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            onClick={handleConfirm}
            disabled={isVoid || isActive || submitting}
            loading={submitting}
          >
            确认生效
          </Button>
        </Space>
      </div>
    </div>
  );
}

// =============================================================================
// ItemBlock: one item card with nested target list
// =============================================================================

interface ItemBlockProps {
  field: { key: number; name: number };
  index: number;
  onRemove: () => void;
  disabled: boolean;
}

function ItemBlock({ field, index, onRemove, disabled }: ItemBlockProps) {
  const form = Form.useFormInstance<OrderFormValues>();
  const fulfillmentType = Form.useWatch<FulfillmentType | undefined>(
    ['items', field.name, 'fulfillment_type'],
    form,
  );
  const totalQuantity = Form.useWatch<number | undefined>(
    ['items', field.name, 'total_quantity'],
    form,
  );
  const unitPrice = Form.useWatch<number | undefined>(
    ['items', field.name, 'unit_price'],
    form,
  );
  const targets = Form.useWatch<TargetFormValues[] | undefined>(
    ['items', field.name, 'targets'],
    form,
  );
  const subscriptionTerm = Form.useWatch<SubscriptionTerm | undefined | null>(
    ['items', field.name, 'subscription_term'],
    form,
  );
  const deliveryMethod = Form.useWatch<DeliveryMethod | undefined | null>(
    ['items', field.name, 'delivery_method'],
    form,
  );

  const requireCoverage = fulfillmentType
    ? COVERAGE_REQUIRED_TYPES.has(fulfillmentType)
    : false;
  const requireIssueNumber = fulfillmentType === 'single_issue';

  // 定价预览（仅用于展示套餐价参考，不用于生成覆盖期）
  const startMonth = Form.useWatch<Dayjs | undefined | null>(
    ['items', field.name, 'start_month'],
    form,
  );
  const previewQuery = useQuery({
    queryKey: [
      'orders',
      'pricing-preview',
      subscriptionTerm,
      deliveryMethod,
      startMonth?.format('YYYY-MM'),
      totalQuantity,
    ],
    queryFn: async () => {
      const res = await previewOrderPricing({
        subscription_term: subscriptionTerm as Exclude<SubscriptionTerm, 'custom'>,
        delivery_method: deliveryMethod as DeliveryMethod,
        term_start_month: startMonth!.format('YYYY-MM'),
        total_quantity: Number(totalQuantity) || 1,
      });
      return res.data;
    },
    enabled:
      requireCoverage &&
      subscriptionTerm !== 'custom' &&
      !!subscriptionTerm &&
      !!deliveryMethod &&
      !!startMonth,
  });

  // 预览成功时自动填充单价（但不覆盖覆盖期，覆盖期由纯日期运算决定）
  useEffect(() => {
    const preview = previewQuery.data;
    if (!preview || disabled || !requireCoverage || subscriptionTerm === 'custom') return;
    form.setFieldValue(['items', field.name, 'unit_price'], Number(preview.unit_price));
  }, [previewQuery.data, disabled, requireCoverage, subscriptionTerm, form, field.name]);

  // 当履约类型在 订阅/续订 ↔ 其它 之间切换时，同步 subscription_term
  useEffect(() => {
    const current = form.getFieldValue(['items', field.name, 'subscription_term']);
    if (requireCoverage) {
      if (!current) {
        const range = form.getFieldValue(['items', field.name, 'coverage_range']) as
          | [Dayjs, Dayjs]
          | null
          | undefined;
        form.setFieldValue(
          ['items', field.name, 'subscription_term'],
          inferSubscriptionTerm(range?.[0], range?.[1]),
        );
      }
    } else if (current) {
      form.setFieldValue(['items', field.name, 'subscription_term'], null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requireCoverage]);

  // 点击"半年/一年"快捷按钮：以起始月份（或当前月）为基准重算覆盖期。
  const handleTermChange = (term: SubscriptionTerm) => {
    form.setFieldValue(['items', field.name, 'subscription_term'], term);
    if (term === 'custom') return;
    const month = form.getFieldValue(['items', field.name, 'start_month']) as Dayjs | null | undefined;
    const start = month?.startOf('month') ?? dayjs().startOf('month');
    form.setFieldValue(['items', field.name, 'coverage_range'], computeCoverageRange(term, start));
  };

  // 起始月份变更：如果当前期限非自定义，则联动重算覆盖期。
  const handleStartMonthChange = (month: Dayjs | null) => {
    const term = form.getFieldValue(['items', field.name, 'subscription_term']) as SubscriptionTerm | null;
    if (!month || !term || term === 'custom') return;
    const start = month.startOf('month');
    form.setFieldValue(['items', field.name, 'coverage_range'], computeCoverageRange(term, start));
  };

  // 用户手动改 RangePicker：仅当当前期限不是"自定义"且日期不再匹配时，降级为自定义。
  const handleCoverageRangeChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (!dates || !dates[0] || !dates[1]) return;
    const [s, e] = dates as [Dayjs, Dayjs];
    form.setFieldValue(['items', field.name, 'start_month'], s.startOf('month'));
    const term = form.getFieldValue(['items', field.name, 'subscription_term']) as SubscriptionTerm | null;
    if (term && term !== 'custom') {
      const inferred = inferSubscriptionTerm(s, e);
      if (inferred !== term) {
        form.setFieldValue(['items', field.name, 'subscription_term'], 'custom');
      }
    }
  };
  // 单价标签与占位符随期限切换
  const unitPriceMeta = useMemo(() => {
    if (!requireCoverage) {
      return { label: '单价', placeholder: '零售每份', hint: '· 单期/零售：每份的零售价（如 5 元/份）' };
    }
    if (subscriptionTerm === 'half_year') {
      return { label: '单份套餐价', placeholder: '如 120', hint: '半年订阅：每订户在 6 个月内的订阅总价（常见 120 元）' };
    }
    if (subscriptionTerm === 'one_year') {
      return { label: '单份套餐价', placeholder: '如 240', hint: '一年订阅：每订户在 12 个月内的订阅总价（常见 240 元）' };
    }
    return { label: '订阅单价 / 户（按覆盖期）', placeholder: '按覆盖期', hint: '自定义覆盖期：每订户在整个覆盖期内的订阅总价' };
  }, [requireCoverage, subscriptionTerm]);

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, background: 'var(--color-bg-subtle, #fafafa)' }}
      title={`明细 ${index + 1}`}
      extra={
        <Button
          danger
          type="text"
          icon={<DeleteOutlined />}
          onClick={onRemove}
          disabled={disabled}
        >
          删除
        </Button>
      }
    >
      <Row gutter={12}>
        <Col span={8}>
          <Form.Item
            name={[field.name, 'publication']}
            label="出版物"
            rules={[{ required: true, message: '请选择出版物' }]}
          >
            <Select options={PUBLICATION_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={[field.name, 'fulfillment_type']}
            label="履约类型"
            rules={[{ required: true, message: '请选择履约类型' }]}
          >
            <Select options={FULFILLMENT_TYPE_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item
            name={[field.name, 'billing_type']}
            label="计费类型"
            rules={[{ required: true, message: '请选择计费类型' }]}
          >
            <Select options={BILLING_TYPE_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
      </Row>
      {requireCoverage && (
        <>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item
                name={[field.name, 'subscription_term']}
                label={
                  <Space size={4}>
                    <span>订阅期限</span>
                    <Tooltip
                      title={
                        <div>
                          <div>选「半年 / 一年」会按起始月份自动算出覆盖期，并把"单价"标签换成对应套餐。</div>
                          <div style={{ marginTop: 4 }}>非标周期（如 2 年）请选「自定义」并直接编辑覆盖期日期。</div>
                        </div>
                      }
                    >
                      <QuestionCircleOutlined style={{ color: 'var(--color-text-tertiary)', cursor: 'help' }} />
                    </Tooltip>
                  </Space>
                }
                rules={[{ required: true, message: '请选择订阅期限' }]}
              >
                <Radio.Group
                  options={SUBSCRIPTION_TERM_OPTIONS}
                  optionType="button"
                  onChange={(e) => handleTermChange(e.target.value as SubscriptionTerm)}
                  disabled={disabled}
                />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                name={[field.name, 'start_month']}
                label="起始月份"
                rules={subscriptionTerm !== 'custom' ? [{ required: true, message: '请选择起始月份' }] : undefined}
              >
                <DatePicker
                  picker="month"
                  style={{ width: '100%' }}
                  placeholder="选择月份"
                  onChange={handleStartMonthChange}
                  disabled={disabled || subscriptionTerm === 'custom'}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name={[field.name, 'delivery_method']}
                label="投递/收费方式"
                rules={[{ required: true, message: '请选择投递/收费方式' }]}
              >
                <Radio.Group options={DELIVERY_METHOD_OPTIONS} disabled={disabled} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name={[field.name, 'coverage_range']}
            label="覆盖期"
            rules={[{ required: true, message: '订阅/续订需要填写覆盖期' }]}
          >
            <DatePicker.RangePicker
              style={{ width: '100%' }}
              disabled={disabled}
              onChange={handleCoverageRangeChange}
            />
          </Form.Item>
        </>
      )}
      {requireCoverage && subscriptionTerm !== 'custom' && (
        <Alert
          type={previewQuery.data?.schedule_incomplete ? 'warning' : 'info'}
          showIcon
          message={previewQuery.isLoading ? '正在计算套餐价...' : previewQuery.data?.price_label ?? '请选择起始月份和投递方式'}
          description={
            previewQuery.data ? (
              <Space direction="vertical" size={2}>
                <span>预计发货：{previewQuery.data.expected_issue_count} 期</span>
                <span>单份套餐价：{formatCurrency(previewQuery.data.unit_price)}</span>
                <span>每期总份数：{Number(totalQuantity) || 0}</span>
                <span>应收小计：{formatCurrency(previewQuery.data.subtotal)}</span>
                {previewQuery.data.warning && <Typography.Text type="warning">{previewQuery.data.warning}</Typography.Text>}
              </Space>
            ) : previewQuery.isError ? (
              '定价预览暂不可用（不影响建单）'
            ) : undefined
          }
          style={{ marginBottom: 12 }}
        />
      )}
      <Row gutter={12}>
        <Col span={6}>
          <Form.Item
            name={[field.name, 'issue_number']}
            label="单期期号"
            rules={
              requireIssueNumber
                ? [{ required: true, message: '单期履约需填写期号' }]
                : undefined
            }
          >
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              precision={0}
              placeholder={requireIssueNumber ? '必填' : '仅单期需要'}
              disabled={disabled || !requireIssueNumber}
            />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            name={[field.name, 'total_quantity']}
            label={
              <Space size={4}>
                <span>每期总份数</span>
                <Tooltip
                  title={
                    <div>
                      <div><strong>每期</strong>需要寄出的份数（与覆盖期长度无关）：</div>
                      <div>· 订阅：等于「订户数 × 每订户每期份数」，常见每订户每期 1 份</div>
                      <div>· 单期/零售：本期总共要寄出的份数</div>
                      <div style={{ marginTop: 4 }}>系统会校验该值必须等于下方履约目标份数之和。</div>
                    </div>
                  }
                >
                  <QuestionCircleOutlined style={{ color: 'var(--color-text-tertiary)', cursor: 'help' }} />
                </Tooltip>
              </Space>
            }
            rules={[
              { required: true, message: '请填写每期总份数' },
              { type: 'number', min: 1, message: '至少 1 份' },
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              precision={0}
              placeholder="每期份数"
              disabled={disabled}
            />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            name={[field.name, 'unit_price']}
            label={
              <Space size={4}>
                <span>{unitPriceMeta.label}</span>
                <Tooltip
                  title={
                    <div>
                      <div>每「份」对应的价格：</div>
                      <div>· 订阅：每订户在<strong>整个覆盖期</strong>的订阅费（如半年 120 元、全年 240 元）</div>
                      <div>· 单期/零售：每份的零售价（如 5 元/份）</div>
                      <div style={{ marginTop: 4 }}>当前：{unitPriceMeta.hint}</div>
                      <div style={{ marginTop: 4 }}>应收小计 = 每期总份数 × 单份套餐价（公式与期数无关）。</div>
                    </div>
                  }
                >
                  <QuestionCircleOutlined style={{ color: 'var(--color-text-tertiary)', cursor: 'help' }} />
                </Tooltip>
              </Space>
            }
            rules={[{ required: true, message: '请填写单价' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              step={0.01}
              prefix="¥"
              placeholder={unitPriceMeta.placeholder}
              disabled={disabled}
            />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            label={
              <Space size={4}>
                <span>应收小计</span>
                <Tooltip title="应收小计 = 每期总份数 × 单份套餐价，由系统自动计算">
                  <QuestionCircleOutlined style={{ color: 'var(--color-text-tertiary)', cursor: 'help' }} />
                </Tooltip>
              </Space>
            }
          >
            <Input value={formatCurrency(subtotal)} disabled />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name={[field.name, 'notes']} label="明细备注">
        <Input.TextArea rows={1} maxLength={500} disabled={disabled} />
      </Form.Item>

      <Divider orientation="left" style={{ margin: '8px 0 12px' }}>
        履约目标
        <Tag
          color={targetSum === Number(totalQuantity || 0) ? 'green' : 'orange'}
          style={{ marginLeft: 8 }}
        >
          目标合计 {targetSum} / 每期总份数 {Number(totalQuantity) || 0}
        </Tag>
      </Divider>

      <Form.List
        name={[field.name, 'targets']}
        rules={[
          {
            validator: async (_, targets: TargetFormValues[]) => {
              if (!targets || targets.length === 0) {
                return Promise.reject(new Error('每条明细至少 1 个履约目标'));
              }
            },
          },
        ]}
      >
        {(targetFields, { add, remove }, { errors }) => (
          <>
            {targetFields.map((tf, tIdx) => (
              <Card
                key={tf.key}
                size="small"
                style={{ marginBottom: 8 }}
                title={`目标 ${tIdx + 1}`}
                extra={
                  <Button
                    danger
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => remove(tf.name)}
                    disabled={disabled}
                  >
                    删除
                  </Button>
                }
              >
                <Row gutter={12}>
                  <Col span={8}>
                    <Form.Item
                      name={[tf.name, 'recipient_name']}
                      label="收件人"
                      rules={[{ required: true, message: '请填写收件人' }]}
                    >
                      <Input maxLength={100} disabled={disabled} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name={[tf.name, 'recipient_phone']} label="电话">
                      <Input maxLength={50} disabled={disabled} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name={[tf.name, 'recipient_postal_code']} label="邮编">
                      <Input maxLength={20} disabled={disabled} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col span={16}>
                    <Form.Item
                      name={[tf.name, 'recipient_address']}
                      label="收件地址"
                      rules={[{ required: true, message: '请填写收件地址' }]}
                    >
                      <Input maxLength={500} disabled={disabled} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      name={[tf.name, 'quantity']}
                      label={
                        <Space size={4}>
                          <span>份数</span>
                          <Tooltip title="该收件人每期收到的份数（订阅情况下一般为 1）。所有目标的份数之和必须等于上方明细的「总份数」。">
                            <QuestionCircleOutlined style={{ color: 'var(--color-text-tertiary)', cursor: 'help' }} />
                          </Tooltip>
                        </Space>
                      }
                      rules={[
                        { required: true, message: '请填写份数' },
                        { type: 'number', min: 1, message: '至少 1 份' },
                      ]}
                    >
                      <InputNumber
                        style={{ width: '100%' }}
                        min={1}
                        precision={0}
                        placeholder="每期份数"
                        disabled={disabled}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item name={[tf.name, 'notes']} label="目标备注">
                  <Input.TextArea rows={1} maxLength={500} disabled={disabled} />
                </Form.Item>
              </Card>
            ))}
            <Button
              type="dashed"
              block
              size="small"
              icon={<PlusOutlined />}
              onClick={() => add(buildBlankTarget())}
              disabled={disabled}
            >
              添加履约目标
            </Button>
            <Form.ErrorList errors={errors} />
          </>
        )}
      </Form.List>
    </Card>
  );
}
