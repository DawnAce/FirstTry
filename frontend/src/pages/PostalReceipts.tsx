import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  InboxOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import {
  commitFinanceImport,
  createFinance,
  deleteFinance,
  listFinance,
  previewFinanceImport,
  updateFinance,
} from '../api/finance';
import type { FinanceImportRow, FinancePayload, PostalFinance } from '../api/finance';
import type { SimpleImportPreview } from '../api/postal';

const { Text } = Typography;

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
}
const toDay = (s?: string | null): Dayjs | null => (s ? dayjs(s) : null);
const fromDay = (d?: Dayjs | null): string | null => (d ? d.format('YYYY-MM-DD') : null);

/** 通用「预览 + 提交」导入弹窗（收款发票专用副本）。 */
function SimpleImportModal<T extends object>(props: {
  open: boolean; onClose: () => void; title: string; hint: string; unit: string; linkedLabel: string;
  previewFn: (f: File) => Promise<{ data: SimpleImportPreview<T> }>;
  commitFn: (sid: string) => Promise<{ data: { created: number; skipped_duplicates: number } }>;
  invalidateKey: string; columns: TableColumnsType<T>; rowKey: (r: T, i?: number) => string;
}) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SimpleImportPreview<T> | null>(null);
  const reset = () => { setFile(null); setPreview(null); };
  const previewMut = useMutation({ mutationFn: () => props.previewFn(file as File), onSuccess: (res) => setPreview(res.data), onError: (e) => message.error(errText(e)) });
  const commitMut = useMutation({
    mutationFn: () => props.commitFn(preview!.session_id),
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created}（跳过重复 ${res.data.skipped_duplicates}）`);
      qc.invalidateQueries({ queryKey: [props.invalidateKey] });
      reset(); props.onClose();
    },
    onError: (e) => message.error(errText(e)),
  });
  const counts = preview?.counts ?? {};
  return (
    <Modal title={props.title} open={props.open} onCancel={() => { reset(); props.onClose(); }} width={920} footer={null} destroyOnClose>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Upload.Dragger maxCount={1} accept=".xlsx" beforeUpload={(f) => { setFile(f); setPreview(null); return false; }} onRemove={() => reset()} fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">{props.hint}</p>
        </Upload.Dragger>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => previewMut.mutate()} loading={previewMut.isPending} disabled={!file}>预览导入</Button>
        {preview && (
          <>
            <Space wrap>
              <Tag color="green">导入 {counts.import ?? 0}</Tag>
              <Tag color="blue">重复 {counts.duplicate ?? 0}</Tag>
              <Tag color="cyan">{props.linkedLabel} {counts.linked ?? 0}</Tag>
              <Text type="secondary">共 {counts.total ?? 0} 行</Text>
              <span style={{ marginLeft: 'auto' }} />
              {isAdmin
                ? <Button type="primary" onClick={() => commitMut.mutate()} loading={commitMut.isPending} disabled={!preview.can_commit}>确认导入 {counts.import ?? 0} {props.unit}</Button>
                : <Text type="secondary">确认导入需管理员权限</Text>}
            </Space>
            <Table<T> rowKey={props.rowKey} columns={props.columns} dataSource={preview.rows} size="small" pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 行` }} scroll={{ x: 800, y: 360 }} />
          </>
        )}
      </Space>
    </Modal>
  );
}

