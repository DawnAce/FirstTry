import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  createInvoice,
  createSettlement,
  deleteInvoice,
  deleteSettlement,
  deleteSettlementAttachment,
  downloadSettlementAttachment,
  getInvoiceOrders,
  invoiceQueryKeys,
  listSettlements,
  settlementQueryKeys,
  updateSettlement,
  uploadSettlementAttachment,
} from '../api/finance';
import type {
  InvoiceOrderRow,
  InvoiceState,
  InvoiceType,
  Settlement,
  SettlementPayload,
  SettlementStatus,
} from '../api/finance';
import { listPartners, partnerQueryKeys } from '../api/contracts';
import { useAuth } from '../contexts/AuthContext';

const { Title, Text } = Typography;

// 与后端 MAX_ATTACHMENT_BYTES 对齐，前端先行拦截超大文件。
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = { normal: '正票', red_reversal: '红冲' };
const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  pending: '待开票',
  issued: '已开票',
  needs_red_reversal: '需冲红',
};
const INVOICE_STATE_COLORS: Record<InvoiceState, string> = {
  pending: 'orange',
  issued: 'green',
  needs_red_reversal: 'red',
};

const SETTLEMENT_STATUS_OPTIONS: Array<{ label: string; value: SettlementStatus }> = [
  { label: '待结算', value: 'pending' },
  { label: '已打款', value: 'paid' },
  { label: '已开票', value: 'invoiced' },
  { label: '已归档', value: 'archived' },
];
const SETTLEMENT_STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: '待结算',
  paid: '已打款',
  invoiced: '已开票',
  archived: '已归档',
};
const SETTLEMENT_STATUS_COLORS: Record<SettlementStatus, string> = {
  pending: 'orange',
  paid: 'blue',
  invoiced: 'green',
  archived: 'default',
};

function apiError(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { detail?: string } } };
  return e.response?.data?.detail ?? fallback;
}
const money = (v: string | null) => (v == null ? '—' : `¥${v}`);

// =========================================================================== //
// 订单发票 Tab（以订单为中心的工作台）
// =========================================================================== //
interface InvoiceFormValues {
  invoice_type: InvoiceType;
  invoice_no?: string;
  amount?: number | null;
  issued_date?: Dayjs | null;
  buyer_title?: string;
  tax_no?: string;
  notes?: string;
}

function InvoicesPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<InvoiceFormValues>();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<InvoiceOrderRow | null>(null);

  const params = { status, q: search || undefined };
  const ordersQuery = useQuery({
    queryKey: invoiceQueryKeys.orders(params),
    queryFn: async () => (await getInvoiceOrders(params)).data,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: invoiceQueryKeys.all });

  const createMutation = useMutation({
    mutationFn: (body: Parameters<typeof createInvoice>[0]) => createInvoice(body),
    onSuccess: () => {
      message.success('发票已登记');
      invalidate();
      setTarget(null);
    },
    onError: (err) => message.error(apiError(err, '登记失败')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteInvoice(id),
    onSuccess: () => { message.success('已删除发票登记'); invalidate(); },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });

  const openRegister = (row: InvoiceOrderRow, type: InvoiceType) => {
    setTarget(row);
    form.resetFields();
    form.setFieldsValue({
      invoice_type: type,
      amount: Number(type === 'red_reversal' ? row.refunded_amount : row.total_amount),
      buyer_title: row.invoice_title ?? undefined,
      tax_no: row.invoice_tax_no ?? undefined,
      issued_date: dayjs(),
    });
  };

  const submit = (v: InvoiceFormValues) => {
    if (!target) return;
    createMutation.mutate({
      order_id: target.order_id,
      invoice_type: v.invoice_type,
      invoice_no: v.invoice_no || null,
      amount: v.amount ?? null,
      issued_date: v.issued_date ? v.issued_date.format('YYYY-MM-DD') : null,
      buyer_title: v.buyer_title || null,
      tax_no: v.tax_no || null,
      notes: v.notes || null,
    });
  };

  const columns: TableColumnsType<InvoiceOrderRow> = [
    {
      title: '订单', key: 'order',
      render: (_: unknown, r) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <Text strong>{r.order_code || `#${r.order_id}`}</Text>
            {r.order_voided && <Tag>已作废</Tag>}
          </Space>
          <Text type="secondary" style={{ fontSize: 12 }}>{r.payer_name}</Text>
        </Space>
      ),
    },
    { title: '下单日', dataIndex: 'order_date', key: 'order_date', width: 110 },
    { title: '应收', dataIndex: 'total_amount', key: 'total_amount', width: 100, align: 'right', render: (v: string) => `¥${v}` },
    {
      title: '已退款', dataIndex: 'refunded_amount', key: 'refunded_amount', width: 100, align: 'right',
      render: (v: string) => (Number(v) > 0 ? <Text type="danger">¥{v}</Text> : <Text type="secondary">—</Text>),
    },
    { title: '开票抬头', dataIndex: 'invoice_title', key: 'invoice_title', render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: '已开发票', key: 'invoices',
      render: (_: unknown, r) =>
        r.invoices.length === 0 ? (
          <Text type="secondary">—</Text>
        ) : (
          <Space size={4} wrap>
            {r.invoices.map((inv) => {
              const tag = (
                <Tag color={inv.invoice_type === 'red_reversal' ? 'red' : 'blue'}>
                  {INVOICE_TYPE_LABELS[inv.invoice_type]}{inv.invoice_no ? ` ${inv.invoice_no}` : ''}
                </Tag>
              );
              return isAdmin ? (
                <Popconfirm
                  key={inv.id} title="删除该发票登记？" okText="删除" cancelText="取消"
                  okButtonProps={{ danger: true }} onConfirm={() => deleteMutation.mutate(inv.id)}
                >
                  <span style={{ cursor: 'pointer' }}>{tag}</span>
                </Popconfirm>
              ) : (
                <span key={inv.id}>{tag}</span>
              );
            })}
          </Space>
        ),
    },
    {
      title: '状态', dataIndex: 'invoice_state', key: 'invoice_state', width: 90,
      render: (v: InvoiceState) => <Tag color={INVOICE_STATE_COLORS[v]}>{INVOICE_STATE_LABELS[v]}</Tag>,
    },
    ...(isAdmin
      ? [{
          title: '操作', key: 'actions', width: 180, fixed: 'right' as const,
          render: (_: unknown, r: InvoiceOrderRow) => (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => openRegister(r, 'normal')}>登记发票</Button>
              {r.needs_red_reversal && (
                <Button type="link" size="small" danger onClick={() => openRegister(r, 'red_reversal')}>登记红冲</Button>
              )}
            </Space>
          ),
        } as TableColumnsType<InvoiceOrderRow>[number]]
      : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <Space wrap>
          <Select
            allowClear placeholder="按状态筛选" style={{ width: 150 }}
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              { label: '待开票', value: 'pending' },
              { label: '需冲红', value: 'needs_red_reversal' },
              { label: '已开票', value: 'issued' },
            ]}
          />
          <Input.Search placeholder="搜索 订单号 / 付款方" allowClear style={{ width: 220 }} onSearch={setSearch} />
          {ordersQuery.data && (
            <Text type="secondary">
              待开票 <Text strong>{ordersQuery.data.pending_count}</Text> · 需冲红{' '}
              <Text strong type={ordersQuery.data.needs_red_reversal_count > 0 ? 'danger' : undefined}>
                {ordersQuery.data.needs_red_reversal_count}
              </Text>
            </Text>
          )}
        </Space>
        <Button icon={<ReloadOutlined />} onClick={() => ordersQuery.refetch()} loading={ordersQuery.isFetching}>刷新</Button>
      </div>

      <Table<InvoiceOrderRow>
        rowKey="order_id"
        size="small"
        loading={ordersQuery.isLoading}
        columns={columns}
        dataSource={ordersQuery.data?.rows ?? []}
        pagination={false}
        scroll={{ x: 1100 }}
        locale={{ emptyText: '暂无需处理的发票（需开票订单 / 已登记发票的订单会出现在此）' }}
      />

      <Modal
        title={target ? `登记发票 · ${target.order_code || `#${target.order_id}`}（${target.payer_name}）` : ''}
        open={target !== null}
        onCancel={() => setTarget(null)}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form<InvoiceFormValues> form={form} layout="vertical" onFinish={submit}>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="invoice_type" label="发票类型" style={{ width: 140 }}>
              <Select options={[{ label: '正票', value: 'normal' }, { label: '红冲', value: 'red_reversal' }]} />
            </Form.Item>
            <Form.Item name="invoice_no" label="发票号" style={{ width: 220 }}>
              <Input placeholder="可空" />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="amount" label="金额" style={{ width: 160 }}>
              <InputNumber prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="issued_date" label="开票日期" style={{ width: 180 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="buyer_title" label="开票抬头">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="tax_no" label="税号">
            <Input />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// =========================================================================== //
// 渠道结算 Tab
// =========================================================================== //
interface SettlementFormValues {
  partner_id: number;
  period?: string;
  amount_due?: number | null;
  paid_amount?: number | null;
  paid_date?: Dayjs | null;
  on_time?: boolean;
  invoice_received?: boolean;
  invoice_no?: string;
  status: SettlementStatus;
  notes?: string;
}

function buildSettlementPayload(v: SettlementFormValues): SettlementPayload {
  return {
    partner_id: v.partner_id,
    period: v.period || null,
    amount_due: v.amount_due ?? null,
    paid_amount: v.paid_amount ?? null,
    paid_date: v.paid_date ? v.paid_date.format('YYYY-MM-DD') : null,
    on_time: v.on_time ?? null,
    invoice_received: !!v.invoice_received,
    invoice_no: v.invoice_no || null,
    status: v.status,
    notes: v.notes || null,
  };
}

function SettlementsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SettlementFormValues>();
  const [filters, setFilters] = useState<{ partner_id?: number; status?: SettlementStatus; q?: string }>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Settlement | null>(null);

  const partnersQuery = useQuery({
    queryKey: partnerQueryKeys.list(),
    queryFn: async () => (await listPartners()).data,
  });
  const partnerOptions = (partnersQuery.data ?? []).map((p) => ({ label: p.name, value: p.id }));

  const listQuery = useQuery({
    queryKey: settlementQueryKeys.list(filters),
    queryFn: async () => (await listSettlements(filters)).data,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: settlementQueryKeys.all });

  const saveMutation = useMutation({
    mutationFn: async (values: SettlementFormValues) => {
      const payload = buildSettlementPayload(values);
      return editing ? updateSettlement(editing.id, payload) : createSettlement(payload);
    },
    onSuccess: () => {
      message.success(editing ? '结算已更新' : '结算已新增');
      invalidate();
      setModalOpen(false);
      setEditing(null);
    },
    onError: (err) => message.error(apiError(err, '保存失败')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSettlement(id),
    onSuccess: () => { message.success('已删除'); invalidate(); },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });
  const uploadMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadSettlementAttachment(id, file),
    onSuccess: () => { message.success('附件已上传'); invalidate(); },
    onError: (err) => message.error(apiError(err, '上传失败')),
  });
  const delAttachMutation = useMutation({
    mutationFn: (id: number) => deleteSettlementAttachment(id),
    onSuccess: () => { message.success('附件已删除'); invalidate(); },
    onError: (err) => message.error(apiError(err, '删除附件失败')),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'pending', invoice_received: false });
    setModalOpen(true);
  };
  const openEdit = (s: Settlement) => {
    setEditing(s);
    form.resetFields();
    form.setFieldsValue({
      partner_id: s.partner_id,
      period: s.period ?? undefined,
      amount_due: s.amount_due == null ? undefined : Number(s.amount_due),
      paid_amount: s.paid_amount == null ? undefined : Number(s.paid_amount),
      paid_date: s.paid_date ? dayjs(s.paid_date) : null,
      on_time: s.on_time ?? undefined,
      invoice_received: s.invoice_received,
      invoice_no: s.invoice_no ?? undefined,
      status: s.status,
      notes: s.notes ?? undefined,
    });
    setModalOpen(true);
  };

  const columns: TableColumnsType<Settlement> = [
    { title: '合作渠道', dataIndex: 'partner_name', key: 'partner_name', render: (v) => <Text strong>{v}</Text> },
    { title: '结算周期', dataIndex: 'period', key: 'period', width: 110, render: (v) => v || <Text type="secondary">—</Text> },
    { title: '应结', dataIndex: 'amount_due', key: 'amount_due', width: 110, align: 'right', render: (v: string | null) => money(v) },
    { title: '已打款', dataIndex: 'paid_amount', key: 'paid_amount', width: 110, align: 'right', render: (v: string | null) => money(v) },
    { title: '打款日', dataIndex: 'paid_date', key: 'paid_date', width: 110, render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: '按时', dataIndex: 'on_time', key: 'on_time', width: 80,
      render: (v: boolean | null) => (v == null ? <Text type="secondary">—</Text> : v ? <Tag color="green">按时</Tag> : <Tag color="red">逾期</Tag>),
    },
    {
      title: '进项发票', key: 'invoice_received', width: 140,
      render: (_: unknown, r) =>
        r.invoice_received ? (
          <Space size={4}><Tag color="green">已开</Tag>{r.invoice_no && <Text type="secondary" style={{ fontSize: 12 }}>{r.invoice_no}</Text>}</Space>
        ) : (
          <Tag>未开</Tag>
        ),
    },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: SettlementStatus) => <Tag color={SETTLEMENT_STATUS_COLORS[v]}>{SETTLEMENT_STATUS_LABELS[v]}</Tag> },
    {
      title: '附件', key: 'attachment', width: 150,
      render: (_: unknown, r) =>
        r.has_attachment ? (
          <Space size={4}>
            <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => downloadSettlementAttachment(r)}>下载</Button>
            {isAdmin && (
              <Popconfirm title="删除附件？" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => delAttachMutation.mutate(r.id)}>
                <Button type="link" size="small" danger>删</Button>
              </Popconfirm>
            )}
          </Space>
        ) : isAdmin ? (
          <Upload
            showUploadList={false}
            accept=".pdf,.jpg,.jpeg,.png"
            beforeUpload={(file) => {
              if (file.size > MAX_ATTACHMENT_BYTES) {
                message.error('附件不能超过 20 MB');
              } else {
                uploadMutation.mutate({ id: r.id, file });
              }
              return Upload.LIST_IGNORE;
            }}
          >
            <Button type="link" size="small" icon={<UploadOutlined />}>上传</Button>
          </Upload>
        ) : (
          <Text type="secondary">无</Text>
        ),
    },
    ...(isAdmin
      ? [{
          title: '操作', key: 'actions', width: 120, fixed: 'right' as const,
          render: (_: unknown, r: Settlement) => (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
              <Popconfirm title="删除该结算记录？" description="附件一并删除。" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => deleteMutation.mutate(r.id)}>
                <Button type="link" size="small" danger>删除</Button>
              </Popconfirm>
            </Space>
          ),
        } as TableColumnsType<Settlement>[number]]
      : []),
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
        <Space wrap>
          <Select
            allowClear placeholder="按渠道筛选" style={{ width: 180 }}
            options={partnerOptions}
            value={filters.partner_id}
            onChange={(v) => setFilters((f) => ({ ...f, partner_id: v }))}
          />
          <Select
            allowClear placeholder="按状态筛选" style={{ width: 140 }}
            options={SETTLEMENT_STATUS_OPTIONS}
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          />
          <Input.Search placeholder="搜索 周期 / 进项发票号" allowClear style={{ width: 220 }} onSearch={(v) => setFilters((f) => ({ ...f, q: v || undefined }))} />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => listQuery.refetch()} loading={listQuery.isFetching}>刷新</Button>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增结算</Button>}
        </Space>
      </div>

      <Table<Settlement>
        rowKey="id"
        size="small"
        loading={listQuery.isLoading}
        columns={columns}
        dataSource={listQuery.data ?? []}
        pagination={false}
        scroll={{ x: 1200 }}
        locale={{ emptyText: '暂无结算记录（点「新增结算」按渠道按周期登记打款 / 进项发票）' }}
      />

      <Modal
        title={editing ? `编辑结算 · ${editing.partner_name}` : '新增渠道结算'}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); }}
        onOk={() => form.submit()}
        okText="保存"
        confirmLoading={saveMutation.isPending}
        width={620}
        destroyOnHidden
      >
        <Form<SettlementFormValues> form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)}>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="partner_id" label="合作渠道" rules={[{ required: true, message: '请选择合作渠道' }]} style={{ width: 240 }}>
              <Select options={partnerOptions} placeholder="选择渠道" showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="period" label="结算周期" style={{ width: 160 }}>
              <Input placeholder="如 2026-Q1 / 2026-05" />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 130 }}>
              <Select options={SETTLEMENT_STATUS_OPTIONS} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="amount_due" label="应结金额" style={{ width: 160 }}>
              <InputNumber min={0} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="paid_amount" label="已打款" style={{ width: 160 }}>
              <InputNumber min={0} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="paid_date" label="打款日" style={{ width: 160 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="on_time" label="是否按时" style={{ width: 140 }}>
              <Select allowClear options={[{ label: '按时', value: true }, { label: '逾期', value: false }]} placeholder="未填" />
            </Form.Item>
            <Form.Item name="invoice_received" label="对方已开票（进项）" valuePropName="checked">
              <Switch checkedChildren="已开" unCheckedChildren="未开" />
            </Form.Item>
            <Form.Item name="invoice_no" label="进项发票号" style={{ width: 200 }}>
              <Input placeholder="可空" />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

// =========================================================================== //
export default function FinanceManagement() {
  const { isAdmin } = useAuth();
  return (
    <div>
      <Title level={3}>财务管理</Title>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Text type="secondary">
          <Text strong>订单发票</Text>：跟踪每张订单是否已开票、退款是否需要冲红；
          <Text strong>渠道结算</Text>：登记与合作渠道的对账打款、是否按时、进项发票，并归档结算单。
          （应收 / 欠款汇总见「活动订单统计」。{isAdmin ? '可登记/编辑/上传。' : '仅管理员可编辑，您可查看与下载。'}）
        </Text>
      </Card>
      <Tabs
        items={[
          { key: 'invoices', label: '订单发票', children: <InvoicesPanel isAdmin={isAdmin} /> },
          { key: 'settlements', label: '渠道结算', children: <SettlementsPanel isAdmin={isAdmin} /> },
        ]}
      />
    </div>
  );
}
