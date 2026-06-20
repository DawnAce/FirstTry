import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, UploadOutlined } from '@ant-design/icons';
import type { TableColumnsType, UploadFile } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  commitOrderImport,
  previewOrderImport,
} from '../api/orderImport';
import type { ImportDecision, ImportPreviewOut, ImportPreviewRow, PreviewSettings } from '../api/orderImport';
import { deliveryMethodLabel, formatCoverage, fulfillmentTypeLabel, publicationLabel } from './orderUtils';

const { Title, Text } = Typography;

type Mode = 'recent' | 'historical';

const DECISION_META: Record<ImportDecision, { label: string; color: string }> = {
  import: { label: '✅ 导入', color: 'green' },
  skip_status: { label: '⏭ 跳过', color: 'default' },
  duplicate: { label: '♻ 重复', color: 'blue' },
  unresolved: { label: '⚠ 待确认', color: 'red' },
};

export default function OrderImport() {
  const [mode, setMode] = useState<Mode>('recent');
  const [file, setFile] = useState<File | null>(null);
  const [postOfficeStart, setPostOfficeStart] = useState<Dayjs | null>(null);
  const [ztoStart, setZtoStart] = useState<Dayjs | null>(null);
  const [cutoff, setCutoff] = useState<Dayjs | null>(null);
  const [preview, setPreview] = useState<ImportPreviewOut | null>(null);

  const previewMutation = useMutation({
    mutationFn: () => {
      const settings: PreviewSettings = { mode };
      if (mode === 'recent') {
        if (postOfficeStart) settings.post_office_start_month = postOfficeStart.format('YYYY-MM');
        if (ztoStart) settings.zto_start_month = ztoStart.format('YYYY-MM');
        if (cutoff) settings.cutoff_date = cutoff.format('YYYY-MM-DD');
      }
      return previewOrderImport(file as File, settings);
    },
    onSuccess: (res) => setPreview(res.data),
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      message.error(err.response?.data?.detail ?? '预览失败'),
  });

  const commitMutation = useMutation({
    mutationFn: () => commitOrderImport(preview!.session_id),
    onSuccess: (res) => {
      message.success(`成功导入 ${res.data.created} 单（跳过重复 ${res.data.skipped_duplicates}）`);
      setPreview(null);
      setFile(null);
    },
    onError: (err: { response?: { data?: { detail?: string } } }) =>
      message.error(err.response?.data?.detail ?? '导入失败'),
  });

  const handlePreview = () => {
    if (!file) {
      message.warning('请先选择 CBJ 订单 Excel');
      return;
    }
    previewMutation.mutate();
  };

  const columns: TableColumnsType<ImportPreviewRow> = [
    {
      title: '结果',
      dataIndex: 'decision',
      key: 'decision',
      width: 100,
      render: (d: ImportDecision) => <Tag color={DECISION_META[d].color}>{DECISION_META[d].label}</Tag>,
    },
    { title: '来源单号', dataIndex: 'external_order_no', key: 'ext', width: 160, ellipsis: true },
    { title: '收件人', dataIndex: 'recipient_name', key: 'name', width: 90 },
    { title: '付款', dataIndex: 'paid_amount', key: 'paid', width: 80, align: 'right', render: (v) => `¥${v}` },
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: (_: unknown, r) => (
        <Space size={2} direction="vertical">
          <Text style={{ fontSize: 12 }}>{r.status_raw} → {r.commercial_status ?? '-'}</Text>
          {r.status_unknown && <Tag color="orange">状态未知</Tag>}
        </Space>
      ),
    },
    {
      title: '识别明细',
      key: 'items',
      render: (_: unknown, r) => {
        if (r.decision !== 'import') {
          return <Text type="secondary">{r.reason ?? '-'}</Text>;
        }
        return (
          <Space direction="vertical" size={0}>
            {r.delivery_overridden_to_zto && <Tag color="orange">投递→中通（请核对）</Tag>}
            {r.items.map((it, i) => (
              <Text key={i} style={{ fontSize: 12 }}>
                {publicationLabel((it.publication ?? 'other') as never)}/{fulfillmentTypeLabel(it.fulfillment_type as never)}
                {it.delivery_method ? `/${deliveryMethodLabel(it.delivery_method as never)}` : ''} · ¥{it.subtotal} · 覆盖{formatCoverage(it.coverage_start_date, it.coverage_end_date)}
              </Text>
            ))}
            {r.warnings.map((w, i) => (
              <Text key={`w${i}`} type="warning" style={{ fontSize: 12 }}>⚠ {w}</Text>
            ))}
          </Space>
        );
      },
    },
  ];

  const counts = preview?.counts ?? {};

  return (
    <div>
      <Title level={3}>电商订单导入</Title>

      {/* Step 1: mode + settings */}
      <Card size="small" title="① 导入模式与起投设置" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Segmented
            value={mode}
            onChange={(v) => { setMode(v as Mode); setPreview(null); }}
            options={[
              { label: '近期订单（要安排投递）', value: 'recent' },
              { label: '历史归档（只补记录）', value: 'historical' },
            ]}
          />
          {mode === 'recent' ? (
            <Space wrap>
              <span>邮局起投月：<DatePicker picker="month" value={postOfficeStart} onChange={setPostOfficeStart} placeholder="如 2026-07" /></span>
              <span>中通起投月：<DatePicker picker="month" value={ztoStart} onChange={setZtoStart} placeholder="如 2026-07" /></span>
              <span>截止日：<DatePicker value={cutoff} onChange={setCutoff} placeholder="此日后付款→下月" /></span>
            </Space>
          ) : (
            <Alert
              type="info"
              message="历史归档：保留下单日期、只补记录；订期留空（可在订单页补填），不进发货同步。"
            />
          )}
        </Space>
      </Card>

      {/* Step 2: upload + preview */}
      <Card size="small" title="② 上传 CBJ 订单 Excel" style={{ marginBottom: 16 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Upload.Dragger
            maxCount={1}
            accept=".xlsx"
            beforeUpload={(f) => { setFile(f); setPreview(null); return false; }}
            onRemove={() => { setFile(null); setPreview(null); }}
            fileList={file ? [{ uid: '1', name: file.name } as UploadFile] : []}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽 CBJ 小程序导出的 .xlsx 到此处</p>
          </Upload.Dragger>
          <Button type="primary" icon={<UploadOutlined />} onClick={handlePreview} loading={previewMutation.isPending} disabled={!file}>
            预览导入
          </Button>
        </Space>
      </Card>

      {/* Step 3: preview + commit */}
      {preview && (
        <Card
          size="small"
          title="③ 预览（确认前可在订单页/商品库调整；未识别请到商品库加行后重导）"
          extra={
            <Button
              type="primary"
              onClick={() => commitMutation.mutate()}
              loading={commitMutation.isPending}
              disabled={!preview.can_commit}
            >
              确认导入 {counts.import ?? 0} 单
            </Button>
          }
        >
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag color="green">导入 {counts.import ?? 0}</Tag>
            <Tag color="default">跳过 {counts.skip_status ?? 0}</Tag>
            <Tag color="blue">重复 {counts.duplicate ?? 0}</Tag>
            <Tag color="red">待确认 {counts.unresolved ?? 0}</Tag>
            <Text type="secondary">共 {counts.total ?? 0} 单</Text>
          </Space>
          <Table<ImportPreviewRow>
            rowKey="external_order_no"
            columns={columns}
            dataSource={preview.rows}
            size="small"
            pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 单` }}
            scroll={{ x: 1000 }}
          />
        </Card>
      )}
    </div>
  );
}
