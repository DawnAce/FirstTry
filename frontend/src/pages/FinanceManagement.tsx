import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
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
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  RollbackOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import {
  createInvoice,
  createSettlement,
  deleteInvoice,
  deleteInvoiceAttachment,
  deleteSettlement,
  deleteSettlementAttachment,
  downloadInvoiceAttachment,
  downloadSettlementAttachment,
  getInvoiceOrders,
  getInvoiceAttachment,
  invoiceQueryKeys,
  listSettlements,
  settlementQueryKeys,
  updateSettlement,
  uploadInvoiceAttachment,
  uploadSettlementAttachment,
} from '../api/finance';
import type {
  Invoice,
  InvoiceOrderRow,
  InvoiceState,
  InvoiceType,
  Settlement,
  SettlementPayload,
  SettlementStatus,
} from '../api/finance';
import { listPartners, partnerQueryKeys } from '../api/contracts';
import { useAuth } from '../contexts/AuthContext';
import PostalReceiptsPanel from './PostalReceipts';
import { PageHeader, StatusPill } from '../components/UiPrimitives';
import './FinanceManagement.css';

const { Text } = Typography;

// 与后端 MAX_ATTACHMENT_BYTES 对齐，前端先行拦截超大文件。
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const INVOICE_ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png';

const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = { normal: '正票', red_reversal: '红冲' };
const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  pending: '待开票',
  issued: '已开票',
  needs_red_reversal: '需冲红',
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

