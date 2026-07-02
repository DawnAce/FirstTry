import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Flex,
  List,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, DownloadOutlined, UploadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import {
  commitPostalImport,
  downloadPostalBatch,
  generatePostalBatch,
  getPostalBatch,
  listPostalBatches,
  markPostalBatchSent,
  previewPostalImport,
} from '../api/postal';
import type {
  PostalBatch,
  PostalBatchRow,
  PostalBatchStatus,
  PostalImportDecision,
  PostalImportPreview,
  PostalImportRow,
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

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PostalImportPreview | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
  };

  const previewMut = useMutation({
    mutationFn: () => previewPostalImport(file as File),
    onSuccess: (res) => setPreview(res.data),
    onError: (err) => message.error(errText(err)),
  });

  const commitMut = useMutation({
    mutationFn: () => commitPostalImport(preview!.session_id),
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created} 单（跳过重复 ${res.data.skipped_duplicates}）`);
      qc.invalidateQueries({ queryKey: ['postalBatches'] });
      reset();
      onClose();
    },
    onError: (err) => message.error(errText(err)),
  });

  const counts = preview?.counts ?? {};
  const columns: TableColumnsType<PostalImportRow> = [
    { title: '结果', dataIndex: 'decision', width: 90, render: (d: PostalImportDecision) => <Tag color={DECISION_META[d].color}>{DECISION_META[d].label}</Tag> },
    { title: '编号', dataIndex: 'external_order_no', width: 120 },
    { title: '收报人', dataIndex: 'name', width: 100 },
    { title: '金额', dataIndex: 'amount', width: 80, align: 'right', render: (v: string) => `¥${v}` },
    { title: '覆盖期', dataIndex: 'coverage_label', width: 180 },
    { title: '投递单位', dataIndex: 'distribution_unit', width: 120, render: (v: string) => v || <Text type="secondary">—(未填)</Text> },
    {
      title: '原因 / 提醒', key: 'note',
      render: (_: unknown, r) => (
        <Space direction="vertical" size={0}>
          {r.reason && <Text type="secondary" style={{ fontSize: 12 }}>{r.reason}</Text>}
          {r.warnings.map((w, i) => <Text key={i} type="warning" style={{ fontSize: 12 }}>⚠ {w}</Text>)}
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title="导入邮局读者明细"
      open={open}
      onCancel={() => { reset(); onClose(); }}
      width={920}
      footer={null}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        <Upload.Dragger
          maxCount={1}
          accept=".xlsx"
          beforeUpload={(f) => { setFile(f); setPreview(null); return false; }}
          onRemove={() => reset()}
          fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">点击或拖拽《报纸邮局投递明细》.xlsx 到此处</p>
          <p className="ant-upload-hint">自动识别「邮局读者明细」工作表；编号加年份前缀防重导</p>
        </Upload.Dragger>
        <Button type="primary" icon={<UploadOutlined />} onClick={() => previewMut.mutate()} loading={previewMut.isPending} disabled={!file}>
          预览导入
        </Button>

        {preview && (
          <>
            <Space wrap>
              <Tag color="green">导入 {counts.import ?? 0}</Tag>
              <Tag color="blue">重复 {counts.duplicate ?? 0}</Tag>
              <Tag color="red">待确认 {counts.unresolved ?? 0}</Tag>
              <Text type="secondary">共 {counts.total ?? 0} 行</Text>
              <span style={{ marginLeft: 'auto' }} />
              {isAdmin ? (
                <Button type="primary" onClick={() => commitMut.mutate()} loading={commitMut.isPending} disabled={!preview.can_commit}>
                  确认导入 {counts.import ?? 0} 单
                </Button>
              ) : (
                <Text type="secondary">确认导入需管理员权限</Text>
              )}
            </Space>
            <Table<PostalImportRow>
              rowKey="external_order_no"
              columns={columns}
              dataSource={preview.rows}
              size="small"
              pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 行` }}
              scroll={{ x: 800, y: 360 }}
            />
          </>
        )}
      </Space>
    </Modal>
  );
}

