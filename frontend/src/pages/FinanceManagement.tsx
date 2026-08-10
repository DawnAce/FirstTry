import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Alert,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  BankOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  PaperClipOutlined,
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
  createSettlementWithAttachments,
  deleteInvoice,
  deleteInvoiceAttachment,
  deleteSettlement,
  deleteSettlementAttachment,
  downloadInvoiceAttachment,
  downloadSettlementAttachment,
  getInvoiceOrders,
  getInvoiceAttachment,
  getSettlementHistory,
  invoiceQueryKeys,
  listSettlements,
  previewSettlementExcel,
  registerSettlementInvoice,
  registerSettlementPayment,
  settlementQueryKeys,
  updateSettlement,
  updateSettlementAttachment,
  uploadInvoiceAttachment,
  uploadSettlementAttachment,
} from '../api/finance';
import type {
  Invoice,
  InvoiceOrderRow,
  InvoiceState,
  InvoiceType,
  Settlement,
  SettlementAttachmentCategory,
  SettlementDirection,
  SettlementInvoiceStatus,
  SettlementListParams,
  SettlementPartyType,
  SettlementPaymentStatus,
  SettlementPayload,
  SettlementStatus,
  SettlementType,
  SettlementExcelPreview,
  SettlementHistory,
  SettlementInvoiceRegisterPayload,
  SettlementPaymentRegisterPayload,
} from '../api/finance';
import { contractQueryKeys, listContracts, listPartners, partnerQueryKeys } from '../api/contracts';
import { useAuth } from '../contexts/AuthContext';
import PostalReceiptsPanel from './PostalReceipts';
import { PageHeader, StatusPill } from '../components/UiPrimitives';
import './FinanceManagement.css';

const { Text } = Typography;
const { RangePicker } = DatePicker;

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
  { label: '已结款', value: 'paid' },
  { label: '已开票', value: 'invoiced' },
  { label: '已归档', value: 'archived' },
];
const SETTLEMENT_DIRECTION_OPTIONS: Array<{ label: string; value: SettlementDirection }> = [
  { label: '应收', value: 'receivable' },
  { label: '应付', value: 'payable' },
];
const SETTLEMENT_DIRECTION_LABELS: Record<SettlementDirection, string> = {
  receivable: '应收',
  payable: '应付',
};
const SETTLEMENT_PARTY_TYPE_OPTIONS: Array<{ label: string; value: SettlementPartyType }> = [
  { label: '渠道', value: 'channel' },
  { label: '个人', value: 'individual' },
];
const SETTLEMENT_PARTY_TYPE_LABELS: Record<SettlementPartyType, string> = {
  channel: '渠道',
  individual: '个人',
};
const SETTLEMENT_TYPE_OPTIONS: Array<{ label: string; value: SettlementType }> = [
  { label: '代销', value: 'consignment' },
  { label: '包销', value: 'buyout' },
];
const SETTLEMENT_TYPE_LABELS: Record<SettlementType, string> = {
  consignment: '代销',
  buyout: '包销',
};
const SETTLEMENT_INVOICE_STATUS_LABELS: Record<SettlementInvoiceStatus, string> = {
  unissued: '未开票',
  issued: '已开票',
};
const SETTLEMENT_PAYMENT_STATUS_LABELS: Record<SettlementPaymentStatus, string> = {
  unpaid: '未收付',
  partial: '部分收付',
  paid: '已收付',
};
const ATTACHMENT_CATEGORY_OPTIONS: Array<{ label: string; value: SettlementAttachmentCategory }> = [
  { label: '结算单', value: 'settlement_sheet' },
  { label: '开票申请', value: 'invoice_application' },
  { label: '发票', value: 'invoice' },
  { label: '其他凭证', value: 'other' },
];
const ATTACHMENT_CATEGORY_LABELS: Record<SettlementAttachmentCategory, string> = {
  settlement_sheet: '结算单',
  invoice_application: '开票申请',
  invoice: '发票',
  other: '其他',
};

function apiError(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { detail?: string } } };
  return e.response?.data?.detail ?? fallback;
}
const money = (v: string | null) => (v == null ? '—' : `¥${v}`);

function validateInvoiceAttachment(file: File, label = '电子发票'): boolean {
  const suffix = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '';
  if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(suffix)) {
    message.error(`${label}仅支持 PDF / JPG / PNG`);
    return false;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    message.error(`${label}不能超过 20MB`);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<InvoiceFormValues>();
  const selectedInvoiceType = Form.useWatch('invoice_type', form);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<InvoiceOrderRow | null>(null);
  const [viewingOverride, setViewing] = useState<InvoiceOrderRow | null>(null);
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
  const requestedOrderId = Number(searchParams.get('invoice_order_id')) || null;
  const deepLinkedViewing = requestedOrderId == null
    ? null
    : ordersQuery.data?.rows.find((row) => row.order_id === requestedOrderId && row.invoices.length > 0) ?? null;
  const viewing = viewingOverride ?? deepLinkedViewing;

  const openInvoiceRecords = (row: InvoiceOrderRow) => {
    const next = new URLSearchParams(searchParams);
    next.set('invoice_order_id', String(row.order_id));
    setSearchParams(next, { replace: true });
    setViewing(row);
  };

  const closeInvoiceRecords = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('invoice_order_id');
    setSearchParams(next, { replace: true });
    setViewing(null);
  };

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
    onSuccess: () => { message.success('已删除发票登记'); invalidate(); closeInvoiceRecords(); },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });
  const replaceViewedInvoice = (updated: Invoice) => {
    setViewing((current) => {
      const source = current ?? viewing;
      return source ? {
        ...source,
        invoices: source.invoices.map((invoice) => invoice.id === updated.id ? updated : invoice),
      } : current;
    });
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
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openInvoiceRecords(r)}>查看记录</Button>
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
        onCancel={closeInvoiceRecords}
        footer={<Button onClick={closeInvoiceRecords}>关闭</Button>}
        width={1000}
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
  contract_id?: number;
  direction: SettlementDirection;
  party_type: SettlementPartyType;
  settlement_type?: SettlementType;
  external_no?: string;
  settlement_period?: [Dayjs, Dayjs];
  return_period?: [Dayjs, Dayjs];
  gross_amount?: number | null;
  return_deduction_amount?: number | null;
  amount_due?: number | null;
  notes?: string;
}