/** 收款 / 发票 · 新增 / 编辑 */
function FinanceFormModal({ open, editing, onClose }: {
  open: boolean; editing: PostalFinance | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        amount: editing.amount != null ? Number(editing.amount) : undefined,
        fee_amount: editing.fee_amount != null ? Number(editing.fee_amount) : undefined,
        net_amount: editing.net_amount != null ? Number(editing.net_amount) : undefined,
        invoiced_amount: editing.invoiced_amount != null ? Number(editing.invoiced_amount) : undefined,
        collected_at: toDay(editing.collected_at),
      });
    } else form.resetFields();
  }, [open, editing, form]);

  const saveMut = useMutation({
    mutationFn: (v: Record<string, unknown> & { collected_at?: Dayjs | null }) => {
      const body: FinancePayload = {
        ...v,
        amount: (v.amount as number | undefined) ?? null, fee_amount: (v.fee_amount as number | undefined) ?? null,
        net_amount: (v.net_amount as number | undefined) ?? null, invoiced_amount: (v.invoiced_amount as number | undefined) ?? null,
        collected_at: fromDay(v.collected_at),
      };
      return editing ? updateFinance(editing.id, body) : createFinance(body);
    },
    onSuccess: () => { message.success(editing ? '收款记录已更新' : '收款记录已新增'); qc.invalidateQueries({ queryKey: ['postalFinance'] }); onClose(); },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑收款/发票' : '新增收款/发票'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={720} destroyOnClose>
      <Form form={form} layout="vertical"
        onValuesChange={(changed) => {
          if ('amount' in changed || 'fee_amount' in changed) {
            const amt = form.getFieldValue('amount');
            const fee = form.getFieldValue('fee_amount');
            if (amt != null && fee != null) form.setFieldsValue({ net_amount: Number((amt - fee).toFixed(2)) });
          }
        }}
        onFinish={(v) => saveMut.mutate(v)}>
        <Flex gap={12} wrap>
          <Form.Item name="payer_name" label="付款人姓名" style={{ width: 160 }}><Input /></Form.Item>
          <Form.Item name="external_order_no" label="原始订单号" style={{ width: 200 }}><Input placeholder="有则精确挂单" /></Form.Item>
          <Form.Item name="product" label="商品" style={{ width: 180 }}><Input /></Form.Item>
          <Form.Item name="copies" label="份数" style={{ width: 100 }}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="amount" label="金额" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={0} precision={2} /></Form.Item>
          <Form.Item name="fee_amount" label="手续费" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={0} precision={2} /></Form.Item>
          <Form.Item name="net_amount" label="到款（空则=金额-手续费）" style={{ width: 210 }}><InputNumber style={{ width: '100%' }} min={0} precision={2} /></Form.Item>
          <Form.Item name="collected_at" label="到款日期" style={{ width: 160 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="invoiced_amount" label="开票金额" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={0} precision={2} /></Form.Item>
          <Form.Item name="tax_category" label="票种" style={{ width: 120 }}><Select allowClear options={[{ label: '普票', value: '普票' }, { label: '专票', value: '专票' }]} /></Form.Item>
          <Form.Item name="platform" label="平台" style={{ width: 170 }}><Input /></Form.Item>
        </Flex>
        <Form.Item name="buyer_title" label="发票抬头"><Input /></Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="tax_no" label="购方税号" style={{ width: 220 }}><Input /></Form.Item>
          <Form.Item name="invoice_recipient" label="发票接收（手机/邮箱）" style={{ flex: 1, minWidth: 200 }}><Input /></Form.Item>
        </Flex>
        <Form.Item name="notes" label="备注"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

/** 财务管理 · 邮局收款 Tab（原邮局管理「收款发票」，迁入财务管理）。 */
export default function PostalReceiptsPanel() {
  const [platform, setPlatform] = useState<string | undefined>();
  const [taxCat, setTaxCat] = useState<string | undefined>();
  const [linked, setLinked] = useState<boolean | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PostalFinance | null>(null);
  const PAGE_SIZE = 50;
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteFinance(id),
    onSuccess: () => { message.success('已删除收款记录'); qc.invalidateQueries({ queryKey: ['postalFinance'] }); },
    onError: (e) => message.error(errText(e)),
  });

  const q = useQuery({
    queryKey: ['postalFinance', { platform, taxCat, linked, search, page }],
    queryFn: () => listFinance({ platform, tax_category: taxCat, linked, search: search.trim() || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
  });

  const linkTag = (r: PostalFinance) => {
    if (!r.order_id) return <Text type="secondary">未挂</Text>;
    return <Tag color="green">{r.link_by === 'order_no' ? '订单号' : '姓名'}挂单</Tag>;
  };

  const cols: TableColumnsType<PostalFinance> = [
    { title: '姓名', dataIndex: 'payer_name', width: 100 },
    { title: '商品', dataIndex: 'product', width: 140, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '金额', dataIndex: 'amount', width: 90, align: 'right', render: (v: string | null) => v ? `¥${v}` : '—' },
    { title: '到款', dataIndex: 'net_amount', width: 90, align: 'right', render: (v: string | null) => v ? `¥${v}` : '—' },
    { title: '到款日期', dataIndex: 'collected_at', width: 110, render: (v: string | null) => v || '—' },
    { title: '票种', dataIndex: 'tax_category', width: 70, render: (v: string | null) => v ? <Tag color={v === '专票' ? 'gold' : 'default'}>{v}</Tag> : '—' },
    { title: '挂单', key: 'link', width: 110, render: (_: unknown, r) => linkTag(r) },
    ...(isAdmin ? [{
      title: '操作', key: 'act', width: 90, render: (_: unknown, r: PostalFinance) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); setFormOpen(true); }} />
          <Popconfirm title="删除该收款记录？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => deleteMut.mutate(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    } as TableColumnsType<PostalFinance>[number]] : []),
  ];

  const renderFinanceExpand = (r: PostalFinance) => (
    <div className="postal-expand">
      <div><div className="k">手续费</div><div className="v">{r.fee_amount ? `¥${r.fee_amount}` : '—'}</div></div>
      <div><div className="k">开票金额</div><div className="v">{r.invoiced_amount ? `¥${r.invoiced_amount}` : '—'}</div></div>
      <div><div className="k">平台</div><div className="v">{r.platform || '—'}</div></div>
      <div><div className="k">份数</div><div className="v">{r.copies ?? '—'}</div></div>
      <div style={{ gridColumn: 'span 2' }}><div className="k">开票抬头</div><div className="v">{r.buyer_title || '不开票/—'}</div></div>
      <div><div className="k">购方税号</div><div className="v">{r.tax_no || '—'}</div></div>
      <div><div className="k">原始订单号</div><div className="v">{r.external_order_no || '—'}</div></div>
      <div style={{ gridColumn: 'span 2' }}><div className="k">发票接收</div><div className="v">{r.invoice_recipient || '—'}</div></div>
      <div style={{ gridColumn: 'span 2' }}><div className="k">备注</div><div className="v">{r.notes || '—'}</div></div>
    </div>
  );

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="平台" style={{ width: 140 }} value={platform} onChange={(v) => { setPlatform(v); setPage(1); }}
            options={['CBJ+小程序', '商学院APP', '淘宝发行部'].map((p) => ({ label: p, value: p }))} />
          <Select allowClear placeholder="票种" style={{ width: 100 }} value={taxCat} onChange={(v) => { setTaxCat(v); setPage(1); }}
            options={[{ label: '普票', value: '普票' }, { label: '专票', value: '专票' }]} />
          <Select allowClear placeholder="挂单" style={{ width: 120 }} value={linked} onChange={(v) => { setLinked(v); setPage(1); }}
            options={[{ label: '已挂单', value: true }, { label: '未挂单', value: false }]} />
          <Input.Search allowClear placeholder="搜索 姓名 / 抬头 / 订单号" style={{ width: 240 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Space>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增收款发票</Button>}
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入收款发票</Button>
        </Space>
      </Flex>
      <Card styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">
          共 <b>{q.data?.total ?? 0}</b> 条 <span className="sep">·</span> 合计金额 <b>¥{(q.data?.summary.total_amount ?? 0).toLocaleString()}</b> <span className="sep">·</span> 合计到款 <b>¥{(q.data?.summary.total_net ?? 0).toLocaleString()}</b>
          {(q.data?.summary.unlinked_count ?? 0) > 0 && <><span className="sep">·</span> <span className="warn"><b>{q.data?.summary.unlinked_count}</b> 条未挂单</span></>}
        </div>
        <Table<PostalFinance> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small"
          expandable={{ expandedRowRender: renderFinanceExpand }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }} />
      </Card>
      <SimpleImportModal<FinanceImportRow>
        open={importOpen} onClose={() => setImportOpen(false)} title="导入提现发票合集" unit="条" linkedLabel="挂到订单" invalidateKey="postalFinance"
        hint="点击或拖拽含《提现发票合集》的 .xlsx（有原始订单号则精确挂单，否则按姓名兜底）"
        previewFn={previewFinanceImport} commitFn={commitFinanceImport}
        rowKey={(r, i) => `${r.payer_name}-${r.amount}-${i}`}
        columns={[
          { title: '结果', dataIndex: 'decision', width: 90, render: (d: string) => <Tag color={d === 'import' ? 'green' : 'blue'}>{d === 'import' ? '✅ 导入' : '♻ 重复'}</Tag> },
          { title: '姓名', dataIndex: 'payer_name', width: 100 },
          { title: '商品', dataIndex: 'product', width: 120, ellipsis: true },
          { title: '金额', dataIndex: 'amount', width: 90, align: 'right', render: (v: string | null) => v ? `¥${v}` : '—' },
          { title: '票种', dataIndex: 'tax_category', width: 70 },
          { title: '平台', dataIndex: 'platform', width: 120 },
          { title: '挂单', key: 'link', width: 100, render: (_: unknown, r) => r.linked ? <Tag color="green">{r.link_by === 'order_no' ? '订单号' : '姓名'}</Tag> : <Text type="secondary">未挂</Text> },
        ]}
      />
      <FinanceFormModal open={formOpen} editing={editing} onClose={() => { setFormOpen(false); setEditing(null); }} />
    </>
  );
}
