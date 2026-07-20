import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, DatePicker, Drawer, Empty, Flex, Form, InputNumber, List, Modal,
  Popconfirm, Space, Table, Tag, Typography, Upload, message,
} from 'antd';
import {
  DownloadOutlined, FileAddOutlined, InboxOutlined, ThunderboltOutlined, UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import {
  activateSubImport, createSubBatch, createSubImport, downloadSubArtifact, generateSubBatch,
  getSubBatch, getSubImportIssues, getSubImportRecords, listSubArtifacts, listSubBatches,
} from '../api/subscription';
import type {
  Artifact, BatchStatus, ImportStatus, ImportVersion, IssueLevel, SubBatch, SubRecord, ValidationIssue,
} from '../api/subscription';

const { Title, Text } = Typography;

const BATCH_STATUS_META: Record<BatchStatus, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'default' },
  pending_validation: { label: '待设为有效', color: 'orange' },
  ready: { label: '可生成', color: 'cyan' },
  generated: { label: '已生成', color: 'green' },
  archived: { label: '已归档', color: 'default' },
};

const IMPORT_STATUS_META: Record<ImportStatus, { label: string; color: string }> = {
  uploading: { label: '上传中', color: 'default' },
  parsing: { label: '解析中', color: 'processing' },
  validation_failed: { label: '校验失败', color: 'red' },
  validation_passed: { label: '校验通过', color: 'blue' },
  active: { label: '当前有效', color: 'green' },
  superseded: { label: '已被替代', color: 'default' },
};

const ISSUE_META: Record<IssueLevel, { label: string; color: string }> = {
  block: { label: '阻断', color: 'red' },
  warn: { label: '警告', color: 'orange' },
  info: { label: '提示', color: 'blue' },
};

function errText(err: unknown): string {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? '操作失败';
}

/** 新建批次弹窗 */
function BatchCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm();
  const mut = useMutation({
    mutationFn: (v: { year: number; month: Dayjs; unit_price?: number; make_date?: Dayjs }) =>
      createSubBatch({
        year: v.year, start_month: v.month.month() + 1,
        make_date: v.make_date ? v.make_date.format('YYYY-MM-DD') : null,
        unit_price: v.unit_price ?? null,
      }),
    onSuccess: () => {
      message.success('订报批次已创建');
      qc.invalidateQueries({ queryKey: ['subBatches'] });
      form.resetFields();
      onClose();
    },
    onError: (e) => message.error(errText(e)),
  });
  return (
    <Modal title="新建订报批次" open={open} onCancel={onClose} onOk={() => form.submit()}
      okText="创建" confirmLoading={mut.isPending} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={(v) => mut.mutate(v)}>
        <Flex gap={12} wrap>
          <Form.Item name="year" label="业务年份" rules={[{ required: true }]} style={{ width: 140 }} initialValue={2026}>
            <InputNumber style={{ width: '100%' }} min={2000} max={2100} />
          </Form.Item>
          <Form.Item name="month" label="订阅起始月" rules={[{ required: true }]} style={{ width: 160 }}>
            <DatePicker picker="month" style={{ width: '100%' }} placeholder="如 2026-08" />
          </Form.Item>
        </Flex>
        <Flex gap={12} wrap>
          <Form.Item name="make_date" label="制作日期（可选）" style={{ width: 180 }}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit_price" label="每份完整订期单价（可选）" style={{ width: 200 }}>
            <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="缺省按 份×月×20" />
          </Form.Item>
        </Flex>
      </Form>
    </Modal>
  );
}

