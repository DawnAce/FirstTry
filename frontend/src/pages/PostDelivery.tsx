import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
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
  DownloadOutlined,
  EditOutlined,
  HistoryOutlined,
  InboxOutlined,
  PlusOutlined,
  ThunderboltOutlined,
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
  commitFinanceImport,
  commitFollowUpImport,
  commitPostalImport,
  createAddressChange,
  createComplaint,
  createDelivery,
  createFinance,
  createFollowUp,
  deleteAddressChange,
  deleteComplaint,
  deleteComplaintHandling,
  deleteDelivery,
  deleteFinance,
  deleteFollowUp,
  downloadPostalBatch,
  generatePostalBatch,
  getComplaintDetail,
  getPostalBatch,
  listAddressChanges,
  listComplaints,
  listDeliveries,
  listFinance,
  listFollowUps,
  listPostalBatches,
  markPostalBatchSent,
  previewAddressChangeImport,
  previewComplaintImport,
  previewFinanceImport,
  previewFollowUpImport,
  previewPostalImport,
  updateAddressChange,
  updateComplaint,
  updateDelivery,
  updateFinance,
  updateFollowUp,
} from '../api/postal';
import type {
  AddrImportRow,
  AddressChangePayload,
  ComplaintImportPreview,
  ComplaintImportRow,
  ComplaintPayload,
  DeliveryPayload,
  FinanceImportRow,
  FinancePayload,
  FollowImportRow,
  FollowUpPayload,
  PostalAddressChange,
  PostalBatch,
  PostalBatchRow,
  PostalBatchStatus,
  PostalComplaint,
  PostalComplaintHandling,
  PostalComplaintStatus,
  PostalDelivery,
  PostalFinance,
  PostalFollowUp,
  PostalImportDecision,
  PostalImportPreview,
  PostalImportRow,
  SimpleImportPreview,
} from '../api/postal';

const { Title, Text } = Typography;

const STATUS_META: Record<PostalBatchStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  generated: { label: '已生成', color: 'cyan' },
  sent: { label: '已发 · 冻结', color: 'green' },
};

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

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
}

