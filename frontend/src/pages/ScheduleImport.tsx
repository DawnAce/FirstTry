import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Input,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Steps,
  Switch,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd';
import {
  CheckCircleFilled,
  DeleteOutlined,
  DownloadOutlined,
  ExclamationCircleFilled,
  FilePdfOutlined,
  InboxOutlined,
  InfoCircleOutlined,
  PauseCircleFilled,
  ProfileOutlined,
  ReloadOutlined,
  SearchOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { TableProps, UploadProps } from 'antd';
import dayjs from 'dayjs';
import {
  commitScheduleUpload,
  discardScheduleUpload,
  getScheduleUploads,
  previewScheduleUpload,
  updateScheduleUploadRows,
} from '../api/schedule';
import type { ScheduleDraftRow, SchedulePreview, ScheduleUpload } from '../api/schedule';
import { useAuth } from '../contexts/AuthContext';
import { formatIssueRange, groupScheduleRowsByMonth, rowHasError } from './publicationScheduleUtils';

const DEFAULT_YEAR = 2026;
const { Dragger } = Upload;

type EditableScheduleDraftRow = ScheduleDraftRow & { draftIndex: number };
type RowValStatus = 'normal' | 'pending' | 'error' | 'rest';
type StatusFilterValue = 'all' | 'normal' | 'pending' | 'suspended';

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '待确认', value: 'pending' },
  { label: '休刊', value: 'suspended' },
];

