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
  updateOrder,
} from '../api/orders';
import type {
  BillingType,
  FulfillmentType,
  OrderCreatePayload,
  OrderItemIn,
  OrderOut,
  OrderPaymentMethod,
  OrderSourceType,
  OrderStatus,
  OrderUpdatePayload,
  Publication,
} from '../api/orders';
import {
  formatCurrency,
  statusBadgeColor,
  statusLabel,
} from './orderUtils';

const { Title } = Typography;
const { TextArea } = Input;

const SOURCE_TYPE_OPTIONS: Array<{ label: string; value: OrderSourceType }> = [
  { label: '电商', value: 'ecommerce' },
  { label: '对公转账', value: 'corporate_transfer' },
  { label: 'VIP 赠阅', value: 'vip_gift' },
  { label: '手工录入', value: 'manual' },
  { label: '邮局全年', value: 'mail_annual' },
];

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

// Fields that remain editable when an order has reached active status.
// Mirrors backend ACTIVE_EDITABLE_FIELDS in order_service.py.
const ACTIVE_EDITABLE_FIELDS = new Set<keyof OrderFormValues>([
  'notes',
  'payer_contact',
  'invoice_required',
  'invoice_title',
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
  publication: Publication;
  fulfillment_type: FulfillmentType;
  billing_type: BillingType;
  coverage_range?: [Dayjs, Dayjs] | null;
  issue_number?: number | null;
  total_quantity: number;
  unit_price: number;
  notes?: string | null;
  targets: TargetFormValues[];
}

export interface OrderFormValues {
  order_date: Dayjs;
  source_type: OrderSourceType;
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
  notes?: string | null;
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
  return {
    publication: 'cbj',
    fulfillment_type: 'subscription',
    billing_type: 'paid',
    coverage_range: null,
    issue_number: null,
    total_quantity: 1,
    unit_price: 0,
    notes: null,
    targets: [buildBlankTarget()],
  };
}

function buildInitialValues(): Partial<OrderFormValues> {
  return {
    order_date: dayjs(),
    source_type: 'manual',
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
    source_type: detail.source_type,
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
    notes: detail.notes,
    items: detail.items.map<ItemFormValues>((it) => {
      const activeAllocation =
        it.allocations.find((a) => a.version_no === 1) ?? it.allocations[0];
      return {
        publication: it.publication,
        fulfillment_type: it.fulfillment_type,
        billing_type: it.billing_type,
        coverage_range:
          it.coverage_start_date && it.coverage_end_date
            ? [dayjs(it.coverage_start_date), dayjs(it.coverage_end_date)]
            : null,
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
  const [start, end] = item.coverage_range ?? [];
  return {
    publication: item.publication,
    publication_format: 'paper',
    fulfillment_type: item.fulfillment_type,
    billing_type: item.billing_type,
    coverage_start_date: start ? start.format('YYYY-MM-DD') : null,
    coverage_end_date: end ? end.format('YYYY-MM-DD') : null,
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

function formValuesToCreatePayload(values: OrderFormValues): OrderCreatePayload {
  return {
    external_order_no: values.external_order_no ?? null,
    order_date: values.order_date.format('YYYY-MM-DD'),
    source_type: values.source_type,
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
    source_type: values.source_type,
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
  // In V1.1 the backend update_order endpoint does not accept item changes,
  // so items are read-only whenever we already have an existing order.
  const itemsReadOnly = isEditMode;

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
          message="订单已生效"
          description="生效订单只能编辑非结构字段（如付款联系人、备注、金额等）。修改订单明细或履约目标的能力将在 V1.2 上线。"
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
              <Form.Item
                name="source_type"
                label="来源类型"
                rules={[{ required: true, message: '请选择来源类型' }]}
              >
                <Select
                  options={SOURCE_TYPE_OPTIONS}
                  disabled={isFieldDisabled('source_type', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="source_platform" label="来源平台">
                <Input
                  maxLength={100}
                  placeholder="如：天猫 / 京东 / 网店"
                  disabled={isFieldDisabled('source_platform', status)}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="source_store" label="来源店铺">
                <Input
                  maxLength={100}
                  placeholder="店铺名称"
                  disabled={isFieldDisabled('source_store', status)}
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
            <Col span={12}>
              <Form.Item name="invoice_title" label="发票抬头">
                <Input
                  maxLength={200}
                  disabled={isFieldDisabled('invoice_title', status)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
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
          {itemsReadOnly ? (
            <Alert
              type="warning"
              message="订单明细在 V1.1 仅可在新建订单时录入"
              description="若需修改明细或履约目标，请先作废本订单再重新创建。明细的就地编辑能力将在 V1.2 上线。"
              showIcon
              style={{ marginBottom: 16 }}
            />
          ) : (
            <Alert
              type="info"
              message={
                <div>
                  每条明细对应一笔履约（订阅/单期/赠阅等）；每条明细下至少 1 个履约目标。
                  <br />
                  <strong>份数语义</strong>：明细「总份数」与目标「份数」都指<strong>每期</strong>份数（如订阅，每订户每期 1 份 → 2 个订户即总份数 2），与覆盖期长度无关。
                  <br />
                  <strong>单价语义</strong>：订阅时为单订户覆盖期内的订阅费（如半年 120 元）；零售时为每份零售价。
                </div>
              }
              showIcon
              style={{ marginBottom: 16 }}
            />
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

  const subtotal = useMemo(
    () => (Number(totalQuantity) || 0) * (Number(unitPrice) || 0),
    [totalQuantity, unitPrice],
  );

  const targetSum = useMemo(
    () => (targets ?? []).reduce((acc, t) => acc + (Number(t?.quantity) || 0), 0),
    [targets],
  );

  const requireCoverage = fulfillmentType
    ? COVERAGE_REQUIRED_TYPES.has(fulfillmentType)
    : false;
  const requireIssueNumber = fulfillmentType === 'single_issue';

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
        <Col span={6}>
          <Form.Item
            name={[field.name, 'publication']}
            label="出版物"
            rules={[{ required: true, message: '请选择出版物' }]}
          >
            <Select options={PUBLICATION_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            name={[field.name, 'fulfillment_type']}
            label="履约类型"
            rules={[{ required: true, message: '请选择履约类型' }]}
          >
            <Select options={FULFILLMENT_TYPE_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            name={[field.name, 'billing_type']}
            label="计费类型"
            rules={[{ required: true, message: '请选择计费类型' }]}
          >
            <Select options={BILLING_TYPE_OPTIONS} disabled={disabled} />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            name={[field.name, 'coverage_range']}
            label="覆盖期"
            rules={
              requireCoverage
                ? [{ required: true, message: '订阅/续订需要填写覆盖期' }]
                : undefined
            }
          >
            <DatePicker.RangePicker style={{ width: '100%' }} disabled={disabled} />
          </Form.Item>
        </Col>
      </Row>
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
                <span>总份数</span>
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
              { required: true, message: '请填写总份数' },
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
                <span>单价</span>
                <Tooltip
                  title={
                    <div>
                      <div>每「份」对应的价格：</div>
                      <div>· 订阅：每订户在<strong>整个覆盖期</strong>的订阅费（如半年 120 元、全年 240 元）</div>
                      <div>· 单期/零售：每份的零售价（如 5 元/份）</div>
                      <div style={{ marginTop: 4 }}>小计 = 总份数 × 单价（公式与期数无关）。</div>
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
              placeholder="订阅整期 / 零售每份"
              disabled={disabled}
            />
          </Form.Item>
        </Col>
        <Col span={6}>
          <Form.Item
            label={
              <Space size={4}>
                <span>小计</span>
                <Tooltip title="小计 = 总份数 × 单价，由系统自动计算">
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
          目标合计 {targetSum} / 明细总份数 {Number(totalQuantity) || 0}
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
