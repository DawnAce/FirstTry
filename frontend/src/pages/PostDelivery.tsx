import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  InboxOutlined,
  PlusOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { listPartners } from '../api/contracts';
import {
  addComplaintHandling,
  applyAddressChange,
  commitAddressChangeImport,
  commitComplaintImport,
  commitFollowUpImport,
  commitPostalImport,
  createAddressChange,
  createComplaint,
  createDelivery,
  createFollowUp,
  deleteAddressChange,
  deleteComplaint,
  deleteComplaintHandling,
  deleteDelivery,
  deleteFollowUp,
  getAddressChange,
  getComplaintDetail,
  getFollowUp,
  listDeliveries,
  listTickets,
  previewAddressChangeImport,
  previewComplaintImport,
  previewFollowUpImport,
  previewPostalImport,
  updateAddressChange,
  updateComplaint,
  updateDelivery,
  updateFollowUp,
} from '../api/postal';
import type {
  AddrImportRow,
  ComplaintImportPreview,
  ComplaintImportRow,
  DeliveryPayload,
  FollowImportRow,
  PostalAddressChange,
  PostalComplaint,
  PostalComplaintHandling,
  PostalComplaintStatus,
  PostalDelivery,
  PostalFollowUp,
  PostalImportDecision,
  PostalImportPreview,
  PostalImportRow,
  SimpleImportPreview,
  Ticket,
  TicketType,
} from '../api/postal';

const { Title, Text } = Typography;

const DECISION_META: Record<PostalImportDecision, { label: string; color: string }> = {
  import: { label: '✅ 导入', color: 'green' },
  duplicate: { label: '♻ 重复', color: 'blue' },
  unresolved: { label: '⚠ 待确认', color: 'red' },
};

const COMPLAINT_STATUS_META: Record<PostalComplaintStatus, { label: string; color: string }> = {
  open: { label: '待处理', color: 'orange' },
  in_progress: { label: '处理中', color: 'blue' },
  resolved: { label: '已解决', color: 'green' },
};

const COMPLAINT_STATUS_OPTS = [
  { label: '待处理', value: 'open' },
  { label: '处理中', value: 'in_progress' },
  { label: '已解决', value: 'resolved' },
];