const toDay = (s?: string | null): Dayjs | null => (s ? dayjs(s) : null);
const fromDay = (d?: Dayjs | null): string | null => (d ? d.format('YYYY-MM-DD') : null);

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
      qc.invalidateQueries({ queryKey: ['postalBatches'] });
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
    { title: '编号', dataIndex: 'delivery_no', width: 100, render: (v: string, r) => <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{r.year}-{v}</Text> },
    { title: '收报人', dataIndex: 'recipient_name', width: 100 },
    { title: '省/市/区 · 详细地址', key: 'addr', width: 320, render: (_: unknown, r) => (
      <Space direction="vertical" size={0} style={{ maxWidth: 300 }}>
        <Text>{[r.recipient_province, r.recipient_city, r.recipient_district].filter(Boolean).join(' ') || '—'}</Text>
        <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.recipient_address}{r.recipient_phone ? ` · ${r.recipient_phone}` : ''}</Text>
      </Space>
    ) },
    { title: '份数', dataIndex: 'copies', width: 64, align: 'right' },
    { title: '起止月', key: 'coverage', width: 160, render: (_: unknown, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.coverage_start_date}~{r.coverage_end_date}</Text> },
    { title: '投递单位', dataIndex: 'distribution_unit_name', width: 150, render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—(未填)</Text>) },
    { title: '渠道', dataIndex: 'source_channel', width: 120, render: (v: string | null) => v || '—' },
    { title: '来源', dataIndex: 'source_type', width: 96, render: (v: PostalDelivery['source_type']) => {
      const meta: Record<string, { label: string; color: string }> = {
        subscription_generated: { label: '订报生成', color: 'green' },
        historical_import: { label: '名册导入', color: 'default' },
        manual: { label: '手工', color: 'gold' },
        order_generated: { label: '订单生成', color: 'blue' },
      };
      const m = v ? meta[v] : undefined;
      return m ? <Tag color={m.color}>{m.label}</Tag> : '—';
    } },
    ...(isAdmin ? [{
      title: '操作', key: 'act', width: 90, render: (_: unknown, r: PostalDelivery) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); setFormOpen(true); }} />
          <Popconfirm title="删除该投递记录？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => deleteMut.mutate(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    } as TableColumnsType<PostalDelivery>[number]] : []),
  ];

  const renderDeliveryExpand = (r: PostalDelivery) => (
    <div className="postal-expand">
      <div><div className="k">电话</div><div className="v">{r.recipient_phone || '—'}</div></div>
      <div><div className="k">邮编</div><div className="v">{r.recipient_postal_code || '—'}</div></div>
      <div><div className="k">产品</div><div className="v">{r.product || '—'}</div></div>
      <div><div className="k">金额</div><div className="v">{r.amount ? `¥${r.amount}` : '—'}</div></div>
      <div><div className="k">业务员</div><div className="v">{r.salesperson || '—'}</div></div>
      <div><div className="k">汇款名</div><div className="v">{r.remittance_name || '—'}</div></div>
      <div><div className="k">平台订单号</div><div className="v">{r.external_order_no || '—'}</div></div>
    </div>
  );

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Text type="secondary">邮局记录不进「订单列表 / 客户管理」，这里是它们完整名册的家（可搜可筛可导出）。每条 = 一条投递记录（≠订单）。</Text>
        <Space>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增投递记录</Button>}
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入邮局明细</Button>
        </Space>
      </Flex>
      <Flex wrap gap={8} style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); if (v == null) setMonth(undefined); setPage(1); }} options={YEAR_OPTS} />
        <Select allowClear placeholder="起投月" style={{ width: 110 }} value={month} disabled={year == null} onChange={(v) => { setMonth(v); setPage(1); }} options={MONTH_OPTS} />
        <Select allowClear placeholder="渠道" style={{ width: 150 }} value={channel} onChange={(v) => { setChannel(v); setPage(1); }} options={POSTAL_CHANNELS.map((c) => ({ label: c, value: c }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="投递单位" style={{ width: 160 }} value={unitId} onChange={(v) => { setUnitId(v); setPage(1); }} options={unitOpts} />
        <Input.Search allowClear placeholder="搜索 姓名 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
      </Flex>
      <Card styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">
          共 <b>{q.data?.total ?? 0}</b> 条投递记录 <span className="sep">·</span> 合计 <b>{(q.data?.summary.total_copies ?? 0).toLocaleString()}</b> 份 <span className="sep">·</span> <b>{q.data?.summary.unit_count ?? 0}</b> 家投递单位
          {(q.data?.summary.missing_unit_count ?? 0) > 0 && <><span className="sep">·</span> <span className="warn"><b>{q.data?.summary.missing_unit_count}</b> 条未填单位</span></>}
        </div>
        <Table<PostalDelivery> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small"
          expandable={{ expandedRowRender: renderDeliveryExpand }}
          scroll={{ x: 1180 }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条投递记录`, showSizeChanger: false }} />
      </Card>
      <ReaderImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <DeliveryFormModal open={formOpen} editing={editing} unitOpts={unitOpts} onClose={() => { setFormOpen(false); setEditing(null); }} />
    </>
  );
}

/** Tab：月度起投明细（主从） */
function BatchesTab() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [genMonth, setGenMonth] = useState<Dayjs | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const batchesQ = useQuery({ queryKey: ['postalBatches'], queryFn: () => listPostalBatches().then((r) => r.data) });
  const batches = batchesQ.data ?? [];
  const activeId = selectedId ?? batches[0]?.id ?? null;

  const detailQ = useQuery({
    queryKey: ['postalBatch', activeId],
    queryFn: () => getPostalBatch(activeId as number).then((r) => r.data),
    enabled: activeId != null,
  });

  const generateMut = useMutation({
    mutationFn: () => generatePostalBatch(genMonth!.year(), genMonth!.month() + 1),
    onSuccess: (res) => {
      message.success(`已生成 ${res.data.year}-${String(res.data.month).padStart(2, '0')} 起投明细（${res.data.row_count} 行）`);
      setSelectedId(res.data.id);
      qc.invalidateQueries({ queryKey: ['postalBatches'] });
      qc.invalidateQueries({ queryKey: ['postalBatch', res.data.id] });
    },
    onError: (err) => message.error(errText(err)),
  });
  const sentMut = useMutation({
    mutationFn: (id: number) => markPostalBatchSent(id),
    onSuccess: (res) => {
      message.success('已标记为已发（冻结）');
      qc.invalidateQueries({ queryKey: ['postalBatches'] });
      qc.invalidateQueries({ queryKey: ['postalBatch', res.data.id] });
    },
    onError: (err) => message.error(errText(err)),
  });

  const detail = detailQ.data;
  const rows = detail?.rows ?? [];
  const totalCopies = useMemo(() => rows.reduce((s, r) => s + r.copies, 0), [rows]);
  const unitCount = useMemo(() => new Set(rows.map((r) => r.distribution_unit_id).filter(Boolean)).size, [rows]);

  const rowCols: TableColumnsType<PostalBatchRow> = [
    { title: '收报人', key: 'name', width: 140, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Text>{r.snap_name}</Text>
        {r.snap_phone && <Text type="secondary" style={{ fontSize: 12 }}>{r.snap_phone}</Text>}
      </Space>
    ) },
    { title: '地区', key: 'region', width: 150, render: (_: unknown, r) => [r.snap_province, r.snap_city, r.snap_district].filter(Boolean).join(' ') || '—' },
    { title: '详细地址', dataIndex: 'snap_address', ellipsis: true },
    { title: '份数', dataIndex: 'copies', width: 64, align: 'right' },
    { title: '投递单位', dataIndex: 'distribution_unit_name', width: 150, render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—(未填)</Text>) },
    { title: '渠道', dataIndex: 'source_channel', width: 120, render: (v: string | null) => v || '—' },
  ];

  const renderBatchRowExpand = (r: PostalBatchRow) => (
    <div className="postal-expand">
      <div><div className="k">电话</div><div className="v">{r.snap_phone || '—'}</div></div>
      <div><div className="k">邮编</div><div className="v">{r.snap_postal_code || '—'}</div></div>
      <div><div className="k">起止月</div><div className="v">{r.coverage_start_date}~{r.coverage_end_date}</div></div>
      <div><div className="k">业务员</div><div className="v">{r.salesperson || '—'}</div></div>
    </div>
  );

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Text type="secondary">按「起投月」把投递记录归成每月一版明细，冻结存档、导出交邮局。给过的不再给；完整名册在「投递名册」页看全量。</Text>
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入邮局明细</Button>
          <DatePicker picker="month" value={genMonth} onChange={setGenMonth} placeholder="选起投月，如 2026-07" />
          {isAdmin && <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => generateMut.mutate()} loading={generateMut.isPending} disabled={!genMonth}>生成当月明细</Button>}
        </Space>
      </Flex>

      <Flex gap={16} align="start">
        <Card size="small" title="月度起投明细（按起投月）" style={{ width: 260, flex: '0 0 260px' }} styles={{ body: { padding: 0 } }} loading={batchesQ.isLoading}>
          {batches.length === 0 ? (
            <Empty style={{ padding: 24 }} image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细" />
          ) : (
            <List<PostalBatch> dataSource={batches} renderItem={(b) => {
              const meta = STATUS_META[b.status];
              const active = b.id === activeId;
              return (
                <List.Item onClick={() => setSelectedId(b.id)} style={{ cursor: 'pointer', padding: '10px 14px', background: active ? '#e6f4ff' : undefined, boxShadow: active ? 'inset 3px 0 0 #1677ff' : undefined }}>
                  <Flex justify="space-between" align="center" style={{ width: '100%' }}>
                    <Space direction="vertical" size={2}>
                      <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{b.year}-{String(b.month).padStart(2, '0')}</Text>
                      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
                    </Space>
                    <Space direction="vertical" size={2} align="end">
                      <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{b.row_count} 行</Text>
                      {b.sent_at && <Text type="secondary" style={{ fontSize: 12 }}>{b.sent_at.slice(0, 10)} 发</Text>}
                    </Space>
                  </Flex>
                </List.Item>
              );
            }} />
          )}
        </Card>

        <Card size="small" style={{ flex: 1, minWidth: 0 }} loading={detailQ.isLoading && activeId != null}>
          {!detail ? (
            <Empty description="选择左侧一版明细查看清单" />
          ) : (
            <>
              <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 12 }}>
                <Space size={24} wrap>
                  <Text>起投月 <Text strong>{detail.batch.year}-{String(detail.batch.month).padStart(2, '0')}</Text></Text>
                  <Text>收件人 <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{detail.rows.length}</Text></Text>
                  <Text>总份数 <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{totalCopies}</Text></Text>
                  <Text>投递单位 <Text strong>{unitCount}</Text></Text>
                  <Tag color={STATUS_META[detail.batch.status].color}>{STATUS_META[detail.batch.status].label}</Tag>
                </Space>
                <Space>
                  {isAdmin && detail.batch.status === 'generated' && (
                    <Popconfirm title="标记为已发？之后本版冻结不可再生成。" onConfirm={() => sentMut.mutate(detail.batch.id)}>
                      <Button loading={sentMut.isPending}>标记已发</Button>
                    </Popconfirm>
                  )}
                  <Button icon={<DownloadOutlined />} onClick={() => downloadPostalBatch(detail.batch.id, `邮局投递明细_${detail.batch.year}-${String(detail.batch.month).padStart(2, '0')}.xlsx`).catch(() => message.error('导出失败'))}>导出 Excel</Button>
                </Space>
              </Flex>
              <Table<PostalBatchRow> rowKey="id" columns={rowCols} dataSource={rows} size="small"
                expandable={{ expandedRowRender: renderBatchRowExpand }}
                pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 行` }} />
            </>
          )}
        </Card>
      </Flex>

      <ReaderImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

