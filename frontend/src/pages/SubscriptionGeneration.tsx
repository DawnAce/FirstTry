import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, Card, Collapse, DatePicker, Drawer, Empty, Flex, Form, InputNumber, List, Modal,
  Popconfirm, Select, Space, Steps, Table, Tag, Typography, Upload, message,
} from 'antd';
import {
  ArrowLeftOutlined, CheckCircleOutlined, DownloadOutlined, FileAddOutlined, InboxOutlined,
  ThunderboltOutlined, UploadOutlined,
} from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../contexts/AuthContext';
import {
  activateSubImport, createSubBatch, createSubImport, downloadSubArtifact, generateSubBatch,
  getSubBatch, getSubImportIssues, getSubImportRecords, listSubArtifacts, listSubBatches,
} from '../api/subscription';
import type {
  Artifact, BatchStatus, ImportStatus, ImportVersion, IssueLevel, SubRecord, ValidationIssue,
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

const ARTIFACT_LABEL: Record<string, string> = {
  workbook: '汇总 + 明细 + 申请',
  postal_summary: '北京局订报汇总表',
  region_detail: '地区集订分送表',
  zip: '完整压缩包',
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
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [draftVersion, setDraftVersion] = useState<ImportVersion | null>(null);
  const [activated, setActivated] = useState(false);
  const [generationDone, setGenerationDone] = useState(false);

  const batchQ = useQuery({ queryKey: ['subBatch', batchId], queryFn: () => getSubBatch(batchId).then((r) => r.data) });
  const artifactsQ = useQuery({ queryKey: ['subArtifacts', batchId], queryFn: () => listSubArtifacts(batchId).then((r) => r.data) });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['subBatch', batchId] });
    qc.invalidateQueries({ queryKey: ['subBatches'] });
  };
  const uploadMut = useMutation({
    mutationFn: () => createSubImport(batchId, fileA as File, fileB),
    onSuccess: (res) => {
      setDraftVersion(res.data);
      message.success(`已创建待确认版本 V${res.data.version_no}`);
      refresh();
    },
    onError: (e) => message.error(errText(e)),
  });
  const activateMut = useMutation({
    mutationFn: (vid: number) => activateSubImport(vid),
    onSuccess: (res) => {
      const s = res.data.postal_sync;
      message.success(`已设为当前有效版本 · 名册新增 ${s.created}、更新 ${s.updated}、归档 ${s.archived} 条`);
      if (draftVersion?.id === res.data.version.id) setActivated(true);
      refresh();
      qc.invalidateQueries({ queryKey: ['postalDeliveries'] });
    },
    onError: (e) => message.error(errText(e)),
  });
  const genMut = useMutation({
    mutationFn: () => generateSubBatch(batchId),
    onSuccess: (res) => {
      message.success(`生成完成，共 ${res.data.artifacts.length} 个文件`);
      setGenerationDone(true);
      qc.invalidateQueries({ queryKey: ['subArtifacts', batchId] });
      refresh();
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
  const activeVersion = versions.find((v) => v.id === batch.active_version_id) ?? null;
  const activeSummary = activeVersion?.summary_json as Record<string, unknown> | null;
  const effectiveUnitPrice = batch.unit_price != null
    ? Number(batch.unit_price)
    : (13 - batch.start_month) * 20;

  const renderVersion = (v: ImportVersion) => {
    const st = IMPORT_STATUS_META[v.status];
    const s = v.summary_json as Record<string, unknown> | null;
    return (
      <List.Item
        style={{ paddingInline: 16 }}
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

  const artifactRow = (a: Artifact) => (
    <List.Item style={{ paddingInline: 16 }} actions={[
      <Button key="d" type="link" size="small" icon={<DownloadOutlined />}
        onClick={() => downloadSubArtifact(a.id, a.filename).catch(() => message.error('下载失败'))}>下载</Button>,
    ]}>
      <List.Item.Meta
        title={<Space>{ARTIFACT_LABEL[a.artifact_type] ?? a.artifact_type}{a.region_name && <Tag>{a.region_name}</Tag>}</Space>}
        description={<Text type="secondary" className="postal-cell-secondary">{a.filename}</Text>}
      />
    </List.Item>
  );

  if (workspaceOpen) {
    const summary = (draftVersion?.summary_json ?? {}) as Record<string, unknown>;
    const blockCount = Number(summary.issue_block ?? 0);
    const warnCount = Number(summary.issue_warn ?? 0);
    const canActivate = draftVersion?.status === 'validation_passed' && blockCount === 0;
    const compareRows = [
      { key: 'count', label: '记录', old: activeSummary?.total_count, next: summary.total_count },
      { key: 'copies', label: '份数', old: activeSummary?.total_copies, next: summary.total_copies },
      { key: 'amount', label: '金额', old: activeSummary?.total_amount, next: summary.total_amount },
      { key: 'region', label: '地区', old: activeSummary?.region_count, next: summary.region_count },
    ];
    return (
      <>
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => setWorkspaceOpen(false)}>返回 {batch.year}年{batch.start_month}月批次</Button>
        <Title level={3} style={{ margin: '12px 0 2px' }}>创建新版本 V{draftVersion?.version_no ?? ((versions[0]?.version_no ?? 0) + 1)}</Title>
        <Text type="secondary">当前有效版本 V{activeVersion?.version_no ?? '—'} 保持不变，确认后才会切换。</Text>
        <Steps className="subscription-steps" current={draftVersion ? (activated ? 2 : 1) : 0} items={[
          { title: '上传来源' },
          { title: '校验与对比' },
          { title: '设为有效' },
        ]} />

        {!draftVersion && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Flex gap={12} wrap>
              <Upload.Dragger className="subscription-upload" maxCount={1} accept=".xlsx,.xls,.csv"
                beforeUpload={(f) => { setFileA(f); return false; }} onRemove={() => setFileA(null)}
                fileList={fileA ? [{ uid: 'a', name: fileA.name } as UploadFile] : []}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">来源 A · 订阅明细</p>
                <p className="ant-upload-hint">.xlsx / .xls，必填</p>
              </Upload.Dragger>
              <Upload.Dragger className="subscription-upload" maxCount={1} accept=".xlsx,.csv"
                beforeUpload={(f) => { setFileB(f); return false; }} onRemove={() => setFileB(null)}
                fileList={fileB ? [{ uid: 'b', name: fileB.name } as UploadFile] : []}>
                <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                <p className="ant-upload-text">来源 B · 读者统计（可选）</p>
                <p className="ant-upload-hint">CSV 需 UTF-8 / 带 BOM</p>
              </Upload.Dragger>
            </Flex>
            <Flex justify="flex-end" gap={8}>
              <Button onClick={() => setWorkspaceOpen(false)}>取消</Button>
              <Button type="primary" icon={<UploadOutlined />} disabled={!fileA} loading={uploadMut.isPending}
                onClick={() => uploadMut.mutate()}>上传并校验</Button>
            </Flex>
          </Space>
        )}

        {draftVersion && !activated && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div className="subscription-metrics">
              <Card size="small"><Text type="secondary">解析记录</Text><Title level={4}>{String(summary.total_count ?? 0)} 条</Title><Text type="secondary">共 {String(summary.total_copies ?? 0)} 份</Text></Card>
              <Card size="small"><Text type="secondary">阻断问题</Text><Title level={4}>{blockCount}</Title><Text type="secondary">{blockCount ? '修正后重新上传' : '可以继续'}</Text></Card>
              <Card size="small"><Text type="secondary">提醒</Text><Title level={4}>{warnCount}</Title><Text type="secondary">不阻断版本切换</Text></Card>
            </div>
            <Card size="small" title={`与当前 V${activeVersion?.version_no ?? '—'} 对比`} styles={{ body: { padding: 0 } }}>
              <Table rowKey="key" size="small" pagination={false} dataSource={compareRows} columns={[
                { title: '指标', dataIndex: 'label' },
                { title: '当前版本', dataIndex: 'old', render: (v) => v ?? '—' },
                { title: `V${draftVersion.version_no}`, dataIndex: 'next', render: (v) => v ?? '—' },
              ]} />
            </Card>
            <Card size="small" title="来源文件" styles={{ body: { padding: 0 } }}>
              <List size="small" dataSource={draftVersion.source_files} renderItem={(f) => (
                <List.Item><Text>{f.file_role} · {f.original_filename}</Text></List.Item>
              )} />
            </Card>
            <Flex justify="space-between" wrap gap={8}>
              <Space>
                <Button onClick={() => setRecordsFor(draftVersion.id)}>查看明细</Button>
                <Button onClick={() => setIssuesFor(draftVersion.id)}>校验问题{blockCount + warnCount ? ` (${blockCount + warnCount})` : ''}</Button>
              </Space>
              <Space>
                <Button onClick={() => { setDraftVersion(null); setFileA(null); setFileB(null); }}>重新选择文件</Button>
                <Popconfirm title={`设 V${draftVersion.version_no} 为当前有效版本？`} description="旧有效版本会保留在版本历史中。" onConfirm={() => activateMut.mutate(draftVersion.id)}>
                  <Button type="primary" disabled={!canActivate} loading={activateMut.isPending}>设为有效版本</Button>
                </Popconfirm>
              </Space>
            </Flex>
          </Space>
        )}

        {draftVersion && activated && (
          <div className="subscription-success">
            <CheckCircleOutlined />
            <Title level={3}>V{draftVersion.version_no} 已设为当前有效版本</Title>
            <Text type="secondary">旧版本已保留，投递名册同步完成。</Text>
            <Flex justify="center" gap={8} style={{ marginTop: 20 }}>
              <Button onClick={() => setWorkspaceOpen(false)}>查看版本记录</Button>
              <Button type="primary" icon={<ThunderboltOutlined />} loading={genMut.isPending}
                onClick={() => genMut.mutate()}>{generationDone ? '重新生成文件' : '生成订报文件'}</Button>
            </Flex>
          </div>
        )}
        <IssuesDrawer versionId={issuesFor} open={issuesFor != null} onClose={() => setIssuesFor(null)} />
        <RecordsDrawer versionId={recordsFor} open={recordsFor != null} onClose={() => setRecordsFor(null)} />
      </>
    );
  }

  const regionArtifacts = current.filter((a) => a.artifact_type === 'region_detail');
  const mainArtifacts = current.filter((a) => a.artifact_type !== 'region_detail');
  const workflowStep = current.length ? 2 : (activeVersion ? 1 : 0);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <div>
          <Space wrap>
            <Title level={4} style={{ margin: 0 }}>{batch.year}年{batch.start_month}月订报批次</Title>
            <Tag color={BATCH_STATUS_META[batch.status].color}>{BATCH_STATUS_META[batch.status].label}</Tag>
          </Space>
          <Text type="secondary">当前有效 V{activeVersion?.version_no ?? '—'} · 完整订期单价 ¥{effectiveUnitPrice.toFixed(2)}{batch.unit_price == null ? '（默认 20 元/月）' : ''}</Text>
        </div>
        {isAdmin && (
          <Space>
            <Button icon={<UploadOutlined />} onClick={() => { setWorkspaceOpen(true); setDraftVersion(null); setActivated(false); setGenerationDone(false); }}>重新上传来源</Button>
            <Popconfirm title="基于当前有效版本生成全部文件？" disabled={!batch.active_version_id} onConfirm={() => genMut.mutate()}>
              <Button type="primary" icon={<ThunderboltOutlined />} loading={genMut.isPending} disabled={!batch.active_version_id}>生成订报文件</Button>
            </Popconfirm>
          </Space>
        )}
      </Flex>

      <Steps className="subscription-steps" current={workflowStep} items={[
        { title: '上传来源' }, { title: '设为有效' }, { title: '下载文件' },
      ]} />

      {activeSummary && (
        <div className="subscription-metrics">
          <Card size="small"><Text type="secondary">订阅记录</Text><Title level={4}>{String(activeSummary.total_count ?? 0)} 条</Title><Text type="secondary">共 {String(activeSummary.total_copies ?? 0)} 份</Text></Card>
          <Card size="small"><Text type="secondary">订报金额</Text><Title level={4}>¥{String(activeSummary.total_amount ?? 0)}</Title><Text type="secondary">当前有效版本</Text></Card>
          <Card size="small"><Text type="secondary">地区文件</Text><Title level={4}>{String(activeSummary.region_count ?? 0)} 份</Title><Text type="secondary">{current.length ? '已生成' : '等待生成'}</Text></Card>
        </div>
      )}

      <Card size="small" title="版本历史（不可变流水）" styles={{ body: { padding: 0 } }}>
        {versions.length === 0
          ? <Empty style={{ padding: 24 }} description="尚无导入版本" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <List<ImportVersion> dataSource={versions} renderItem={renderVersion} />}
      </Card>

      <Card size="small" title="生成文件" styles={{ body: { padding: 0 } }} loading={artifactsQ.isLoading}>
        {current.length === 0
          ? <Empty style={{ padding: 24 }} description="尚无产物，设为有效后点「生成订报文件」" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <>
              <List<Artifact> dataSource={mainArtifacts} renderItem={artifactRow} />
              {regionArtifacts.length > 0 && <Collapse ghost items={[{
                key: 'regions',
                label: `地区集订分送表（${regionArtifacts.length} 个地区）`,
                children: <List<Artifact> dataSource={regionArtifacts} renderItem={artifactRow} />,
              }]} />}
            </>}
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
      <Flex className="postal-page-head" justify="space-between" align="flex-start" wrap gap={12}>
        <div>
          <Title level={3} className="postal-page-title">邮局订报生成</Title>
          <Text type="secondary">上传来源、校验版本并生成邮局订报文件；旧版本始终保留。</Text>
        </div>
        <Space>
          <Select value={activeId} onChange={setSelectedId} placeholder="选择批次" style={{ width: 150 }}
            options={batches.map((b) => ({ label: `${b.year}-${String(b.start_month).padStart(2, '0')}`, value: b.id }))} />
          {isAdmin && <Button type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>新建批次</Button>}
        </Space>
      </Flex>
      <div style={{ marginTop: 12 }}>
        {batchesQ.isLoading ? <Card loading /> : activeId == null
          ? <Empty description="选择或新建一个订报批次" />
          : <BatchDetailPanel key={activeId} batchId={activeId} />}
      </div>

      <BatchCreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