function buildSettlementPayload(v: SettlementFormValues): SettlementPayload {
  return {
    partner_id: v.partner_id,
    contract_id: v.contract_id ?? null,
    direction: v.direction,
    party_type: v.party_type,
    settlement_type: v.settlement_type ?? null,
    external_no: v.external_no || null,
    period: null,
    settlement_start_date: v.settlement_period?.[0].format('YYYY-MM-DD') ?? null,
    settlement_end_date: v.settlement_period?.[1].format('YYYY-MM-DD') ?? null,
    return_start_date: v.return_period?.[0].format('YYYY-MM-DD') ?? null,
    return_end_date: v.return_period?.[1].format('YYYY-MM-DD') ?? null,
    gross_amount: v.gross_amount ?? null,
    return_deduction_amount: v.return_deduction_amount ?? 0,
    amount_due: v.amount_due ?? null,
    notes: v.notes || null,
  };
}

interface PendingSettlementAttachment {
  uid: string;
  category: SettlementAttachmentCategory;
  file: File;
  isPrimary: boolean;
  previewState: 'idle' | 'loading' | 'success' | 'error';
  preview?: SettlementExcelPreview;
  previewError?: string;
  appliedFields?: string[];
  preservedFields?: string[];
}

type RecognizedSettlementField =
  | 'external_no'
  | 'settlement_period'
  | 'return_period'
  | 'gross_amount'
  | 'return_deduction_amount';

const RECOGNIZED_SETTLEMENT_FIELD_LABELS: Record<RecognizedSettlementField, string> = {
  external_no: '外部平台单号',
  settlement_period: '结算周期',
  return_period: '退报周期',
  gross_amount: '报款/结算总额',
  return_deduction_amount: '退报扣款',
};

interface SettlementInvoiceFormValues {
  invoice_no?: string;
  invoice_date: Dayjs;
  invoice_title?: string;
  invoice_tax_no?: string;
  invoice_type?: string;
  invoice_item_name?: string;
  invoice_amount?: number;
  notes?: string;
}

interface SettlementPaymentFormValues {
  amount: number;
  paid_date: Dayjs;
  on_time?: boolean;
  notes?: string;
}