/** Tab：投诉工单 */
function ComplaintsTab() {
  const [year, setYear] = useState<number | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [minHandling, setMinHandling] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PostalComplaint | null>(null);
  const [handlingId, setHandlingId] = useState<number | null>(null);
  const PAGE_SIZE = 50;
  const { isAdmin } = useAuth();
  const qc = useQueryClient();

  const unitsQ = useQuery({ queryKey: ['partners'], queryFn: () => listPartners().then((r) => r.data) });
  const unitOpts = (unitsQ.data ?? []).filter((p) => p.partner_type === 'distribution').map((p) => ({ label: p.name, value: p.id }));
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteComplaint(id),
    onSuccess: () => { message.success('已删除投诉'); qc.invalidateQueries({ queryKey: ['postalComplaints'] }); },
    onError: (e) => message.error(errText(e)),
  });

  const q = useQuery({
    queryKey: ['postalComplaints', { year, status, minHandling, search, page }],
    queryFn: () => listComplaints({ year, status, min_handling_count: minHandling, search: search.trim() || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
  });
  const data = q.data;

  const cols: TableColumnsType<PostalComplaint> = [
    { title: '接诉日期', dataIndex: 'complaint_date', width: 110, render: (v: string | null) => v || '—' },
    { title: '收报人', dataIndex: 'snap_name', width: 100 },
    { title: '编号', dataIndex: 'external_order_no', width: 120, render: (v: string | null) => v || '—' },
    { title: '投诉情况', dataIndex: 'missing_issues', ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '次数', dataIndex: 'handling_count', width: 64, align: 'right', render: (v: number | null) => v ?? '—' },
    { title: '状态', dataIndex: 'status', width: 90, render: (s: PostalComplaintStatus) => <Tag color={COMPLAINT_STATUS_META[s].color}>{COMPLAINT_STATUS_META[s].label}</Tag> },
    { title: '读者', key: 'reader', width: 100, render: (_: unknown, r) => readerTag(r.postal_delivery_id) },
    {
      title: '操作', key: 'act', width: isAdmin ? 150 : 80, render: (_: unknown, r: PostalComplaint) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => setHandlingId(r.id)}>处理</Button>
          {isAdmin && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); setFormOpen(true); }} />}
          {isAdmin && (
            <Popconfirm title="删除该投诉？处理记录一并删除。" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => deleteMut.mutate(r.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const renderComplaintExpand = (r: PostalComplaint) => (
    <div className="postal-expand">
      <div><div className="k">处理</div><div className="v">{r.routed_label ? <Tag>{r.routed_label}</Tag> : null}{r.handling || (r.routed_label ? '' : '—')}</div></div>
      <div><div className="k">回访</div><div className="v">{r.follow_up || '—'}</div></div>
      <div><div className="k">投递单位</div><div className="v">{r.routed_unit_name ? <Tag color="blue">{r.routed_unit_name}</Tag> : '—'}</div></div>
      <div><div className="k">第一接诉人</div><div className="v">{r.first_handler || '—'}</div></div>
      <div><div className="k">电话</div><div className="v">{r.snap_phone || '—'}</div></div>
      <div><div className="k">地址</div><div className="v">{r.snap_address || '—'}</div></div>
      <div><div className="k">备注</div><div className="v">{r.notes || '—'}</div></div>
    </div>
  );

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
          <Select allowClear placeholder="状态" style={{ width: 120 }} value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={COMPLAINT_STATUS_OPTS} />
          <Select allowClear placeholder="处理次数" style={{ width: 130 }} value={minHandling} onChange={(v) => { setMinHandling(v); setPage(1); }}
            options={[{ label: '≥2 次', value: 2 }, { label: '≥3 次', value: 3 }]} />
          <Input.Search allowClear placeholder="搜索 收报人 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Space>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增投诉</Button>}
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入投诉</Button>
        </Space>
      </Flex>

      <Card styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">
          <span>共 <b>{data?.total ?? 0}</b> 条</span>
          <span className="sep">·</span>
          <span className={`postal-chip ${status === 'open' ? 'on' : ''}`} onClick={() => { setStatus(status === 'open' ? undefined : 'open'); setPage(1); }}>待处理 <b>{data?.summary.open ?? 0}</b></span>
          <span className={`postal-chip ${status === 'in_progress' ? 'on' : ''}`} onClick={() => { setStatus(status === 'in_progress' ? undefined : 'in_progress'); setPage(1); }}>处理中 <b>{data?.summary.in_progress ?? 0}</b></span>
          <span className={`postal-chip ${status === 'resolved' ? 'on' : ''}`} onClick={() => { setStatus(status === 'resolved' ? undefined : 'resolved'); setPage(1); }}>已解决 <b>{data?.summary.resolved ?? 0}</b></span>
        </div>
        <Table<PostalComplaint>
          rowKey="id"
          columns={cols}
          dataSource={data?.rows ?? []}
          loading={q.isLoading}
          size="small"
          expandable={{ expandedRowRender: renderComplaintExpand }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }}
        />
      </Card>

      <ComplaintImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ComplaintFormModal open={formOpen} editing={editing} unitOpts={unitOpts} onClose={() => { setFormOpen(false); setEditing(null); }} />
      <ComplaintHandlingDrawer complaintId={handlingId} onClose={() => setHandlingId(null)} />
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
function DeliveryFormModal({ open, editing, unitOpts, onClose }: {
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
    <Modal title={editing ? '编辑投递记录' : '新增投递记录'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={760} destroyOnClose>
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
    </Modal>
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
      const body: ComplaintPayload = { ...v, complaint_date: fromDay(v.complaint_date) };
      return editing ? updateComplaint(editing.id, body) : createComplaint(body);
    },
    onSuccess: () => {
      message.success(editing ? '投诉已更新' : '投诉已新增');
      qc.invalidateQueries({ queryKey: ['postalComplaints'] });
      onClose();
    },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑投诉' : '新增投诉'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={640} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={2000} max={2100} /></Form.Item>
          <Form.Item name="delivery_no" label="编号（关联读者）" style={{ width: 180 }}><Input placeholder="去零编号，如 680" /></Form.Item>
          <Form.Item name="complaint_date" label="接诉日期" style={{ width: 160 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Form.Item name="missing_issues" label="投诉情况"><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name="handling" label="处理情况（自动归一渠道单位）" style={{ flex: 1, minWidth: 240 }}><Input placeholder="如 转北京11185" /></Form.Item>
          <Form.Item name="routed_unit_id" label="投递单位" style={{ width: 180 }}><Select allowClear showSearch optionFilterProp="label" options={unitOpts} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="snap_name" label="收报人（快照，留空自动带出）" style={{ width: 220 }}><Input /></Form.Item>
          <Form.Item name="snap_phone" label="电话" style={{ width: 150 }}><Input /></Form.Item>
          <Form.Item name="first_handler" label="第一接诉人" style={{ width: 130 }}><Input /></Form.Item>
          <Form.Item name="status" label="状态" style={{ width: 130 }}><Select options={COMPLAINT_STATUS_OPTS} /></Form.Item>
        </Flex>
        <Form.Item name="snap_address" label="地址（快照）"><Input /></Form.Item>
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
  const open = complaintId != null;

  const detailQ = useQuery({
    queryKey: ['postalComplaintDetail', complaintId],
    queryFn: () => getComplaintDetail(complaintId as number).then((r) => r.data),
    enabled: open,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['postalComplaints'] });
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
    mutationFn: (hid: number) => deleteComplaintHandling(complaintId as number, hid),
    onSuccess: () => { message.success('已删除该处理'); invalidate(); },
    onError: (e) => message.error(errText(e)),
  });

  const detail = detailQ.data;
  const c = detail?.complaint;

  return (
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
            <Divider plain style={{ marginTop: 0 }}>处理时间线</Divider>
            {(detail?.handlings.length ?? 0) === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无处理记录" />
            ) : (
              <Timeline items={detail!.handlings.map((h: PostalComplaintHandling) => ({
                color: h.result_status === 'resolved' ? 'green' : (h.result_status === 'in_progress' ? 'blue' : 'gray'),
                children: (
                  <Space direction="vertical" size={2} style={{ width: '100%' }}>
                    <Space size={8} wrap>
                      <Text type="secondary" style={{ fontSize: 12 }}>{h.handled_at?.replace('T', ' ').slice(0, 16)}</Text>
                      {h.handled_by_name && <Tag>{h.handled_by_name}</Tag>}
                      {h.result_status && <Tag color={COMPLAINT_STATUS_META[h.result_status as PostalComplaintStatus].color}>{COMPLAINT_STATUS_META[h.result_status as PostalComplaintStatus].label}</Tag>}
                      {isAdmin && <Popconfirm title="删除该处理记录？次数与状态会回退。" onConfirm={() => delMut.mutate(h.id)}><Button type="link" size="small" danger>删除</Button></Popconfirm>}
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
  );
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
    else form.resetFields();
  }, [open, editing, form]);

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body: AddressChangePayload = { ...v, change_date: fromDay(v.change_date) };
      return editing ? updateAddressChange(editing.id, body) : createAddressChange(body);
    },
    onSuccess: () => { message.success(editing ? '改地址已更新' : '改地址已新增'); qc.invalidateQueries({ queryKey: ['postalAddrChanges'] }); onClose(); },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑改地址' : '新增改地址'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={640} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={2000} max={2100} /></Form.Item>
          <Form.Item name="delivery_no" label="编号（关联读者）" style={{ width: 180 }}><Input placeholder="去零编号" /></Form.Item>
          <Form.Item name="change_date" label="修改日期" style={{ width: 160 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="old_name" label="原姓名" style={{ width: 150 }}><Input /></Form.Item>
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
function FollowUpFormModal({ open, editing, onClose }: {
  open: boolean; editing: PostalFollowUp | null; onClose: () => void;
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
      const body: FollowUpPayload = { ...v, follow_up_date: fromDay(v.follow_up_date) };
      return editing ? updateFollowUp(editing.id, body) : createFollowUp(body);
    },
    onSuccess: () => { message.success(editing ? '回访已更新' : '回访已新增'); qc.invalidateQueries({ queryKey: ['postalFollowUps'] }); onClose(); },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal title={editing ? '编辑回访' : '新增回访'} open={open} onCancel={onClose}
      onOk={() => form.submit()} okText="保存" confirmLoading={saveMut.isPending} width={560} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)}>
        <Flex gap={12} wrap>
          <Form.Item name="year" label="年度" style={{ width: 120 }}><InputNumber style={{ width: '100%' }} min={2000} max={2100} /></Form.Item>
          <Form.Item name="delivery_no" label="编号（关联读者）" style={{ width: 180 }}><Input placeholder="去零编号" /></Form.Item>
          <Form.Item name="follow_up_date" label="回访日期" style={{ width: 160 }}><DatePicker style={{ width: '100%' }} /></Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="snap_name" label="收报人" style={{ width: 160 }}><Input /></Form.Item>
          <Form.Item name="batch_label" label="批次列头" style={{ width: 180 }}><Input placeholder="如 20240227回访" /></Form.Item>
        </Flex>
        <Form.Item name="result" label="回访结果"><Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} /></Form.Item>
      </Form>
    </Modal>
  );
}

/** 收款/发票 · 新增 / 编辑 */
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
    mutationFn: (v: any) => {
      const body: FinancePayload = {
        ...v,
        amount: v.amount ?? null, fee_amount: v.fee_amount ?? null,
        net_amount: v.net_amount ?? null, invoiced_amount: v.invoiced_amount ?? null,
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

/** Tab：改地址工单 */
function AddressChangesTab() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState<number | undefined>();
  const [applied, setApplied] = useState<boolean | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PostalAddressChange | null>(null);
  const PAGE_SIZE = 50;

  const q = useQuery({
    queryKey: ['postalAddrChanges', { year, applied, search, page }],
    queryFn: () => listAddressChanges({ year, applied, search: search.trim() || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
  });
  const applyMut = useMutation({
    mutationFn: (id: number) => applyAddressChange(id),
    onSuccess: () => { message.success('已应用新地址到投递记录'); qc.invalidateQueries({ queryKey: ['postalAddrChanges'] }); qc.invalidateQueries({ queryKey: ['postalDeliveries'] }); },
    onError: (e) => message.error(errText(e)),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteAddressChange(id),
    onSuccess: () => { message.success('已删除改地址'); qc.invalidateQueries({ queryKey: ['postalAddrChanges'] }); },
    onError: (e) => message.error(errText(e)),
  });

  const cols: TableColumnsType<PostalAddressChange> = [
    { title: '修改日期', dataIndex: 'change_date', width: 110, render: (v: string | null) => v || '—' },
    { title: '收报人', key: 'name', width: 140, render: (_: unknown, r) => <Space size={4}>{r.old_name || '—'}{r.new_name && <><span style={{ color: '#999' }}>→</span>{r.new_name}</>}</Space> },
    { title: '编号', dataIndex: 'external_order_no', width: 120, render: (v: string | null) => v || '—' },
    { title: '新地址', dataIndex: 'new_address', ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '读者', key: 'reader', width: 100, render: (_: unknown, r) => readerTag(r.postal_delivery_id) },
    { title: '应用', key: 'apply', width: 130, render: (_: unknown, r) => (
      r.applied_to_order
        ? <Tag color="green">✓ 已应用</Tag>
        : (isAdmin && r.postal_delivery_id
          ? <Popconfirm title="把新姓名/电话/地址写回投递记录？下一版明细即用新地址。" onConfirm={() => applyMut.mutate(r.id)}><Button size="small" loading={applyMut.isPending}>应用新地址</Button></Popconfirm>
          : <Text type="secondary">{r.postal_delivery_id ? '—' : '未匹配'}</Text>)
    ) },
    ...(isAdmin ? [{
      title: '操作', key: 'act', width: 90, render: (_: unknown, r: PostalAddressChange) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); setFormOpen(true); }} />
          <Popconfirm title="删除该改地址工单？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => deleteMut.mutate(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    } as TableColumnsType<PostalAddressChange>[number]] : []),
  ];

  const renderAddrExpand = (r: PostalAddressChange) => (
    <div className="postal-expand">
      <div><div className="k">新电话</div><div className="v">{r.new_phone || '—'}</div></div>
      <div><div className="k">原电话</div><div className="v">{r.old_phone || '—'}</div></div>
      <div><div className="k">原地址</div><div className="v">{r.old_address || '—'}</div></div>
      <div><div className="k">份数 原→新</div><div className="v">{r.old_copies ?? '—'} → {r.new_copies ?? '—'}</div></div>
      <div><div className="k">处理</div><div className="v">{r.routed_label ? <Tag>{r.routed_label}</Tag> : null}{r.handling || (r.routed_label ? '' : '—')}</div></div>
      <div><div className="k">原起月日 / 实际起月日</div><div className="v">{r.original_start_month || '—'} / {r.effective_start_month || '—'}</div></div>
      <div><div className="k">备注</div><div className="v">{r.notes || '—'}</div></div>
    </div>
  );

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
          <Select allowClear placeholder="应用状态" style={{ width: 130 }} value={applied} onChange={(v) => { setApplied(v); setPage(1); }} options={[{ label: '已应用', value: true }, { label: '未应用', value: false }]} />
          <Input.Search allowClear placeholder="搜索 姓名 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Space>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增改地址</Button>}
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入改地址</Button>
        </Space>
      </Flex>
      <Card styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">
          <span>共 <b>{q.data?.total ?? 0}</b> 条</span>
          <span className="sep">·</span>
          <span className={`postal-chip ${applied === false ? 'on' : ''}`} onClick={() => { setApplied(applied === false ? undefined : false); setPage(1); }}>待应用 <b>{q.data?.summary.pending_apply ?? 0}</b></span>
          <span className="postal-chip" style={{ cursor: 'default' }}>未匹配 <b>{q.data?.summary.unmatched ?? 0}</b></span>
          <span className={`postal-chip ${applied === true ? 'on' : ''}`} onClick={() => { setApplied(applied === true ? undefined : true); setPage(1); }}>已应用 <b>{q.data?.summary.applied ?? 0}</b></span>
        </div>
        <Table<PostalAddressChange> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small"
          expandable={{ expandedRowRender: renderAddrExpand }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }} />
      </Card>
      <SimpleImportModal<AddrImportRow>
        open={importOpen} onClose={() => setImportOpen(false)} title="导入邮局改地址" unit="条" linkedLabel="已关联读者" invalidateKey="postalAddrChanges"
        hint="点击或拖拽含《邮局年改地址》的 .xlsx"
        previewFn={previewAddressChangeImport} commitFn={commitAddressChangeImport}
        rowKey={(r, i) => `${r.external_order_no}-${r.change_date}-${i}`}
        columns={[
          { title: '结果', dataIndex: 'decision', width: 90, render: (d: string) => <Tag color={d === 'import' ? 'green' : 'blue'}>{d === 'import' ? '✅ 导入' : '♻ 重复'}</Tag> },
          { title: '编号', dataIndex: 'external_order_no', width: 130, render: (v: string, r) => <Space size={4}>{v}{r.linked && <Tag color="cyan" style={{ marginInlineEnd: 0 }}>已关联读者</Tag>}</Space> },
          { title: '收报人', dataIndex: 'old_name', width: 100 },
          { title: '修改日期', dataIndex: 'change_date', width: 110 },
          { title: '新地址', dataIndex: 'new_address', ellipsis: true },
          { title: '处理', dataIndex: 'routed_label', width: 100, render: (v: string | null) => v ? <Tag>{v}</Tag> : '—' },
        ]}
      />
      <AddressChangeFormModal open={formOpen} editing={editing} onClose={() => { setFormOpen(false); setEditing(null); }} />
    </>
  );
}

/** Tab：回访 */
function FollowUpsTab() {
  const [year, setYear] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PostalFollowUp | null>(null);
  const PAGE_SIZE = 50;
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const deleteMut = useMutation({
    mutationFn: (id: number) => deleteFollowUp(id),
    onSuccess: () => { message.success('已删除回访'); qc.invalidateQueries({ queryKey: ['postalFollowUps'] }); },
    onError: (e) => message.error(errText(e)),
  });

  const q = useQuery({
    queryKey: ['postalFollowUps', { year, search, page }],
    queryFn: () => listFollowUps({ year, search: search.trim() || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
  });

  const cols: TableColumnsType<PostalFollowUp> = [
    { title: '回访日期', dataIndex: 'follow_up_date', width: 120, render: (v: string | null) => v || '—' },
    { title: '批次', dataIndex: 'batch_label', width: 140, render: (v: string | null) => v || '—' },
    { title: '收报人', dataIndex: 'snap_name', width: 110 },
    { title: '编号', dataIndex: 'external_order_no', width: 110, render: (v: string | null) => v || '—' },
    { title: '结果', dataIndex: 'result', ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '读者', key: 'reader', width: 100, render: (_: unknown, r) => readerTag(r.postal_delivery_id) },
    ...(isAdmin ? [{
      title: '操作', key: 'act', width: 90, render: (_: unknown, r: PostalFollowUp) => (
        <Space size={0}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r); setFormOpen(true); }} />
          <Popconfirm title="删除该回访？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => deleteMut.mutate(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    } as TableColumnsType<PostalFollowUp>[number]] : []),
  ];

  const renderFollowExpand = (r: PostalFollowUp) => (
    <div className="postal-expand">
      <div style={{ gridColumn: '1 / -1' }}><div className="k">回访结果</div><div className="v" style={{ whiteSpace: 'pre-wrap' }}>{r.result || '—'}</div></div>
    </div>
  );

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
          <Input.Search allowClear placeholder="搜索 姓名 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Space>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增回访</Button>}
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入回访</Button>
        </Space>
      </Flex>
      <Card styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">共 <b>{q.data?.total ?? 0}</b> 条回访记录</div>
        <Table<PostalFollowUp> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small"
          expandable={{ expandedRowRender: renderFollowExpand }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }} />
      </Card>
      <SimpleImportModal<FollowImportRow>
        open={importOpen} onClose={() => setImportOpen(false)} title="导入回访（读者明细的回访列）" unit="条" linkedLabel="已关联读者" invalidateKey="postalFollowUps"
        hint="点击或拖拽含《邮局读者明细》(带回访列)的 .xlsx"
        previewFn={previewFollowUpImport} commitFn={commitFollowUpImport}
        rowKey={(r, i) => `${r.external_order_no}-${r.batch_label}-${i}`}
        columns={[
          { title: '结果', dataIndex: 'decision', width: 90, render: (d: string) => <Tag color={d === 'import' ? 'green' : 'blue'}>{d === 'import' ? '✅ 导入' : '♻ 重复'}</Tag> },
          { title: '编号', dataIndex: 'external_order_no', width: 130, render: (v: string, r) => <Space size={4}>{v}{r.linked && <Tag color="cyan" style={{ marginInlineEnd: 0 }}>已关联读者</Tag>}</Space> },
          { title: '收报人', dataIndex: 'name', width: 100 },
          { title: '批次', dataIndex: 'batch_label', width: 130 },
          { title: '回访日期', dataIndex: 'follow_up_date', width: 110, render: (v: string | null) => v || '—' },
          { title: '结果', dataIndex: 'result', ellipsis: true },
        ]}
      />
      <FollowUpFormModal open={formOpen} editing={editing} onClose={() => { setFormOpen(false); setEditing(null); }} />
    </>
  );
}

/** Tab：收款发票（此页不变；按订单号/姓名挂真实订单） */
function FinanceTab() {
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

const POST_TABS = [
  { key: 'deliveries', label: '投递名册', component: DeliveriesTab },
  { key: 'batches', label: '月度起投明细', component: BatchesTab },
  { key: 'complaints', label: '投诉工单', component: ComplaintsTab },
  { key: 'address', label: '改地址', component: AddressChangesTab },
  { key: 'follow', label: '回访', component: FollowUpsTab },
  { key: 'finance', label: '收款发票', component: FinanceTab },
] as const;

export default function PostDelivery() {
  const { tab } = useParams<{ tab: string }>();
  const current = POST_TABS.find((t) => t.key === tab) ?? POST_TABS[0];
  const Content = current.component;
  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>邮局管理 · {current.label}</Title>
      <Content />
    </div>
  );
}