const POSTAL_CHANNELS = ['CBJ+小程序', '中经报有赞', '淘宝发行部', '对公转账'];
const YEAR_OPTS = [2024, 2025, 2026].map((y) => ({ label: `${y}年`, value: y }));
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1} 月`, value: i + 1 }));
const POSTAL_SOURCE_META: Record<string, { label: string; color: string }> = {
  subscription_generated: { label: '订报生成', color: 'green' },
  historical_import: { label: '名册导入', color: 'default' },
  manual: { label: '手工', color: 'gold' },
  order_generated: { label: '订单生成', color: 'blue' },
};

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
}

const toDay = (s?: string | null): Dayjs | null => (s ? dayjs(s) : null);
const fromDay = (d?: Dayjs | null): string | null => (d ? d.format('YYYY-MM-DD') : null);
const fromDateTime = (d?: Dayjs | null): string | null => (d ? d.format('YYYY-MM-DDTHH:mm:ss') : null);

/** 新建工单时从投递名册选人；复用名册查询，不维护第二套“客户”数据。 */
function ReaderLookup({ value, onChange, onSelectReader }: {
  value?: number;
  onChange?: (value: number) => void;
  onSelectReader: (reader: PostalDelivery) => void;
}) {
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(typed.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [typed]);
  const q = useQuery({
    queryKey: ['postalReaderLookup', search],
    queryFn: () => listDeliveries({ search, page: 1, page_size: 20 }).then((r) => r.data.rows),
    enabled: search.length > 0,
    staleTime: 30_000,
  });
  const readers = q.data ?? [];
  return (
    <Select
      value={value}
      showSearch
      filterOption={false}
      loading={q.isFetching}
      placeholder="输入编号、姓名、电话或地址"
      onSearch={setTyped}
      onChange={(id: number) => {
        onChange?.(id);
        const reader = readers.find((item) => item.id === id);
        if (reader) onSelectReader(reader);
      }}
      notFoundContent={search ? (q.isFetching ? '搜索中…' : '未找到匹配读者') : '请输入检索内容'}
      options={readers.map((reader) => ({
        value: reader.id,
        label: `${reader.year}-${reader.delivery_no}｜${reader.recipient_name}｜${reader.recipient_phone || '无电话'}｜${reader.recipient_address}`,
      }))}
    />
  );
}

/** 工单「读者」列：编号+年度是否关联到投递记录。 */
function readerTag(postalDeliveryId: number | null) {
  return postalDeliveryId
    ? <Tag color="cyan" style={{ marginInlineEnd: 0 }}>已关联读者</Tag>
    : <Tag style={{ marginInlineEnd: 0 }}>未匹配</Tag>;
}

/** 邮局读者明细导入弹窗 → 投递记录 */
function ReaderImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PostalImportPreview | null>(null);
  const reset = () => { setFile(null); setPreview(null); };

  const previewMut = useMutation({
    mutationFn: () => previewPostalImport(file as File),
    onSuccess: (res) => setPreview(res.data),
    onError: (err) => message.error(errText(err)),
  });
  const commitMut = useMutation({
    mutationFn: () => commitPostalImport(preview!.session_id),
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created} 条投递记录（跳过重复 ${res.data.skipped_duplicates}）`);
      qc.invalidateQueries({ queryKey: ['postalDeliveries'] });
      reset(); onClose();
    },
    onError: (err) => message.error(errText(err)),
  });

  const counts = preview?.counts ?? {};
  const columns: TableColumnsType<PostalImportRow> = [
    { title: '结果', dataIndex: 'decision', width: 90, render: (d: PostalImportDecision) => <Tag color={DECISION_META[d].color}>{DECISION_META[d].label}</Tag> },
    { title: '编号', dataIndex: 'delivery_no', width: 100 },
    { title: '年度', dataIndex: 'year', width: 70, render: (v: number | null) => v ?? '—' },
    { title: '收报人', dataIndex: 'name', width: 100 },
    { title: '金额', dataIndex: 'amount', width: 80, align: 'right', render: (v: string) => `¥${v}` },
    { title: '覆盖期', dataIndex: 'coverage_label', width: 180 },
    { title: '投递单位', dataIndex: 'distribution_unit', width: 120, render: (v: string) => v || <Text type="secondary">—(未填)</Text> },
    { title: '原因 / 提醒', key: 'note', render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        {r.reason && <Text type="secondary" style={{ fontSize: 12 }}>{r.reason}</Text>}
        {r.warnings.map((w, i) => <Text key={i} type="warning" style={{ fontSize: 12 }}>⚠ {w}</Text>)}
      </Space>
    ) },
  ];

  return (
    <Modal title="导入邮局读者明细" open={open} onCancel={() => { reset(); onClose(); }} width={920} footer={null} destroyOnClose>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Upload.Dragger maxCount={1} accept=".xlsx"
          beforeUpload={(f) => { setFile(f); setPreview(null); return false; }}
          onRemove={() => reset()} fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽《报纸邮局投递明细》.xlsx 到此处</p>
          <p className="ant-upload-hint">自动识别「邮局读者明细」工作表 → 投递记录（不造订单）；按 年度+编号 去重</p>
        </Upload.Dragger>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => previewMut.mutate()} loading={previewMut.isPending} disabled={!file}>预览导入</Button>
        {preview && (
          <>
            <Space wrap>
              <Tag color="green">导入 {counts.import ?? 0}</Tag>
              <Tag color="blue">重复 {counts.duplicate ?? 0}</Tag>
              <Tag color="red">待确认 {counts.unresolved ?? 0}</Tag>
              <Text type="secondary">共 {counts.total ?? 0} 行</Text>
              <span style={{ marginLeft: 'auto' }} />
              {isAdmin
                ? <Button type="primary" onClick={() => commitMut.mutate()} loading={commitMut.isPending} disabled={!preview.can_commit}>确认导入 {counts.import ?? 0} 条</Button>
                : <Text type="secondary">确认导入需管理员权限</Text>}
            </Space>
            <Table<PostalImportRow> rowKey={(r, i) => `${r.delivery_no}-${i}`} columns={columns} dataSource={preview.rows} size="small" pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 行` }} scroll={{ x: 800, y: 360 }} />
          </>
        )}
      </Space>
    </Modal>
  );
}

/** 邮局投诉导入弹窗 */
function ComplaintImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ComplaintImportPreview | null>(null);
  const reset = () => { setFile(null); setPreview(null); };

  const previewMut = useMutation({
    mutationFn: () => previewComplaintImport(file as File),
    onSuccess: (res) => setPreview(res.data),
    onError: (err) => message.error(errText(err)),
  });
  const commitMut = useMutation({
    mutationFn: () => commitComplaintImport(preview!.session_id),
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created} 条投诉（跳过重复 ${res.data.skipped_duplicates}）`);
      qc.invalidateQueries({ queryKey: ['postalComplaints'] });
      reset(); onClose();
    },
    onError: (err) => message.error(errText(err)),
  });

  const counts = preview?.counts ?? {};
  const columns: TableColumnsType<ComplaintImportRow> = [
    { title: '结果', dataIndex: 'decision', width: 90, render: (d: string) => <Tag color={d === 'import' ? 'green' : 'blue'}>{d === 'import' ? '✅ 导入' : '♻ 重复'}</Tag> },
    { title: '编号', dataIndex: 'external_order_no', width: 130, render: (v: string, r) => <Space size={4}>{v}{r.linked && <Tag color="cyan" style={{ marginInlineEnd: 0 }}>已关联读者</Tag>}</Space> },
    { title: '收报人', dataIndex: 'name', width: 90 },
    { title: '接诉日期', dataIndex: 'complaint_date', width: 110 },
    { title: '投诉情况', dataIndex: 'missing_issues', ellipsis: true },
    { title: '处理', dataIndex: 'routed_label', width: 110, render: (v: string | null) => v ? <Tag>{v}</Tag> : '—' },
    { title: '状态', dataIndex: 'status', width: 90, render: (s: PostalComplaintStatus) => <Tag color={COMPLAINT_STATUS_META[s].color}>{COMPLAINT_STATUS_META[s].label}</Tag> },
  ];

  return (
    <Modal title="导入邮局投诉" open={open} onCancel={() => { reset(); onClose(); }} width={920} footer={null} destroyOnClose>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Upload.Dragger maxCount={1} accept=".xlsx"
          beforeUpload={(f) => { setFile(f); setPreview(null); return false; }}
          onRemove={() => reset()} fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽含《邮局年投诉》的 .xlsx 到此处</p>
          <p className="ant-upload-hint">自动识别「邮局年投诉」工作表；按 年度+编号 关联读者（投递记录）</p>
        </Upload.Dragger>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => previewMut.mutate()} loading={previewMut.isPending} disabled={!file}>预览导入</Button>
        {preview && (
          <>
            <Space wrap>
              <Tag color="green">导入 {counts.import ?? 0}</Tag>
              <Tag color="blue">重复 {counts.duplicate ?? 0}</Tag>
              <Tag color="cyan">已关联读者 {counts.linked ?? 0}</Tag>
              <Text type="secondary">共 {counts.total ?? 0} 行</Text>
              <span style={{ marginLeft: 'auto' }} />
              {isAdmin
                ? <Button type="primary" onClick={() => commitMut.mutate()} loading={commitMut.isPending} disabled={!preview.can_commit}>确认导入 {counts.import ?? 0} 条</Button>
                : <Text type="secondary">确认导入需管理员权限</Text>}
            </Space>
            <Table<ComplaintImportRow> rowKey={(r, i) => `${r.external_order_no}-${r.complaint_date}-${i}`} columns={columns} dataSource={preview.rows} size="small" pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 行` }} scroll={{ x: 800, y: 360 }} />
          </>
        )}
      </Space>
    </Modal>
  );
}

/** Tab：投递名册（全部投递记录） */
function DeliveriesTab() {
  const [year, setYear] = useState<number | undefined>();
  const [month, setMonth] = useState<number | undefined>();
  const [channel, setChannel] = useState<string | undefined>();
  const [unitId, setUnitId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PostalDelivery | null>(null);
  const [detail, setDetail] = useState<PostalDelivery | null>(null);
  const PAGE_SIZE = 50;
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteDelivery(id),
    onSuccess: () => { message.success('已删除投递记录'); qc.invalidateQueries({ queryKey: ['postalDeliveries'] }); },
    onError: (e) => message.error(errText(e)),
  });

  const unitsQ = useQuery({ queryKey: ['partners'], queryFn: () => listPartners().then((r) => r.data) });
  const unitOpts = (unitsQ.data ?? []).filter((p) => p.partner_type === 'distribution').map((p) => ({ label: p.name, value: p.id }));

  const q = useQuery({
    queryKey: ['postalDeliveries', { year, month, channel, unitId, search, page }],
    queryFn: () => listDeliveries({
      year, month, channel, distribution_unit_id: unitId,
      search: search.trim() || undefined, page, page_size: PAGE_SIZE,
    }).then((r) => r.data),
  });

  const cols: TableColumnsType<PostalDelivery> = [
    { title: '读者', key: 'reader', width: 150, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Text strong>{r.recipient_name}</Text>
        <Text type="secondary" className="postal-cell-secondary">{r.year}-{r.delivery_no}</Text>
      </Space>
    ) },
    { title: '地址', key: 'addr', render: (_: unknown, r) => (
      <Space direction="vertical" size={0} style={{ maxWidth: 380 }}>
        <Text strong>{[r.recipient_province, r.recipient_city, r.recipient_district].filter(Boolean).join(' · ') || '—'}</Text>
        <Text type="secondary" className="postal-cell-secondary" ellipsis>{r.recipient_address}</Text>
      </Space>
    ) },
    { title: '订阅', key: 'coverage', width: 150, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Text>{r.copies} 份</Text>
        <Text type="secondary" className="postal-cell-secondary">
          {r.coverage_start_date ? dayjs(r.coverage_start_date).format('YYYY.MM') : '—'}—{r.coverage_end_date ? dayjs(r.coverage_end_date).format('YYYY.MM') : '—'}
        </Text>
      </Space>
    ) },
    { title: '渠道 / 投递单位', key: 'fulfillment', width: 190, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Text>{r.source_channel || '—'}</Text>
        <Text type="secondary" className="postal-cell-secondary">{r.distribution_unit_name || '待补投递单位'}</Text>
      </Space>
    ) },
    { title: '操作', key: 'act', width: 72, align: 'right', render: (_: unknown, r) => (
      <Button type="link" size="small" onClick={() => setDetail(r)}>查看</Button>
    ) },
  ];

  return (
    <>
      <Flex className="postal-page-head" justify="space-between" align="flex-start" wrap gap={12}>
        <div>
          <Title level={3} className="postal-page-title">投递名册</Title>
          <Text type="secondary">投递记录 {(q.data?.total ?? 0).toLocaleString()} 条</Text>
        </div>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入</Button>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增记录</Button>}
        </Space>
      </Flex>
      <Flex className="postal-toolbar" wrap gap={8}>
        <Input.Search allowClear placeholder="搜索姓名、编号或地址" style={{ width: 300 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); if (v == null) setMonth(undefined); setPage(1); }} options={YEAR_OPTS} />
        <Select allowClear placeholder="渠道" style={{ width: 150 }} value={channel} onChange={(v) => { setChannel(v); setPage(1); }} options={POSTAL_CHANNELS.map((c) => ({ label: c, value: c }))} />
        <Dropdown trigger={['click']} dropdownRender={() => (
          <Card size="small">
            <Space direction="vertical">
              <Select allowClear placeholder="起投月" style={{ width: 180 }} value={month} disabled={year == null} onChange={(v) => { setMonth(v); setPage(1); }} options={MONTH_OPTS} />
              <Select allowClear showSearch optionFilterProp="label" placeholder="投递单位" style={{ width: 180 }} value={unitId} onChange={(v) => { setUnitId(v); setPage(1); }} options={unitOpts} />
            </Space>
          </Card>
        )}>
          <Button>更多筛选{month != null || unitId != null ? ' · 已选' : ''}</Button>
        </Dropdown>
      </Flex>
      <Card className="postal-table-card" styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">
          合计 <b>{(q.data?.summary.total_copies ?? 0).toLocaleString()}</b> 份 <span className="sep">·</span> <b>{q.data?.summary.unit_count ?? 0}</b> 家投递单位
          {(q.data?.summary.missing_unit_count ?? 0) > 0 && <><span className="sep">·</span> <span className="warn"><b>{q.data?.summary.missing_unit_count}</b> 条未填单位</span></>}
        </div>
        <Table<PostalDelivery> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small"
          scroll={{ x: 900 }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条投递记录`, showSizeChanger: false }} />
      </Card>
      <ReaderImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <DeliveryDetailDrawer record={detail} isAdmin={isAdmin} deleting={deleteMut.isPending}
        onClose={() => setDetail(null)}
        onEdit={(record) => { setDetail(null); setEditing(record); setFormOpen(true); }}
        onDelete={(record) => deleteMut.mutate(record.id, { onSuccess: () => setDetail(null) })} />
      <DeliveryFormDrawer open={formOpen} editing={editing} unitOpts={unitOpts} onClose={() => { setFormOpen(false); setEditing(null); }} />
    </>
  );
}

