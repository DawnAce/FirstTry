import { SOURCE_PLATFORM_OPTIONS, SOURCE_STORE_OPTIONS, normalizeSource } from '../api/salesSources';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  DatePicker,
  Divider,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckOutlined,
  DeleteOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  ShoppingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  confirmOrder,
  createOrder,
  getOrder,
  orderQueryKeys,
  updateOrder,
} from '../api/orders';
import type {
  BillingType,
  CoverageStartMode,
  DeliveryMethod,
  FulfillmentType,
  FulfillmentTargetOut,
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
import { extractFormValidation } from './OrderEditor.validation';
import './OrderManagement.css';
import OrderCoverageFields from './OrderCoverageFields';
import { existingCoverage } from './orderCoverage';

const { TextArea } = Input;

// 「录入方式」（entry_method）前端表单完全隐藏，后端手工录入入口固定写 'manual'。
// 销售渠道信息走 source_platform / source_store，付款方式走 payment_method。
// Excel 批量导入 / API 同步入口会分别写 excel_import / api_sync。

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
  delivery_snapshot?: Pick<FulfillmentTargetOut, 'shipping_channel' | 'distribution_unit_id' | 'effective_from_issue' | 'effective_until_issue'>;
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
  coverage_start?: Dayjs | null;
  coverage_end?: Dayjs | null;
  coverage_start_mode?: CoverageStartMode;
  coverage_start_issue?: number | null;
  issue_year?: number;
  end_date_adjusted?: boolean;
  subscription_term?: SubscriptionTerm | null;
  delivery_method?: DeliveryMethod | null;
  // 预设期限（半年/一年）的起始月份；自定义期限时从 coverage_start 派生。
  start_month?: Dayjs | null;
  issue_number?: number | null;
  total_quantity: number;
  unit_price: number;
  notes?: string | null;
  targets: TargetFormValues[];
}

export interface OrderFormValues {
  order_date: Dayjs;
  // NOTE: entry_method removed from form — UI hides it; backend forces 'manual'.
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
  const [s, e] = computeCoverageRange('one_year', start);
  return {
    publication: 'cbj',
    fulfillment_type: 'subscription',
    billing_type: 'paid',
    coverage_start: s,
    coverage_end: e,
    coverage_start_mode: 'month',
    end_date_adjusted: false,
    subscription_term: 'one_year',
    delivery_method: 'post_office',
    start_month: start,
    issue_number: null,
    total_quantity: 1,
    unit_price: 240,
    notes: null,
    targets: [buildBlankTarget()],
  };
}

function buildInitialValues(): Partial<OrderFormValues> {
  return {
    order_date: dayjs(),
    payer_name: '',
    invoice_required: false,
    total_amount: 240,
    items: [buildBlankItem()],
  };
}

