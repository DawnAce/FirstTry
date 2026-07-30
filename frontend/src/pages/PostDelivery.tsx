import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Checkbox,
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
import { PageHeader } from '../components/UiPrimitives';
import { coverageStatus, EXPIRING_DAYS } from './orderUtils';
import type {
  AddrImportRow,
  ComplaintImportPreview,
  ComplaintImportRow,
  DeliveryPayload,
  DeliveryStatusFilter,
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

const { Text } = Typography;

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

const COMPLAINT_SOURCE_OPTS = ['客服中心', '发行电话接入', '同事反馈'].map((value) => ({ label: value, value }));

const POSTAL_CHANNELS = [
  '中经报有赞',
  '对公转账',
  'CBJ+小程序',
  '2024年VIP',
  '2025年VIP',
  '2026年VIP',
  '商学院有赞',
  '淘宝发行部',
  '拼多多',
  '天猫店',
  '订阅卡',
  '商学院APP',
  '中国经营报APP',
];
const YEAR_OPTS = [2024, 2025, 2026].map((y) => ({ label: `${y}年`, value: y }));
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1} 月`, value: i + 1 }));
const POSTAL_SOURCE_META: Record<string, { label: string; color: string }> = {
  subscription_generated: { label: '订报转投', color: 'green' },
  historical_import: { label: '名册导入', color: 'default' },
  manual: { label: '手工', color: 'gold' },
  order_generated: { label: '订单生成', color: 'blue' },
};
const DELIVERY_STATUS_META = {
  pending: { label: '待开始', color: 'blue' },
  active: { label: '投递中', color: 'green' },
  expiring: { label: '即将到期', color: 'orange' },
  completed: { label: '已完结', color: 'default' },
  unknown: { label: '期限待补', color: 'default' },
} as const;
const DELIVERY_STATUS_OPTIONS: { label: string; value: DeliveryStatusFilter }[] = [
  { label: `即将到期（${EXPIRING_DAYS}天内）`, value: 'expiring' },
  { label: '投递中', value: 'active' },
  { label: '待开始', value: 'pending' },
  { label: '已完结', value: 'completed' },
];

function deliveryStatusTag(record: Pick<PostalDelivery, 'coverage_start_date' | 'coverage_end_date'>) {
  const meta = DELIVERY_STATUS_META[coverageStatus(record.coverage_start_date, record.coverage_end_date)];
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function expiryDays(record: Pick<PostalDelivery, 'coverage_start_date' | 'coverage_end_date'>) {
  if (!record.coverage_end_date || coverageStatus(record.coverage_start_date, record.coverage_end_date) !== 'expiring') return null;
  return Math.max(0, dayjs(record.coverage_end_date).startOf('day').diff(dayjs().startOf('day'), 'day'));
}

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
}

const toDay = (s?: string | null): Dayjs | null => (s ? dayjs(s) : null);
const fromDay = (d?: Dayjs | null): string | null => (d ? d.format('YYYY-MM-DD') : null);
const fromDateTime = (d?: Dayjs | null): string | null => (d ? d.format('YYYY-MM-DDTHH:mm:ss') : null);

type FollowNextAction = 'complaint' | 'address';
type TicketFormPrefill = {
  reader: PostalDelivery;
  communicationContent: string;
  followUpId: number;
  existingComplaintId: number | null;
};

/** 新建工单时从投递明细选人；复用名册查询，不维护第二套“客户”数据。 */
function ReaderLookup({ value, selectedReader, onChange, onSelectReader }: {
  value?: number;
  selectedReader?: PostalDelivery | null;
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
  const found = q.data ?? [];
  const readers = selectedReader && !found.some((reader) => reader.id === selectedReader.id)
    ? [selectedReader, ...found]
    : found;
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

/** Tab：投递明细（全部投递记录） */
function DeliveriesTab() {
  const [year, setYear] = useState<number | undefined>();
  const [month, setMonth] = useState<number | undefined>();
  const [channel, setChannel] = useState<string | undefined>();
  const [status, setStatus] = useState<DeliveryStatusFilter | undefined>();
  const [unitId, setUnitId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PostalDelivery | null>(null);
  const [detail, setDetail] = useState<PostalDelivery | null>(null);
  const [sourceChangeId, setSourceChangeId] = useState<number | null>(null);
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
    queryKey: ['postalDeliveries', { year, month, channel, status, unitId, search, page }],
    queryFn: () => listDeliveries({
      year, month, channel, status, distribution_unit_id: unitId,
      search: search.trim() || undefined, page, page_size: PAGE_SIZE,
    }).then((r) => r.data),
  });

  const cols: TableColumnsType<PostalDelivery> = [
    { title: '编号', key: 'delivery_no', width: 120, render: (_: unknown, r) => (
      <Text className="postal-delivery-number">{r.year}-{r.delivery_no}</Text>
    ) },
    { title: '收报人', key: 'reader', width: 160, render: (_: unknown, r) => (
      <Space direction="vertical" size={0} className="postal-reader-cell">
        <Text strong className="postal-reader-name">{r.recipient_name}</Text>
        <Text type="secondary" className="postal-cell-secondary postal-reader-phone">{r.recipient_phone || '未记录电话'}</Text>
      </Space>
    ) },
    { title: '地址', key: 'addr', render: (_: unknown, r) => (
      <Space direction="vertical" size={0} className="postal-address-cell">
        <Text strong>{[r.recipient_province, r.recipient_city, r.recipient_district].filter(Boolean).join(' · ') || '—'}</Text>
        <Text type="secondary" className="postal-cell-secondary" ellipsis>{r.recipient_address}</Text>
      </Space>
    ) },
    { title: '订阅', key: 'coverage', width: 170, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Space size={4}><Text>{r.copies} 份</Text>{deliveryStatusTag(r)}</Space>
        <Text type="secondary" className="postal-cell-secondary">
          {r.coverage_start_date ? dayjs(r.coverage_start_date).format('YYYY.MM') : '—'}—{r.coverage_end_date ? dayjs(r.coverage_end_date).format('YYYY.MM') : '—'}
        </Text>
        {expiryDays(r) != null && <Text className="postal-expiry-countdown">剩 {expiryDays(r)} 天</Text>}
      </Space>
    ) },
    { title: '投递单位', key: 'distribution_unit', width: 180, render: (_: unknown, r) => (
      r.distribution_unit_name
        ? <Text className="postal-distribution-unit">{r.distribution_unit_name}</Text>
        : <Tag color="orange" className="postal-unit-missing">待补投递单位</Tag>
    ) },
    { title: '订单来源', key: 'source_channel', width: 150, render: (_: unknown, r) => (
      r.source_channel ? <span className="postal-source-pill">{r.source_channel}</span> : <Text type="secondary">—</Text>
    ) },
    { title: '操作', key: 'act', width: 72, align: 'right', render: (_: unknown, r) => (
      <Button type="link" size="small" onClick={() => setDetail(r)}>查看</Button>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="投递明细"
        description={`投递记录 ${(q.data?.total ?? 0).toLocaleString()} 条`}
        actions={<Space>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入</Button>
          {isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); setFormOpen(true); }}>新增记录</Button>}
        </Space>}
      />
      <Flex className="postal-toolbar" wrap gap={8}>
        <Input.Search allowClear placeholder="搜索姓名、电话、编号或地址" style={{ width: 300 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); if (v == null) setMonth(undefined); setPage(1); }} options={YEAR_OPTS} />
        <Select allowClear placeholder="订单来源" style={{ width: 150 }} value={channel} onChange={(v) => { setChannel(v); setPage(1); }} options={POSTAL_CHANNELS.map((c) => ({ label: c, value: c }))} />
        <Select allowClear placeholder="订阅状态" className={status === 'expiring' ? 'postal-status-filter-expiring' : undefined}
          style={{ width: 190 }} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={DELIVERY_STATUS_OPTIONS} />
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
      {status && (
        <Space className="postal-active-filters" size={8}>
          <Text type="secondary">已选：</Text>
          <Tag color={DELIVERY_STATUS_META[status].color} closable onClose={() => { setStatus(undefined); setPage(1); }}>
            {status === 'expiring' ? `即将到期 · ${EXPIRING_DAYS}天内` : DELIVERY_STATUS_META[status].label}
          </Tag>
        </Space>
      )}
      <Card className="postal-table-card" styles={{ body: { padding: 0 } }}>
        <div className="postal-summary">
          {status === 'expiring' ? <>
            即将到期 <b>{q.data?.total ?? 0}</b> 位订户 <span className="sep">·</span> 合计 <b>{(q.data?.summary.total_copies ?? 0).toLocaleString()}</b> 份
            {q.data?.summary.nearest_expiry_date && <><span className="sep">·</span><span className="warn">最早 <b>{Math.max(0, dayjs(q.data.summary.nearest_expiry_date).startOf('day').diff(dayjs().startOf('day'), 'day'))}</b> 天后到期</span></>}
            <span className="postal-summary-sort">已按到期日由近到远排序</span>
          </> : <>
            合计 <b>{(q.data?.summary.total_copies ?? 0).toLocaleString()}</b> 份 <span className="sep">·</span> <b>{q.data?.summary.unit_count ?? 0}</b> 家投递单位
            {(q.data?.summary.missing_unit_count ?? 0) > 0 && <><span className="sep">·</span> <span className="warn"><b>{q.data?.summary.missing_unit_count}</b> 条未填单位</span></>}
          </>}
        </div>
        <Table<PostalDelivery> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small"
          scroll={{ x: 1100 }}
          pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条投递记录`, showSizeChanger: false }} />
      </Card>
      <ReaderImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <DeliveryDetailDrawer record={detail} isAdmin={isAdmin} deleting={deleteMut.isPending}
        onClose={() => setDetail(null)}
        onEdit={(record) => { setDetail(null); setEditing(record); setFormOpen(true); }}
        onDelete={(record) => deleteMut.mutate(record.id, { onSuccess: () => setDetail(null) })}
        onOpenAddressChange={setSourceChangeId} />
      <AddressDetailDrawer addressId={sourceChangeId} readOnly modal onClose={() => setSourceChangeId(null)} onEdit={() => {}} />
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
          <Form.Item name="source_channel" label="订单来源" style={{ width: 170 }}>
            <Select allowClear options={POSTAL_CHANNELS.map((c) => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item name="distribution_unit_id" label="投递单位" style={{ width: 190 }}>
            <Select allowClear showSearch optionFilterProp="label" options={unitOpts} />
          </Form.Item>
          <Form.Item name="salesperson" label="业务员" style={{ width: 120 }}><Input /></Form.Item>
          <Form.Item name="remittance_name" label="汇款名" style={{ width: 150 }}><Input /></Form.Item>
        </Flex>
        <Form.Item name="external_order_no" label="来源单号（可选）"><Input placeholder="原平台订单号" /></Form.Item>
      </Form>
    </Drawer>
  );
}