function buildYearOptions(selectedYear: number) {
  const currentYear = dayjs().year();
  return Array.from(new Set([DEFAULT_YEAR, currentYear - 1, currentYear, currentYear + 1, selectedYear]))
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderStatus(status: ScheduleUpload['status']) {
  const colorMap: Record<ScheduleUpload['status'], string> = { previewed: 'blue', committed: 'green', failed: 'red' };
  const labelMap: Record<ScheduleUpload['status'], string> = { previewed: '待确认', committed: '已保存', failed: '失败' };
  return <Tag color={colorMap[status]}>{labelMap[status]}</Tag>;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  const err = error as { response?: { data?: { detail?: string } }; message?: string };
  return err.response?.data?.detail || err.message || fallback;
}

// 单行校验状态：休刊 → rest；解析硬错误 → error；版数≠默认 → pending（待确认软标）；否则 normal。
function rowValStatus(row: ScheduleDraftRow, errors: string[], defaultPageCount: number | null): RowValStatus {
  if (row.is_suspended) return 'rest';
  if (rowHasError(row, errors)) return 'error';
  if (defaultPageCount != null && row.page_count != null && row.page_count !== defaultPageCount) return 'pending';
  return 'normal';
}

// PDF 摘要未给默认版数时，用各行版数的众数兜底（多数期版数一致），便于展示与异常判定。
function modePageCount(rows: ScheduleDraftRow[]): number | null {
  const counts = new Map<number, number>();
  rows.forEach((row) => {
    if (row.page_count != null) counts.set(row.page_count, (counts.get(row.page_count) ?? 0) + 1);
  });
  let best: number | null = null;
  let bestCount = 0;
  counts.forEach((count, pageCount) => {
    if (count > bestCount) {
      bestCount = count;
      best = pageCount;
    }
  });
  return best;
}

export default function ScheduleImport() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  // ⚠️ 前 9 个 useState 的顺序被单测按下标断言，请勿调整；新增状态一律追加在后面。
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const [previewPageCount, setPreviewPageCount] = useState<number | null>(null);
  const [draftRows, setDraftRows] = useState<ScheduleDraftRow[]>([]);
  const [savingDraftRows, setSavingDraftRows] = useState(false);
  const [monthFilter, setMonthFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all');
  const [searchText, setSearchText] = useState('');
  const yearOptions = useMemo(() => buildYearOptions(year), [year]);

  const uploadsQuery = useQuery({
    queryKey: ['scheduleUploads', year],
    queryFn: async () => {
      const res = await getScheduleUploads(year);
      return res.data;
    },
  });

  const errors = preview?.errors ?? [];
  const previewRowsWithIndex = useMemo<EditableScheduleDraftRow[]>(
    () => draftRows.map((row, draftIndex) => ({ ...row, draftIndex })),
    [draftRows],
  );
  const previewIssueRange = preview ? formatIssueRange(preview.summary) : '-';
  const hasDraftRowChanges = preview ? JSON.stringify(draftRows) !== JSON.stringify(preview.rows) : false;

  // 统计：解析记录 / 正常 / 休刊 / 异常·待确认。
  const counts = useMemo(() => {
    const acc = { total: draftRows.length, normal: 0, rest: 0, pending: 0 };
    draftRows.forEach((row) => {
      const status = rowValStatus(row, errors, previewPageCount);
      if (status === 'rest') acc.rest += 1;
      else if (status === 'normal') acc.normal += 1;
      else acc.pending += 1; // pending | error
    });
    return acc;
  }, [draftRows, errors, previewPageCount]);

  const visibleRows = useMemo(() => previewRowsWithIndex.filter((row) => {
    if (monthFilter !== null && dayjs(row.publish_date).month() + 1 !== monthFilter) return false;
    const status = rowValStatus(row, errors, previewPageCount);
    if (statusFilter === 'normal' && status !== 'normal') return false;
    if (statusFilter === 'suspended' && status !== 'rest') return false;
    if (statusFilter === 'pending' && !(status === 'pending' || status === 'error')) return false;
    const q = searchText.trim();
    if (q) {
      const hit = row.publish_date.includes(q) || (row.issue_number !== null && String(row.issue_number).includes(q));
      if (!hit) return false;
    }
    return true;
  }), [previewRowsWithIndex, monthFilter, statusFilter, searchText, errors, previewPageCount]);

  const visibleGroups = useMemo(() => groupScheduleRowsByMonth(visibleRows), [visibleRows]);
  const monthChips = useMemo(
    () => groupScheduleRowsByMonth(previewRowsWithIndex).map((group) => group.month),
    [previewRowsWithIndex],
  );
  const visibleRangeLabel = visibleGroups.length === 0
    ? '无匹配记录'
    : visibleGroups.length === 1
      ? `${preview?.year ?? year} 年 ${visibleGroups[0].month} 月预览`
      : `${preview?.year ?? year} 年 ${visibleGroups[0].month} - ${visibleGroups[visibleGroups.length - 1].month} 月预览`;

  const handlePreviewUpload: UploadProps['beforeUpload'] = async (file) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      setPreview(null);
      setPreviewFileName(null);
      setPreviewError('请上传 PDF 文件');
      message.error('请上传 PDF 文件');
      return Upload.LIST_IGNORE;
    }
    setPreviewing(true);
    setPreview(null);
    setPreviewError(null);
    setPreviewFileName(file.name);
    try {
      const res = await previewScheduleUpload(file);
      setPreview(res.data);
      setDraftRows(res.data.rows);
      setPreviewPageCount(res.data.summary.page_count ?? modePageCount(res.data.rows));
      if (res.data.year !== year) setYear(res.data.year);
      await queryClient.invalidateQueries({ queryKey: ['scheduleUploads', res.data.year] });
      message.success('刊期表解析预览已生成');
    } catch (error: unknown) {
      const errorMessage = getApiErrorMessage(error, '刊期表预览失败，请稍后重试');
      setPreviewError(errorMessage);
      message.error(errorMessage);
    } finally {
      setPreviewing(false);
    }
    return Upload.LIST_IGNORE;
  };

  const handleYearChange = (nextYear: number) => {
    setYear(nextYear);
    setPreview(null);
    setPreviewError(null);
    setPreviewFileName(null);
    setPreviewPageCount(null);
    setDraftRows([]);
    setMonthFilter(null);
    setStatusFilter('all');
    setSearchText('');
  };

  const handleReupload = () => {
    setPreview(null);
    setPreviewError(null);
    setPreviewFileName(null);
    setPreviewPageCount(null);
    setDraftRows([]);
    setMonthFilter(null);
    setStatusFilter('all');
    setSearchText('');
  };

  const handleDownloadParsed = () => {
    if (!preview) return;
    const header = '出版日期,期号,版数,状态';
    const lines = draftRows.map((row) => [
      row.publish_date,
      row.issue_number ?? '',
      row.page_count ?? '',
      row.is_suspended ? '休刊' : '出版',
    ].join(','));
    const csv = `﻿${[header, ...lines].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${preview.year}年刊期表解析结果.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleContinueEdit = () => {
    document.querySelector('.si-preview-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDraftRowChange = (draftIndex: number, patch: Partial<ScheduleDraftRow>) => {
    setDraftRows((rows) => rows.map((row, index) => {
      if (index !== draftIndex) return row;
      const next = { ...row, ...patch };
      if (patch.is_suspended === true) next.issue_number = null;
      return next;
    }));
  };

  const handleAddDraftRow = () => {
    setDraftRows((rows) => [
      ...rows,
      { publish_date: `${preview?.year ?? year}-01-01`, issue_number: null, is_suspended: true, page_count: previewPageCount },
    ]);
  };

  const handleRemoveDraftRow = (draftIndex: number) => {
    setDraftRows((rows) => rows.filter((_row, index) => index !== draftIndex));
  };

  const handleApplyDraftRows = async () => {
    if (!preview) return;
    setSavingDraftRows(true);
    try {
      const res = await updateScheduleUploadRows(preview.upload_id, draftRows);
      setPreview(res.data);
      setDraftRows(res.data.rows);
      await queryClient.invalidateQueries({ queryKey: ['scheduleUploads', res.data.year] });
      message.success('手动修正已应用并重新校验');
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '手动修正保存失败，请稍后重试'));
    } finally {
      setSavingDraftRows(false);
    }
  };

  const handleCommitPreview = async () => {
    if (!preview) return;
    if (!preview.can_commit) {
      message.warning('当前预览存在校验问题，暂不能保存');
      return;
    }
    setCommitting(true);
    try {
      await commitScheduleUpload(preview.upload_id, previewPageCount);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule', preview.year] }),
        queryClient.invalidateQueries({ queryKey: ['scheduleUploads', preview.year] }),
      ]);
      setYear(preview.year);
      setPreview(null);
      setPreviewError(null);
      setPreviewFileName(null);
      setPreviewPageCount(null);
      setDraftRows([]);
      message.success(`${preview.year} 年刊期表已保存`);
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '刊期表保存失败，请稍后重试'));
    } finally {
      setCommitting(false);
    }
  };

  const handleDiscardUpload = async (uploadId: number) => {
    try {
      await discardScheduleUpload(uploadId);
      await queryClient.invalidateQueries({ queryKey: ['scheduleUploads', year] });
      message.success('已删除待确认记录');
    } catch (error: unknown) {
      message.error(getApiErrorMessage(error, '删除失败，请稍后重试'));
    }
  };

  const stepCurrent = committing ? 3 : preview ? 2 : previewing ? 1 : 0;

  const statCards: Array<{ icon: ReactNode; bg: string; label: string; value: number; suffix: string; valueColor?: string }> = [
    { icon: <ProfileOutlined style={{ fontSize: 21, color: 'var(--color-accent)' }} />, bg: 'rgba(0,113,227,.08)', label: '解析记录', value: counts.total, suffix: '行' },
    { icon: <CheckCircleFilled style={{ fontSize: 21, color: '#52c41a' }} />, bg: 'rgba(82,196,26,.12)', label: '正常项', value: counts.normal, suffix: '项' },
    { icon: <PauseCircleFilled style={{ fontSize: 21, color: '#8c8c94' }} />, bg: 'rgba(0,0,0,.05)', label: '休刊项', value: counts.rest, suffix: '项' },
    { icon: <WarningOutlined style={{ fontSize: 21, color: '#fa8c16' }} />, bg: 'rgba(250,140,22,.10)', label: '异常 / 待确认', value: counts.pending, suffix: '项', valueColor: counts.pending > 0 ? '#fa8c16' : undefined },
  ];

  const previewColumns: TableProps<EditableScheduleDraftRow>['columns'] = [
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      key: 'publish_date',
      width: 170,
      render: (value: string, record) => (
        <DatePicker
          value={dayjs(value)}
          allowClear={false}
          style={{ width: 150 }}
          onChange={(nextDate) => nextDate && handleDraftRowChange(record.draftIndex, { publish_date: nextDate.format('YYYY-MM-DD') })}
          disabled={committing || savingDraftRows}
        />
      ),
    },
    {
      title: '期号',
      key: 'issue_number',
      width: 110,
      render: (_value: unknown, record) => (
        <InputNumber
          min={1}
          precision={0}
          style={{ width: 90 }}
          value={record.issue_number}
          status={rowValStatus(record, errors, previewPageCount) === 'pending' ? 'warning' : undefined}
          disabled={record.is_suspended || committing || savingDraftRows}
          onChange={(value) => handleDraftRowChange(record.draftIndex, { issue_number: value ?? null })}
        />
      ),
    },
    {
      title: '版数',
      key: 'page_count',
      width: 100,
      render: (_value: unknown, record) => (
        <InputNumber
          min={1}
          precision={0}
          style={{ width: 80 }}
          value={record.page_count}
          status={rowValStatus(record, errors, previewPageCount) === 'pending' ? 'warning' : undefined}
          disabled={committing || savingDraftRows}
          onChange={(value) => handleDraftRowChange(record.draftIndex, { page_count: value ?? null })}
        />
      ),
    },
    {
      title: '休刊',
      key: 'is_suspended',
      width: 92,
      render: (_value: unknown, record) => (
        <Switch
          checked={record.is_suspended}
          checkedChildren="休刊"
          unCheckedChildren="出版"
          disabled={committing || savingDraftRows}
          onChange={(checked) => handleDraftRowChange(record.draftIndex, { is_suspended: checked })}
        />
      ),
    },
    {
      title: '校验状态',
      key: 'validation_status',
      width: 150,
      render: (_value: unknown, record) => {
        const status = rowValStatus(record, errors, previewPageCount);
        if (status === 'rest') return <span className="si-val rest"><span className="si-val-dot" />休刊</span>;
        if (status === 'error') return <span className="si-val error"><span className="si-val-dot" />需检查</span>;
        if (status === 'pending') {
          return (
            <Tooltip title="版数与默认版数不一致，建议复核">
              <span className="si-val pending">
                <span className="si-val-dot" />待确认 <InfoCircleOutlined style={{ fontSize: 12 }} />
              </span>
            </Tooltip>
          );
        }
        return <span className="si-val normal"><span className="si-val-dot" />正常</span>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 72,
      render: (_value: unknown, record) => (
        <Popconfirm title="确认删除此行？" okText="删除" cancelText="取消" onConfirm={() => handleRemoveDraftRow(record.draftIndex)} disabled={committing || savingDraftRows}>
          <Button type="link" size="small" danger disabled={committing || savingDraftRows}>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  const uploadColumns: TableProps<ScheduleUpload>['columns'] = [
    { title: '文件名', dataIndex: 'original_filename', key: 'original_filename' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (status: ScheduleUpload['status']) => renderStatus(status) },
    { title: '上传人', dataIndex: 'uploaded_by', key: 'uploaded_by', render: (value: string | null) => value || '-' },
    { title: '上传时间', dataIndex: 'created_at', key: 'created_at', render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-') },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ScheduleUpload) => (
        record.status === 'previewed' ? (
          <Popconfirm title="确认删除此待确认记录？" onConfirm={() => handleDiscardUpload(record.id)} okText="删除" cancelText="取消">
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        ) : null
      ),
    },
  ];

  return (
    <div className="si-page">
      <div className="si-head">
        <div>
          <h1 className="si-title">导入期刊表</h1>
          <p className="si-sub">上传年度期刊 PDF，并在保存前进行人工确认与修正</p>
        </div>
        <Select value={year} options={yearOptions} onChange={handleYearChange} disabled={committing} style={{ width: 140 }} />
      </div>

      <Card className="si-steps-card" style={{ marginBottom: 16 }} styles={{ body: { padding: '18px 24px' } }}>
        <Steps
          current={stepCurrent}
          items={[{ title: '上传 PDF' }, { title: '解析校验' }, { title: '人工确认' }, { title: '确认保存' }]}
        />
      </Card>

      {!isAdmin ? (
        <Alert
          type="warning"
          showIcon
          title="仅管理员可上传刊期 PDF"
          description="当前账号没有导入权限，请联系管理员处理年度刊期表导入。"
        />
      ) : !preview ? (
        <Card className="si-upload-card" title="PDF 上传与解析预览">
          <Dragger
            accept=".pdf,application/pdf"
            beforeUpload={handlePreviewUpload}
            disabled={previewing || committing}
            maxCount={1}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">点击或拖拽上传年度刊期 PDF</p>
            <p className="ant-upload-hint">选择文件后将自动解析并生成预览，不会直接写入正式刊期表</p>
          </Dragger>
          {previewFileName && <div className="si-file-hint">当前预览文件：{previewFileName}</div>}
          {previewing && <Alert style={{ marginTop: 16 }} type="info" showIcon title="正在解析 PDF，请稍候..." />}
          {previewError && <Alert style={{ marginTop: 16 }} type="error" showIcon title="解析预览失败" description={previewError} />}
        </Card>
      ) : (
        <>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} lg={12} style={{ display: 'flex' }}>
              <Card className="si-upload-card" title="PDF 上传与解析预览" style={{ flex: 1 }}>
                <div className="si-file">
                  <div className="si-file-icon"><FilePdfOutlined /></div>
                  <div className="si-file-main">
                    <div className="si-file-name">{previewFileName ?? `${preview.year}年刊期表.pdf`}</div>
                    <div className="si-file-status">上传成功，已完成解析</div>
                  </div>
                </div>
                <Alert
                  style={{ marginTop: 16 }}
                  type={preview.can_commit ? 'success' : 'warning'}
                  showIcon
                  title={preview.can_commit ? '解析完成，可确认保存' : '解析完成，但存在需要处理的问题'}
                  description={preview.can_commit
                    ? `系统已生成 ${preview.year} 年期刊预览，确认保存后将写入正式期刊表。`
                    : '请处理校验问题后再保存；本次预览尚未修改正式刊期表。'}
                />
                <div className="si-links">
                  <a onClick={handleReupload}><ReloadOutlined /> 重新上传 PDF</a>
                  <a onClick={handleDownloadParsed}><DownloadOutlined /> 下载解析结果</a>
                </div>
              </Card>
            </Col>
            <Col xs={24} lg={12} style={{ display: 'flex' }}>
              <Card className="si-summary-card" title="导入摘要" style={{ flex: 1 }}>
                <div className="si-summary-grid">
                  <div className="si-kv"><span className="k">年份</span><span className="v">{preview.year} 年</span></div>
                  <div className="si-kv"><span className="k">总行数</span><span className="v">{preview.summary.total_rows} 行</span></div>
                  <div className="si-kv"><span className="k">出版期数</span><span className="v">{preview.summary.published_count} 期</span></div>
                  <div className="si-kv"><span className="k">休刊次数</span><span className="v">{preview.summary.suspended_count} 次</span></div>
                  <div className="si-kv"><span className="k">期号范围</span><span className="v">{previewIssueRange}</span></div>
                  <div className="si-kv">
                    <span className="k">默认版数</span>
                    <span className="v">
                      <InputNumber
                        size="small"
                        min={1}
                        precision={0}
                        value={previewPageCount}
                        onChange={(val) => setPreviewPageCount(val ?? null)}
                        style={{ width: 72 }}
                        disabled={committing}
                      /> 版
                    </span>
                  </div>
                  <div className="si-kv"><span className="k">待人工确认项</span><span className={`v${counts.pending > 0 ? ' warn' : ''}`}>{counts.pending} 项</span></div>
                  <div className="si-kv"><span className="k">当前状态</span><span className="v warn">待确认</span></div>
                </div>
                <Alert
                  className="si-overwrite-alert"
                  type="warning"
                  showIcon
                  icon={<ExclamationCircleFilled />}
                  title={`保存后将覆盖 ${preview.year} 年现有期刊表，请确认无误后再提交。`}
                />
                <div className="si-summary-actions">
                  <div className="si-summary-actions-row">
                    <Popconfirm
                      title="确认保存刊期表？"
                      description={`确认保存后将更新 ${preview.year} 年的正式刊期表，其他年份数据不受影响。`}
                      okText="确认保存"
                      cancelText="取消"
                      disabled={!preview.can_commit || committing || hasDraftRowChanges}
                      onConfirm={handleCommitPreview}
                    >
                      <Button type="primary" loading={committing} disabled={!preview.can_commit || committing || hasDraftRowChanges}>确认保存</Button>
                    </Popconfirm>
                    <Button onClick={handleContinueEdit} disabled={committing}>继续编辑</Button>
                  </div>
                  <Button
                    block
                    loading={savingDraftRows}
                    disabled={!hasDraftRowChanges || committing || savingDraftRows}
                    onClick={handleApplyDraftRows}
                  >
                    应用修正并重新校验
                  </Button>
                  {hasDraftRowChanges && <div className="si-dirty-hint">存在未应用的手动修正，需重新校验后才能确认保存。</div>}
                </div>
              </Card>
            </Col>
          </Row>

          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            icon={<InfoCircleOutlined />}
            title="请优先检查异常项、休刊项以及自动解析置信度较低的记录。"
          />

          <Row gutter={16} style={{ marginBottom: 16 }}>
            {statCards.map((card, idx) => (
              <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
                <Card className="dashboard-stat-card" size="small" style={{ flex: 1 }}>
                  <div className="dashboard-stat-card-inner" style={{ alignItems: 'center' }}>
                    <div className="dashboard-stat-icon" style={{ background: card.bg }}>{card.icon}</div>
                    <div className="dashboard-stat-content">
                      <div className="dashboard-stat-label">{card.label}</div>
                      <div className="dashboard-stat-value" style={card.valueColor ? { color: card.valueColor } : undefined}>
                        {card.value}<span className="dashboard-stat-suffix"> {card.suffix}</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>

          {errors.length > 0 && (
            <Alert
              style={{ marginBottom: 16 }}
              type="error"
              showIcon
              title="解析校验错误"
              description={<ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
            />
          )}

          <div className="si-preview-area">
            <Row gutter={16}>
              <Col xs={24} xl={17}>
                <Card className="si-preview-card" title="人工确认预览" styles={{ body: { padding: 0 } }}>
                  <div className="si-toolbar">
                    <div className="si-chips">
                      <button type="button" className={`si-chip${monthFilter === null ? ' on' : ''}`} onClick={() => setMonthFilter(null)}>全部</button>
                      {monthChips.map((m) => (
                        <button type="button" key={m} className={`si-chip${monthFilter === m ? ' on' : ''}`} onClick={() => setMonthFilter(m)}>{m}月</button>
                      ))}
                    </div>
                    <div className="si-toolbar-tail">
                      <Select<StatusFilterValue>
                        size="small"
                        options={STATUS_OPTIONS}
                        value={statusFilter}
                        onChange={setStatusFilter}
                        style={{ width: 110 }}
                      />
                      <Input
                        size="small"
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder="搜索日期或期号"
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                        style={{ width: 180 }}
                      />
                    </div>
                  </div>
                  <div className="si-count-hint">共 {draftRows.length} 条待确认记录，当前显示 {visibleRangeLabel}</div>

                  <div className="si-groups">
                    {visibleGroups.length === 0 ? (
                      <div className="si-empty">没有符合当前筛选条件的记录</div>
                    ) : visibleGroups.map((group) => (
                      <div className="si-group" key={group.month}>
                        <div className="si-group-title">预览 · {preview.year} 年 {group.month} 月</div>
                        <Table<EditableScheduleDraftRow>
                          rowKey={(record) => `${record.draftIndex}-${record.publish_date}`}
                          columns={previewColumns}
                          dataSource={group.rows}
                          pagination={false}
                          size="small"
                          rowClassName={(record) => {
                            const status = rowValStatus(record, errors, previewPageCount);
                            return status === 'pending' || status === 'error' ? 'si-row-flagged' : '';
                          }}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="si-add-row">
                    <Button type="dashed" block onClick={handleAddDraftRow} disabled={committing || savingDraftRows}>+ 新增一行</Button>
                  </div>
                </Card>
              </Col>
              <Col xs={24} xl={7}>
                <Card className="si-help-card" title={<span><InfoCircleOutlined style={{ color: 'var(--color-accent)', marginRight: 8 }} />人工确认说明</span>}>
                  <ol className="si-help-list">
                    <li>核对年份、期号范围与版数是否正确。</li>
                    <li>休刊项请确认「休刊 / 出版」开关状态。</li>
                    <li>异常项（橙色「待确认」）处理后，点「应用修正并重新校验」。</li>
                    <li>确认无误后点「确认保存」，将覆盖写入该年度正式刊期表。</li>
                  </ol>
                </Card>
              </Col>
            </Row>
          </div>
        </>
      )}

      <Card className="si-uploads-card" title="上传记录" style={{ marginTop: 16 }} loading={uploadsQuery.isLoading}>
        {uploadsQuery.isError ? (
          <Alert type="error" showIcon title="加载上传记录失败，请稍后重试" />
        ) : (
          <Table<ScheduleUpload>
            rowKey="id"
            columns={uploadColumns}
            dataSource={uploadsQuery.data ?? []}
            pagination={false}
            size="middle"
          />
        )}
      </Card>
    </div>
  );
}