function detailToFormValues(detail: OrderOut): Partial<OrderFormValues> {
  return {
    order_date: dayjs(detail.order_date),
    source_platform: normalizeSource(detail.source_platform, detail.source_store).platform,
    source_store: normalizeSource(detail.source_platform, detail.source_store).store,
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
    items: detail.items.filter(it => it.status !== 'cancelled').map<ItemFormValues>((it) => {
      // Select current active allocation (open-ended), falling back to highest version
      const activeAllocation =
        it.allocations
          .filter((a) => a.effective_until_issue == null)
          .sort((a, b) => b.version_no - a.version_no)[0]
        ?? [...it.allocations].sort((a, b) => b.version_no - a.version_no)[0];
      const coverage = existingCoverage(it);
      const isCoverageType = COVERAGE_REQUIRED_TYPES.has(it.fulfillment_type);
      return {
        id: it.id,
        publication: it.publication,
        fulfillment_type: it.fulfillment_type,
        billing_type: it.billing_type,
        coverage_start: coverage.start,
        coverage_end: coverage.end,
        coverage_start_mode: coverage.mode,
        coverage_start_issue: it.coverage_start_issue,
        issue_year: coverage.start?.year() ?? dayjs().year(),
        end_date_adjusted: coverage.adjusted,
        subscription_term: it.subscription_term ?? (isCoverageType
          ? inferSubscriptionTerm(coverage.start, coverage.end)
          : null),
        delivery_method: it.delivery_method,
        start_month: coverage.start?.startOf('month') ?? null,
        issue_number: it.issue_number,
        total_quantity: it.total_quantity,
        unit_price: Number(it.unit_price),
        notes: it.notes,
        targets:
          activeAllocation?.targets.filter(t => t.status === 'active' && !t.replaced_by_target_id).map((t) => ({
            delivery_snapshot: { shipping_channel: t.shipping_channel,
              distribution_unit_id: t.distribution_unit_id, effective_from_issue: t.effective_from_issue,
              effective_until_issue: t.effective_until_issue },
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
  const start = item.coverage_start;
  const end = item.coverage_end;
  return {
    publication: item.publication,
    publication_format: 'paper',
    fulfillment_type: item.fulfillment_type,
    billing_type: item.billing_type,
    subscription_term: item.subscription_term ?? null,
    delivery_method: item.delivery_method ?? null,
    term_start_month: isCoverageType && item.coverage_start_mode === 'month' && item.start_month ? item.start_month.format('YYYY-MM') : null,
    coverage_start_mode: isCoverageType ? item.coverage_start_mode : null,
    coverage_start_issue: isCoverageType && item.coverage_start_mode === 'issue' ? item.coverage_start_issue : null,
    coverage_start_date: isCoverageType && start ? start.format('YYYY-MM-DD') : null,
    coverage_end_date: isCoverageType && end ? end.format('YYYY-MM-DD') : null,
    issue_number: item.issue_number ?? null,
    total_quantity: totalQty,
    unit_price: unitPrice,
    subtotal: Math.round(totalQty * unitPrice * 100) / 100,
    notes: item.notes ?? null,
    targets: item.targets.map((t) => ({
      ...t.delivery_snapshot,
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
    // entry_method 不传：后端手工录入入口固定写 'manual'（录入方式 provenance）
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
    // entry_method 不传：provenance 元数据不可改（后端 OrderUpdate 也未包含该字段）
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
      (!item.coverage_start || !item.coverage_end)
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
    okText: '确定',
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
  const watchedPayer = Form.useWatch<string | undefined>('payer_name', form);
  const watchedPaidAmount = Form.useWatch<number | null | undefined>('paid_amount', form);
  const watchedTotalAmount = Form.useWatch<number | null | undefined>('total_amount', form);
  const watchedItems = Form.useWatch<ItemFormValues[] | undefined>('items', form);
  const watchedInvoiceRequired = Form.useWatch<boolean | undefined>('invoice_required', form);
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

  const computedTotalAmount = useMemo(
    () =>
      (watchedItems ?? []).reduce(
        (sum, item) =>
          sum + (Number(item?.total_quantity) || 0) * (Number(item?.unit_price) || 0),
        0,
      ),
    [watchedItems],
  );
  const summaryItem = watchedItems?.[0];
  const summaryTargetCount = (watchedItems ?? []).reduce(
    (sum, item) => sum + (item?.targets?.length ?? 0),
    0,
  );
  const summaryQuantity = (watchedItems ?? []).reduce(
    (sum, item) => sum + (Number(item?.total_quantity) || 0),
    0,
  );

  useEffect(() => {
    if (isActive || isVoid) return;
    const current = Number(form.getFieldValue('total_amount')) || 0;
    if (Math.abs(current - computedTotalAmount) > 0.001) {
      form.setFieldValue('total_amount', computedTotalAmount);
    }
  }, [computedTotalAmount, form, isActive, isVoid]);

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
      queryClient.invalidateQueries({ queryKey: ['postalDeliveries', 'order', id] });
      queryClient.invalidateQueries({ queryKey: ['postalTickets', 'order', id] });
    }
  };

  const handleFormValidationFailure = (error: unknown) => {
    const { fields, messages } = extractFormValidation(error);
    const firstField = fields[0];
    if (firstField?.name.length === 1 && firstField.name[0] === 'items') {
      document.getElementById('order-items-section')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    } else if (firstField) {
      form.scrollToField(firstField.name, {
        behavior: 'smooth',
        block: 'center',
        focus: true,
      });
    }

    if (messages.length === 1) {
      message.warning(messages[0]);
    } else if (messages.length > 1) {
      showValidationErrors(messages);
    } else {
      message.warning('请检查表单中标红的字段');
    }
  };

  /**
   * Persists base fields and items atomically. Returns the resulting order id
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
        if (values.items.length > 0) {
          payload.items_update = {
            effective_from_issue: isActive ? values.effective_from_issue! : undefined,
            change_reason: values.change_reason ?? undefined,
            items: values.items.map(itemToUpdatePayload),
          };
        }
        const res = await updateMutation.mutateAsync({ id: orderId!, payload });

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
      await form.validateFields();
      // 明细 ID、既有投递快照等不一定有可见控件，保存时必须保留。
      values = form.getFieldsValue(true);
    } catch (error) {
      handleFormValidationFailure(error);
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
      await form.validateFields();
      values = form.getFieldsValue(true);
    } catch (error) {
      handleFormValidationFailure(error);
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
      navigate(`/orders/${id}`, { state: { justActivated: true } });
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
        title="加载订单失败"
        description={String(detailQuery.error)}
        action={
          <Button onClick={() => detailQuery.refetch()} type="primary" size="small">
            重试
          </Button>
        }
      />
    );
  }

  const summaryTotal = Number(watchedTotalAmount) || computedTotalAmount;
  const summaryCoverage = summaryItem?.coverage_start && summaryItem.coverage_end
    ? `${summaryItem.coverage_start.format('YYYY-MM-DD')} 至 ${summaryItem.coverage_end.format('YYYY-MM-DD')}`
    : '待选择';
  const summaryTerm = summaryItem?.subscription_term
    ? { half_year: '半年', one_year: '一年', custom: '自定义' }[summaryItem.subscription_term] : '待选择';
  const summaryDelivery = summaryItem?.delivery_method
    ? { post_office: '邮局投递', zto_mf: 'ZTO-MF 快递' }[summaryItem.delivery_method] : '待选择';

  return (
    <div className="order-page order-editor-page">
      <header className="order-page-header">
        <div className="order-page-heading">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>
            返回列表
          </Button>
          <div>
            <div className="order-title-line">
              <h1>{headerTitle}</h1>
              {isEditMode && status && (
                <Badge status={statusBadgeColor(status)} text={statusLabel(status)} />
              )}
            </div>
            <p>常规订单单页完成，带 * 的字段为必填；金额与覆盖期自动计算。</p>
          </div>
        </div>
        <span className="order-page-status">{isEditMode ? statusLabel(status ?? 'draft') : '单页录入'}</span>
      </header>

      {isVoid && (
        <Alert type="error" showIcon title="该订单已作废" description="已作废订单不可再编辑。" />
      )}
      {isActive && (
        <Alert
          type="info"
          showIcon
          title="正在编辑已生效订单"
          description="修改履约目标会生成新版本；请填写本次变更的生效起始期号。"
        />
      )}

      <Form<OrderFormValues>
        form={form}
        layout="vertical"
        disabled={isVoid}
        initialValues={buildInitialValues()}
        className="order-editor-form"
      >
        <div className="order-editor-layout">
          <div className="order-editor-main">
            <Card
              className="order-form-section"
              title={<span><UserOutlined />客户与商品</span>}
              extra={<span className="order-section-meta">3 项必填</span>}
            >
              <Row gutter={[14, 0]}>
                <Col xs={24} md={8}>
                  <Form.Item name="payer_name" label="付款主体" rules={[{ required: true, message: '请填写付款主体' }]}>
                    <Input maxLength={200} placeholder="单位名称或个人姓名" disabled={isFieldDisabled('payer_name', status)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="payer_contact" label="付款联系人">
                    <Input maxLength={100} placeholder="姓名 / 电话" disabled={isFieldDisabled('payer_contact', status)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="order_date" label="下单日期" rules={[{ required: true, message: '请选择下单日期' }]}>
                    <DatePicker style={{ width: '100%' }} disabled={isFieldDisabled('order_date', status)} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card
              className="order-form-section"
              title={<span><LinkOutlined />来源与收款</span>}
              extra={<span className="order-section-meta">4 项必填</span>}
            >
              <Row gutter={[14, 0]}>
                <Col xs={24} md={8}>
                  <Form.Item name="source_platform" label="来源平台" rules={[{ required: true, message: '请选择来源平台' }]}>
                    <Select
                      options={SOURCE_PLATFORM_OPTIONS}
                      placeholder="选择来源平台"
                      allowClear
                      onChange={handlePlatformChange}
                      disabled={isFieldDisabled('source_platform', status)}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="source_store" label="来源店铺" rules={[{ required: true, message: '请选择来源店铺' }]}>
                    <Select
                      options={storeOptions}
                      placeholder={sourcePlatform ? '选择店铺' : '请先选择来源平台'}
                      allowClear
                      notFoundContent={sourcePlatform ? '该平台暂无对应店铺' : '请先选择来源平台'}
                      disabled={!sourcePlatform || isFieldDisabled('source_store', status)}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="external_order_no" label="来源单号" rules={[{ required: true, message: '请填写来源单号' }]}>
                    <Input maxLength={100} placeholder="电商订单号 / 外部单号" disabled={isFieldDisabled('external_order_no', status)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="payment_method" label="支付方式">
                    <Select allowClear options={PAYMENT_METHOD_OPTIONS} disabled={isFieldDisabled('payment_method', status)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item
                    name="paid_amount"
                    label="已付金额"
                    rules={[
                      { required: true, message: '请填写已付金额' },
                      { type: 'number', min: 0, message: '已付金额不能小于 0' },
                    ]}
                  >
                    <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" disabled={isFieldDisabled('paid_amount', status)} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="payment_collector" label="收款经办人">
                    <Input maxLength={100} placeholder="经办人姓名" disabled={isFieldDisabled('payment_collector', status)} />
                  </Form.Item>
                </Col>
              </Row>
            </Card>

            <Card
              id="order-items-section"
              className="order-form-section order-items-section"
              title={<span><ShoppingOutlined />订购与收件</span>}
              extra={<span className="order-section-meta">明细、周期及履约目标</span>}
            >
              {isActive && (
                <div className="order-active-change">
                  <Row gutter={[14, 0]}>
                    <Col xs={24} md={8}>
                      <Form.Item name="effective_from_issue" label="生效起始期号" tooltip="本次履约变更从哪一期生效；不能替代下方的订阅起投刊期与覆盖日期。" rules={[{ required: true, message: '请填写生效起始期号' }]}>
                        <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="如 2660" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={16}>
                      <Form.Item name="change_reason" label="变更原因（可选）">
                        <Input maxLength={255} placeholder="如：客户要求换地址" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              )}
              <Form.List
                name="items"
                rules={itemsReadOnly ? undefined : [{
                  validator: async (_, items: ItemFormValues[]) => {
                    if (!items || items.length === 0) return Promise.reject(new Error('至少添加 1 条订单明细'));
                  },
                }]}
              >
                {(fields, { add, remove }, { errors }) => (
                  <>
                    {fields.map((field, idx) => (
                      <ItemBlock key={field.key} field={field} index={idx} onRemove={() => remove(field.name)} disabled={itemsReadOnly} preservePrice={isEditMode} />
                    ))}
                    {!itemsReadOnly && (
                      <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add(buildBlankItem())}>
                        添加订单明细
                      </Button>
                    )}
                    <Form.ErrorList errors={errors} />
                  </>
                )}
              </Form.List>
            </Card>

            <Collapse
              className="order-optional-section"
              items={[{
                key: 'optional',
                label: <span><FileTextOutlined />选填信息</span>,
                extra: <span className="order-section-meta">发票、金额调整、备注</span>,
                children: (
                  <>
                    <div className="order-invoice-switch">
                      <div><strong>需要开具发票</strong><p>开启后填写发票抬头、税号和接收邮箱。</p></div>
                      <Form.Item name="invoice_required" valuePropName="checked" noStyle>
                        <Switch checkedChildren="是" unCheckedChildren="否" disabled={isFieldDisabled('invoice_required', status)} />
                      </Form.Item>
                    </div>
                    {watchedInvoiceRequired && (
                      <Row gutter={[14, 0]} className="order-invoice-fields">
                        <Col xs={24} md={8}>
                          <Form.Item name="invoice_title" label="发票抬头">
                            <Input maxLength={200} placeholder="单位或个人名称" disabled={isFieldDisabled('invoice_title', status)} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name="invoice_tax_no" label="纳税人识别号" tooltip="个人发票可留空">
                            <Input maxLength={64} disabled={isFieldDisabled('invoice_tax_no', status)} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={8}>
                          <Form.Item name="invoice_recipient_email" label="发票接收邮箱" rules={[{ type: 'email', message: '请输入有效的邮箱地址' }]}>
                            <Input maxLength={128} disabled={isFieldDisabled('invoice_recipient_email', status)} />
                          </Form.Item>
                        </Col>
                      </Row>
                    )}
                    {isActive ? (
                      <Row gutter={[14, 0]}>
                        <Col xs={24} md={8}>
                          <Form.Item name="total_amount" label="订单总金额">
                            <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" />
                          </Form.Item>
                        </Col>
                        <Col xs={24} md={16}>
                          <Form.Item name="notes" label="订单备注">
                            <TextArea rows={2} maxLength={500} showCount />
                          </Form.Item>
                        </Col>
                      </Row>
                    ) : (
                      <>
                        <Form.Item name="total_amount" hidden><InputNumber /></Form.Item>
                        <Form.Item name="notes" label="订单备注">
                          <TextArea rows={2} maxLength={500} showCount />
                        </Form.Item>
                      </>
                    )}
                  </>
                ),
              }]}
            />
          </div>

          <aside className="order-summary-column">
            <Card className="order-summary-card">
              <div className="order-summary-hero">
                <span>订单应收</span>
                <strong>{formatCurrency(summaryTotal)}</strong>
              </div>
              <dl>
                <div><dt>付款主体</dt><dd>{watchedPayer || '待填写'}</dd></div>
                <div><dt>订阅期限</dt><dd>{summaryTerm}</dd></div>
                {summaryItem?.coverage_start_mode === 'issue' && <div><dt>起投刊期</dt><dd>{summaryItem.coverage_start_issue ? `第 ${summaryItem.coverage_start_issue} 期` : '待选择'}</dd></div>}
                <div><dt>覆盖期</dt><dd>{summaryCoverage}</dd></div>
                <div><dt>投递方式</dt><dd>{summaryDelivery}</dd></div>
                <div><dt>履约目标</dt><dd>{summaryTargetCount} 人 / {summaryQuantity} 份</dd></div>
                <div><dt>已付金额</dt><dd>{watchedPaidAmount == null ? '待填写' : formatCurrency(watchedPaidAmount)}</dd></div>
              </dl>
              <div className="order-summary-check">✓ 份数与金额随订单明细自动更新</div>
            </Card>
          </aside>
        </div>
      </Form>

      <div className="order-action-bar">
        <Button type="text" icon={<SaveOutlined />} onClick={handleSaveDraft} disabled={isVoid || submitting} loading={submitting}>
          {isActive ? '保存变更' : '保存草稿'}
        </Button>
        <div>
          <Button onClick={() => navigate(isEditMode ? `/orders/${orderId}` : '/orders')}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={handleConfirm} disabled={isVoid || isActive || submitting} loading={submitting}>
            确认生效
          </Button>
        </div>
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
  preservePrice?: boolean;
}

function ItemBlock({ field, index, onRemove, disabled, preservePrice = false }: ItemBlockProps) {
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
  // Derived (displayed read-only): 应收小计 = 单价 × 每期总份数; 目标合计 = 各履约目标份数之和.
  const subtotal = (Number(unitPrice) || 0) * (Number(totalQuantity) || 0);
  const targetSum = (targets ?? []).reduce(
    (sum, t) => sum + (Number(t?.quantity) || 0),
    0,
  );

  const requireCoverage = fulfillmentType
    ? COVERAGE_REQUIRED_TYPES.has(fulfillmentType)
    : false;
  const requireIssueNumber = fulfillmentType === 'single_issue';

  useEffect(() => {
    const current = form.getFieldValue(['items', field.name, 'subscription_term']);
    if (requireCoverage && !current) form.setFieldValue(['items', field.name, 'subscription_term'], 'custom');
    if (!requireCoverage && current) form.setFieldValue(['items', field.name, 'subscription_term'], null);
  }, [requireCoverage, form, field.name]);
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
      className="order-item-card"
      size="small"
      title={<span>明细 {index + 1}<Tag color="purple">{fulfillmentType === 'subscription' ? '订阅' : '履约'}</Tag></span>}
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
      <Row gutter={[12, 0]}>
        <Col xs={24} md={8}>
          <Form.Item
            name={[field.name, 'publication']}
            label="出版物"
            rules={[{ required: true, message: '请选择出版物' }]}
          >
            <Select options={PUBLICATION_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name={[field.name, 'fulfillment_type']}
            label="履约类型"
            rules={[{ required: true, message: '请选择履约类型' }]}
          >
            <Select options={FULFILLMENT_TYPE_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item
            name={[field.name, 'billing_type']}
            label="计费类型"
            rules={[{ required: true, message: '请选择计费类型' }]}
          >
            <Select options={BILLING_TYPE_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
      </Row>
      {requireCoverage && <OrderCoverageFields index={field.name} disabled={disabled} preservePrice={preservePrice} />}
      <Row gutter={[12, 0]}>
        {requireIssueNumber && (
          <Col xs={24} md={6}>
            <Form.Item name={[field.name, 'issue_number']} label="单期期号" rules={[{ required: true, message: '单期履约需填写期号' }]}>
              <InputNumber style={{ width: '100%' }} min={1} precision={0} placeholder="必填" disabled={disabled} />
            </Form.Item>
          </Col>
        )}
        <Col xs={24} md={6}>
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
        <Col xs={24} md={6}>
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
        <Col xs={24} md={6}>
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

      <Divider titlePlacement="left" style={{ margin: '8px 0 12px' }}>
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
                className="order-target-card"
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
                <Row gutter={[12, 0]}>
                  <Col xs={24} md={8}>
                    <Form.Item
                      name={[tf.name, 'recipient_name']}
                      label="收件人"
                      rules={[{ required: true, message: '请填写收件人' }]}
                    >
                      <Input maxLength={100} disabled={disabled} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name={[tf.name, 'recipient_phone']} label="电话">
                      <Input maxLength={50} disabled={disabled} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item name={[tf.name, 'recipient_postal_code']} label="邮编">
                      <Input maxLength={20} disabled={disabled} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={[12, 0]}>
                  <Col xs={24} md={16}>
                    <Form.Item
                      name={[tf.name, 'recipient_address']}
                      label="收件地址"
                      rules={[{ required: true, message: '请填写收件地址' }]}
                    >
                      <Input maxLength={500} disabled={disabled} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
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