function DeliveryDetailDrawer({ record, isAdmin, deleting, onClose, onEdit, onDelete, onOpenAddressChange }: {
  record: PostalDelivery | null;
  isAdmin: boolean;
  deleting: boolean;
  onClose: () => void;
  onEdit: (record: PostalDelivery) => void;
  onDelete: (record: PostalDelivery) => void;
  onOpenAddressChange: (id: number) => void;
}) {
  const source = record?.source_type ? POSTAL_SOURCE_META[record.source_type] : null;
  const changesQ = useQuery({
    queryKey: ['postalTickets', 'delivery-applied-changes', record?.id],
    queryFn: () => listTickets({
      type: 'address', applied: true, postal_delivery_id: record?.id, page_size: 50,
    }).then((r) => r.data.rows),
    enabled: record != null,
  });
  const changeSources = changesQ.data ?? [];
  const statusKey = record ? coverageStatus(record.coverage_start_date, record.coverage_end_date) : 'unknown';
  const statusMeta = DELIVERY_STATUS_META[statusKey];
  const statusClass = statusKey === 'active' ? 'status-resolved'
    : statusKey === 'pending' ? 'status-open'
      : statusKey === 'expiring' ? 'status-address' : 'status-completed';
  return (
    <Drawer title={record ? (
      <div className="complaint-form-title postal-detail-title">
        <span className="complaint-form-title-icon" aria-hidden>📬</span>
        <div className="complaint-form-title-copy">
          <strong>投递记录详情</strong>
          <div className="complaint-form-meta">投递编号 {record.year}-{record.delivery_no}</div>
        </div>
        <span className={`complaint-form-status ${statusClass}`}>{statusMeta.label}</span>
      </div>
    ) : '投递记录详情'} open={record != null} onClose={onClose} width={720} destroyOnClose
      rootClassName="postal-delivery-detail-drawer-root"
      extra={isAdmin && record ? <Button icon={<EditOutlined />} onClick={() => onEdit(record)}>编辑记录</Button> : null}
      footer={record ? (
        <div className="complaint-form-footer">
          <span className="complaint-form-save-tip"><b>✓</b>投诉、信息修改和回访均通过投递编号关联</span>
          {isAdmin && (
            <Popconfirm title="删除该投递记录？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => onDelete(record)}>
              <Button danger icon={<DeleteOutlined />} loading={deleting}>删除记录</Button>
            </Popconfirm>
          )}
          <Button type="primary" onClick={onClose}>返回列表</Button>
        </div>
      ) : null}>
      {record && (
        <div className="postal-detail-body">
          <div className="postal-detail-reader">
            <div className="postal-reader-avatar">{record.recipient_name.slice(0, 1)}</div>
            <div className="postal-detail-reader-copy">
              <strong>{record.recipient_name}</strong>
              <span>{record.recipient_phone || '未记录电话'} · {record.product || '未记录产品'}</span>
            </div>
            <span className="postal-detail-reader-linked">✓ 读者已关联</span>
          </div>

          <section className="complaint-form-section postal-detail-section">
            <h3><span aria-hidden>📍</span>投递信息</h3>
            <div className="postal-detail-grid">
              <div className="postal-detail-field wide"><span>详细地址</span><strong>{[record.recipient_province, record.recipient_city, record.recipient_district, record.recipient_address].filter(Boolean).join(' ') || '—'}</strong></div>
              <div className="postal-detail-field"><span>邮政编码</span><strong>{record.recipient_postal_code || '未记录'}</strong></div>
              <div className="postal-detail-field"><span>投递状态</span><strong>{deliveryStatusTag(record)}</strong></div>
              <div className="postal-detail-field"><span>订阅起止</span><strong>{record.coverage_start_date || '—'} — {record.coverage_end_date || '—'}</strong></div>
              <div className="postal-detail-field"><span>订阅份数</span><strong>{record.copies} 份</strong></div>
              <div className="postal-detail-field wide"><span>投递单位</span><strong className={!record.distribution_unit_name ? 'muted' : ''}>{record.distribution_unit_name || '待补投递单位'}</strong></div>
            </div>
            <div className="complaint-form-source-note postal-detail-change-note">
              <span aria-hidden>💡</span>
              {changesQ.isLoading ? <span>正在查询信息修改记录…</span> : changesQ.isError ? <Text type="danger">信息修改记录加载失败</Text> : changeSources.length ? (
                <Space wrap size={4}>
                  <span>已应用的信息修改：</span>
                  {changeSources.map((change) => (
                    <Button key={change.id} type="link" icon={<HistoryOutlined />} onClick={() => onOpenAddressChange(change.id)}>
                      #{change.id} · {change.ticket_date ? dayjs(change.ticket_date).format('YYYY-MM-DD') : '日期未填'}
                    </Button>
                  ))}
                </Space>
              ) : <span>当前记录暂无已应用的信息修改；后续可在“邮局工单”中追溯。</span>}
            </div>
          </section>

          <section className="complaint-form-section postal-detail-section">
            <h3><span aria-hidden>💼</span>订单来源与业务</h3>
            <div className="postal-detail-grid">
              <div className="postal-detail-field"><span>订单来源</span><strong>{record.source_channel || '未记录'}</strong></div>
              <div className="postal-detail-field"><span>来源单号</span><strong className={!record.external_order_no ? 'muted' : ''}>{record.external_order_no || '未记录'}</strong></div>
              <div className="postal-detail-field"><span>金额</span><strong>{record.amount != null ? `¥${record.amount}` : '未记录'}</strong></div>
              <div className="postal-detail-field"><span>业务员</span><strong className={!record.salesperson ? 'muted' : ''}>{record.salesperson || '未填写'}</strong></div>
              <div className="postal-detail-field"><span>汇款名</span><strong className={!record.remittance_name ? 'muted' : ''}>{record.remittance_name || '未填写'}</strong></div>
              <div className="postal-detail-field"><span>录入方式</span><strong>{source ? <Tag color={source.color}>{source.label}</Tag> : '未记录'}</strong></div>
            </div>
            <div className="complaint-form-source-note"><span aria-hidden>💡</span><span>来源单号用于记录原平台订单号；未摘抄时可保持为空。</span></div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

/** 投诉 · 新增 / 编辑（基础字段；处理流程见处理抽屉） */
function ComplaintFormModal({ open, editing, prefill, unitOpts, onClose }: {
  open: boolean;
  editing: PostalComplaint | null;
  prefill?: TicketFormPrefill | null;
  unitOpts: UnitOpt[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, complaint_date: toDay(editing.complaint_date) });
    else {
      const reader = prefill?.reader;
      form.resetFields();
      form.setFieldsValue({
        status: 'open',
        complaint_date: dayjs(),
        ...(reader ? {
          postal_delivery_id: reader.id,
          year: reader.year,
          delivery_no: reader.delivery_no,
          snap_name: reader.recipient_name,
          snap_phone: reader.recipient_phone,
          snap_address: reader.recipient_address,
          routed_unit_id: reader.distribution_unit_id,
          source_platform: reader.source_channel,
        } : {}),
        missing_issues: prefill?.communicationContent,
        notes: prefill ? `由回访记录 #${prefill.followUpId} 转入` : undefined,
      });
    }
  }, [open, editing, prefill, form]);

  const year = Form.useWatch<number>('year', form) ?? editing?.year;
  const deliveryNo = Form.useWatch<string>('delivery_no', form) ?? editing?.external_order_no;
  const displayDeliveryNo = year && deliveryNo?.startsWith(`${year}-`) ? deliveryNo.slice(`${year}-`.length) : deliveryNo;
  const sourcePlatform = Form.useWatch<string>('source_platform', form) ?? editing?.source_platform;
  const status = Form.useWatch<PostalComplaintStatus>('status', form) ?? editing?.status ?? 'open';

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body = { ...v, complaint_date: fromDay(v.complaint_date) };
      delete body.postal_delivery_id;
      delete body.source_platform;
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
    <Modal
      title={(
        <div className="complaint-form-title">
          <span className="complaint-form-title-icon" aria-hidden>📬</span>
          <div className="complaint-form-title-copy">
            <strong>{editing ? '编辑投诉' : '新增投诉'}</strong>
            <div className="complaint-form-meta">
              <span>{year ? `${year} 年度` : '待选择年度'}</span>
              <i>·</i>
              <span>{displayDeliveryNo ? `编号 ${displayDeliveryNo}` : '待关联读者'}</span>
              {sourcePlatform && <><i>·</i><span className="complaint-form-platform">来源平台：{sourcePlatform}</span></>}
            </div>
          </div>
          <span className={`complaint-form-status status-${status}`}>{COMPLAINT_STATUS_META[status].label}</span>
        </div>
      )}
      open={open}
      onCancel={onClose}
      width={780}
      centered
      destroyOnClose
      className="complaint-form-modal"
      rootClassName="complaint-form-modal-root"
      footer={(
        <div className="complaint-form-footer">
          <span className="complaint-form-save-tip"><b>✓</b>修改内容会同步到投诉记录</span>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMut.isPending} onClick={() => form.submit()}>
            {editing ? '保存修改' : '创建投诉'}
          </Button>
        </div>
      )}
    >
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)} className="complaint-form">
        <Form.Item name="year" hidden><InputNumber /></Form.Item>
        <Form.Item name="delivery_no" hidden><Input /></Form.Item>
        <Form.Item name="source_platform" hidden><Input /></Form.Item>
        {!editing && (
          <section className="complaint-form-section complaint-form-reader">
            <h3><span aria-hidden>🔗</span>关联读者</h3>
            <Form.Item name="postal_delivery_id" label="检索读者" rules={[{ required: true, message: '请先从投递明细选择读者' }]}
              extra="可按年度编号（如 2026-6325）、姓名、电话或地址搜索">
              <ReaderLookup selectedReader={prefill?.reader} onSelectReader={(reader) => form.setFieldsValue({
                year: reader.year,
                delivery_no: reader.delivery_no,
                snap_name: reader.recipient_name,
                snap_phone: reader.recipient_phone,
                snap_address: reader.recipient_address,
                routed_unit_id: reader.distribution_unit_id,
                source_platform: reader.source_channel,
              })} />
            </Form.Item>
          </section>
        )}

        <section className="complaint-form-section">
          <h3><span aria-hidden>📣</span>投诉信息</h3>
          <div className="complaint-form-grid complaint-form-grid-three">
            <Form.Item name="complaint_date" label="接诉日期"><DatePicker /></Form.Item>
            <Form.Item name="complaint_source" label="投诉来源" rules={[{ required: true, message: '请选择投诉来源' }]}>
              <Select options={COMPLAINT_SOURCE_OPTS} />
            </Form.Item>
            <Form.Item name="status" label="状态"><Select options={COMPLAINT_STATUS_OPTS} /></Form.Item>
            <Form.Item name="missing_issues" label="投诉情况" className="complaint-form-wide">
              <Input.TextArea autoSize={{ minRows: 1, maxRows: 3 }} />
            </Form.Item>
          </div>
        </section>

        <div className="complaint-form-columns">
          <section className="complaint-form-section">
            <h3><span aria-hidden>👤</span>联系人信息</h3>
            <div className="complaint-form-contact-grid">
              <Form.Item name="snap_name" label="收报人（名册快照）"><Input disabled={!editing} /></Form.Item>
              <Form.Item name="snap_phone" label="电话"><Input disabled={!editing} /></Form.Item>
              <Form.Item name="snap_address" label="地址（名册快照）" className="complaint-form-wide">
                <Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} disabled={!editing} />
              </Form.Item>
            </div>
            <div className="complaint-form-source-note">
              <span aria-hidden>🔗</span>
              <span>资料来自 <b>{year && displayDeliveryNo ? `${year}-${displayDeliveryNo}` : '所选读者'}</b> 的关联读者名册，编辑后保留为投诉快照</span>
            </div>
          </section>

          <section className="complaint-form-section">
            <h3><span aria-hidden>📮</span>处理信息</h3>
            <div className="complaint-form-grid complaint-form-processing-grid">
              <Form.Item name="handling" label="处理情况（自动归一渠道单位）" className="complaint-form-wide">
                <Input placeholder="如 转北京11185" />
              </Form.Item>
              <Form.Item name="routed_unit_id" label="投递单位">
                <Select allowClear showSearch optionFilterProp="label" options={unitOpts} />
              </Form.Item>
              <Form.Item name="first_handler" label="第一接诉人"><Input placeholder="姓名" /></Form.Item>
              <Form.Item name="notes" label="备注" className="complaint-form-wide"><Input placeholder="补充说明（选填）" /></Form.Item>
            </div>
          </section>
        </div>
      </Form>
    </Modal>
  );
}

