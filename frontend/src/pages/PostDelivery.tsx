import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, DownloadOutlined, UploadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import { listPartners } from '../api/contracts';
import {
  applyAddressChange,
  commitAddressChangeImport,
  commitComplaintImport,
  commitFinanceImport,
  commitFollowUpImport,
  commitPostalImport,
  downloadPostalBatch,
  generatePostalBatch,
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
} from '../api/postal';
import type {
  AddrImportRow,
  ComplaintImportPreview,
  ComplaintImportRow,
  FinanceImportRow,
  FollowImportRow,
  PostalAddressChange,
  PostalBatch,
  PostalBatchRow,
  PostalBatchStatus,
  PostalComplaint,
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
  resolved: { label: '已回访', color: 'green' },
};

const POSTAL_CHANNELS = ['CBJ+小程序', '中经报有赞', '淘宝发行部', '对公转账'];
const YEAR_OPTS = [2024, 2025, 2026].map((y) => ({ label: `${y}年`, value: y }));
const MONTH_OPTS = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1} 月`, value: i + 1 }));

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
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
  const PAGE_SIZE = 50;

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
    { title: '编号', dataIndex: 'delivery_no', width: 90, fixed: 'left', render: (v: string, r) => <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{r.year}-{v}</Text> },
    { title: '收报人', dataIndex: 'recipient_name', width: 100 },
    { title: '电话', dataIndex: 'recipient_phone', width: 120, render: (v: string | null) => v || '—' },
    { title: '省/市/区 · 详细地址', key: 'addr', width: 280, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        <Text>{[r.recipient_province, r.recipient_city, r.recipient_district].filter(Boolean).join(' ') || '—'}</Text>
        <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.recipient_address}</Text>
      </Space>
    ) },
    { title: '邮编', dataIndex: 'recipient_postal_code', width: 80, render: (v: string | null) => v || '—' },
    { title: '份数', dataIndex: 'copies', width: 60, align: 'right' },
    { title: '起止月', key: 'coverage', width: 170, render: (_: unknown, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.coverage_start_date}~{r.coverage_end_date}</Text> },
    { title: '投递单位', dataIndex: 'distribution_unit_name', width: 130, render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—(未填)</Text>) },
    { title: '渠道', dataIndex: 'source_channel', width: 120, render: (v: string | null) => v || '—' },
  ];

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Text type="secondary">邮局记录不进「订单列表 / 客户管理」，这里是它们完整名册的家（可搜可筛可导出）。每条 = 一条投递记录（≠订单）。</Text>
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入邮局明细</Button>
      </Flex>
      <Flex wrap gap={8} style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
        <Select allowClear placeholder="起投月" style={{ width: 110 }} value={month} onChange={(v) => { setMonth(v); setPage(1); }} options={MONTH_OPTS} />
        <Select allowClear placeholder="渠道" style={{ width: 150 }} value={channel} onChange={(v) => { setChannel(v); setPage(1); }} options={POSTAL_CHANNELS.map((c) => ({ label: c, value: c }))} />
        <Select allowClear showSearch optionFilterProp="label" placeholder="投递单位" style={{ width: 160 }} value={unitId} onChange={(v) => { setUnitId(v); setPage(1); }} options={unitOpts} />
        <Input.Search allowClear placeholder="搜索 姓名 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
      </Flex>
      <Table<PostalDelivery> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small" scroll={{ x: 1150 }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条投递记录`, showSizeChanger: false }} />
      <ReaderImportModal open={importOpen} onClose={() => setImportOpen(false)} />
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
    { title: '收报人', dataIndex: 'snap_name', width: 100, fixed: 'left' },
    { title: '电话', dataIndex: 'snap_phone', width: 120 },
    { title: '地区', key: 'region', width: 150, render: (_: unknown, r) => [r.snap_province, r.snap_city, r.snap_district].filter(Boolean).join(' ') || '—' },
    { title: '详细地址', dataIndex: 'snap_address', width: 240, ellipsis: true },
    { title: '邮编', dataIndex: 'snap_postal_code', width: 80, render: (v: string | null) => v || '—' },
    { title: '份数', dataIndex: 'copies', width: 60, align: 'right' },
    { title: '起止月', key: 'coverage', width: 170, render: (_: unknown, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.coverage_start_date}~{r.coverage_end_date}</Text> },
    { title: '投递单位', dataIndex: 'distribution_unit_name', width: 130, render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—(未填)</Text>) },
    { title: '渠道', dataIndex: 'source_channel', width: 120, render: (v: string | null) => v || '—' },
    { title: '业务员', dataIndex: 'salesperson', width: 90, render: (v: string | null) => v || '—' },
  ];

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
              <Table<PostalBatchRow> rowKey="id" columns={rowCols} dataSource={rows} size="small" pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 行` }} scroll={{ x: 1200 }} />
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
  const PAGE_SIZE = 50;

  const q = useQuery({
    queryKey: ['postalComplaints', { year, status, minHandling, search, page }],
    queryFn: () => listComplaints({ year, status, min_handling_count: minHandling, search: search.trim() || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
  });
  const data = q.data;

  const cols: TableColumnsType<PostalComplaint> = [
    { title: '接诉日期', dataIndex: 'complaint_date', width: 110, render: (v: string | null) => v || '—' },
    { title: '收报人', dataIndex: 'snap_name', width: 90 },
    { title: '编号', dataIndex: 'external_order_no', width: 110, render: (v: string | null) => v || '—' },
    { title: '投诉情况', dataIndex: 'missing_issues', ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '处理', key: 'handling', width: 170, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        {r.routed_label && <Tag>{r.routed_label}</Tag>}
        {r.handling && <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.handling}</Text>}
      </Space>
    ) },
    { title: '回访', dataIndex: 'follow_up', width: 160, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '次数', dataIndex: 'handling_count', width: 60, align: 'right', render: (v: number | null) => v ?? '—' },
    { title: '投递单位', dataIndex: 'routed_unit_name', width: 120, render: (v: string | null) => v ? <Tag color="blue">{v}</Tag> : '—' },
    { title: '状态', dataIndex: 'status', width: 90, render: (s: PostalComplaintStatus) => <Tag color={COMPLAINT_STATUS_META[s].color}>{COMPLAINT_STATUS_META[s].label}</Tag> },
    { title: '读者', key: 'reader', width: 100, fixed: 'right', render: (_: unknown, r) => readerTag(r.postal_delivery_id) },
  ];

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
          <Select allowClear placeholder="状态" style={{ width: 120 }} value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ label: '待处理', value: 'open' }, { label: '已回访', value: 'resolved' }]} />
          <Select allowClear placeholder="处理次数" style={{ width: 130 }} value={minHandling} onChange={(v) => { setMinHandling(v); setPage(1); }}
            options={[{ label: '≥2 次', value: 2 }, { label: '≥3 次', value: 3 }]} />
          <Input.Search allowClear placeholder="搜索 收报人 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入投诉</Button>
      </Flex>

      <Table<PostalComplaint>
        rowKey="id"
        columns={cols}
        dataSource={data?.rows ?? []}
        loading={q.isLoading}
        size="small"
        scroll={{ x: 1200 }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }}
      />

      <ComplaintImportModal open={importOpen} onClose={() => setImportOpen(false)} />
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

/** Tab：改地址工单 */
function AddressChangesTab() {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [year, setYear] = useState<number | undefined>();
  const [applied, setApplied] = useState<boolean | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
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

  const cols: TableColumnsType<PostalAddressChange> = [
    { title: '修改日期', dataIndex: 'change_date', width: 110, render: (v: string | null) => v || '—' },
    { title: '收报人', key: 'name', width: 130, render: (_: unknown, r) => <Space size={4}>{r.old_name || '—'}{r.new_name && <><span style={{ color: '#999' }}>→</span>{r.new_name}</>}</Space> },
    { title: '编号', dataIndex: 'external_order_no', width: 110, render: (v: string | null) => v || '—' },
    { title: '新地址', dataIndex: 'new_address', ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '新电话', dataIndex: 'new_phone', width: 120, render: (v: string | null) => v || '—' },
    { title: '处理', key: 'handling', width: 160, render: (_: unknown, r) => (
      <Space direction="vertical" size={0}>
        {r.routed_label && <Tag>{r.routed_label}</Tag>}
        {r.handling && <Text type="secondary" style={{ fontSize: 12 }} ellipsis>{r.handling}</Text>}
      </Space>
    ) },
    { title: '读者', key: 'reader', width: 100, render: (_: unknown, r) => readerTag(r.postal_delivery_id) },
    { title: '应用', key: 'apply', width: 130, fixed: 'right', render: (_: unknown, r) => (
      r.applied_to_order
        ? <Tag color="green">✓ 已应用</Tag>
        : (isAdmin && r.postal_delivery_id
          ? <Popconfirm title="把新姓名/电话/地址写回投递记录？下一版明细即用新地址。" onConfirm={() => applyMut.mutate(r.id)}><Button size="small" loading={applyMut.isPending}>应用新地址</Button></Popconfirm>
          : <Text type="secondary">{r.postal_delivery_id ? '—' : '未匹配'}</Text>)
    ) },
  ];

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
          <Select allowClear placeholder="应用状态" style={{ width: 130 }} value={applied} onChange={(v) => { setApplied(v); setPage(1); }} options={[{ label: '已应用', value: true }, { label: '未应用', value: false }]} />
          <Input.Search allowClear placeholder="搜索 姓名 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入改地址</Button>
      </Flex>
      <Table<PostalAddressChange> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small" scroll={{ x: 1150 }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }} />
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
    </>
  );
}

/** Tab：回访 */
function FollowUpsTab() {
  const [year, setYear] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const PAGE_SIZE = 50;

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
    { title: '读者', key: 'reader', width: 100, fixed: 'right', render: (_: unknown, r) => readerTag(r.postal_delivery_id) },
  ];

  return (
    <>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Space wrap>
          <Select allowClear placeholder="年度" style={{ width: 110 }} value={year} onChange={(v) => { setYear(v); setPage(1); }} options={YEAR_OPTS} />
          <Input.Search allowClear placeholder="搜索 姓名 / 编号" style={{ width: 220 }} onSearch={(v) => { setSearch(v); setPage(1); }} onChange={(e) => !e.target.value && setSearch('')} />
        </Space>
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入回访</Button>
      </Flex>
      <Table<PostalFollowUp> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small" scroll={{ x: 850 }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }} />
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
  const PAGE_SIZE = 50;

  const q = useQuery({
    queryKey: ['postalFinance', { platform, taxCat, linked, search, page }],
    queryFn: () => listFinance({ platform, tax_category: taxCat, linked, search: search.trim() || undefined, page, page_size: PAGE_SIZE }).then((r) => r.data),
  });

  const linkTag = (r: PostalFinance) => {
    if (!r.order_id) return <Text type="secondary">未挂</Text>;
    return <Tag color="green">{r.link_by === 'order_no' ? '订单号' : '姓名'}挂单</Tag>;
  };

  const cols: TableColumnsType<PostalFinance> = [
    { title: '姓名', dataIndex: 'payer_name', width: 90 },
    { title: '商品', dataIndex: 'product', width: 130, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: '金额', dataIndex: 'amount', width: 80, align: 'right', render: (v: string | null) => v ? `¥${v}` : '—' },
    { title: '手续费', dataIndex: 'fee_amount', width: 80, align: 'right', render: (v: string | null) => v ? `¥${v}` : '—' },
    { title: '到款', dataIndex: 'net_amount', width: 90, align: 'right', render: (v: string | null) => v ? `¥${v}` : '—' },
    { title: '到款日期', dataIndex: 'collected_at', width: 110, render: (v: string | null) => v || '—' },
    { title: '开票抬头', dataIndex: 'buyer_title', ellipsis: true, render: (v: string | null) => v || <Text type="secondary">不开票/—</Text> },
    { title: '票种', dataIndex: 'tax_category', width: 70, render: (v: string | null) => v ? <Tag color={v === '专票' ? 'gold' : 'default'}>{v}</Tag> : '—' },
    { title: '平台', dataIndex: 'platform', width: 120, render: (v: string | null) => v || '—' },
    { title: '挂单', key: 'link', width: 100, fixed: 'right', render: (_: unknown, r) => linkTag(r) },
  ];

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
        <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入收款发票</Button>
      </Flex>
      <Table<PostalFinance> rowKey="id" columns={cols} dataSource={q.data?.rows ?? []} loading={q.isLoading} size="small" scroll={{ x: 1200 }}
        pagination={{ current: page, pageSize: PAGE_SIZE, total: q.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条`, showSizeChanger: false }} />
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
    </>
  );
}

export default function PostDelivery() {
  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>物流管理 · 邮局投递</Title>
      <Tabs
        defaultActiveKey="deliveries"
        items={[
          { key: 'deliveries', label: '📇 投递名册', children: <DeliveriesTab /> },
          { key: 'batches', label: '📦 月度起投明细', children: <BatchesTab /> },
          { key: 'complaints', label: '📮 投诉工单', children: <ComplaintsTab /> },
          { key: 'address', label: '✏️ 改地址', children: <AddressChangesTab /> },
          { key: 'follow', label: '📞 回访', children: <FollowUpsTab /> },
          { key: 'finance', label: '🧾 收款发票', children: <FinanceTab /> },
        ]}
      />
    </div>
  );
}