/** 上传两份来源文件 → 新版本 */
function ImportUpload({ batchId }: { batchId: number }) {
  const qc = useQueryClient();
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const mut = useMutation({
    mutationFn: () => createSubImport(batchId, fileA as File, fileB),
    onSuccess: (res) => {
      const v = res.data;
      const st = IMPORT_STATUS_META[v.status];
      message.success(`已建版本 V${v.version_no}（${st.label}）`);
      setFileA(null); setFileB(null);
      qc.invalidateQueries({ queryKey: ['subBatch', batchId] });
      qc.invalidateQueries({ queryKey: ['subBatches'] });
    },
    onError: (e) => message.error(errText(e)),
  });
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Flex gap={12} wrap>
        <Upload.Dragger style={{ width: 320 }} maxCount={1} accept=".xlsx,.xls,.csv"
          beforeUpload={(f) => { setFileA(f); return false; }} onRemove={() => setFileA(null)}
          fileList={fileA ? [{ uid: 'a', name: fileA.name } as UploadFile] : []}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">来源A · 订阅明细（.xlsx/.xls）</p>
        </Upload.Dragger>
        <Upload.Dragger style={{ width: 320 }} maxCount={1} accept=".xlsx,.csv"
          beforeUpload={(f) => { setFileB(f); return false; }} onRemove={() => setFileB(null)}
          fileList={fileB ? [{ uid: 'b', name: fileB.name } as UploadFile] : []}>
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          <p className="ant-upload-text">来源B · 读者统计（.xlsx/.csv，可选）</p>
          <p className="ant-upload-hint">CSV 需 UTF-8/带 BOM</p>
        </Upload.Dragger>
      </Flex>
      <Button type="primary" icon={<UploadOutlined />} disabled={!fileA} loading={mut.isPending}
        onClick={() => mut.mutate()}>上传并解析（生成新版本）</Button>
    </Space>
  );
}

/** 校验问题抽屉 */
function IssuesDrawer({ versionId, open, onClose }: { versionId: number | null; open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['subIssues', versionId],
    queryFn: () => getSubImportIssues(versionId as number).then((r) => r.data),
    enabled: open && versionId != null,
  });
  const cols: TableColumnsType<ValidationIssue> = [
    { title: '级别', dataIndex: 'level', width: 80, render: (l: IssueLevel) => <Tag color={ISSUE_META[l].color}>{ISSUE_META[l].label}</Tag> },
    { title: '来源', dataIndex: 'source', width: 60, render: (v) => v || '—' },
    { title: '行号', dataIndex: 'row_no', width: 70, render: (v) => v ?? '—' },
    { title: '字段', dataIndex: 'field', width: 120, render: (v) => v || '—' },
    { title: '说明', dataIndex: 'message' },
  ];
  return (
    <Drawer title="校验问题" width={720} open={open} onClose={onClose} destroyOnClose>
      <Table<ValidationIssue> rowKey="id" size="small" loading={q.isLoading}
        columns={cols} dataSource={q.data ?? []} pagination={{ pageSize: 20 }} />
    </Drawer>
  );
}