/** 投诉详情抽屉：详情 + 三态时间线 + 登记处理 */
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
    <Drawer title="投诉详情" width={640} open={open} onClose={onClose} destroyOnClose>
      {!c ? <Empty description={detailQ.isLoading ? '加载中…' : (detailQ.isError ? errText(detailQ.error) : '无数据')} /> : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={1} bordered items={[
            { key: 's', label: '状态', children: <Tag color={COMPLAINT_STATUS_META[c.status].color}>{COMPLAINT_STATUS_META[c.status].label}</Tag> },
            { key: 'date', label: '接诉日期', children: c.complaint_date || '—' },
            { key: 'source', label: '投诉来源', children: c.complaint_source || '—' },
            { key: 'platform', label: '来源平台', children: c.source_platform || '—' },
            { key: 'n', label: '收报人', children: c.snap_name || '—' },
            { key: 'phone', label: '电话', children: c.snap_phone || '—' },
            { key: 'address', label: '地址', children: c.snap_address || '—' },
            { key: 'no', label: '编号', children: c.external_order_no || '—' },
            { key: 'm', label: '投诉情况', children: c.missing_issues || '—' },
            { key: 'handling', label: '处理情况', children: c.handling || '—' },
            { key: 'unit', label: '投递单位', children: c.routed_unit_name || c.routed_label || '—' },
            { key: 'first', label: '第一接诉人', children: c.first_handler || '—' },
            { key: 'cnt', label: '处理次数', children: c.handling_count ?? 0 },
            { key: 'notes', label: '备注', children: c.notes || '—' },
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

/** 收件信息变更 · 新增 / 编辑 */
function AddressChangeFormModal({ open, editing, prefill, onClose }: {
  open: boolean;
  editing: PostalAddressChange | null;
  prefill?: TicketFormPrefill | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, change_date: toDay(editing.change_date) });
    else {
      const reader = prefill?.reader;
      form.resetFields();
      form.setFieldsValue({
        change_date: dayjs(),
        ...(reader ? {
          postal_delivery_id: reader.id,
          year: reader.year,
          delivery_no: reader.delivery_no,
          old_name: reader.recipient_name,
          old_phone: reader.recipient_phone,
          old_address: reader.recipient_address,
          old_copies: reader.copies,
          original_start_month: reader.coverage_start_date ? dayjs(reader.coverage_start_date).format('MMDD') : null,
        } : {}),
        notes: prefill ? `由回访记录 #${prefill.followUpId} 转入：${prefill.communicationContent}` : undefined,
      });
    }
  }, [open, editing, prefill, form]);

  const watchedYear = Form.useWatch<number>('year', form);
  const watchedDeliveryNo = Form.useWatch<string>('delivery_no', form);
  const postalDeliveryId = Form.useWatch<number>('postal_delivery_id', form) ?? editing?.postal_delivery_id;
  const externalParts = editing?.external_order_no?.split('-', 2) ?? [];
  const year = watchedYear ?? (externalParts[0] ? Number(externalParts[0]) : undefined);
  const deliveryNo = watchedDeliveryNo ?? externalParts[1];

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body = { ...v, change_date: fromDateTime(v.change_date) };
      delete body.postal_delivery_id;
      return editing ? updateAddressChange(editing.id, body) : createAddressChange(body);
    },
    onSuccess: () => {
      message.success(editing ? '收件信息变更已更新' : '收件信息变更已新增');
      qc.invalidateQueries({ queryKey: ['postalAddrChanges'] });
      qc.invalidateQueries({ queryKey: ['postalTickets'] });
      onClose();
    },
    onError: (e) => message.error(errText(e)),
  });

  const submit = (values: any) => {
    const hasChange = ['new_name', 'new_phone', 'new_address'].some((key) => values[key]?.trim())
      || values.new_copies != null;
    if (!hasChange) {
      message.error('请至少填写一项变更后的收件信息');
      return;
    }
    saveMut.mutate(values);
  };

  return (
    <Modal
      title={(
        <div className="complaint-form-title">
          <span className="complaint-form-title-icon" aria-hidden>📬</span>
          <div className="complaint-form-title-copy">
            <strong>{editing ? '编辑收件信息变更' : '新增收件信息变更'}</strong>
            <div className="complaint-form-meta">
              <span>{year ? `${year} 年度` : '待选择年度'}</span><i>·</i>
              <span>{deliveryNo ? `编号 ${deliveryNo}` : '待关联读者'}</span>
              {postalDeliveryId && <><i>·</i><span className="complaint-form-platform">已关联读者</span></>}
            </div>
          </div>
          <span className="complaint-form-status status-address">待应用</span>
        </div>
      )}
      open={open}
      onCancel={onClose}
      width={900}
      centered
      destroyOnClose
      className="complaint-form-modal address-form-modal"
      rootClassName="complaint-form-modal-root"
      footer={(
        <div className="complaint-form-footer">
          <span className="complaint-form-save-tip"><b>✓</b>保存后生成待应用工单，不会立即覆盖读者名册</span>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMut.isPending} onClick={() => form.submit()}>
            {editing ? '保存修改' : '创建变更工单'}
          </Button>
        </div>
      )}
    >
      <Form form={form} layout="vertical" onFinish={submit} className="complaint-form address-change-form">
        <Form.Item name="year" hidden><InputNumber /></Form.Item>
        <Form.Item name="delivery_no" hidden><Input /></Form.Item>
        {editing && <Form.Item name="postal_delivery_id" hidden><InputNumber /></Form.Item>}

        <section className="complaint-form-section complaint-form-reader">
          <h3><span aria-hidden>🔗</span>关联与生效</h3>
          <div className="complaint-form-grid address-form-schedule">
            {!editing ? (
              <Form.Item name="postal_delivery_id" label="关联读者" rules={[{ required: true, message: '请先从投递明细选择读者' }]}>
                <ReaderLookup selectedReader={prefill?.reader} onSelectReader={(reader) => form.setFieldsValue({
                  year: reader.year,
                  delivery_no: reader.delivery_no,
                  old_name: reader.recipient_name,
                  old_phone: reader.recipient_phone,
                  old_address: reader.recipient_address,
                  old_copies: reader.copies,
                  original_start_month: reader.coverage_start_date ? dayjs(reader.coverage_start_date).format('MMDD') : null,
                })} />
              </Form.Item>
            ) : (
              <Form.Item label="关联读者"><Input value={`${editing.old_name || '读者'} · ${editing.external_order_no || '未匹配'}`} disabled /></Form.Item>
            )}
            <Form.Item name="change_date" label="变更登记时间">
              <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" />
            </Form.Item>
            <Form.Item name="original_start_month" label="原起月日"><Input /></Form.Item>
            <Form.Item name="effective_start_month" label="实际起月日"><Input /></Form.Item>
          </div>
          <div className="complaint-form-source-note"><span aria-hidden>✓</span><span>已从投递明细带入当前名册信息；保存工单不会立即改写名册</span></div>
        </section>

        <section className="complaint-form-section">
          <h3><span aria-hidden>↔️</span>变更前后对比</h3>
          <div className="address-form-compare">
            <div className="address-form-card before">
              <div className="address-form-card-head"><strong>变更前</strong>当前名册信息</div>
              <div className="address-form-person-grid">
                <Form.Item name="old_name" label="姓名"><Input disabled={!editing} /></Form.Item>
                <Form.Item name="old_phone" label="电话"><Input disabled={!editing} /></Form.Item>
                <Form.Item name="old_copies" label="份数"><InputNumber disabled={!editing} /></Form.Item>
              </div>
              <Form.Item name="old_address" label="地址" className="address-form-address"><Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} disabled={!editing} /></Form.Item>
            </div>
            <div className="address-form-card after">
              <div className="address-form-card-head"><strong>变更后</strong>需要应用的新信息</div>
              <div className="address-form-person-grid">
                <Form.Item name="new_name" label="姓名"><Input /></Form.Item>
                <Form.Item name="new_phone" label="电话"><Input /></Form.Item>
                <Form.Item name="new_copies" label="份数"><InputNumber min={0} /></Form.Item>
              </div>
              <Form.Item name="new_address" label="地址" className="address-form-address"><Input.TextArea autoSize={{ minRows: 1, maxRows: 2 }} /></Form.Item>
            </div>
          </div>
          <div className="complaint-form-source-note"><span aria-hidden>💡</span><span>姓名、电话、地址或份数至少填写一项；未填写的项目保持原值</span></div>
        </section>

        <section className="complaint-form-section address-form-explain-section">
          <h3><span aria-hidden>📝</span>处理说明</h3>
          <div className="complaint-form-grid address-form-explain">
            <Form.Item name="handling" label="处理情况"><Input placeholder="如 已联系投递单位，确认下期按新信息投递" /></Form.Item>
            <Form.Item name="notes" label="备注"><Input placeholder="补充说明（选填）" /></Form.Item>
          </div>
        </section>
      </Form>
    </Modal>
  );
}