function SettlementsPanel({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SettlementFormValues>();
  const [invoiceForm] = Form.useForm<SettlementInvoiceFormValues>();
  const [paymentForm] = Form.useForm<SettlementPaymentFormValues>();
  const [filters, setFilters] = useState<SettlementListParams>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingSettlementAttachment[]>([]);
  const [detail, setDetail] = useState<Settlement | null>(null);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [pendingInvoiceFile, setPendingInvoiceFile] = useState<File | null>(null);
  const [pendingPaymentFile, setPendingPaymentFile] = useState<File | null>(null);
  const recognitionFilledFields = useRef(new Set<RecognizedSettlementField>());
  const selectedPartnerId = Form.useWatch('partner_id', form);
  const selectedDirection = Form.useWatch('direction', form) ?? 'payable';

  const partnersQuery = useQuery({
    queryKey: partnerQueryKeys.list(),
    queryFn: async () => (await listPartners()).data,
    retry: false,
  });
  const partnerOptions = (partnersQuery.data ?? []).map((p) => ({ label: p.name, value: p.id }));
  const selectedPartner = (partnersQuery.data ?? []).find((p) => p.id === selectedPartnerId);
  const contractsQuery = useQuery({
    queryKey: contractQueryKeys.list({ partner_id: selectedPartnerId }),
    queryFn: async () => (await listContracts({ partner_id: selectedPartnerId })).data,
    enabled: !!selectedPartnerId,
  });
  const contractOptions = (contractsQuery.data ?? []).map((c) => ({
    label: `${c.contract_no ? `${c.contract_no} · ` : ''}${c.title}`,
    value: c.id,
  }));

  const listQuery = useQuery({
    queryKey: settlementQueryKeys.list(filters),
    queryFn: async () => (await listSettlements(filters)).data,
  });
  const historyQuery = useQuery({
    queryKey: ['settlements', detail?.id, 'history'],
    queryFn: async () => (await getSettlementHistory(detail!.id)).data,
    enabled: !!detail,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: settlementQueryKeys.all });
  const invalidateHistory = (id: number) => queryClient.invalidateQueries({ queryKey: ['settlements', id, 'history'] });

  const saveMutation = useMutation({
    mutationFn: async (values: SettlementFormValues) => {
      const payload = buildSettlementPayload(values);
      if (editing) return updateSettlement(editing.id, payload);
      if (pendingAttachments.length) {
        return createSettlementWithAttachments(payload, pendingAttachments);
      }
      return createSettlement(payload);
    },
    onSuccess: (response) => {
      message.success(editing ? '结算已更新' : '结算已新增');
      invalidate();
      if (detail?.id === response.data.id) setDetail(response.data);
      setModalOpen(false);
      setEditing(null);
      setPendingAttachments([]);
    },
    onError: (err) => message.error(apiError(err, '保存失败')),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteSettlement(id),
    onSuccess: () => { message.success('已删除'); invalidate(); },
    onError: (err) => message.error(apiError(err, '删除失败')),
  });
  const uploadMutation = useMutation({
    mutationFn: ({ id, category, file, isPrimary = false }: { id: number; category: SettlementAttachmentCategory; file: File; isPrimary?: boolean }) =>
      uploadSettlementAttachment(id, category, file, isPrimary),
    onSuccess: (response) => { message.success('附件已上传'); setDetail(response.data); invalidate(); invalidateHistory(response.data.id); },
    onError: (err) => message.error(apiError(err, '上传失败')),
  });
  const delAttachMutation = useMutation({
    mutationFn: ({ id, attachmentId }: { id: number; attachmentId: number }) =>
      deleteSettlementAttachment(id, attachmentId),
    onSuccess: (response) => { message.success('附件已删除'); setDetail(response.data); invalidate(); invalidateHistory(response.data.id); },
    onError: (err) => message.error(apiError(err, '删除附件失败')),
  });
  const updateAttachMutation = useMutation({
    mutationFn: ({ id, attachmentId, category, isPrimary }: { id: number; attachmentId: number; category?: SettlementAttachmentCategory; isPrimary?: boolean }) =>
      updateSettlementAttachment(id, attachmentId, { category, is_primary: isPrimary }),
    onSuccess: (response) => { message.success('附件设置已更新'); setDetail(response.data); invalidate(); invalidateHistory(response.data.id); },
    onError: (err) => message.error(apiError(err, '更新附件失败')),
  });

  const applySettlementPreview = (preview: SettlementExcelPreview) => {
    if (!preview.recognized) return { appliedFields: [], preservedFields: [] };
    const recognizedValues: Partial<Record<RecognizedSettlementField, SettlementFormValues[RecognizedSettlementField]>> = {
      external_no: preview.external_no ?? undefined,
      settlement_period: preview.settlement_start_date && preview.settlement_end_date
        ? [dayjs(preview.settlement_start_date), dayjs(preview.settlement_end_date)]
        : undefined,
      return_period: preview.return_start_date && preview.return_end_date
        ? [dayjs(preview.return_start_date), dayjs(preview.return_end_date)]
        : undefined,
      gross_amount: preview.gross_amount == null ? undefined : Number(preview.gross_amount),
      return_deduction_amount: Number(preview.return_deduction_amount ?? 0),
    };
    const currentValues = form.getFieldsValue();
    const patch: Partial<SettlementFormValues> = {};
    const appliedFields: string[] = [];
    const preservedFields: string[] = [];

    (Object.entries(recognizedValues) as Array<[RecognizedSettlementField, SettlementFormValues[RecognizedSettlementField]]>)
      .forEach(([field, value]) => {
        if (value == null) return;
        const currentValue = currentValues[field];
        const isEmpty = currentValue == null || currentValue === '';
        const isUntouchedDefault = field === 'return_deduction_amount'
          && currentValue === 0
          && !form.isFieldTouched(field);
        if (isEmpty || isUntouchedDefault || recognitionFilledFields.current.has(field)) {
          Object.assign(patch, { [field]: value });
          recognitionFilledFields.current.add(field);
          appliedFields.push(RECOGNIZED_SETTLEMENT_FIELD_LABELS[field]);
        } else {
          preservedFields.push(RECOGNIZED_SETTLEMENT_FIELD_LABELS[field]);
        }
      });

    const resultingGross = patch.gross_amount ?? currentValues.gross_amount;
    const resultingReturn = patch.return_deduction_amount ?? currentValues.return_deduction_amount ?? 0;
    if (resultingGross != null) patch.amount_due = Number(resultingGross) - Number(resultingReturn);
    form.setFieldsValue(patch);
    return { appliedFields, preservedFields };
  };
  const previewMutation = useMutation({
    mutationFn: ({ file }: { uid: string; file: File; apply: boolean }) => previewSettlementExcel(file),
    onSuccess: (response, variables) => {
      const preview = response.data;
      const applyResult = variables.apply
        ? applySettlementPreview(preview)
        : { appliedFields: [], preservedFields: [] };
      setPendingAttachments((items) => items.map((item) => item.uid === variables.uid
        ? {
          ...item,
          preview,
          previewState: preview.recognized ? 'success' : 'error',
          previewError: preview.warnings.join('；'),
          ...applyResult,
        }
        : item));
    },
    onError: (err, variables) => setPendingAttachments((items) => items.map((item) => item.uid === variables.uid
      ? { ...item, previewState: 'error', previewError: apiError(err, '表格识别失败，文件仍可保存') }
      : item)),
  });

  const invoiceMutation = useMutation({
    mutationFn: async (values: SettlementInvoiceFormValues) => {
      if (!detail || !pendingInvoiceFile) throw new Error('请上传发票文件');
      await uploadSettlementAttachment(detail.id, 'invoice', pendingInvoiceFile);
      const payload: SettlementInvoiceRegisterPayload = {
        invoice_no: values.invoice_no || null,
        invoice_date: values.invoice_date.format('YYYY-MM-DD'),
        invoice_title: values.invoice_title || null,
        invoice_tax_no: values.invoice_tax_no || null,
        invoice_type: values.invoice_type || null,
        invoice_item_name: values.invoice_item_name || null,
        invoice_amount: values.invoice_amount ?? null,
        notes: values.notes || null,
      };
      return registerSettlementInvoice(detail.id, payload);
    },
    onSuccess: (response) => {
      message.success('发票已登记并留存'); setDetail(response.data); setInvoiceModalOpen(false);
      setPendingInvoiceFile(null); invalidate(); historyQuery.refetch();
    },
    onError: (err) => message.error(apiError(err, err instanceof Error ? err.message : '发票登记失败')),
  });
  const paymentMutation = useMutation({
    mutationFn: async (values: SettlementPaymentFormValues) => {
      if (!detail) throw new Error('未选择结算单');
      const payload: SettlementPaymentRegisterPayload = {
        amount: values.amount,
        paid_date: values.paid_date.format('YYYY-MM-DD'),
        on_time: values.on_time ?? null,
        notes: values.notes || null,
      };
      if (pendingPaymentFile) await uploadSettlementAttachment(detail.id, 'other', pendingPaymentFile);
      return registerSettlementPayment(detail.id, payload);
    },
    onSuccess: (response) => {
      message.success(detail?.direction === 'receivable' ? '收款已登记' : '付款已登记');
      setDetail(response.data); setPaymentModalOpen(false); setPendingPaymentFile(null);
      invalidate(); historyQuery.refetch();
    },
    onError: (err) => message.error(apiError(err, err instanceof Error ? err.message : '收付款登记失败')),
  });

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      direction: 'payable',
      party_type: 'channel',
      return_deduction_amount: 0,
    });
    setPendingAttachments([]);
    recognitionFilledFields.current.clear();
    setModalOpen(true);
  };
  const openEdit = (s: Settlement) => {
    setEditing(s);
    form.resetFields();
    form.setFieldsValue({
      partner_id: s.partner_id,
      contract_id: s.contract_id ?? undefined,
      direction: s.direction,
      party_type: s.party_type,
      settlement_type: s.settlement_type ?? undefined,
      external_no: s.external_no ?? s.settlement_no ?? undefined,
      settlement_period: s.settlement_start_date && s.settlement_end_date
        ? [dayjs(s.settlement_start_date), dayjs(s.settlement_end_date)]
        : undefined,
      return_period: s.return_start_date && s.return_end_date
        ? [dayjs(s.return_start_date), dayjs(s.return_end_date)]
        : undefined,
      gross_amount: s.gross_amount == null ? undefined : Number(s.gross_amount),
      return_deduction_amount: Number(s.return_deduction_amount ?? 0),
      amount_due: s.amount_due == null ? undefined : Number(s.amount_due),
      notes: s.notes ?? undefined,
    });
    setPendingAttachments([]);
    recognitionFilledFields.current.clear();
    setModalOpen(true);
  };

  const formatPeriod = (start: string | null, end: string | null, legacy?: string | null) => {
    if (!start || !end) return legacy || <Text type="secondary">—</Text>;
    return start === end ? start : `${start} ～ ${end}`;
  };

  const handlePartnerChange = () => {
    form.setFieldsValue({
      contract_id: undefined,
      settlement_type: undefined,
    });
  };

  const syncCalculatedAmounts = (_changed: Partial<SettlementFormValues>, all: SettlementFormValues) => {
    const patch: Partial<SettlementFormValues> = {};
    if (all.gross_amount != null) {
      patch.amount_due = all.gross_amount - (all.return_deduction_amount ?? 0);
    }
    if (Object.keys(patch).length) form.setFieldsValue(patch);
  };

  const handleSettlementValuesChange = (changed: Partial<SettlementFormValues>, all: SettlementFormValues) => {
    (Object.keys(changed) as RecognizedSettlementField[]).forEach((field) => {
      recognitionFilledFields.current.delete(field);
    });
    syncCalculatedAmounts(changed, all);
  };

  const validateSettlementAttachment = (file: File) => {
    const suffix = file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '';
    if (!['.pdf', '.jpg', '.jpeg', '.png', '.xls', '.xlsx'].includes(suffix)) {
      message.error('结算附件仅支持 PDF / JPG / PNG / XLS / XLSX');
      return false;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      message.error('附件不能超过 20 MB');
      return false;
    }
    return true;
  };

  const recommendAttachmentCategory = (file: File): SettlementAttachmentCategory => {
    const name = file.name.toLowerCase();
    if (name.includes('开票申请')) return 'invoice_application';
    if (name.includes('发票')) return 'invoice';
    if (name.endsWith('.xls') || name.endsWith('.xlsx') || name.includes('结算')) return 'settlement_sheet';
    return 'other';
  };

  const handleSettlementAttachment = (file: File) => {
    if (!validateSettlementAttachment(file)) return Upload.LIST_IGNORE;
    const duplicate = pendingAttachments.some(
      (item) => item.file.name === file.name && item.file.size === file.size,
    );
    if (duplicate) {
      message.warning(`${file.name} 已在待保存附件中`);
      return Upload.LIST_IGNORE;
    }
    const category = recommendAttachmentCategory(file);
    const uid = `${Date.now()}-${file.name}-${file.size}`;
    const isPrimary = category === 'settlement_sheet' && !pendingAttachments.some((item) => item.isPrimary);
    setPendingAttachments((items) => [...items, {
      uid, category, file, isPrimary,
      previewState: isPrimary && file.name.toLowerCase().endsWith('.xlsx') ? 'loading' : 'idle',
    }]);
    if (isPrimary && file.name.toLowerCase().endsWith('.xlsx')) {
      previewMutation.mutate({ uid, file, apply: true });
    }
    return Upload.LIST_IGNORE;
  };

  const updatePendingCategory = (uid: string, category: SettlementAttachmentCategory) => {
    const target = pendingAttachments.find((item) => item.uid === uid);
    if (!target) return;
    const canBecomePrimary = category === 'settlement_sheet' && !pendingAttachments.some((item) => item.isPrimary && item.uid !== uid);
    const isPrimary = target.isPrimary ? category === 'settlement_sheet' : canBecomePrimary;
    setPendingAttachments((items) => items.map((item) => item.uid === uid
      ? { ...item, category, isPrimary, previewState: category === 'settlement_sheet' ? item.previewState : 'idle', preview: category === 'settlement_sheet' ? item.preview : undefined }
      : item));
    if (isPrimary && target.file.name.toLowerCase().endsWith('.xlsx') && !target.preview) {
      setPendingAttachments((items) => items.map((item) => item.uid === uid ? { ...item, previewState: 'loading' } : item));
      previewMutation.mutate({ uid, file: target.file, apply: true });
    }
  };

  const setPrimaryPending = (uid: string) => {
    const target = pendingAttachments.find((item) => item.uid === uid);
    if (!target || target.category !== 'settlement_sheet') return;
    if (target.preview) {
      const applyResult = applySettlementPreview(target.preview);
      setPendingAttachments((items) => items.map((item) => item.uid === uid
        ? { ...item, isPrimary: true, ...applyResult }
        : { ...item, isPrimary: false }));
    } else if (target.file.name.toLowerCase().endsWith('.xlsx')) {
      setPendingAttachments((items) => items.map((item) => ({ ...item, isPrimary: item.uid === uid })));
      setPendingAttachments((items) => items.map((item) => item.uid === uid ? { ...item, previewState: 'loading' } : item));
      previewMutation.mutate({ uid, file: target.file, apply: true });
    } else {
      setPendingAttachments((items) => items.map((item) => ({ ...item, isPrimary: item.uid === uid })));
    }
  };

  const handleSavedAttachment = (file: File) => {
    if (!detail || !validateSettlementAttachment(file)) return Upload.LIST_IGNORE;
    const category = recommendAttachmentCategory(file);
    const isPrimary = category === 'settlement_sheet' && !detail.attachments.some((item) => item.is_primary);
    uploadMutation.mutate({ id: detail.id, category, file, isPrimary });
    return Upload.LIST_IGNORE;
  };

  const openInvoiceRegister = () => {
    if (!detail) return;
    invoiceForm.setFieldsValue({
      invoice_no: detail.invoice_no ?? undefined,
      invoice_date: detail.invoice_date ? dayjs(detail.invoice_date) : dayjs(),
      invoice_title: detail.invoice_title ?? undefined,
      invoice_tax_no: detail.invoice_tax_no ?? undefined,
      invoice_type: detail.invoice_type ?? undefined,
      invoice_item_name: detail.invoice_item_name ?? undefined,
      invoice_amount: detail.invoice_amount == null ? (detail.amount_due == null ? undefined : Number(detail.amount_due)) : Number(detail.invoice_amount),
      notes: undefined,
    });
    setPendingInvoiceFile(null);
    setInvoiceModalOpen(true);
  };

  const openPaymentRegister = () => {
    if (!detail) return;
    const remaining = Math.max(0, Number(detail.amount_due ?? 0) - Number(detail.paid_amount ?? 0));
    paymentForm.setFieldsValue({ amount: remaining || undefined, paid_date: dayjs(), on_time: undefined, notes: undefined });
    setPendingPaymentFile(null);
    setPaymentModalOpen(true);
  };

  const columns: TableColumnsType<Settlement> = [
    { title: '结算对象', dataIndex: 'partner_name', key: 'partner_name', render: (v) => <Text strong>{v}</Text> },
    { title: '对象类型', dataIndex: 'party_type', key: 'party_type', width: 82, render: (v: SettlementPartyType) => <Tag>{SETTLEMENT_PARTY_TYPE_LABELS[v]}</Tag> },
    { title: '方向', dataIndex: 'direction', key: 'direction', width: 72, render: (v: SettlementDirection) => <Tag color={v === 'receivable' ? 'green' : 'blue'}>{SETTLEMENT_DIRECTION_LABELS[v]}</Tag> },
    { title: '系统结算单号', dataIndex: 'system_no', key: 'system_no', width: 205, render: (v) => <Text copyable>{v}</Text> },
    { title: '外部平台单号', dataIndex: 'external_no', key: 'external_no', width: 185, render: (v, r) => v || r.settlement_no || <Text type="secondary">—</Text> },
    { title: '销售模式', dataIndex: 'settlement_type', key: 'settlement_type', width: 85, render: (v: SettlementType | null) => v ? <Tag color={v === 'consignment' ? 'cyan' : 'purple'}>{SETTLEMENT_TYPE_LABELS[v]}</Tag> : <Text type="secondary">—</Text> },
    { title: '结算周期', key: 'settlement_period', width: 210, render: (_v, r) => formatPeriod(r.settlement_start_date, r.settlement_end_date, r.period) },
    { title: '退报周期', key: 'return_period', width: 210, render: (_v, r) => r.return_start_date ? formatPeriod(r.return_start_date, r.return_end_date) : <Text type="secondary">无退报</Text> },
    { title: '报款/结算总额', dataIndex: 'gross_amount', key: 'gross_amount', width: 130, align: 'right', render: (v: string | null) => money(v) },
    { title: '退报扣款', dataIndex: 'return_deduction_amount', key: 'return_deduction_amount', width: 110, align: 'right', render: (v: string | null) => money(v) },
    { title: '应结', dataIndex: 'amount_due', key: 'amount_due', width: 110, align: 'right', render: (v: string | null) => money(v) },
    { title: '已结款', dataIndex: 'paid_amount', key: 'paid_amount', width: 110, align: 'right', render: (v: string | null) => money(v) },
    { title: '结款日', dataIndex: 'paid_date', key: 'paid_date', width: 110, render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: '按时', dataIndex: 'on_time', key: 'on_time', width: 80,
      render: (v: boolean | null) => (v == null ? <Text type="secondary">—</Text> : v ? <Tag color="green">按时</Tag> : <Tag color="red">逾期</Tag>),
    },
    {
      title: '开票状态', key: 'invoice_status', width: 100,
      render: (_: unknown, r) =>
        <Tag color={r.invoice_status === 'issued' ? 'green' : 'default'}>{SETTLEMENT_INVOICE_STATUS_LABELS[r.invoice_status]}</Tag>,
    },
    { title: '收付状态', dataIndex: 'payment_status', key: 'payment_status', width: 100, render: (v: SettlementPaymentStatus) => <Tag color={v === 'paid' ? 'blue' : v === 'partial' ? 'gold' : 'default'}>{SETTLEMENT_PAYMENT_STATUS_LABELS[v]}</Tag> },
    {
      title: '附件', key: 'attachment', width: 180,
      render: (_: unknown, r) =>
        r.attachments.length ? (
          <Space orientation="vertical" size={0}>
            {r.attachments.slice(0, 2).map((attachment) => (
              <Button key={attachment.id} type="link" size="small" icon={<DownloadOutlined />} onClick={() => downloadSettlementAttachment(r, attachment)}>
                {ATTACHMENT_CATEGORY_LABELS[attachment.category]}
              </Button>
            ))}
            {r.attachments.length > 2 && <Text type="secondary">另 {r.attachments.length - 2} 份</Text>}
          </Space>
        ) : <Text type="secondary">无</Text>,
    },
    ...[{
          title: '操作', key: 'actions', width: 150, fixed: 'right' as const,
          render: (_: unknown, r: Settlement) => (
            <Space size={4}>
              <Button type="link" size="small" onClick={() => setDetail(r)}>查看详情</Button>
              {isAdmin && <>
              <Popconfirm title="删除该结算记录？" description="附件一并删除。" okText="删除" okButtonProps={{ danger: true }} cancelText="取消" onConfirm={() => deleteMutation.mutate(r.id)}>
                <Button type="link" size="small" danger>删除</Button>
              </Popconfirm>
              </>}
            </Space>
          ),
        } as TableColumnsType<Settlement>[number]],
  ];

  return (
    <div className="finance-settlement-panel">
      <div className="finance-context-banner">
        <InfoCircleOutlined />
        <Text><Text strong>结算归档：</Text>按渠道记录应收/应付、结构化结算与退报周期、结款、开票和多份凭证。</Text>
      </div>
      <div className="finance-toolbar">
        <div className="finance-toolbar-filters">
          <Select
            allowClear placeholder="按结算对象筛选" className="finance-filter-partner"
            options={partnerOptions}
            value={filters.partner_id}
            onChange={(v) => setFilters((f) => ({ ...f, partner_id: v }))}
          />
          <Select
            allowClear placeholder="个人/渠道" style={{ width: 115 }}
            options={SETTLEMENT_PARTY_TYPE_OPTIONS}
            value={filters.party_type}
            onChange={(v) => setFilters((f) => ({ ...f, party_type: v }))}
          />
          <Select
            allowClear placeholder="代销/包销" style={{ width: 115 }}
            options={SETTLEMENT_TYPE_OPTIONS}
            value={filters.settlement_type}
            onChange={(v) => setFilters((f) => ({ ...f, settlement_type: v }))}
          />
          <Select
            allowClear placeholder="按方向筛选" style={{ width: 110 }}
            options={SETTLEMENT_DIRECTION_OPTIONS}
            value={filters.direction}
            onChange={(v) => setFilters((f) => ({ ...f, direction: v }))}
          />
          <Select
            allowClear placeholder="按状态筛选" className="finance-filter-status"
            options={SETTLEMENT_STATUS_OPTIONS}
            value={filters.status}
            onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          />
          <RangePicker
            onChange={(value) => setFilters((f) => ({
              ...f,
              settlement_from: value?.[0]?.format('YYYY-MM-DD'),
              settlement_to: value?.[1]?.format('YYYY-MM-DD'),
            }))}
          />
          <Input.Search placeholder="搜索系统/外部单号 / 发票号" allowClear className="finance-filter-search" onSearch={(v) => setFilters((f) => ({ ...f, q: v || undefined }))} />
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
        scroll={{ x: 2500 }}
        locale={{ emptyText: '暂无结算记录（点「新增结算」登记渠道结算与退报周期）' }}
      />

      <Modal
        title={(
          <div className="finance-settlement-modal-title">
            <span className="finance-settlement-modal-title-icon" aria-hidden><FileTextOutlined /></span>
            <div className="finance-settlement-modal-title-copy">
              <strong>{editing ? '编辑结算' : '新增结算'}</strong>
              <div className="finance-settlement-modal-meta">
                <span>{editing ? editing.system_no : '渠道结算'}</span>
                <i>·</i>
                <span>{editing ? '仅修改基础信息' : '系统编号保存后自动生成'}</span>
                {!editing && <><i>·</i><span>附件与信息一次保存</span></>}
              </div>
            </div>
            <span className="finance-settlement-modal-status">{editing ? '编辑中' : '待保存'}</span>
          </div>
        )}
        open={modalOpen}
        onCancel={() => { setModalOpen(false); setEditing(null); setPendingAttachments([]); }}
        width={900}
        centered
        destroyOnHidden
        className="finance-settlement-modal"
        rootClassName="finance-settlement-modal-root"
        footer={(
          <div className="finance-settlement-modal-footer">
            <span className="finance-settlement-modal-save-tip"><CheckCircleOutlined />{editing ? '修改内容会同步到结算记录' : '保存后附件与结算记录会一并归档'}</span>
            <Button onClick={() => { setModalOpen(false); setEditing(null); setPendingAttachments([]); }}>取消</Button>
            <Button type="primary" loading={saveMutation.isPending} onClick={() => form.submit()}>{editing ? '保存修改' : '保存结算'}</Button>
          </div>
        )}
      >
        <Form<SettlementFormValues> className="finance-settlement-form" form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} onValuesChange={handleSettlementValuesChange}>
          {!editing && <section className="finance-settlement-section finance-settlement-upload-first">
            <h3><span aria-hidden><PaperClipOutlined /></span>结算凭证</h3>
            <Alert
              className="finance-settlement-upload-note"
              type="info"
              showIcon
              message="有结算单时先上传，系统会识别外部单号、结算/退报周期和金额；已有人工内容会保留。没有附件也可以直接填写。"
            />
            <div className="finance-settlement-attachment-list">
              {pendingAttachments.length ? pendingAttachments.map((attachment) => (
                <div key={attachment.uid} className="finance-settlement-attachment-row">
                  <div className="finance-settlement-attachment-head">
                    <Select aria-label={`${attachment.file.name}的附件类型`} value={attachment.category} options={ATTACHMENT_CATEGORY_OPTIONS} onChange={(value) => updatePendingCategory(attachment.uid, value)} />
                    <div className="finance-settlement-attachment-name">
                      <Text>{attachment.file.name}</Text>
                      <Text type="secondary">{(attachment.file.size / 1024).toFixed(1)} KB</Text>
                    </div>
                    <div className="finance-settlement-attachment-actions">
                      {!attachment.isPrimary && attachment.category === 'settlement_sheet' && <Button type="link" size="small" onClick={() => setPrimaryPending(attachment.uid)}>改用此表识别</Button>}
                      <Button type="link" size="small" danger onClick={() => setPendingAttachments((items) => items.filter((item) => item.uid !== attachment.uid))}>移除</Button>
                    </div>
                  </div>
                  {attachment.previewState === 'loading' && <Alert className="finance-settlement-recognition" type="info" showIcon message="正在识别此结算单…" />}
                  {attachment.previewState === 'success' && attachment.preview && <Alert
                    className="finance-settlement-recognition"
                    type={attachment.preview.warnings.length ? 'warning' : 'success'}
                    showIcon
                    message={`此结算单识别结果 · ${attachment.preview.detail_count} 条明细（退报 ${attachment.preview.return_detail_count} 条）`}
                    description={<Space orientation="vertical" size={2}>
                      {attachment.preview.warnings.length > 0 && <Text>{attachment.preview.warnings.join('；')}</Text>}
                      {!!attachment.appliedFields?.length && <Text>已自动填入：{attachment.appliedFields.join('、')}</Text>}
                      {!!attachment.preservedFields?.length && <Text type="warning">已保留人工填写：{attachment.preservedFields.join('、')}</Text>}
                      {!attachment.appliedFields?.length && !attachment.preservedFields?.length && <Text>已完成识别，请核对下方信息。</Text>}
                    </Space>}
                  />}
                  {attachment.previewState === 'error' && <Alert className="finance-settlement-recognition" type="warning" showIcon message="此结算单未能自动识别，原文件仍会保存" description={attachment.previewError} />}
                </div>
              )) : <Text type="secondary">尚未选择附件。可以先上传，也可以跳过后直接填写。</Text>}
            </div>
            <div className="finance-settlement-upload-actions">
              <Upload showUploadList={false} accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" beforeUpload={handleSettlementAttachment}>
                <Button icon={<UploadOutlined />}>{pendingAttachments.length ? '继续选择附件' : '选择并识别附件'}</Button>
              </Upload>
              <Text type="secondary">支持 PDF、JPG、PNG、XLS、XLSX，单个不超过 20 MB</Text>
            </div>
          </section>}

          <section className="finance-settlement-section">
            <h3><span aria-hidden><BankOutlined /></span>结算基础信息</h3>
            {partnersQuery.isError && <Alert
              className="finance-settlement-partner-alert"
              type="error"
              showIcon
              message="合作渠道加载失败，当前无法选择结算对象"
              description={<Space orientation="vertical" size={8}>
                <Text>请先重试；若系统刚完成升级，请确认数据库迁移已执行后再继续。</Text>
                <Button size="small" onClick={() => partnersQuery.refetch()} loading={partnersQuery.isFetching}>重试</Button>
              </Space>}
            />}
            {!partnersQuery.isLoading && !partnersQuery.isError && partnerOptions.length === 0 && <Alert
              className="finance-settlement-partner-alert"
              type="warning"
              showIcon
              message="尚未维护可用的合作渠道"
              description="请先到“合作渠道”维护结算对象，保存后再回来新增结算。"
            />}
            <div className="finance-settlement-form-grid">
            <Form.Item className="finance-settlement-span-2" name="partner_id" label="结算对象" rules={[{ required: true, message: '请选择结算对象' }]}>
              <Select
                options={partnerOptions}
                placeholder={partnersQuery.isError ? '合作渠道加载失败' : partnerOptions.length ? '选择合作方' : '暂无可用合作渠道'}
                showSearch
                optionFilterProp="label"
                onChange={handlePartnerChange}
                loading={partnersQuery.isLoading || partnersQuery.isFetching}
                disabled={partnersQuery.isError || (!partnersQuery.isLoading && partnerOptions.length === 0)}
                notFoundContent={partnersQuery.isError ? '加载失败，请重试' : partnersQuery.isLoading ? '正在加载合作渠道…' : '暂无可用合作渠道'}
              />
            </Form.Item>
            <Form.Item name="contract_id" label="关联合同">
              <Select allowClear options={contractOptions} loading={contractsQuery.isFetching} placeholder="选填" />
            </Form.Item>
            <Form.Item name="direction" label="收付方向" rules={[{ required: true }]}>
              <Select options={SETTLEMENT_DIRECTION_OPTIONS} />
            </Form.Item>
            <Form.Item name="party_type" label="结算对象类型" rules={[{ required: true }]}>
              <Select options={SETTLEMENT_PARTY_TYPE_OPTIONS} disabled={!!editing} />
            </Form.Item>
            {(selectedPartner?.sales_mode_policy ?? 'not_applicable') !== 'not_applicable' && <Form.Item
              name="settlement_type"
              label="销售模式"
              rules={[{ required: selectedPartner?.sales_mode_policy === 'required', message: '请选择代销或包销' }]}
            >
              <Select allowClear={selectedPartner?.sales_mode_policy !== 'required'} options={SETTLEMENT_TYPE_OPTIONS} placeholder="代销 / 包销" />
            </Form.Item>}
            <Form.Item label="系统结算单号">
              <Input disabled value={editing?.system_no} placeholder="保存后自动生成" />
            </Form.Item>
            <Form.Item className={(selectedPartner?.sales_mode_policy ?? 'not_applicable') === 'not_applicable' ? 'finance-settlement-wide' : 'finance-settlement-span-2'} name="external_no" label="外部平台单号">
              <Input placeholder="选填，格式不限" />
            </Form.Item>
            </div>
          </section>

          <section className="finance-settlement-section">
            <h3><span aria-hidden><CalendarOutlined /></span>周期与金额</h3>
            <div className="finance-settlement-period-grid">
            <Form.Item className="finance-settlement-period-half" name="settlement_period" label="结算周期" rules={[{ required: true, message: '请选择结算周期' }]}>
              <RangePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item className="finance-settlement-period-half" name="return_period" label="退报周期" dependencies={['return_deduction_amount']} rules={[({ getFieldValue }) => ({
              validator: (_rule, value) => getFieldValue('return_deduction_amount') > 0 && !value
                ? Promise.reject(new Error('有退报扣款时必须选择退报周期'))
                : Promise.resolve(),
            })]}>
              <RangePicker style={{ width: '100%' }} placeholder={['无退报可不填', '结束日期']} />
            </Form.Item>
            <Form.Item className="finance-settlement-period-third" name="gross_amount" label={selectedDirection === 'receivable' ? '报款金额' : '结算总额'} rules={[{ required: true, message: '请填写总额' }]}>
              <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item className="finance-settlement-period-third" name="return_deduction_amount" label="退报扣款">
              <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item className="finance-settlement-period-third" name="amount_due" label={selectedDirection === 'receivable' ? '应收金额' : '应付金额'}>
              <InputNumber precision={2} prefix="¥" disabled style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item className="finance-settlement-period-wide" name="notes" label="备注">
              <Input placeholder="补充说明（选填）" />
            </Form.Item>
            </div>
          </section>
        </Form>
      </Modal>

      <Drawer
        title={detail ? `结算详情 · ${detail.system_no}` : '结算详情'}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={760}
        extra={detail && isAdmin ? <Button onClick={() => openEdit(detail)}>编辑基础信息</Button> : null}
      >
        {detail && <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <section>
            <Divider titlePlacement="start" plain>结算信息</Divider>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="结算对象">{detail.partner_name}</Descriptions.Item>
              <Descriptions.Item label="收付方向">{SETTLEMENT_DIRECTION_LABELS[detail.direction]}</Descriptions.Item>
              <Descriptions.Item label="销售模式">{detail.settlement_type ? SETTLEMENT_TYPE_LABELS[detail.settlement_type] : '不适用'}</Descriptions.Item>
              <Descriptions.Item label="外部单号">{detail.external_no || '—'}</Descriptions.Item>
              <Descriptions.Item label="结算周期">{formatPeriod(detail.settlement_start_date, detail.settlement_end_date, detail.period)}</Descriptions.Item>
              <Descriptions.Item label="退报周期">{detail.return_start_date ? formatPeriod(detail.return_start_date, detail.return_end_date) : '无退报'}</Descriptions.Item>
              <Descriptions.Item label="结算总额">{money(detail.gross_amount)}</Descriptions.Item>
              <Descriptions.Item label="退报扣款">{money(detail.return_deduction_amount)}</Descriptions.Item>
              <Descriptions.Item label="应结金额">{money(detail.amount_due)}</Descriptions.Item>
              <Descriptions.Item label="备注">{detail.notes || '—'}</Descriptions.Item>
            </Descriptions>
          </section>

          <section>
            <Divider titlePlacement="start" plain>附件</Divider>
            <Space orientation="vertical" style={{ width: '100%' }}>
              {detail.attachments.length ? detail.attachments.map((attachment) => (
                <Space key={attachment.id} wrap>
                  <Select disabled={!isAdmin} value={attachment.category} options={ATTACHMENT_CATEGORY_OPTIONS} onChange={(category) => updateAttachMutation.mutate({ id: detail.id, attachmentId: attachment.id, category })} style={{ width: 130 }} />
                  <Button type="link" icon={<DownloadOutlined />} onClick={() => downloadSettlementAttachment(detail, attachment)}>{attachment.filename}</Button>
                  {attachment.is_primary ? <Tag color="blue">主结算单</Tag> : isAdmin && attachment.category === 'settlement_sheet' && <Button type="link" size="small" onClick={() => updateAttachMutation.mutate({ id: detail.id, attachmentId: attachment.id, isPrimary: true })}>设为主结算单</Button>}
                  {attachment.recognized === true && <Tag color="green">已识别</Tag>}
                  {attachment.recognized === false && <Tag color="orange">未识别</Tag>}
                  {isAdmin && <Popconfirm title="删除该附件？" onConfirm={() => delAttachMutation.mutate({ id: detail.id, attachmentId: attachment.id })}><Button type="link" danger size="small">删除</Button></Popconfirm>}
                </Space>
              )) : <Text type="secondary">暂无附件</Text>}
              {isAdmin && <Upload showUploadList={false} accept=".pdf,.jpg,.jpeg,.png,.xls,.xlsx" beforeUpload={handleSavedAttachment}>
                <Button icon={<UploadOutlined />} loading={uploadMutation.isPending}>上传附件（自动推荐分类）</Button>
              </Upload>}
            </Space>
          </section>

          <section>
            <Divider titlePlacement="start" plain>开票</Divider>
            <Space wrap>
              <Tag color={detail.invoice_status === 'issued' ? 'green' : 'default'}>{SETTLEMENT_INVOICE_STATUS_LABELS[detail.invoice_status]}</Tag>
              {detail.invoice_no && <Text>发票号：{detail.invoice_no}</Text>}
              {detail.invoice_date && <Text>开票日期：{detail.invoice_date}</Text>}
              {isAdmin && <Button type="primary" onClick={openInvoiceRegister}>{detail.direction === 'receivable' ? '登记我方开票' : '登记收到发票'}</Button>}
            </Space>
          </section>

          <section>
            <Divider titlePlacement="start" plain>{detail.direction === 'receivable' ? '收款' : '付款'}</Divider>
            <Space wrap>
              <Tag color={detail.payment_status === 'paid' ? 'blue' : detail.payment_status === 'partial' ? 'gold' : 'default'}>{SETTLEMENT_PAYMENT_STATUS_LABELS[detail.payment_status]}</Tag>
              <Text>累计已结：{money(detail.paid_amount)}</Text>
              {detail.paid_date && <Text>最近日期：{detail.paid_date}</Text>}
              {isAdmin && detail.payment_status !== 'paid' && <Button type="primary" onClick={openPaymentRegister}>{detail.direction === 'receivable' ? '登记收款' : '登记付款'}</Button>}
            </Space>
          </section>

          <section>
            <Divider titlePlacement="start" plain>操作记录</Divider>
            {historyQuery.isLoading ? <Text type="secondary">加载中…</Text> : (historyQuery.data?.length ? historyQuery.data.map((item: SettlementHistory) => (
              <div key={item.id} className="finance-settlement-history-row">
                <Text>{item.action}</Text><Text type="secondary">{item.username || '系统'} · {dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}</Text>
              </div>
            )) : <Text type="secondary">暂无操作记录</Text>)}
          </section>
        </Space>}
      </Drawer>

      <Modal title={detail?.direction === 'receivable' ? '登记我方开票' : '登记收到发票'} open={invoiceModalOpen} onCancel={() => setInvoiceModalOpen(false)} onOk={() => invoiceForm.submit()} confirmLoading={invoiceMutation.isPending} destroyOnHidden>
        <Form form={invoiceForm} layout="vertical" onFinish={(values) => invoiceMutation.mutate(values)}>
          <div className="finance-settlement-form-grid">
            <Form.Item name="invoice_date" label="开票日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="invoice_no" label="发票号"><Input /></Form.Item>
            <Form.Item name="invoice_title" label="发票抬头"><Input /></Form.Item>
            <Form.Item name="invoice_tax_no" label="纳税人识别号"><Input /></Form.Item>
            <Form.Item name="invoice_type" label="发票类型"><Select allowClear options={[{ label: '增值税普通发票', value: 'vat_normal' }, { label: '增值税专用发票', value: 'vat_special' }]} /></Form.Item>
            <Form.Item name="invoice_amount" label="开票金额"><InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} /></Form.Item>
          </div>
          <Form.Item name="invoice_item_name" label="发票内容"><Input /></Form.Item>
          <Form.Item label="发票文件" required extra="上传成功后自动把开票状态更新为已开票">
            <Upload showUploadList={false} accept=".pdf,.jpg,.jpeg,.png" beforeUpload={(file) => { if (validateInvoiceAttachment(file)) setPendingInvoiceFile(file); return Upload.LIST_IGNORE; }}>
              <Button icon={<UploadOutlined />}>{pendingInvoiceFile?.name || '选择发票文件'}</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={detail?.direction === 'receivable' ? '登记收款' : '登记付款'} open={paymentModalOpen} onCancel={() => setPaymentModalOpen(false)} onOk={() => paymentForm.submit()} confirmLoading={paymentMutation.isPending} destroyOnHidden>
        <Form form={paymentForm} layout="vertical" onFinish={(values) => paymentMutation.mutate(values)}>
          <Form.Item name="amount" label="本次金额" rules={[{ required: true, message: '请输入本次金额' }]}><InputNumber min={0.01} precision={2} prefix="¥" style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="paid_date" label={detail?.direction === 'receivable' ? '收款日期' : '付款日期'} rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="on_time" label="是否按时"><Select allowClear options={[{ label: '按时', value: true }, { label: '逾期', value: false }]} /></Form.Item>
          <Form.Item label="收付款凭证（选填）"><Upload showUploadList={false} accept=".pdf,.jpg,.jpeg,.png" beforeUpload={(file) => { if (validateInvoiceAttachment(file, '收付款凭证')) setPendingPaymentFile(file); return Upload.LIST_IGNORE; }}><Button icon={<UploadOutlined />}>{pendingPaymentFile?.name || '选择凭证'}</Button></Upload></Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
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