/** 明细预览抽屉（只读，解析出的全部记录） */
function RecordsDrawer({ versionId, open, onClose }: { versionId: number | null; open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['subRecords', versionId],
    queryFn: () => getSubImportRecords(versionId as number).then((r) => r.data),
    enabled: open && versionId != null,
  });
  const cols: TableColumnsType<SubRecord> = [
    { title: '地区', dataIndex: 'region_name', width: 64, render: (v) => v || '—' },
    { title: '姓名', dataIndex: 'name', width: 90 },
    { title: '电话', dataIndex: 'phone', width: 120, render: (v) => v || '—' },
    { title: '省/市/区', key: 'r', width: 150, render: (_: unknown, r) => [r.province, r.city, r.district].filter(Boolean).join(' ') || '—' },
    { title: '详细地址', dataIndex: 'address', ellipsis: true },
    { title: '份数', dataIndex: 'copies', width: 56, align: 'right' },
    { title: '金额', dataIndex: 'amount', width: 80, align: 'right', render: (v) => (v != null ? `¥${v}` : '—') },
    { title: '渠道', dataIndex: 'source_channel', width: 110, render: (v) => v || '—' },
    { title: '来源', dataIndex: 'source_file_role', width: 56, render: (v) => (v ? <Tag>{v}</Tag> : '—') },
  ];
  return (
    <Drawer title="解析明细（只读）" width={980} open={open} onClose={onClose} destroyOnClose>
      <Table<SubRecord> rowKey="id" size="small" loading={q.isLoading}
        columns={cols} dataSource={q.data ?? []}
        pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 条` }} />
    </Drawer>
  );
}

/** 批次详情：版本历史 + 生成 + 产物 */
function BatchDetailPanel({ batchId }: { batchId: number }) {
  const { isAdmin } = useAuth();
  const qc = useQueryClient();
  const [issuesFor, setIssuesFor] = useState<number | null>(null);
  const [recordsFor, setRecordsFor] = useState<number | null>(null);

  const batchQ = useQuery({ queryKey: ['subBatch', batchId], queryFn: () => getSubBatch(batchId).then((r) => r.data) });
  const artifactsQ = useQuery({ queryKey: ['subArtifacts', batchId], queryFn: () => listSubArtifacts(batchId).then((r) => r.data) });

  const activateMut = useMutation({
    mutationFn: (vid: number) => activateSubImport(vid),
    onSuccess: () => {
      message.success('已设为当前有效版本');
      qc.invalidateQueries({ queryKey: ['subBatch', batchId] });
      qc.invalidateQueries({ queryKey: ['subBatches'] });
    },
    onError: (e) => message.error(errText(e)),
  });
  const genMut = useMutation({
    mutationFn: () => generateSubBatch(batchId),
    onSuccess: (res) => {
      message.success(`生成完成，共 ${res.data.artifacts.length} 个文件`);
      qc.invalidateQueries({ queryKey: ['subArtifacts', batchId] });
      qc.invalidateQueries({ queryKey: ['subBatch', batchId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const batch = batchQ.data;
  const versions = useMemo(
    () => [...(batch?.versions ?? [])].sort((a, b) => b.version_no - a.version_no),
    [batch],
  );
  const artifacts = artifactsQ.data ?? [];
  const current = artifacts.filter((a) => !a.is_historical);

  if (!batch) return <Card loading />;

  const renderVersion = (v: ImportVersion) => {
    const st = IMPORT_STATUS_META[v.status];
    const s = v.summary_json as Record<string, unknown> | null;
    return (
      <List.Item
        actions={[
          <Button key="r" type="link" size="small" onClick={() => setRecordsFor(v.id)}>查看明细</Button>,
          <Button key="i" type="link" size="small" onClick={() => setIssuesFor(v.id)}>校验问题</Button>,
          ...(isAdmin && v.status === 'validation_passed'
            ? [<Popconfirm key="a" title="设为当前有效版本？旧有效版本将被替代。" onConfirm={() => activateMut.mutate(v.id)}>
                <Button type="link" size="small">设为有效</Button>
              </Popconfirm>]
            : []),
        ]}
      >
        <List.Item.Meta
          title={<Space>V{v.version_no}<Tag color={st.color}>{st.label}</Tag>
            {s && <Text type="secondary" style={{ fontWeight: 400 }}>
              {`条 ${s.total_count ?? 0} · 份 ${s.total_copies ?? 0} · ¥${s.total_amount ?? 0} · 地区 ${s.region_count ?? 0}`}
            </Text>}
          </Space>}
          description={<Text type="secondary" style={{ fontSize: 12 }}>
            {v.reason || '—'} · {v.source_files.map((f) => `${f.file_role}:${f.original_filename}`).join(' / ')}
            {s && (Number(s.issue_block) > 0 || Number(s.issue_warn) > 0)
              ? ` · 阻断 ${s.issue_block} / 警告 ${s.issue_warn}` : ''}
          </Text>}
        />
      </List.Item>
    );
  };

  const ARTIFACT_LABEL: Record<string, string> = {
    workbook: '汇总+明细+申请', postal_summary: '北京局订报汇总表', region_detail: '地区集订分送表', zip: '打包 ZIP',
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Space size={16} wrap>
          <Title level={5} style={{ margin: 0 }}>{batch.year}年{batch.start_month}月 订报批次</Title>
          <Tag color={BATCH_STATUS_META[batch.status].color}>{BATCH_STATUS_META[batch.status].label}</Tag>
          {batch.active_version_id && <Text type="secondary">当前有效：版本 #{batch.active_version_id}</Text>}
        </Space>
        {isAdmin && (
          <Popconfirm title="基于当前有效版本生成全部文件？" disabled={!batch.active_version_id}
            onConfirm={() => genMut.mutate()}>
            <Button type="primary" icon={<ThunderboltOutlined />} loading={genMut.isPending}
              disabled={!batch.active_version_id}>生成订报文件</Button>
          </Popconfirm>
        )}
      </Flex>

      {isAdmin && (
        <Card size="small" title="上传来源文件（生成新版本）">
          <ImportUpload batchId={batchId} />
        </Card>
      )}

      <Card size="small" title="版本历史（不可变流水）" styles={{ body: { padding: 0 } }}>
        {versions.length === 0
          ? <Empty style={{ padding: 24 }} description="尚无导入版本" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <List<ImportVersion> dataSource={versions} renderItem={renderVersion} />}
      </Card>

      <Card size="small" title="生成产物" styles={{ body: { padding: 0 } }} loading={artifactsQ.isLoading}>
        {current.length === 0
          ? <Empty style={{ padding: 24 }} description="尚无产物，设为有效后点「生成订报文件」" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <List<Artifact> dataSource={current} renderItem={(a) => (
              <List.Item actions={[
                <Button key="d" type="link" size="small" icon={<DownloadOutlined />}
                  onClick={() => downloadSubArtifact(a.id, a.filename).catch(() => message.error('下载失败'))}>下载</Button>,
              ]}>
                <List.Item.Meta
                  title={<Space><Tag>{ARTIFACT_LABEL[a.artifact_type] ?? a.artifact_type}</Tag>{a.region_name || ''}</Space>}
                  description={<Text type="secondary" style={{ fontSize: 12 }}>{a.filename}</Text>}
                />
              </List.Item>
            )} />}
      </Card>

      <IssuesDrawer versionId={issuesFor} open={issuesFor != null} onClose={() => setIssuesFor(null)} />
      <RecordsDrawer versionId={recordsFor} open={recordsFor != null} onClose={() => setRecordsFor(null)} />
    </Space>
  );
}

export default function SubscriptionGeneration() {
  const { isAdmin } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const batchesQ = useQuery({ queryKey: ['subBatches'], queryFn: () => listSubBatches().then((r) => r.data) });
  const batches = batchesQ.data ?? [];
  const activeId = selectedId ?? batches[0]?.id ?? null;

  return (
    <div>
      <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 12 }}>
        <Title level={3} style={{ marginTop: 0, marginBottom: 0 }}>邮局管理 · 邮局订报生成</Title>
        {isAdmin && <Button type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>新建批次</Button>}
      </Flex>
      <Text type="secondary">上传两份来源文件（订阅明细 + 读者统计），系统解析 / 校验 / 计算 / 生成邮局订报文件；每次重导形成不可变版本流水，旧版不覆盖。</Text>

      <Flex gap={16} align="start" style={{ marginTop: 12 }}>
        <Card size="small" title="订报批次" style={{ width: 240, flex: '0 0 240px' }} styles={{ body: { padding: 0 } }} loading={batchesQ.isLoading}>
          {batches.length === 0
            ? <Empty style={{ padding: 24 }} description="暂无批次" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            : <List<SubBatch> dataSource={batches} renderItem={(b) => {
                const meta = BATCH_STATUS_META[b.status];
                const active = b.id === activeId;
                return (
                  <List.Item onClick={() => setSelectedId(b.id)} style={{ cursor: 'pointer', padding: '10px 14px', background: active ? '#e6f4ff' : undefined, boxShadow: active ? 'inset 3px 0 0 #1677ff' : undefined }}>
                    <Flex justify="space-between" align="center" style={{ width: '100%' }}>
                      <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>{b.year}-{String(b.start_month).padStart(2, '0')}</Text>
                      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>{meta.label}</Tag>
                    </Flex>
                  </List.Item>
                );
              }} />}
        </Card>
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeId == null ? <Empty description="选择或新建一个订报批次" /> : <BatchDetailPanel batchId={activeId} />}
        </div>
      </Flex>

      <BatchCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