/** 回访 · 新增 / 编辑 */
function FollowUpFormModal({ open, editing, onClose, onSaved, onContinue }: {
  open: boolean;
  editing: PostalFollowUp | null;
  onClose: () => void;
  onSaved?: () => void;
  onContinue?: (prefill: TicketFormPrefill, actions: FollowNextAction[]) => void;
}) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue({ ...editing, follow_up_date: toDay(editing.follow_up_date) });
    else {
      form.resetFields();
      form.setFieldsValue({ follow_up_date: dayjs(), next_actions: [] });
    }
  }, [open, editing, form]);

  const watchedYear = Form.useWatch<number>('year', form);
  const watchedDeliveryNo = Form.useWatch<string>('delivery_no', form);
  const watchedReaderName = Form.useWatch<string>('snap_name', form);
  const selectedReader = Form.useWatch<PostalDelivery | null>('selected_reader', { form, preserve: true });
  const nextActions = Form.useWatch<FollowNextAction[]>('next_actions', form) ?? [];
  const externalParts = editing?.external_order_no?.split('-', 2) ?? [];
  const year = watchedYear ?? (externalParts[0] ? Number(externalParts[0]) : undefined);
  const deliveryNo = watchedDeliveryNo ?? externalParts[1];
  const readerName = watchedReaderName ?? editing?.snap_name;

  const saveMut = useMutation({
    mutationFn: (v: any) => {
      const body = { ...v, follow_up_date: fromDay(v.follow_up_date) };
      delete body.postal_delivery_id;
      delete body.selected_reader;
      delete body.next_actions;
      return editing ? updateFollowUp(editing.id, body) : createFollowUp(body);
    },
    onSuccess: (response, values) => {
      message.success(editing ? '回访已更新' : '回访已新增');
      qc.invalidateQueries({ queryKey: ['postalFollowUps'] });
      qc.invalidateQueries({ queryKey: ['postalTickets'] });
      onSaved?.();
      onClose();
      const actions = (values.next_actions ?? []) as FollowNextAction[];
      if (!editing && selectedReader && actions.length) {
        onContinue?.({
          reader: selectedReader,
          communicationContent: values.communication_content,
          followUpId: response.data.id,
          existingComplaintId: response.data.parent_ticket_id,
        }, actions);
      }
    },
    onError: (e) => message.error(errText(e)),
  });

  return (
    <Modal
      title={(
        <div className="complaint-form-title">
          <span className="complaint-form-title-icon" aria-hidden>📞</span>
          <div className="complaint-form-title-copy">
            <strong>{editing ? '编辑回访' : '新增回访'}</strong>
            <div className="complaint-form-meta">
              <span>{year ? `${year} 年度` : '待选择年度'}</span><i>·</i>
              <span>{deliveryNo ? `编号 ${deliveryNo}` : '待关联读者'}</span>
              {readerName && <><i>·</i><span className="complaint-form-platform">{readerName}</span></>}
            </div>
          </div>
          <span className="complaint-form-status status-in_progress">回访登记</span>
        </div>
      )}
      open={open}
      onCancel={onClose}
      width={820}
      centered
      destroyOnClose
      className="complaint-form-modal follow-form-modal"
      rootClassName="complaint-form-modal-root"
      footer={(
        <div className="complaint-form-footer">
          <span className="complaint-form-save-tip"><b>✓</b>回访负责留痕；投诉和资料变更分别进入对应工单处理</span>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saveMut.isPending} onClick={() => form.submit()}>
            {!editing && nextActions.length ? '保存并继续' : (editing ? '保存修改' : '保存回访')}
          </Button>
        </div>
      )}
    >
      <Form form={form} layout="vertical" onFinish={(v) => saveMut.mutate(v)} className="complaint-form follow-up-form">
        <Form.Item name="year" hidden><InputNumber /></Form.Item>
        <Form.Item name="delivery_no" hidden><Input /></Form.Item>
        <Form.Item name="snap_name" hidden><Input /></Form.Item>
        {editing && <Form.Item name="postal_delivery_id" hidden><InputNumber /></Form.Item>}

        <section className="complaint-form-section complaint-form-reader">
          <h3><span aria-hidden>🔗</span>关联与时间</h3>
          <div className="complaint-form-grid follow-form-link-grid">
            {!editing ? (
              <Form.Item name="postal_delivery_id" label="关联读者" rules={[{ required: true, message: '请先从投递明细选择读者' }]}>
                <ReaderLookup selectedReader={selectedReader} onSelectReader={(reader) => {
                  form.setFieldsValue({
                    selected_reader: reader,
                    year: reader.year,
                    delivery_no: reader.delivery_no,
                    snap_name: reader.recipient_name,
                  });
                }} />
              </Form.Item>
            ) : (
              <Form.Item label="关联读者"><Input value={`${editing.snap_name || '读者'} · ${editing.external_order_no || '未匹配'}`} disabled /></Form.Item>
            )}
            <Form.Item name="follow_up_date" label="回访日期" rules={[{ required: true, message: '请选择回访日期' }]}><DatePicker /></Form.Item>
          </div>
          <div className="complaint-form-source-note"><span aria-hidden>✓</span><span>已关联读者；年度、编号和收报人快照已自动带入</span></div>
        </section>

        <section className="complaint-form-section">
          <h3><span aria-hidden>💬</span>沟通记录</h3>
          <div className="complaint-form-grid follow-form-communication-grid">
            <Form.Item name="communication_content" label="沟通内容" rules={[{ required: true, message: '请填写本次沟通内容' }]}>
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} placeholder="记录客户反馈、问题和诉求" />
            </Form.Item>
            <Form.Item name="result" label="沟通结果" rules={[{ required: true, message: '请填写本次沟通结果' }]}>
              <Input.TextArea autoSize={{ minRows: 3, maxRows: 5 }} placeholder="记录结论、约定和下一步" />
            </Form.Item>
          </div>
        </section>

        {!editing && (
          <section className="complaint-form-section follow-form-actions-section">
            <h3><span aria-hidden>🧭</span>后续处理</h3>
            <Form.Item name="next_actions">
              <Checkbox.Group className="follow-next-actions">
                <Checkbox value="complaint" className={`follow-next-action complaint ${nextActions.includes('complaint') ? 'selected' : ''}`}>
                  <span className="follow-next-action-copy"><strong>创建投诉工单</strong><small>带入关联读者与沟通内容</small></span>
                </Checkbox>
                <Checkbox value="address" className={`follow-next-action address ${nextActions.includes('address') ? 'selected' : ''}`}>
                  <span className="follow-next-action-copy"><strong>创建收件信息变更工单</strong><small>打开变更前后对比，确认具体修改项</small></span>
                </Checkbox>
              </Checkbox.Group>
            </Form.Item>
            <div className="complaint-form-source-note"><span aria-hidden>💡</span><span>可同时选择；保存回访后依次打开预填工单，各自处理并保留关联</span></div>
          </section>
        )}
      </Form>
    </Modal>
  );
}