export default function PostDelivery() {
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
      message.success(`已生成 ${res.data.year}-${String(res.data.month).padStart(2, '0')} 批次（${res.data.row_count} 行）`);
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
    {
      title: '地区', key: 'region', width: 150,
      render: (_: unknown, r) => [r.snap_province, r.snap_city, r.snap_district].filter(Boolean).join(' ') || '—',
    },
    { title: '详细地址', dataIndex: 'snap_address', width: 240, ellipsis: true },
    { title: '邮编', dataIndex: 'snap_postal_code', width: 80, render: (v: string | null) => v || '—' },
    { title: '份数', dataIndex: 'copies', width: 60, align: 'right' },
    {
      title: '起止月', key: 'coverage', width: 170,
      render: (_: unknown, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.coverage_start_date}~{r.coverage_end_date}</Text>,
    },
    {
      title: '投递单位', dataIndex: 'distribution_unit_name', width: 130,
      render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : <Text type="secondary">—(未填)</Text>),
    },
    { title: '渠道', dataIndex: 'source_channel', width: 120, render: (v: string | null) => v || '—' },
    { title: '业务员', dataIndex: 'salesperson', width: 90, render: (v: string | null) => v || '—' },
  ];

  return (
    <div>
      <Flex justify="space-between" align="center" wrap style={{ marginBottom: 8 }}>
        <Title level={3} style={{ margin: 0 }}>物流管理 · 邮局投递</Title>
        <Space wrap>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>导入邮局明细</Button>
          <DatePicker picker="month" value={genMonth} onChange={setGenMonth} placeholder="选起投月，如 2026-07" />
          {isAdmin && (
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => generateMut.mutate()} loading={generateMut.isPending} disabled={!genMonth}>
              生成批次
            </Button>
          )}
        </Space>
      </Flex>
      <Text type="secondary">按「起投月」把 post_office 订单归成每月一版投递明细，冻结存档、导出交邮局。给过的不再给；完整名册在「订单 / 客户管理」里看全量。</Text>

      <Flex gap={16} align="start" style={{ marginTop: 16 }}>
        {/* 左：批次列表 */}
        <Card size="small" title="投递批次（起投月）" style={{ width: 260, flex: '0 0 260px' }} styles={{ body: { padding: 0 } }} loading={batchesQ.isLoading}>
          {batches.length === 0 ? (
            <Empty style={{ padding: 24 }} image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无批次" />
          ) : (
            <List<PostalBatch>
              dataSource={batches}
              renderItem={(b) => {
                const meta = STATUS_META[b.status];
                const active = b.id === activeId;
                return (
                  <List.Item
                    onClick={() => setSelectedId(b.id)}
                    style={{
                      cursor: 'pointer', padding: '10px 14px',
                      background: active ? '#e6f4ff' : undefined,
                      boxShadow: active ? 'inset 3px 0 0 #1677ff' : undefined,
                    }}
                  >
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
              }}
            />
          )}
        </Card>

        {/* 右：批次明细 */}
        <Card size="small" style={{ flex: 1, minWidth: 0 }} loading={detailQ.isLoading && activeId != null}>
          {!detail ? (
            <Empty description="选择左侧一版批次查看明细" />
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
                  <Button
                    icon={<DownloadOutlined />}
                    onClick={() => downloadPostalBatch(detail.batch.id, `邮局投递明细_${detail.batch.year}-${String(detail.batch.month).padStart(2, '0')}.xlsx`).catch(() => message.error('导出失败'))}
                  >
                    导出 Excel
                  </Button>
                </Space>
              </Flex>
              <Table<PostalBatchRow>
                rowKey="id"
                columns={rowCols}
                dataSource={rows}
                size="small"
                pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 行` }}
                scroll={{ x: 1200 }}
              />
            </>
          )}
        </Card>
      </Flex>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