function validateInvoiceAttachment(file: File): boolean {
  const suffix = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '';
  if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(suffix)) {
    message.error('电子发票仅支持 PDF / JPG / PNG');
    return false;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    message.error('电子发票不能超过 20MB');
    return false;
  }
  return true;
}

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
  const selectedInvoiceType = Form.useWatch('invoice_type', form);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<InvoiceOrderRow | null>(null);
  const [viewing, setViewing] = useState<InvoiceOrderRow | null>(null);
  const [pendingInvoiceFile, setPendingInvoiceFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    invoice: Invoice;
    filename: string;
    url: string;
    kind: 'pdf' | 'image';
  } | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const params = { status, q: search || undefined };
  const ordersQuery = useQuery({
    queryKey: invoiceQueryKeys.orders(params),
    queryFn: async () => (await getInvoiceOrders(params)).data,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: invoiceQueryKeys.all });

  const createMutation = useMutation({
    mutationFn: async ({ body, file }: {
      body: Parameters<typeof createInvoice>[0];
      file: File | null;
    }) => {
      const invoice = (await createInvoice(body)).data;
      if (!file) return { attachmentError: null };
      try {
        await uploadInvoiceAttachment(invoice.id, file);
        return { attachmentError: null };
      } catch (attachmentError) {
        return { attachmentError };
      }
    },
    onSuccess: ({ attachmentError }) => {
      if (attachmentError) {
        message.warning(`发票已登记，但电子发票上传失败：${apiError(attachmentError, '请稍后在发票记录中补传')}`);
      } else {
        message.success(pendingInvoiceFile ? '发票和电子发票已保存' : '发票已登记');
      }
      invalidate();
      setTarget(null);
      setPendingInvoiceFile(null);
    },
    onError: (err) => message.error(apiError(err, '登记失败')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteInvoice(id),
    onSuccess: () => { message.success('已删除发票登记'); invalidate(); setViewing(null); },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });
  const replaceViewedInvoice = (updated: Invoice) => {
    setViewing((current) => current ? {
      ...current,
      invoices: current.invoices.map((invoice) => invoice.id === updated.id ? updated : invoice),
    } : current);
  };
  const attachmentUploadMutation = useMutation({
    mutationFn: ({ invoice, file }: { invoice: Invoice; file: File }) =>
      uploadInvoiceAttachment(invoice.id, file),
    onSuccess: (response) => {
      replaceViewedInvoice(response.data);
      invalidate();
      message.success('电子发票已保存');
    },
    onError: (err) => message.error(apiError(err, '电子发票上传失败')),
  });
  const attachmentDeleteMutation = useMutation({
    mutationFn: (invoice: Invoice) => deleteInvoiceAttachment(invoice.id),
    onSuccess: (response) => {
      replaceViewedInvoice(response.data);
      invalidate();
      message.success('电子发票附件已删除');
    },
    onError: (err) => message.error(apiError(err, '删除电子发票失败')),
  });
  const attachmentPreviewMutation = useMutation({
    mutationFn: async (invoice: Invoice) => ({ invoice, blob: (await getInvoiceAttachment(invoice.id)).data }),
    onSuccess: ({ invoice, blob }) => {
      const filename = invoice.attachment_filename ?? `invoice-${invoice.id}`;
      const kind = filename.toLowerCase().endsWith('.pdf') || blob.type === 'application/pdf' ? 'pdf' : 'image';
      setPreview({ invoice, filename, url: URL.createObjectURL(blob), kind });
    },
    onError: (err) => message.error(apiError(err, '电子发票预览失败')),
  });
  const attachmentDownloadMutation = useMutation({
    mutationFn: (invoice: Invoice) => downloadInvoiceAttachment(invoice),
    onError: (err) => message.error(apiError(err, '电子发票下载失败')),
  });

  const openRegister = (row: InvoiceOrderRow, type: InvoiceType) => {
    setTarget(row);
    setPendingInvoiceFile(null);
    form.resetFields();
    form.setFieldsValue({
      invoice_type: type,
      amount: Number(type === 'red_reversal' ? row.refunded_amount : row.remaining_invoice_amount),
      buyer_title: row.invoice_title ?? undefined,
      tax_no: row.invoice_tax_no ?? undefined,
      issued_date: dayjs(),
    });
  };

  const submit = (v: InvoiceFormValues) => {
    if (!target) return;
    createMutation.mutate({
      file: pendingInvoiceFile,
      body: {
        order_id: target.order_id,
        invoice_type: v.invoice_type,
        invoice_no: v.invoice_no || null,
        amount: v.amount ?? null,
        issued_date: v.issued_date ? v.issued_date.format('YYYY-MM-DD') : null,
        buyer_title: v.buyer_title || null,
        tax_no: v.tax_no || null,
        notes: v.notes || null,
      },
    });
  };

  const uploadRecordAttachment = (invoice: Invoice, file: File) => {
    if (validateInvoiceAttachment(file)) {
      attachmentUploadMutation.mutate({ invoice, file });
    }
    return Upload.LIST_IGNORE;
  };

  const columns: TableColumnsType<InvoiceOrderRow> = [
    {
      title: '订单 / 付款方', key: 'order', width: 185,
      render: (_: unknown, r) => (
        <Space orientation="vertical" size={0}>
          <Space size={4}>
            <Text strong className="finance-order-code">{r.order_code || `#${r.order_id}`}</Text>
            {r.order_voided && <Tag>已作废</Tag>}
          </Space>
          <Text type="secondary" className="finance-cell-secondary">{r.payer_name}</Text>
        </Space>
      ),
    },
    { title: '下单日', dataIndex: 'order_date', key: 'order_date', width: 110 },
    {
      title: '应开金额', key: 'amount', width: 120,
      render: (_: unknown, r) => (
        <Space orientation="vertical" size={0}>
          <Text strong>¥{r.total_amount}</Text>
          <Text type={Number(r.refunded_amount) > 0 ? 'danger' : 'secondary'} className="finance-cell-secondary">
            已退款 ¥{r.refunded_amount}
          </Text>
        </Space>
      ),
    },
    {
      title: '开票进度', key: 'invoice_progress', width: 185,
      render: (_: unknown, r) => (
        <div className="finance-invoice-progress">
          <div className="finance-invoice-progress-copy">
            <Text>已开 ¥{r.normal_invoiced_amount}</Text>
            <Text type="secondary">{Math.min(100, Math.round(Number(r.normal_invoiced_amount) / Math.max(Number(r.total_amount), 0.01) * 100))}%</Text>
          </div>
          <Progress
            percent={Math.min(100, Number(r.normal_invoiced_amount) / Math.max(Number(r.total_amount), 0.01) * 100)}
            showInfo={false}
            size="small"
            status={Number(r.normal_invoiced_amount) > Number(r.total_amount) ? 'exception' : 'normal'}
          />
          <Text type={Number(r.remaining_invoice_amount) > 0 ? 'warning' : 'secondary'} className="finance-cell-secondary">
            待开 ¥{r.remaining_invoice_amount}
          </Text>
        </div>
      ),
    },
    {
      title: '开票信息', key: 'invoice_info',
      render: (_: unknown, r) => (
        <Space orientation="vertical" size={2} className="finance-invoice-info">
          <Text>{r.invoice_title || '未填写开票抬头'}</Text>
          <Text type="secondary" className="finance-cell-secondary">{r.invoice_recipient_email || '未填写接收邮箱'}</Text>
          {r.invoices.length > 0 && (
            <Space size={4} wrap>
              {r.invoices.map((inv) => (
                <Tag key={inv.id} color={inv.invoice_type === 'red_reversal' ? 'red' : 'blue'}>
                  {INVOICE_TYPE_LABELS[inv.invoice_type]}{inv.invoice_no ? ` ${inv.invoice_no}` : ''}
                </Tag>
              ))}
            </Space>
          )}
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'invoice_state', key: 'invoice_state', width: 105,
      render: (v: InvoiceState) => (
        <StatusPill tone={v === 'issued' ? 'success' : v === 'needs_red_reversal' ? 'danger' : 'warning'}>
          {INVOICE_STATE_LABELS[v]}
        </StatusPill>
      ),
    },
    {
      title: '操作', key: 'actions', width: isAdmin ? 205 : 105, fixed: 'right' as const,
      render: (_: unknown, r: InvoiceOrderRow) => (
        <Space size={4}>
          {isAdmin && Number(r.remaining_invoice_amount) > 0 && (
                <Button type="link" size="small" onClick={() => openRegister(r, 'normal')}>
                  {Number(r.normal_invoiced_amount) > 0 ? '继续开票' : '登记发票'}
                </Button>
          )}
          {isAdmin && r.needs_red_reversal && (
            <Button type="link" size="small" danger onClick={() => openRegister(r, 'red_reversal')}>登记红冲</Button>
          )}
          {r.invoices.length > 0 && (
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => setViewing(r)}>查看记录</Button>
          )}
          {!isAdmin && r.invoices.length === 0 && <Text type="secondary">—</Text>}
        </Space>
      ),
    },
  ];

  return (
    <div className="finance-invoice-panel">
      <section className="finance-overview" aria-label="发票概览">
        <div className="finance-overview-item finance-overview-item-info">
          <span className="finance-overview-icon"><FileTextOutlined /></span>
          <div><Text type="secondary">待开票</Text><strong>{ordersQuery.data?.pending_count ?? 0}</strong></div>
        </div>
        <div className="finance-overview-item finance-overview-item-warning">
          <span className="finance-overview-icon"><RollbackOutlined /></span>
          <div><Text type="secondary">需冲红</Text><strong>{ordersQuery.data?.needs_red_reversal_count ?? 0}</strong></div>
        </div>
        <div className="finance-overview-item finance-overview-item-success">
          <span className="finance-overview-icon"><CheckCircleOutlined /></span>
          <div><Text type="secondary">已开票订单</Text><strong>{ordersQuery.data?.issued_count ?? 0}</strong></div>
        </div>
      </section>

      <div className="finance-context-banner">
        <InfoCircleOutlined />
        <Text><Text strong>开票规则：</Text>支持分次开票，累计金额达到订单应开金额后自动完成；退款订单单独提示冲红。</Text>
      </div>

      <div className="finance-toolbar">
        <div className="finance-toolbar-filters">
          <Select
            allowClear placeholder="全部状态" className="finance-filter-status"
            value={status}
            onChange={(v) => setStatus(v)}
            options={[
              { label: '待开票', value: 'pending' },
              { label: '需冲红', value: 'needs_red_reversal' },
              { label: '已开票', value: 'issued' },
            ]}
          />
          <Input.Search placeholder="搜索订单号 / 付款方" allowClear className="finance-filter-search" onSearch={setSearch} />
          <Text type="secondary">共 {ordersQuery.data?.total ?? 0} 条订单</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => ordersQuery.refetch()} loading={ordersQuery.isFetching}>刷新</Button>
      </div>

      <Table<InvoiceOrderRow>
        className="finance-data-table"
        rowKey="order_id"
        size="small"
        loading={ordersQuery.isLoading}
        columns={columns}
        dataSource={ordersQuery.data?.rows ?? []}
        pagination={false}
        scroll={{ x: 1120 }}
        locale={{ emptyText: '暂无需处理的发票（需开票订单 / 已登记发票的订单会出现在此）' }}
      />

      <Modal
        className="finance-form-modal"
        title={target ? `登记发票 · ${target.order_code || `#${target.order_id}`}（${target.payer_name}）` : ''}
        open={target !== null}
        onCancel={() => { setTarget(null); setPendingInvoiceFile(null); }}
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
            <Form.Item
              name="amount"
              label="开票金额"
              style={{ width: 160 }}
              rules={[{ required: true, message: '请输入开票金额' }]}
              extra={selectedInvoiceType === 'normal' && target
                ? `本次最多可开 ¥${target.remaining_invoice_amount}`
                : undefined}
            >
              <InputNumber
                prefix="¥"
                min={0.01}
                max={selectedInvoiceType === 'normal' && target
                  ? Number(target.remaining_invoice_amount)
                  : undefined}
                precision={2}
                style={{ width: '100%' }}
              />
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
          <Form.Item label="发票接收邮箱">
            <Input
              value={target?.invoice_recipient_email ?? ''}
              placeholder="订单中未填写发票接收邮箱"
              readOnly
            />
          </Form.Item>
          <Form.Item
            label="电子发票（选填）"
            extra="支持 PDF、JPG、PNG，最大 20MB；不上传也可以正常保存，之后可在发票记录中补传。"
          >
            <Upload
              accept={INVOICE_ATTACHMENT_ACCEPT}
              maxCount={1}
              beforeUpload={(file) => {
                if (!validateInvoiceAttachment(file)) return Upload.LIST_IGNORE;
                setPendingInvoiceFile(file);
                return false;
              }}
              onRemove={() => { setPendingInvoiceFile(null); }}
              fileList={pendingInvoiceFile ? [{
                uid: 'invoice-attachment',
                name: pendingInvoiceFile.name,
                status: 'done',
              } as UploadFile] : []}
            >
              <Button icon={<UploadOutlined />}>选择电子发票</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={viewing ? `发票记录 · ${viewing.order_code || `#${viewing.order_id}`}（${viewing.payer_name}）` : '发票记录'}
        open={viewing !== null}
        onCancel={() => setViewing(null)}
        footer={<Button onClick={() => setViewing(null)}>关闭</Button>}
        width={760}
        destroyOnHidden
      >
        <div className="finance-record-summary">
          <div><Text type="secondary">订单应开</Text><strong>¥{viewing?.total_amount ?? '0.00'}</strong></div>
          <div><Text type="secondary">累计已开</Text><strong>¥{viewing?.normal_invoiced_amount ?? '0.00'}</strong></div>
          <div><Text type="secondary">剩余待开</Text><strong>¥{viewing?.remaining_invoice_amount ?? '0.00'}</strong></div>
        </div>
        <div className="finance-record-list">
          {viewing?.invoices.map((inv) => (
            <div className="finance-record-item" key={inv.id}>
              <Tag color={inv.invoice_type === 'red_reversal' ? 'red' : 'blue'}>{INVOICE_TYPE_LABELS[inv.invoice_type]}</Tag>
              <div className="finance-record-main">
                <Text strong>{inv.amount == null ? '金额未填写' : `¥${inv.amount}`}</Text>
                <Text type="secondary">
                  {inv.invoice_no ? `发票号 ${inv.invoice_no}` : '未填写发票号'} · {inv.issued_date || '未填写开票日期'}
                </Text>
                <div className="finance-record-attachment">
                  {inv.has_attachment ? (
                    <>
                      <span className="finance-record-file">
                        <FileTextOutlined />
                        <Text ellipsis={{ tooltip: inv.attachment_filename }}>
                          {inv.attachment_filename || '电子发票'}
                        </Text>
                      </span>
                      <Space size={0} wrap>
                        <Button
                          type="link"
                          size="small"
                          icon={<EyeOutlined />}
                          loading={attachmentPreviewMutation.isPending && attachmentPreviewMutation.variables?.id === inv.id}
                          onClick={() => attachmentPreviewMutation.mutate(inv)}
                        >预览</Button>
                        <Button
                          type="link"
                          size="small"
                          icon={<DownloadOutlined />}
                          loading={attachmentDownloadMutation.isPending && attachmentDownloadMutation.variables?.id === inv.id}
                          onClick={() => attachmentDownloadMutation.mutate(inv)}
                        >下载</Button>
                        {isAdmin && (
                          <Upload
                            accept={INVOICE_ATTACHMENT_ACCEPT}
                            showUploadList={false}
                            beforeUpload={(file) => uploadRecordAttachment(inv, file)}
                          >
                            <Button
                              type="link"
                              size="small"
                              icon={<UploadOutlined />}
                              loading={attachmentUploadMutation.isPending && attachmentUploadMutation.variables?.invoice.id === inv.id}
                            >替换</Button>
                          </Upload>
                        )}
                        {isAdmin && (
                          <Popconfirm
                            title="删除电子发票附件？"
                            description="只删除文件，不会删除这条开票记录。"
                            okText="删除附件"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => attachmentDeleteMutation.mutate(inv)}
                          >
                            <Button
                              type="link"
                              size="small"
                              danger
                              loading={attachmentDeleteMutation.isPending && attachmentDeleteMutation.variables?.id === inv.id}
                            >删除附件</Button>
                          </Popconfirm>
                        )}
                      </Space>
                    </>
                  ) : (
                    <>
                      <Text type="secondary" className="finance-record-no-file">未上传电子发票</Text>
                      {isAdmin && (
                        <Upload
                          accept={INVOICE_ATTACHMENT_ACCEPT}
                          showUploadList={false}
                          beforeUpload={(file) => uploadRecordAttachment(inv, file)}
                        >
                          <Button
                            type="link"
                            size="small"
                            icon={<UploadOutlined />}
                            loading={attachmentUploadMutation.isPending && attachmentUploadMutation.variables?.invoice.id === inv.id}
                          >补传</Button>
                        </Upload>
                      )}
                    </>
                  )}
                </div>
              </div>
              {isAdmin && (
                <Popconfirm
                  title="删除该发票登记？"
                  description="删除后会重新计算订单开票进度。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => deleteMutation.mutate(inv.id)}
                >
                  <Button className="finance-record-delete" danger type="text" icon={<DeleteOutlined />} loading={deleteMutation.isPending}>删除记录</Button>
                </Popconfirm>
              )}
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title={preview ? `电子发票预览 · ${preview.filename}` : '电子发票预览'}
        open={preview !== null}
        onCancel={() => setPreview(null)}
        width={920}
        destroyOnHidden
        footer={preview ? (
          <Space>
            <Button
              icon={<DownloadOutlined />}
              loading={attachmentDownloadMutation.isPending}
              onClick={() => attachmentDownloadMutation.mutate(preview.invoice)}
            >下载保存</Button>
            <Button type="primary" onClick={() => setPreview(null)}>关闭</Button>
          </Space>
        ) : null}
      >
        <div className="finance-invoice-preview">
          {preview?.kind === 'pdf' ? (
            <iframe src={preview.url} title={preview.filename} />
          ) : preview ? (
            <img src={preview.url} alt={preview.filename} />
          ) : null}
        </div>
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
    <div className="finance-settlement-panel">
      <div className="finance-context-banner">
        <InfoCircleOutlined />
        <Text><Text strong>结算归档：</Text>按合作渠道和结算周期登记打款、进项发票与附件，形成完整对账记录。</Text>
      </div>
      <div className="finance-toolbar">
        <div className="finance-toolbar-filters">
          <Select
            allowClear placeholder="按渠道筛选" className="finance-filter-partner"
            options={partnerOptions}
            value={filters.partner_id}
            onChange={(v) => setFilters((f) => ({ ...f, partner_id: v }))}
          />
          <Select
            allowClear placeholder="按状态筛选" className="finance-filter-status"
            options={SETTLEMENT_STATUS_OPTIONS}
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          />
          <Input.Search placeholder="搜索周期 / 进项发票号" allowClear className="finance-filter-search" onSearch={(v) => setFilters((f) => ({ ...f, q: v || undefined }))} />
          <Text type="secondary">共 {listQuery.data?.length ?? 0} 条记录</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => listQuery.refetch()} loading={listQuery.isFetching}>刷新</Button>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增结算</Button>}
        </Space>
      </div>

      <Table<Settlement>
        className="finance-data-table"
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
    <div className="finance-page">
      <PageHeader
        title="财务工作台"
        description="集中处理订单发票、渠道结算与邮局回款"
        actions={<Text type="secondary">{isAdmin ? '管理员 · 可登记与维护' : '只读模式'}</Text>}
      />
      <section className="finance-workspace">
        <Tabs
          className="finance-workspace-tabs"
          items={[
            { key: 'invoices', label: '订单发票', children: <InvoicesPanel isAdmin={isAdmin} /> },
            { key: 'settlements', label: '渠道结算', children: <SettlementsPanel isAdmin={isAdmin} /> },
            { key: 'postal-receipts', label: '邮局收款', children: <PostalReceiptsPanel /> },
          ]}
        />
      </section>
    </div>
  );
}