/** 通用导入弹窗（改地址 / 回访 / 收款发票共用：counts import/duplicate/linked + 可配置列） */
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

type UnitOpt = { label: string; value: number };

/** 投递记录 · 新增 / 编辑 */
function DeliveryFormDrawer({ open, editing, unitOpts, onClose }: {
  open: boolean; editing: PostalDelivery | null; unitOpts: UnitOpt[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        amount: editing.amount != null ? Number(editing.amount) : undefined,
        coverage_start_date: toDay(editing.coverage_start_date),
        coverage_end_date: toDay(editing.coverage_end_date),
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ copies: 1 });
    }
  }, [open, editing, form]);

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body: DeliveryPayload = {
        ...v,
        amount: v.amount ?? null,
        coverage_start_date: fromDay(v.coverage_start_date),
        coverage_end_date: fromDay(v.coverage_end_date),
      };
      return editing ? updateDelivery(editing.id, body) : createDelivery(body);
    },
    onSuccess: () => {
      message.success(editing ? '投递记录已更新' : '投递记录已新增');
      qc.invalidateQueries({ queryKey: ['postalDeliveries'] });
      onClose();
    },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Drawer title={editing ? '编辑投递记录' : '新增投递记录'} open={open} onClose={onClose}
      width={720} destroyOnClose footer={(
        <Flex justify="flex-end" gap={8}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMut.isPending} onClick={() => form.submit()}>保存</Button>
        </Flex>
      )}>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" rules={[{ required: true, message: '必填' }]} style={{ width: 120 }}>
            <InputNumber style={{ width: '100%' }} min={2000} max={2100} />
          </Form.Item>
          <Form.Item name="delivery_no" label="编号" rules={[{ required: true, message: '必填' }]} style={{ width: 140 }}><Input /></Form.Item>
          <Form.Item name="recipient_name" label="收报人" rules={[{ required: true, message: '必填' }]} style={{ width: 140 }}><Input /></Form.Item>
          <Form.Item name="recipient_phone" label="电话" style={{ width: 160 }}><Input /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="recipient_province" label="省" style={{ width: 110 }}><Input /></Form.Item>
          <Form.Item name="recipient_city" label="市" style={{ width: 110 }}><Input /></Form.Item>
          <Form.Item name="recipient_district" label="区" style={{ width: 110 }}><Input /></Form.Item>
          <Form.Item name="recipient_postal_code" label="邮编" style={{ width: 110 }}><Input /></Form.Item>
        </Flex>
        <Form.Item name="recipient_address" label="详细地址" rules={[{ required: true, message: '必填' }]}><Input /></Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="product" label="产品" style={{ width: 160 }}><Input /></Form.Item>
          <Form.Item name="copies" label="份数" style={{ width: 100 }}><InputNumber style={{ width: '100%' }} min={1} /></Form.Item>
          <Form.Item name="amount" label="金额" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={0} precision={2} /></Form.Item>
          <Form.Item name="coverage_start_date" label="起投日期" style={{ width: 150 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="coverage_end_date" label="止投日期" style={{ width: 150 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="source_channel" label="渠道" style={{ width: 170 }}>
            <Select allowClear options={POSTAL_CHANNELS.map((c) => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item name="distribution_unit_id" label="投递单位" style={{ width: 190 }}>
            <Select allowClear showSearch optionFilterProp="label" options={unitOpts} />
          </Form.Item>
          <Form.Item name="salesperson" label="业务员" style={{ width: 120 }}><Input /></Form.Item>
          <Form.Item name="remittance_name" label="汇款名" style={{ width: 150 }}><Input /></Form.Item>
        </Flex>
        <Form.Item name="external_order_no" label="平台订单号（可选）"><Input /></Form.Item>
      </Form>
    </Drawer>
  );
}

function DeliveryDetailDrawer({ record, isAdmin, deleting, onClose, onEdit, onDelete }: {
  record: PostalDelivery | null;
  isAdmin: boolean;
  deleting: boolean;
  onClose: () => void;
  onEdit: (record: PostalDelivery) => void;
  onDelete: (record: PostalDelivery) => void;
}) {
  const source = record?.source_type ? POSTAL_SOURCE_META[record.source_type] : null;
  return (
    <Drawer title="投递记录详情" open={record != null} onClose={onClose} width={560} destroyOnClose
      extra={isAdmin && record ? <Button icon={<EditOutlined />} onClick={() => onEdit(record)}>编辑记录</Button> : null}
      footer={isAdmin && record ? (
        <Flex justify="space-between" align="center">
          <Popconfirm title="删除该投递记录？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => onDelete(record)}>
            <Button danger icon={<DeleteOutlined />} loading={deleting}>删除记录</Button>
          </Popconfirm>
          <Button onClick={onClose}>返回列表</Button>
        </Flex>
      ) : null}>
      {record && (
        <Space direction="vertical" size={20} style={{ width: '100%' }}>
          <Flex gap={12} align="center">
            <div className="postal-reader-avatar">{record.recipient_name.slice(0, 1)}</div>
            <div>
              <Title level={5} style={{ margin: 0 }}>{record.recipient_name}</Title>
              <Text type="secondary">{record.year}-{record.delivery_no}{record.recipient_phone ? ` · ${record.recipient_phone}` : ''}</Text>
            </div>
          </Flex>
          <div>
            <Title level={5}>投递信息</Title>
            <Descriptions size="small" column={1} bordered items={[
              { key: 'address', label: '详细地址', children: [record.recipient_province, record.recipient_city, record.recipient_district, record.recipient_address].filter(Boolean).join(' ') || '—' },
              { key: 'postal', label: '邮编', children: record.recipient_postal_code || '—' },
              { key: 'coverage', label: '订阅范围', children: `${record.coverage_start_date || '—'} 至 ${record.coverage_end_date || '—'} · ${record.copies}份` },
              { key: 'product', label: '产品', children: record.product || '—' },
              { key: 'channel', label: '渠道', children: record.source_channel || '—' },
              { key: 'unit', label: '投递单位', children: record.distribution_unit_name || '待补投递单位' },
              { key: 'source', label: '来源', children: source ? <Tag color={source.color}>{source.label}</Tag> : '—' },
            ]} />
          </div>
          <div>
            <Title level={5}>业务信息</Title>
            <Descriptions size="small" column={1} bordered items={[
              { key: 'amount', label: '金额', children: record.amount != null ? `¥${record.amount}` : '—' },
              { key: 'sales', label: '业务员', children: record.salesperson || '—' },
              { key: 'remit', label: '汇款名', children: record.remittance_name || '—' },
              { key: 'order', label: '平台订单', children: record.external_order_no || (record.order_id ? `订单 #${record.order_id}` : '未关联') },
            ]} />
          </div>
        </Space>
      )}
    </Drawer>
  );
}

/** 投诉 · 新增 / 编辑（基础字段；处理流程见处理抽屉） */
function ComplaintFormModal({ open, editing, unitOpts, onClose }: {
  open: boolean; editing: PostalComplaint | null; unitOpts: UnitOpt[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, complaint_date: toDay(editing.complaint_date) });
    else { form.resetFields(); form.setFieldsValue({ status: 'open' }); }
  }, [open, editing, form]);

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body = { ...v, complaint_date: fromDay(v.complaint_date) };
      delete body.postal_delivery_id;
      return editing ? updateComplaint(editing.id, body) : createComplaint(body);
    },
    onSuccess: () => {
      message.success(editing ? '投诉已更新' : '投诉已新增');
      qc.invalidateQueries({ queryKey: ['postalComplaints'] });
      qc.invalidateQueries({ queryKey: ['postalTickets'] });
      onClose();
    },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑投诉' : '新增投诉'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={640} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        {!editing && (
          <Form.Item name="postal_delivery_id" label="关联读者" rules={[{ required: true, message: '请先从投递名册选择读者' }]}
            extra="可按年度编号（如 2026-6325）、姓名、电话或地址搜索">
            <ReaderLookup onSelectReader={(reader) => form.setFieldsValue({
              year: reader.year,
              delivery_no: reader.delivery_no,
              snap_name: reader.recipient_name,
              snap_phone: reader.recipient_phone,
              snap_address: reader.recipient_address,
              routed_unit_id: reader.distribution_unit_id,
            })} />
          </Form.Item>
        )}
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" style={{ width: 120 }}><InputNumber disabled={!editing} style={{ width: '100%' }} min={2000} max={2100} /></Form.Item>
          <Form.Item name="delivery_no" label="编号" style={{ width: 180 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="complaint_date" label="接诉日期" style={{ width: 160 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Form.Item name="missing_issues" label="投诉情况"><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="handling" label="处理情况（自动归一渠道单位）" style={{ flex: 1, minWidth: 240 }}><Input placeholder="如 转北京11185" /></Form.Item>
          <Form.Item name="routed_unit_id" label="投递单位" style={{ width: 180 }}><Select allowClear showSearch optionFilterProp="label" options={unitOpts} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="snap_name" label="收报人（名册快照）" style={{ width: 220 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="snap_phone" label="电话" style={{ width: 150 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="first_handler" label="第一接诉人" style={{ width: 130 }}><Input /></Form.Item>
          <Form.Item name="status" label="状态" style={{ width: 130 }}><Select options={COMPLAINT_STATUS_OPTS} /></Form.Item>
        </Flex>
        <Form.Item name="snap_address" label="地址（名册快照）"><Input disabled={!editing} /></Form.Item>
        <Form.Item name="notes" label="备注"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

/** 投诉处理抽屉：三态时间线 + 登记处理 */
function ComplaintHandlingDrawer({ complaintId, onClose }: { complaintId: number | null; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const [editingFollow, setEditingFollow] = useState<PostalFollowUp | null>(null);
  const open = complaintId != null;

  const detailQ = useQuery({
    queryKey: ['postalComplaintDetail', complaintId],
    queryFn: () => getComplaintDetail(complaintId as number).then((r) => r.data),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['postalComplaints'] });
    qc.invalidateQueries({ queryKey: ['postalTickets'] });
    qc.invalidateQueries({ queryKey: ['postalComplaintDetail', complaintId] });
  };
  const addMut = useMutation({
    mutationFn: (v: any) => addComplaintHandling(complaintId as number, {
      action: v.action, follow_result: v.follow_result || null, result_status: v.result_status,
    }),
    onSuccess: () => { message.success('已登记一次处理'); form.resetFields(); form.setFieldsValue({ result_status: 'in_progress' }); invalidate(); },
    onError: (e) => message.error(errText(e)),
  });
  const delMut = useMutation({
    mutationFn: async (event: PostalComplaintHandling) => {
      if (event.source_ticket_id) await deleteFollowUp(event.source_ticket_id);
      else await deleteComplaintHandling(complaintId as number, event.id);
    },
    onSuccess: () => { message.success('已删除该时间线记录'); invalidate(); },
    onError: (e) => message.error(errText(e)),
  });
  const editFollow = async (id: number) => {
    try {
      setEditingFollow((await getFollowUp(id)).data);
    } catch (e) {
      message.error(errText(e));
    }
  };

  const detail = detailQ.data;
  const c = detail?.complaint;

  return (<>
    <Drawer title="投诉处理" width={560} open={open} onClose={onClose} destroyOnClose>
      {!c ? <Empty description={detailQ.isLoading ? '加载中…' : '无数据'} /> : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered items={[
            { key: 's', label: '状态', children: <Tag color={COMPLAINT_STATUS_META[c.status].color}>{COMPLAINT_STATUS_META[c.status].label}</Tag> },
            { key: 'n', label: '收报人', children: c.snap_name || '—' },
            { key: 'no', label: '编号', children: c.external_order_no || '—' },
            { key: 'm', label: '投诉情况', children: c.missing_issues || '—' },
            { key: 'cnt', label: '处理次数', children: c.handling_count ?? 0 },
          ]} />

          {isAdmin && (
            <Card size="small" title="登记一次处理">
              <Form form={form} layout="vertical" initialValues={{ result_status: 'in_progress' }} onFinish={(v) => addMut.mutate(v)}>
                <Form.Item name="action" label="处理过程" rules={[{ required: true, message: '必填' }]}>
                  <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder="本次做了什么" />
                </Form.Item>
                <Flex gap={12} wrap>
                  <Form.Item name="result_status" label="处理后状态" style={{ width: 160 }}><Select options={COMPLAINT_STATUS_OPTS} /></Form.Item>
                  <Form.Item name="follow_result" label="回访结果（可选）" style={{ flex: 1, minWidth: 200 }}><Input /></Form.Item>
                </Flex>
                <Button type="primary" htmlType="submit" loading={addMut.isPending}>提交处理</Button>
              </Form>
            </Card>
          )}

          <div>
            <Divider plain style={{ marginTop: 0 }}>工单时间线</Divider>
            {(detail?.handlings.length ?? 0) === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无处理记录" />
            ) : (
              <Timeline items={detail!.handlings.map((h: PostalComplaintHandling) => ({
                color: h.event_type === 'follow_up' ? 'green' : (h.result_status === 'resolved' ? 'green' : (h.result_status === 'in_progress' ? 'blue' : 'gray')),
                children: (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space size={8} wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>{h.handled_at?.replace('T', ' ').slice(0, 16)}</Text>
                      {h.handled_by_name && <Tag>{h.handled_by_name}</Tag>}
                      {h.event_type === 'follow_up' && <Tag color="green">回访</Tag>}
                      {h.result_status && <Tag color={COMPLAINT_STATUS_META[h.result_status as PostalComplaintStatus].color}>{COMPLAINT_STATUS_META[h.result_status as PostalComplaintStatus].label}</Tag>}
                      {isAdmin && h.source_ticket_id && <Button type="text" size="small" icon={<EditOutlined />} title="编辑回访" onClick={() => editFollow(h.source_ticket_id as number)} />}
                      {isAdmin && <Popconfirm title={h.event_type === 'follow_up' ? '删除该回访记录？' : '删除该处理记录？次数与状态会回退。'} onConfirm={() => delMut.mutate(h)}><Button type="link" size="small" danger>删除</Button></Popconfirm>}
                    </Space>
                    <Text>{h.action}</Text>
                    {h.follow_result && <Text type="secondary" style={{ fontSize: 12 }}>回访：{h.follow_result}</Text>}
                  </Space>
                ),
              }))} />
            )}
          </div>
        </Space>
      )}
    </Drawer>
    <FollowUpFormModal
      open={editingFollow != null}
      editing={editingFollow}
      onClose={() => setEditingFollow(null)}
      onSaved={invalidate}
    />
  </>);
}

/** 改地址 · 新增 / 编辑 */
function AddressChangeFormModal({ open, editing, onClose }: {
  open: boolean; editing: PostalAddressChange | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, change_date: toDay(editing.change_date) });
    else { form.resetFields(); form.setFieldsValue({ change_date: dayjs() }); }
  }, [open, editing, form]);

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body = { ...v, change_date: fromDateTime(v.change_date) };
      delete body.postal_delivery_id;
      return editing ? updateAddressChange(editing.id, body) : createAddressChange(body);
    },
    onSuccess: () => { message.success(editing ? '改地址已更新' : '改地址已新增'); qc.invalidateQueries({ queryKey: ['postalAddrChanges'] }); qc.invalidateQueries({ queryKey: ['postalTickets'] }); onClose(); },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑改地址' : '新增改地址'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={640} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        {!editing && (
          <Form.Item name="postal_delivery_id" label="关联读者" rules={[{ required: true, message: '请先从投递名册选择读者' }]}
            extra="可按年度编号（如 2026-6325）、姓名、电话或地址搜索；选中后自动带入原信息">
            <ReaderLookup onSelectReader={(reader) => form.setFieldsValue({
              year: reader.year,
              delivery_no: reader.delivery_no,
              old_name: reader.recipient_name,
              old_phone: reader.recipient_phone,
              old_address: reader.recipient_address,
              old_copies: reader.copies,
              original_start_month: reader.coverage_start_date ? dayjs(reader.coverage_start_date).format('MMDD') : null,
            })} />
          </Form.Item>
        )}
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" style={{ width: 120 }}><InputNumber disabled={!editing} style={{ width: '100%' }} min={2000} max={2100} /></Form.Item>
          <Form.Item name="delivery_no" label="编号" style={{ width: 180 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="change_date" label="修改日期时间" style={{ width: 210 }}>
            <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
          </Form.Item>
        </Flex>
        <Divider plain>原始信息（从投递名册带入）</Divider>
        <Flex gap={12} wrap>
          <Form.Item name="old_name" label="原姓名" style={{ width: 150 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="old_phone" label="原电话" style={{ width: 160 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="old_copies" label="原份数" style={{ width: 110 }}><InputNumber disabled={!editing} style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Form.Item name="old_address" label="原地址"><Input disabled={!editing} /></Form.Item>
        <Divider plain>修改后信息</Divider>
        <Flex gap={12} wrap>
          <Form.Item name="new_name" label="新姓名" style={{ width: 150 }}><Input /></Form.Item>
          <Form.Item name="new_phone" label="新电话" style={{ width: 160 }}><Input /></Form.Item>
          <Form.Item name="new_copies" label="新份数" style={{ width: 110 }}><InputNumber style={{ width: '100%' }} min={0} /></Form.Item>
        </Flex>
        <Form.Item name="new_address" label="新地址"><Input /></Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="original_start_month" label="原起月日" style={{ width: 150 }}><Input /></Form.Item>
          <Form.Item name="effective_start_month" label="实际起月日" style={{ width: 150 }}><Input /></Form.Item>
          <Form.Item name="handling" label="处理情况" style={{ flex: 1, minWidth: 200 }}><Input placeholder="如 转北京局微信" /></Form.Item>
        </Flex>
        <Form.Item name="notes" label="备注"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

/** 回访 · 新增 / 编辑 */
function FollowUpFormModal({ open, editing, onClose, onSaved }: {
  open: boolean; editing: PostalFollowUp | null; onClose: () => void; onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, follow_up_date: toDay(editing.follow_up_date) });
    else form.resetFields();
  }, [open, editing, form]);

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body = { ...v, follow_up_date: fromDay(v.follow_up_date) };
      delete body.postal_delivery_id;
      return editing ? updateFollowUp(editing.id, body) : createFollowUp(body);
    },
    onSuccess: () => { message.success(editing ? '回访已更新' : '回访已新增'); qc.invalidateQueries({ queryKey: ['postalFollowUps'] }); qc.invalidateQueries({ queryKey: ['postalTickets'] }); onSaved?.(); onClose(); },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑回访' : '新增回访'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={560} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        {!editing && (
          <Form.Item name="postal_delivery_id" label="关联读者" rules={[{ required: true, message: '请先从投递名册选择读者' }]}
            extra="可按年度编号（如 2026-6325）、姓名、电话或地址搜索">
            <ReaderLookup onSelectReader={(reader) => form.setFieldsValue({
              year: reader.year,
              delivery_no: reader.delivery_no,
              snap_name: reader.recipient_name,
            })} />
          </Form.Item>
        )}
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" style={{ width: 120 }}><InputNumber disabled={!editing} style={{ width: '100%' }} min={2000} max={2100} /></Form.Item>
          <Form.Item name="delivery_no" label="编号" style={{ width: 180 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="follow_up_date" label="回访日期" style={{ width: 160 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="snap_name" label="收报人（名册快照）" style={{ width: 220 }}><Input disabled={!editing} /></Form.Item>
          <Form.Item name="batch_label" label="批次列头" style={{ width: 180 }}><Input placeholder="如 20240227回访" /></Form.Item>
        </Flex>
        <Form.Item name="result" label="回访结果"><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
      </Form>
    </Modal>
  );
}

const TICKET_TYPE_META: Record<TicketType, { label: string; color: string }> = {
  complaint: { label: '投诉', color: 'red' },
  address: { label: '改地址', color: 'purple' },
  follow: { label: '回访', color: 'blue' },
};

function ticketStatusTag(t: Ticket) {
  if (t.type === 'complaint') {
    const m = t.status ? COMPLAINT_STATUS_META[t.status as PostalComplaintStatus] : null;
    return m ? <Tag color={m.color}>{m.label}</Tag> : <Text type="secondary">—</Text>;
  }
  if (t.type === 'address') {
    if (t.status === 'applied') return <Tag color="green">已应用</Tag>;
    if (t.status === 'unmatched') return <Tag>未匹配</Tag>;
    return <Tag color="orange">待应用</Tag>;
  }
  return <Text type="secondary">—</Text>;
}

/** 改地址详情抽屉：新旧对比 + 应用新地址（写回投递记录，挂单则同步履约订单）。 */
function AddressDetailDrawer({ addressId, onEdit, onClose }: {
  addressId: number | null; onEdit: (rec: PostalAddressChange) => void; onClose: () => void;
}) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const open = addressId != null;
  const q = useQuery({
    queryKey: ['postalAddrDetail', addressId],
    queryFn: () => getAddressChange(addressId as number).then((r) => r.data),
    enabled: open,
  });
  const applyMut = useMutation({
    mutationFn: () => applyAddressChange(addressId as number),
    onSuccess: () => {
      message.success('已应用新地址');
      qc.invalidateQueries({ queryKey: ['postalTickets'] });
      qc.invalidateQueries({ queryKey: ['postalAddrDetail', addressId] });
    },
    onError: (e) => message.error(errText(e)),
  });
  const a = q.data;
  return (
    <Drawer title="改地址工单" width={560} open={open} onClose={onClose} destroyOnClose
      extra={isAdmin && a && (a.applied_to_order
        ? <Text type="secondary">已应用 · 只读</Text>
        : <Button icon={<EditOutlined />} onClick={() => onEdit(a)}>编辑</Button>)}>
      {!a ? <Empty description={q.isLoading ? '加载中…' : '无数据'} /> : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="diff-row" style={{ display: 'flex', gap: 12 }}>
            <Card size="small" title="原" style={{ flex: 1, background: '#fafafa' }}>
              <div>{a.old_name || '—'}{a.old_phone ? ` / ${a.old_phone}` : ''}</div>
              <div style={{ color: '#666' }}>{a.old_address || '—'}</div>
              {a.old_copies != null && <div style={{ fontSize: 12, color: '#999' }}>份数 {a.old_copies}</div>}
            </Card>
            <Card size="small" title="新" style={{ flex: 1, background: '#f6ffed', borderColor: '#b7eb8f' }}>
              <div>{a.new_name || '—'}{a.new_phone ? ` / ${a.new_phone}` : ''}</div>
              <div style={{ color: '#237804' }}>{a.new_address || '—'}</div>
              {a.new_copies != null && <div style={{ fontSize: 12, color: '#999' }}>份数 {a.new_copies}</div>}
            </Card>
          </div>
          <Descriptions size="small" column={1} bordered items={[
            { key: 'date', label: '修改时间', children: a.change_date ? dayjs(a.change_date).format('YYYY-MM-DD HH:mm') : '—' },
            { key: 'st', label: '起月日', children: `${a.original_start_month || '—'} → ${a.effective_start_month || '—'}` },
            { key: 'h', label: '处理情况', children: a.handling || (a.routed_label ? <Tag>{a.routed_label}</Tag> : '—') },
            { key: 'r', label: '关联读者', children: readerTag(a.postal_delivery_id) },
            { key: 'no', label: '编号', children: a.external_order_no || '—' },
            { key: 'ap', label: '应用状态', children: a.applied_to_order
                ? <Tag color="green">已应用{a.order_id ? '·已同步履约订单' : '·仅名册'}</Tag>
                : (a.postal_delivery_id ? <Tag color="orange">待应用</Tag> : <Tag>未匹配（未关联读者）</Tag>) },
          ]} />
          {isAdmin && !a.applied_to_order && (
            <Popconfirm
              title="应用新地址？"
              description={a.postal_delivery_id
                ? '把新地址写回投递名册' + (a.order_id ? '，并同步该读者在履约的订单。' : '（该读者未挂订单，仅更新名册）。')
                : '该工单未关联投递记录，无法应用（请先导入读者名册）。'}
              okText="应用" onConfirm={() => applyMut.mutate()} disabled={!a.postal_delivery_id}
            >
              <Button type="primary" loading={applyMut.isPending} disabled={!a.postal_delivery_id}>✅ 应用新地址</Button>
            </Popconfirm>
          )}
          {a.notes && <Text type="secondary">备注：{a.notes}</Text>}
        </Space>
      )}
    </Drawer>
  );
}

/** 回访详情抽屉。 */
function FollowDetailDrawer({ followId, onEdit, onClose }: {
  followId: number | null; onEdit: (rec: PostalFollowUp) => void; onClose: () => void;
}) {
  const { isAdmin } = useAuth();
  const open = followId != null;
  const q = useQuery({
    queryKey: ['postalFollowDetail', followId],
    queryFn: () => getFollowUp(followId as number).then((r) => r.data),
    enabled: open,
  });
  const f = q.data;
  return (
    <Drawer title="回访记录" width={480} open={open} onClose={onClose} destroyOnClose
      extra={isAdmin && f && <Button icon={<EditOutlined />} onClick={() => onEdit(f)}>编辑</Button>}>
      {!f ? <Empty description={q.isLoading ? '加载中…' : '无数据'} /> : (
        <Descriptions size="small" column={1} bordered items={[
          { key: 'd', label: '回访日期', children: f.follow_up_date || '—' },
          { key: 'n', label: '收报人', children: f.snap_name || '—' },
          { key: 'no', label: '编号', children: f.external_order_no || '—' },
          { key: 'b', label: '批次列头', children: f.batch_label || '—' },
          { key: 'r', label: '回访结果', children: <span style={{ whiteSpace: 'pre-wrap' }}>{f.result || '—'}</span> },
          { key: 'link', label: '关联读者', children: readerTag(f.postal_delivery_id) },
        ]} />
      )}
    </Drawer>
  );
}

/** Tab：客服工单（投诉 / 改地址 / 回访 统一） */
function TicketsTab() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState<TicketType | undefined>();
  const [year, setYear] = useState<number | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [applied, setApplied] = useState<boolean | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // 详情抽屉
  const [handlingId, setHandlingId] = useState<number | null>(null);
  const [addressDetailId, setAddressDetailId] = useState<number | null>(null);
  const [followDetailId, setFollowDetailId] = useState<number | null>(null);
  // 导入弹窗
  const [importType, setImportType] = useState<TicketType | null>(null);
  // 表单弹窗（新增/编辑，需完整记录）
  const [complaintForm, setComplaintForm] = useState<{ open: boolean; editing: PostalComplaint | null }>({ open: false, editing: null });
  const [addressForm, setAddressForm] = useState<{ open: boolean; editing: PostalAddressChange | null }>({ open: false, editing: null });
  const [followForm, setFollowForm] = useState<{ open: boolean; editing: PostalFollowUp | null }>({ open: false, editing: null });

  const unitsQ = useQuery({ queryKey: ['partners'], queryFn: () => listPartners().then((r) => r.data) });
  const unitOpts = (unitsQ.data ?? []).filter((p) => p.partner_type === 'distribution').map((p) => ({ label: p.name, value: p.id }));

  const q = useQuery({
    queryKey: ['postalTickets', { type, year, status, applied, search, page }],
    queryFn: () => listTickets({
      type, year, status: type === 'complaint' ? status : undefined,
      applied: type === 'address' ? applied : undefined,
      search: search.trim() || undefined, page, page_size: PAGE_SIZE,
    }).then((r) => r.data),
  });
  const data = q.data;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['postalTickets'] });
  const delComplaint = useMutation({ mutationFn: (id: number) => deleteComplaint(id), onSuccess: () => { message.success('已删除投诉'); invalidate(); }, onError: (e) => message.error(errText(e)) });
  const delAddress = useMutation({ mutationFn: (id: number) => deleteAddressChange(id), onSuccess: () => { message.success('已删除改地址'); invalidate(); }, onError: (e) => message.error(errText(e)) });
  const delFollow = useMutation({ mutationFn: (id: number) => deleteFollowUp(id), onSuccess: () => { message.success('已删除回访'); invalidate(); }, onError: (e) => message.error(errText(e)) });

  const openDetail = (t: Ticket) => {
    if (t.type === 'complaint') setHandlingId(t.id);
    else if (t.type === 'address') setAddressDetailId(t.id);
    else setFollowDetailId(t.id);
  };
  const openEdit = async (t: Ticket) => {
    try {
      if (t.type === 'complaint') {
        const d = (await getComplaintDetail(t.id)).data;
        setComplaintForm({ open: true, editing: d.complaint });
      } else if (t.type === 'address') {
        const rec = (await getAddressChange(t.id)).data;
        setAddressForm({ open: true, editing: rec });
      } else {
        const rec = (await getFollowUp(t.id)).data;
        setFollowForm({ open: true, editing: rec });
      }
    } catch (e) { message.error(errText(e)); }
  };
  const onDelete = (t: Ticket) => {
    if (t.type === 'complaint') delComplaint.mutate(t.id);
    else if (t.type === 'address') delAddress.mutate(t.id);
    else delFollow.mutate(t.id);
  };

  const cols: TableColumnsType<Ticket> = [
    { title: '读者 / 类型', key: 'reader', width: 180, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Text strong>{r.recipient_name || '—'}</Text>
        <Text type="secondary" className="postal-cell-secondary">{TICKET_TYPE_META[r.type].label}{r.delivery_no ? ` · ${r.delivery_no}` : ''}</Text>
      </Space>
    ) },
    { title: '内容', dataIndex: 'summary', ellipsis: true, render: (v: string | null, r) => (
      <Space direction="vertical" size={0} style={{ maxWidth: 520 }}>
        <Text ellipsis>{v || '—'}</Text>
        <Text type="secondary" className="postal-cell-secondary">
          {r.postal_delivery_id ? '已关联投递名册' : '未关联投递名册'}{r.handling_count != null ? ` · 已处理 ${r.handling_count} 次` : ''}
        </Text>
      </Space>
    ) },
    { title: '时间', dataIndex: 'ticket_date', width: 148, render: (v: string | null, r) => v ? dayjs(v).format(r.type === 'address' ? 'MM月DD日 HH:mm' : 'YYYY-MM-DD') : '—' },
    { title: '状态', key: 'status', width: 100, render: (_: unknown, r) => ticketStatusTag(r) },
    {
      title: '操作', key: 'act', width: isAdmin ? 170 : 80, render: (_: unknown, r: Ticket) => {
        const isAppliedAddress = r.type === 'address' && r.applied_to_order === true;
        return (
          <Space size={0}>
            <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => openDetail(r)}>{r.type === 'complaint' ? '处理' : '详情'}</Button>
            {isAdmin && (isAppliedAddress ? (
              <Text type="secondary" style={{ fontSize: 12, padding: '0 7px' }}>已锁定</Text>
            ) : (
              <>
                <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                <Popconfirm
                  title={`删除该${TICKET_TYPE_META[r.type].label}工单？`}
                  description={r.type === 'complaint' ? '关联回访不会删除，将恢复为独立回访工单。' : undefined}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => onDelete(r)}
                >
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </>
            ))}
          </Space>
        );
      },
    },
  ];

  const sm = data?.summary;
  const typeOptions = [
    { label: `全部${sm ? ` ${sm.complaint + sm.address + sm.follow}` : ''}`, value: 'all' },
    { label: `投诉${sm ? ` ${sm.complaint}` : ''}`, value: 'complaint' },
    { label: `改地址${sm ? ` ${sm.address}` : ''}`, value: 'address' },
    { label: `回访${sm ? ` ${sm.follow}` : ''}`, value: 'follow' },
  ];

  return (
    <>
      <Flex className="postal-page-head" justify="space-between" align="flex-start" wrap gap={12}>
        <div>
          <Title level={3} className="postal-page-title">客服工单</Title>
          <Text type="secondary">共 {data?.total ?? 0} 条工单</Text>
        </div>
        <Space wrap>
          <Dropdown menu={{ items: [
            { key: 'complaint', label: '导入投诉', onClick: () => setImportType('complaint') },
            { key: 'address', label: '导入改地址', onClick: () => setImportType('address') },
            { key: 'follow', label: '导入回访', onClick: () => setImportType('follow') },
          ] }}>
            <Button icon={<UploadOutlined />}>导入</Button>
          </Dropdown>
          {isAdmin && (
            <Dropdown menu={{ items: [
              { key: 'complaint', label: '新增投诉', onClick: () => setComplaintForm({ open: true, editing: null }) },
              { key: 'address', label: '新增改地址', onClick: () => setAddressForm({ open: true, editing: null }) },
              { key: 'follow', label: '新增回访', onClick: () => setFollowForm({ open: true, editing: null }) },
            ] }}>
              <Button type="primary" icon={<PlusOutlined />}>新建工单</Button>
            </Dropdown>
          )}
        </Space>
      </Flex>

      <Flex className="postal-toolbar" wrap gap={8}>
        <Radio.Group
          optionType="button" buttonStyle="solid" options={typeOptions}
          value={type ?? 'all'}
          onChange={(e) => { const v = e.target.value; setType(v === 'all' ? undefined : v); setStatus(undefined); setApplied(undefined); setPage(1); }}
        />
        <Input.Search allowClear placeholder="搜索读者或编号" style={{ width: 240 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
        {type === 'complaint' && (
          <>
            <Select allowClear placeholder="状态" style={{ width: 120 }} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={COMPLAINT_STATUS_OPTS} />
          </>
        )}
        {type === 'address' && (
          <Select allowClear placeholder="应用状态" style={{ width: 130 }} value={applied} onChange={(v) => { setApplied(v); setPage(1); }}
            options={[{ label: '已应用', value: true }, { label: '未应用', value: false }]} />
        )}
      </Flex>

      <Card className="postal-table-card" styles={{ body: { padding: 0 } }}>
        <Table<Ticket>
          rowKey={(r) => `${r.type}-${r.id}`}
          columns={cols}
          dataSource={data?.rows ?? []}
          loading={q.isLoading}
          size="small"
          pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }}
        />
      </Card>

      {/* 详情抽屉 */}
      <ComplaintHandlingDrawer complaintId={handlingId} onClose={() => setHandlingId(null)} />
      <AddressDetailDrawer addressId={addressDetailId} onClose={() => setAddressDetailId(null)}
        onEdit={(rec) => { setAddressDetailId(null); setAddressForm({ open: true, editing: rec }); }} />
      <FollowDetailDrawer followId={followDetailId} onClose={() => setFollowDetailId(null)}
        onEdit={(rec) => { setFollowDetailId(null); setFollowForm({ open: true, editing: rec }); }} />

      {/* 表单弹窗 */}
      <ComplaintFormModal open={complaintForm.open} editing={complaintForm.editing} unitOpts={unitOpts} onClose={() => setComplaintForm({ open: false, editing: null })} />
      <AddressChangeFormModal open={addressForm.open} editing={addressForm.editing} onClose={() => setAddressForm({ open: false, editing: null })} />
      <FollowUpFormModal open={followForm.open} editing={followForm.editing} onClose={() => setFollowForm({ open: false, editing: null })} />

      {/* 导入弹窗 */}
      <ComplaintImportModal open={importType === 'complaint'} onClose={() => setImportType(null)} />
      <SimpleImportModal<AddrImportRow>
        open={importType === 'address'} onClose={() => setImportType(null)} title="导入改地址" unit="条" linkedLabel="已关联" invalidateKey="postalTickets"
        hint="点击或拖拽含《改地址》的 .xlsx"
        previewFn={previewAddressChangeImport} commitFn={commitAddressChangeImport}
        rowKey={(r, i) => `${r.external_order_no}-${i}`}
        columns={[
          { title: '结果', dataIndex: 'decision', width: 90, render: (d: string) => <Tag color={d === 'import' ? 'green' : 'blue'}>{d === 'import' ? '✅ 导入' : '♻ 重复'}</Tag> },
          { title: '编号', dataIndex: 'external_order_no', width: 120 },
          { title: '原姓名', dataIndex: 'old_name', width: 100 },
          { title: '新地址', dataIndex: 'new_address', ellipsis: true },
        ]}
      />
      <SimpleImportModal<FollowImportRow>
        open={importType === 'follow'} onClose={() => setImportType(null)} title="导入回访" unit="条" linkedLabel="已关联" invalidateKey="postalTickets"
        hint="点击或拖拽含《回访》的 .xlsx"
        previewFn={previewFollowUpImport} commitFn={commitFollowUpImport}
        rowKey={(r, i) => `${r.external_order_no}-${i}`}
        columns={[
          { title: '结果', dataIndex: 'decision', width: 90, render: (d: string) => <Tag color={d === 'import' ? 'green' : 'blue'}>{d === 'import' ? '✅ 导入' : '♻ 重复'}</Tag> },
          { title: '编号', dataIndex: 'external_order_no', width: 120 },
          { title: '姓名', dataIndex: 'name', width: 100 },
          { title: '批次', dataIndex: 'batch_label', width: 130 },
          { title: '结果', dataIndex: 'result', ellipsis: true },
        ]}
      />
    </>
  );
}

const POST_TABS = [
  { key: 'deliveries', label: '投递名册', component: DeliveriesTab },
  { key: 'tickets', label: '客服工单', component: TicketsTab },
] as const;

export default function PostDelivery() {
  const { tab } = useParams<{ tab: string }>();
  const current = POST_TABS.find((t) => t.key === tab) ?? POST_TABS[0];
  const Content = current.component;
  return <Content />;
}