const TICKET_TYPE_META: Record<TicketType, { label: string; color: string }> = {
  complaint: { label: '投诉', color: 'red' },
  address: { label: '收件信息变更', color: 'purple' },
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

/** 收件信息变更详情抽屉：新旧对比 + 应用变更（写回投递记录，挂单则同步履约订单）。 */
function AddressDetailDrawer({ addressId, readOnly = false, modal = false, onEdit, onClose }: {
  addressId: number | null; readOnly?: boolean; modal?: boolean; onEdit: (rec: PostalAddressChange) => void; onClose: () => void;
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
      message.success('已应用收件信息变更');
      qc.invalidateQueries({ queryKey: ['postalTickets'] });
      qc.invalidateQueries({ queryKey: ['postalAddrDetail', addressId] });
    },
    onError: (e) => message.error(errText(e)),
  });
  const a = q.data;
  const extra = a && (readOnly || a.applied_to_order
    ? <Text type="secondary">{a.applied_to_order ? '已应用 · 只读' : '只读查看'}</Text>
    : isAdmin ? <Button icon={<EditOutlined />} onClick={() => onEdit(a)}>编辑</Button> : null);
  const content = !a ? <Empty description={q.isLoading ? '加载中…' : '无数据'} /> : (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="diff-row" style={{ display: 'flex', gap: 12 }}>
            <Card size="small" title="原" style={{ flex: 1, background: 'var(--color-bg-subtle)' }}>
              <div>{a.old_name || '—'}{a.old_phone ? ` / ${a.old_phone}` : ''}</div>
              <div style={{ color: 'var(--color-text-tertiary)' }}>{a.old_address || '—'}</div>
              {a.old_copies != null && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>份数 {a.old_copies}</div>}
            </Card>
            <Card size="small" title="新" style={{ flex: 1, background: 'var(--color-success-soft)', borderColor: 'var(--color-success)' }}>
              <div>{a.new_name || '—'}{a.new_phone ? ` / ${a.new_phone}` : ''}</div>
              <div style={{ color: 'var(--color-success-text)' }}>{a.new_address || '—'}</div>
              {a.new_copies != null && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>份数 {a.new_copies}</div>}
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
          {isAdmin && !readOnly && !a.applied_to_order && (
            <Popconfirm
              title="应用收件信息变更？"
              description={a.postal_delivery_id
                ? '把变更后的姓名、电话、地址和份数写回投递明细' + (a.order_id ? '，并同步该读者在履约的订单。' : '（该读者未挂订单，仅更新名册）。')
                : '该工单未关联投递记录，无法应用（请先导入读者名册）。'}
              okText="应用" onConfirm={() => applyMut.mutate()} disabled={!a.postal_delivery_id}
            >
              <Button type="primary" loading={applyMut.isPending} disabled={!a.postal_delivery_id}>✅ 应用变更</Button>
            </Popconfirm>
          )}
          {a.notes && <Text type="secondary">备注：{a.notes}</Text>}
    </Space>
  );
  if (modal) return (
    <Modal title={<Space>收件信息变更工单{extra}</Space>} width={680} open={open} onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>} destroyOnClose mask={false} zIndex={1100}
      style={{ top: 72, marginLeft: 40, marginRight: 'auto' }}>
      <div style={{ maxHeight: 'calc(100vh - 210px)', overflowY: 'auto', paddingRight: 4 }}>{content}</div>
    </Modal>
  );
  return (
    <Drawer title="收件信息变更工单" width={560} open={open} onClose={onClose} destroyOnClose extra={extra}>
      {content}
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
          { key: 'content', label: '沟通内容', children: <span style={{ whiteSpace: 'pre-wrap' }}>{f.communication_content || '—'}</span> },
          { key: 'r', label: '沟通结果', children: <span style={{ whiteSpace: 'pre-wrap' }}>{f.result || '—'}</span> },
          { key: 'link', label: '关联读者', children: readerTag(f.postal_delivery_id) },
        ]} />
      )}
    </Drawer>
  );
}

/** Tab：邮局工单（投诉 / 改地址 / 回访 统一） */
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
  const [complaintPrefill, setComplaintPrefill] = useState<TicketFormPrefill | null>(null);
  const [addressPrefill, setAddressPrefill] = useState<TicketFormPrefill | null>(null);
  const [queuedAddressPrefill, setQueuedAddressPrefill] = useState<TicketFormPrefill | null>(null);

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
  const delAddress = useMutation({ mutationFn: (id: number) => deleteAddressChange(id), onSuccess: () => { message.success('已删除收件信息变更'); invalidate(); }, onError: (e) => message.error(errText(e)) });
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
        setComplaintPrefill(null);
        setComplaintForm({ open: true, editing: d.complaint });
      } else if (t.type === 'address') {
        const rec = (await getAddressChange(t.id)).data;
        setAddressPrefill(null);
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

  const closeAddressForm = () => {
    setAddressForm({ open: false, editing: null });
    setAddressPrefill(null);
  };
  const closeComplaintForm = () => {
    setComplaintForm({ open: false, editing: null });
    setComplaintPrefill(null);
    if (queuedAddressPrefill) {
      setAddressPrefill(queuedAddressPrefill);
      setAddressForm({ open: true, editing: null });
      setQueuedAddressPrefill(null);
    }
  };
  const continueFromFollowUp = (prefill: TicketFormPrefill, actions: FollowNextAction[]) => {
    const wantsComplaint = actions.includes('complaint');
    const wantsAddress = actions.includes('address');
    if (wantsComplaint && prefill.existingComplaintId) {
      message.info('该回访已自动并入现有投诉工单，无需重复创建');
    }
    if (wantsComplaint && !prefill.existingComplaintId) {
      setQueuedAddressPrefill(wantsAddress ? prefill : null);
      setComplaintPrefill(prefill);
      setComplaintForm({ open: true, editing: null });
      return;
    }
    if (wantsAddress) {
      setAddressPrefill(prefill);
      setAddressForm({ open: true, editing: null });
    } else if (wantsComplaint && prefill.existingComplaintId) {
      setHandlingId(prefill.existingComplaintId);
    }
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
          {r.postal_delivery_id ? '已关联投递明细' : '未关联投递明细'}{r.handling_count != null ? ` · 已处理 ${r.handling_count} 次` : ''}
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
            <Button type="link" size="small" icon={<HistoryOutlined />} onClick={() => openDetail(r)}>详情</Button>
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
    { label: `收件信息变更${sm ? ` ${sm.address}` : ''}`, value: 'address' },
    { label: `回访${sm ? ` ${sm.follow}` : ''}`, value: 'follow' },
  ];

  return (
    <>
      <PageHeader
        title="邮局工单"
        description={`共 ${data?.total ?? 0} 条工单`}
        actions={<Space wrap>
          <Dropdown menu={{ items: [
            { key: 'complaint', label: '导入投诉', onClick: () => setImportType('complaint') },
            { key: 'address', label: '导入收件信息变更', onClick: () => setImportType('address') },
            { key: 'follow', label: '导入回访', onClick: () => setImportType('follow') },
          ] }}>
            <Button icon={<UploadOutlined />}>导入</Button>
          </Dropdown>
          {isAdmin && (
            <Dropdown menu={{ items: [
              { key: 'complaint', label: '新增投诉', onClick: () => { setComplaintPrefill(null); setComplaintForm({ open: true, editing: null }); } },
              { key: 'address', label: '新增收件信息变更', onClick: () => { setAddressPrefill(null); setAddressForm({ open: true, editing: null }); } },
              { key: 'follow', label: '新增回访', onClick: () => setFollowForm({ open: true, editing: null }) },
            ] }}>
              <Button type="primary" icon={<PlusOutlined />}>新建工单</Button>
            </Dropdown>
          )}
        </Space>}
      />

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
        onEdit={(rec) => { setAddressDetailId(null); setAddressPrefill(null); setAddressForm({ open: true, editing: rec }); }} />
      <FollowDetailDrawer followId={followDetailId} onClose={() => setFollowDetailId(null)}
        onEdit={(rec) => { setFollowDetailId(null); setFollowForm({ open: true, editing: rec }); }} />

      {/* 表单弹窗 */}
      <ComplaintFormModal open={complaintForm.open} editing={complaintForm.editing} prefill={complaintPrefill} unitOpts={unitOpts} onClose={closeComplaintForm} />
      <AddressChangeFormModal open={addressForm.open} editing={addressForm.editing} prefill={addressPrefill} onClose={closeAddressForm} />
      <FollowUpFormModal open={followForm.open} editing={followForm.editing} onClose={() => setFollowForm({ open: false, editing: null })} onContinue={continueFromFollowUp} />

      {/* 导入弹窗 */}
      <ComplaintImportModal open={importType === 'complaint'} onClose={() => setImportType(null)} />
      <SimpleImportModal<AddrImportRow>
        open={importType === 'address'} onClose={() => setImportType(null)} title="导入收件信息变更" unit="条" linkedLabel="已关联" invalidateKey="postalTickets"
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
  { key: 'deliveries', label: '投递明细', component: DeliveriesTab },
  { key: 'tickets', label: '邮局工单', component: TicketsTab },
] as const;

export default function PostDelivery() {
  const { tab } = useParams<{ tab: string }>();
  const current = POST_TABS.find((t) => t.key === tab) ?? POST_TABS[0];
  const Content = current.component;
  return <Content />;
}
