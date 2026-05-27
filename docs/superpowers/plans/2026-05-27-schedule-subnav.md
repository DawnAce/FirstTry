# 期刊表管理二级导航重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将"刊期表管理"拆分为两个二级导航页面——"期刊表"（含年度概览、筛选过滤、明细表格）和"导入期刊表"（PDF上传预览功能），提升信息组织和操作效率。

**Architecture:** 将现有 `PublicationScheduleManager.tsx` 大组件拆分为两个独立页面组件。侧边栏菜单新增 `schedule-management` 子菜单组，下设 `/schedule` 和 `/schedule/import` 两个路由。"期刊表"页面新增月份筛选（与年份联动）、期号/日期查询、状态筛选功能。"导入期刊表"页面保留原有的 PDF 上传预览+确认保存+上传记录全部功能。

**Tech Stack:** React, TypeScript, Ant Design, TanStack Query, dayjs, react-router-dom

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `frontend/src/pages/ScheduleView.tsx` | "期刊表"页面：年度概览统计卡、筛选栏（年份+月份联动、期号/日期查询、状态筛选）、明细表格 |
| Create | `frontend/src/pages/ScheduleImport.tsx` | "导入期刊表"页面：PDF上传预览、草稿编辑、确认保存、上传记录 |
| Modify | `frontend/src/components/AppLayout.tsx` | 侧边栏菜单：`刊期表管理` 改为子菜单，含"期刊表"和"导入期刊表"两个子项 |
| Modify | `frontend/src/App.tsx` | 路由：新增 `/schedule/import` 路由，引入新页面组件 |
| Delete | `frontend/src/pages/PublicationScheduleManager.tsx` | 旧的合并页面，功能已拆分到上面两个文件 |
| Keep | `frontend/src/pages/publicationScheduleUtils.ts` | 工具函数不变，两个新页面共用 |
| Keep | `frontend/src/api/schedule.ts` | API 层不变 |

---

### Task 1: 创建"期刊表"页面组件 (ScheduleView.tsx)

**Files:**
- Create: `frontend/src/pages/ScheduleView.tsx`

这个页面包含：
1. 标题区（标题 + 年份选择器）
2. 年度概览统计卡（出版期数、休刊次数、期号范围）
3. 筛选栏（月份选择—联动年份、按日期/期号查询某一期、状态筛选：全部/正常/休刊）
4. 筛选后的明细表格（和原来一样按月分组，但只显示筛选后的数据）

- [ ] **Step 1: 创建 ScheduleView.tsx**

```tsx
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Card,
  Col,
  DatePicker,
  Input,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { getSchedule } from '../api/schedule';
import type { ScheduleEntry } from '../api/schedule';
import {
  formatIssueRange,
  groupScheduleRowsByMonth,
  summarizeScheduleRows,
} from './publicationScheduleUtils';

const DEFAULT_YEAR = dayjs().year();

function buildYearOptions(selectedYear: number) {
  const currentYear = dayjs().year();
  return Array.from(new Set([2026, currentYear - 1, currentYear, currentYear + 1, selectedYear]))
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderIssue(row: Pick<ScheduleEntry, 'is_suspended' | 'issue_number'>) {
  if (row.is_suspended) return <Tag color="default">休刊</Tag>;
  return row.issue_number === null ? '-' : `第 ${row.issue_number} 期`;
}

export default function ScheduleView() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [filterMonth, setFilterMonth] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'normal' | 'suspended'>('all');
  const [searchDate, setSearchDate] = useState<string | null>(null);
  const [searchIssue, setSearchIssue] = useState<string>('');

  const yearOptions = useMemo(() => buildYearOptions(year), [year]);

  const scheduleQuery = useQuery({
    queryKey: ['schedule', year],
    queryFn: async () => {
      const res = await getSchedule(year);
      return res.data;
    },
  });

  const scheduleRows = scheduleQuery.data ?? [];
  const summary = useMemo(() => summarizeScheduleRows(scheduleRows), [scheduleRows]);
  const issueRange = formatIssueRange(summary);

  // 可用月份列表（从数据中提取，与年份联动）
  const availableMonths = useMemo(() => {
    const months = new Set<number>();
    scheduleRows.forEach((row) => {
      months.add(dayjs(row.publish_date).month() + 1);
    });
    return Array.from(months).sort((a, b) => a - b);
  }, [scheduleRows]);

  const monthOptions = useMemo(
    () => [
      { label: '全部月份', value: 0 },
      ...availableMonths.map((m) => ({ label: `${m} 月`, value: m })),
    ],
    [availableMonths],
  );

  // 切换年份时重置月份筛选
  const handleYearChange = (nextYear: number) => {
    setYear(nextYear);
    setFilterMonth(null);
    setFilterStatus('all');
    setSearchDate(null);
    setSearchIssue('');
  };

  // 筛选逻辑
  const filteredRows = useMemo(() => {
    let rows = scheduleRows;

    if (filterMonth) {
      rows = rows.filter((row) => dayjs(row.publish_date).month() + 1 === filterMonth);
    }

    if (filterStatus === 'normal') {
      rows = rows.filter((row) => !row.is_suspended);
    } else if (filterStatus === 'suspended') {
      rows = rows.filter((row) => row.is_suspended);
    }

    if (searchDate) {
      rows = rows.filter((row) => row.publish_date === searchDate);
    }

    if (searchIssue.trim()) {
      const num = Number(searchIssue.trim());
      if (!isNaN(num)) {
        rows = rows.filter((row) => row.issue_number === num);
      }
    }

    return rows;
  }, [scheduleRows, filterMonth, filterStatus, searchDate, searchIssue]);

  const monthGroups = useMemo(() => groupScheduleRowsByMonth(filteredRows), [filteredRows]);

  const scheduleColumns: TableProps<ScheduleEntry>['columns'] = [
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      key: 'publish_date',
      render: (value: string) => dayjs(value).format('YYYY-MM-DD'),
    },
    {
      title: '期号',
      key: 'issue_number',
      render: (_value: unknown, record) => renderIssue(record),
    },
    {
      title: '状态',
      key: 'status',
      render: (_value: unknown, record) =>
        record.is_suspended
          ? <Tag color="orange">休刊</Tag>
          : <Tag color="green">正常</Tag>,
    },
    {
      title: '版数',
      dataIndex: 'page_count',
      key: 'page_count',
      render: (_value: number | null | undefined, record: ScheduleEntry) => {
        const planned = record.page_count;
        const actual = record.actual_page_count;
        if (planned == null && actual == null) return '-';
        const mismatch = actual != null && planned != null && actual !== planned;
        return (
          <Space size={4}>
            {planned != null && <span>计划 {planned}版</span>}
            {actual != null && (
              <span style={{ color: mismatch ? '#fa8c16' : undefined, fontWeight: mismatch ? 500 : undefined }}>
                实际 {actual}版
              </span>
            )}
            {mismatch && (
              <Tag color="orange" style={{ fontSize: 11, lineHeight: '18px', padding: '0 4px', margin: 0 }}>
                <WarningOutlined />
              </Tag>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        {/* 标题区 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              期刊表
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)' }}>
              查看年度出版计划和期刊明细
            </p>
          </div>
          <Select
            value={year}
            options={yearOptions}
            onChange={handleYearChange}
            style={{ width: 140 }}
          />
        </div>

        {scheduleQuery.isError && (
          <Alert type="error" showIcon message="加载刊期表数据失败，请稍后重试" />
        )}

        {/* 年度概览统计卡 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8} lg={8}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="出版期数" value={summary.published_count} suffix="期" />
            </Card>
          </Col>
          <Col xs={24} sm={8} lg={8}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="休刊次数" value={summary.suspended_count} suffix="次" />
            </Card>
          </Col>
          <Col xs={24} sm={8} lg={8}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="期号范围" value={issueRange} />
            </Card>
          </Col>
        </Row>

        {/* 筛选栏 */}
        <Card size="small">
          <Space wrap size={16}>
            <Space size={8}>
              <Typography.Text type="secondary">月份：</Typography.Text>
              <Select
                value={filterMonth ?? 0}
                options={monthOptions}
                onChange={(v) => setFilterMonth(v === 0 ? null : v)}
                style={{ width: 120 }}
              />
            </Space>
            <Space size={8}>
              <Typography.Text type="secondary">日期：</Typography.Text>
              <DatePicker
                value={searchDate ? dayjs(searchDate) : null}
                onChange={(date) => setSearchDate(date ? date.format('YYYY-MM-DD') : null)}
                placeholder="按出版日期查询"
                allowClear
              />
            </Space>
            <Space size={8}>
              <Typography.Text type="secondary">期号：</Typography.Text>
              <Input
                value={searchIssue}
                onChange={(e) => setSearchIssue(e.target.value)}
                placeholder="输入期号"
                allowClear
                style={{ width: 120 }}
              />
            </Space>
            <Space size={8}>
              <Typography.Text type="secondary">状态：</Typography.Text>
              <Select
                value={filterStatus}
                onChange={setFilterStatus}
                style={{ width: 100 }}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '正常', value: 'normal' },
                  { label: '休刊', value: 'suspended' },
                ]}
              />
            </Space>
          </Space>
        </Card>

        {/* 明细表格 */}
        {filteredRows.length === 0 && !scheduleQuery.isLoading && !scheduleQuery.isError ? (
          <Card>
            <Alert type="info" showIcon message="暂无匹配的刊期数据" />
          </Card>
        ) : (
          monthGroups.map((group) => (
            <Card key={group.month} title={`${year} 年 ${group.month} 月`} loading={scheduleQuery.isLoading}>
              <Table<ScheduleEntry>
                rowKey="id"
                columns={scheduleColumns}
                dataSource={group.rows}
                pagination={false}
                size="middle"
              />
            </Card>
          ))
        )}
      </Space>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (无错误)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ScheduleView.tsx
git commit -m "feat: create ScheduleView page with filters and summary stats"
```

---

### Task 2: 创建"导入期刊表"页面组件 (ScheduleImport.tsx)

**Files:**
- Create: `frontend/src/pages/ScheduleImport.tsx`

从原 `PublicationScheduleManager.tsx` 中提取 PDF 上传预览、草稿行编辑、确认保存、上传记录功能。

- [ ] **Step 1: 创建 ScheduleImport.tsx**

```tsx
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  InputNumber,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import { InboxOutlined, DeleteOutlined, WarningOutlined } from '@ant-design/icons';
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
import {
  formatIssueRange,
  groupScheduleRowsByMonth,
  rowHasError,
} from './publicationScheduleUtils';

const DEFAULT_YEAR = dayjs().year();
const { Dragger } = Upload;
const { Text } = Typography;

type EditableScheduleDraftRow = ScheduleDraftRow & { draftIndex: number };

function buildYearOptions(selectedYear: number) {
  const currentYear = dayjs().year();
  return Array.from(new Set([2026, currentYear - 1, currentYear, currentYear + 1, selectedYear]))
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderStatus(status: ScheduleUpload['status']) {
  const colorMap: Record<ScheduleUpload['status'], string> = {
    previewed: 'blue',
    committed: 'green',
    failed: 'red',
  };
  const labelMap: Record<ScheduleUpload['status'], string> = {
    previewed: '待确认',
    committed: '已保存',
    failed: '失败',
  };
  return <Tag color={colorMap[status]}>{labelMap[status]}</Tag>;
}

function getApiErrorMessage(error: unknown, fallback: string) {
  const err = error as { response?: { data?: { detail?: string } }; message?: string };
  return err.response?.data?.detail || err.message || fallback;
}

export default function ScheduleImport() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const [previewPageCount, setPreviewPageCount] = useState<number | null>(null);
  const [draftRows, setDraftRows] = useState<ScheduleDraftRow[]>([]);
  const [savingDraftRows, setSavingDraftRows] = useState(false);
  const yearOptions = useMemo(() => buildYearOptions(year), [year]);

  const uploadsQuery = useQuery({
    queryKey: ['scheduleUploads', year],
    queryFn: async () => {
      const res = await getScheduleUploads(year);
      return res.data;
    },
  });

  const previewRowsWithIndex = useMemo<EditableScheduleDraftRow[]>(
    () => draftRows.map((row, draftIndex) => ({ ...row, draftIndex })),
    [draftRows],
  );
  const previewMonthGroups = useMemo(() => groupScheduleRowsByMonth(previewRowsWithIndex), [previewRowsWithIndex]);
  const previewIssueRange = preview ? formatIssueRange(preview.summary) : '-';
  const hasDraftRowChanges = preview
    ? JSON.stringify(draftRows) !== JSON.stringify(preview.rows)
    : false;

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
      setPreviewPageCount(res.data.summary.page_count ?? null);
      if (res.data.year !== year) {
        setYear(res.data.year);
      }
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
  };

  const handleDraftRowChange = (
    draftIndex: number,
    patch: Partial<ScheduleDraftRow>,
  ) => {
    setDraftRows((rows) => rows.map((row, index) => {
      if (index !== draftIndex) return row;
      const next = { ...row, ...patch };
      if (patch.is_suspended === true) {
        next.issue_number = null;
      }
      return next;
    }));
  };

  const handleAddDraftRow = () => {
    setDraftRows((rows) => [
      ...rows,
      {
        publish_date: `${preview?.year ?? year}-01-01`,
        issue_number: null,
        is_suspended: true,
        page_count: previewPageCount,
      },
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
      const errorMessage = getApiErrorMessage(error, '手动修正保存失败，请稍后重试');
      message.error(errorMessage);
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
      const errorMessage = getApiErrorMessage(error, '刊期表保存失败，请稍后重试');
      message.error(errorMessage);
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
      const errorMessage = getApiErrorMessage(error, '删除失败，请稍后重试');
      message.error(errorMessage);
    }
  };

  const previewColumns: TableProps<EditableScheduleDraftRow>['columns'] = [
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      key: 'publish_date',
      render: (value: string, record) => (
        <DatePicker
          value={dayjs(value)}
          onChange={(nextDate) => {
            if (nextDate) {
              handleDraftRowChange(record.draftIndex, { publish_date: nextDate.format('YYYY-MM-DD') });
            }
          }}
          disabled={committing || savingDraftRows}
        />
      ),
    },
    {
      title: '期号',
      key: 'issue_number',
      render: (_value: unknown, record) => (
        <InputNumber
          min={1}
          precision={0}
          value={record.issue_number}
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
          value={record.page_count}
          disabled={committing || savingDraftRows}
          onChange={(value) => handleDraftRowChange(record.draftIndex, { page_count: value ?? null })}
        />
      ),
    },
    {
      title: '休刊',
      key: 'is_suspended',
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
      render: (_value: unknown, record) => (
        rowHasError(record, preview?.errors ?? [])
          ? <Tag color="red">需检查</Tag>
          : <Tag color="green">正常</Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_value: unknown, record) => (
        <Button
          danger
          size="small"
          disabled={committing || savingDraftRows}
          onClick={() => handleRemoveDraftRow(record.draftIndex)}
        >
          删除
        </Button>
      ),
    },
  ];

  const uploadColumns: TableProps<ScheduleUpload>['columns'] = [
    {
      title: '文件名',
      dataIndex: 'original_filename',
      key: 'original_filename',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: ScheduleUpload['status']) => renderStatus(status),
    },
    {
      title: '上传人',
      dataIndex: 'uploaded_by',
      key: 'uploaded_by',
      render: (value: string | null) => value || '-',
    },
    {
      title: '上传时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (value: string | null) => value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ScheduleUpload) =>
        record.status === 'previewed' ? (
          <Popconfirm
            title="确认删除此待确认记录？"
            onConfirm={() => handleDiscardUpload(record.id)}
            okText="删除"
            cancelText="取消"
          >
            <Button type="link" danger size="small" icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <Alert type="warning" showIcon message="仅管理员可导入刊期表" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              导入期刊表
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)' }}>
              上传年度刊期 PDF 并预览确认
            </p>
          </div>
          <Select
            value={year}
            options={yearOptions}
            onChange={handleYearChange}
            disabled={committing}
            style={{ width: 140 }}
          />
        </div>

        <Card title="上传 PDF 预览">
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
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

            {previewFileName && (
              <Text type="secondary">当前预览文件：{previewFileName}</Text>
            )}

            {previewing && (
              <Alert type="info" showIcon message="正在解析 PDF，请稍候..." />
            )}

            {previewError && (
              <Alert type="error" showIcon message="解析预览失败" description={previewError} />
            )}

            {preview && (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type={preview.can_commit ? 'success' : 'warning'}
                  showIcon
                  message={preview.can_commit ? '解析完成，可确认保存' : '解析完成，但存在需要处理的问题'}
                  description={preview.can_commit
                    ? `确认保存后将更新 ${preview.year} 年的正式刊期表（仅影响该年份，其他年份不受影响）。`
                    : '请处理校验问题后再保存；本次预览尚未修改正式刊期表。'}
                />

                <Popconfirm
                  title="确认保存刊期表？"
                  description={`保存后将更新 ${preview.year} 年的刊期表，其他年份数据不受影响。`}
                  okText="确认保存"
                  cancelText="取消"
                  disabled={!preview.can_commit || committing}
                  onConfirm={handleCommitPreview}
                >
                  <Button
                    type="primary"
                    loading={committing}
                    disabled={!preview.can_commit || committing || hasDraftRowChanges}
                  >
                    确认保存
                  </Button>
                </Popconfirm>

                <Space>
                  <Button onClick={handleAddDraftRow} disabled={committing || savingDraftRows}>
                    新增一行
                  </Button>
                  <Button
                    type="default"
                    loading={savingDraftRows}
                    disabled={!hasDraftRowChanges || committing || savingDraftRows}
                    onClick={handleApplyDraftRows}
                  >
                    应用手动修正并重新校验
                  </Button>
                  {hasDraftRowChanges && (
                    <Text type="warning">存在未应用的手动修正，需重新校验后才能确认保存。</Text>
                  )}
                </Space>

                <Row gutter={[16, 16]}>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <Statistic title="年份" value={preview.year} suffix="年" />
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <Statistic title="总行数" value={preview.summary.total_rows} suffix="行" />
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <Statistic title="出版期数" value={preview.summary.published_count} suffix="期" />
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <Statistic title="休刊次数" value={preview.summary.suspended_count} suffix="次" />
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <Statistic title="期号范围" value={previewIssueRange} />
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <div style={{ marginBottom: 4, color: 'rgba(0, 0, 0, 0.45)', fontSize: 14 }}>版数</div>
                      <InputNumber
                        value={previewPageCount}
                        onChange={(val) => setPreviewPageCount(val)}
                        min={1}
                        suffix="版"
                        style={{ width: '100%' }}
                        placeholder="如：32"
                      />
                    </Card>
                  </Col>
                  <Col xs={24} sm={12} lg={4}>
                    <Card size="small">
                      <Statistic
                        title="可保存"
                        value={preview.can_commit ? '是' : '否'}
                        valueStyle={{ color: preview.can_commit ? 'var(--color-accent)' : undefined }}
                      />
                    </Card>
                  </Col>
                </Row>

                {preview.errors.length > 0 && (
                  <Alert
                    type="error"
                    showIcon
                    message="解析校验错误"
                    description={(
                      <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                        {preview.errors.map((error) => (
                          <li key={error}>{error}</li>
                        ))}
                      </ul>
                    )}
                  />
                )}

                {previewMonthGroups.map((group) => (
                  <Card key={group.month} title={`预览：${preview.year} 年 ${group.month} 月`} size="small">
                    <Table<EditableScheduleDraftRow>
                      rowKey={(record) => `${record.draftIndex}-${record.publish_date}`}
                      columns={previewColumns}
                      dataSource={group.rows}
                      pagination={false}
                      size="middle"
                      rowClassName={(record) => (rowHasError(record, preview.errors) ? 'schedule-preview-row-error' : '')}
                    />
                  </Card>
                ))}
              </Space>
            )}
          </Space>
        </Card>

        <Card title="上传记录" loading={uploadsQuery.isLoading}>
          {uploadsQuery.isError ? (
            <Alert type="error" showIcon message="加载上传记录失败，请稍后重试" />
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
      </Space>
    </div>
  );
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ScheduleImport.tsx
git commit -m "feat: create ScheduleImport page with PDF upload and preview"
```

---

### Task 3: 更新侧边栏菜单和路由

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx`
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/pages/PublicationScheduleManager.tsx`

- [ ] **Step 1: 修改 AppLayout.tsx 菜单**

将 `刊期表管理` 从一级菜单改为带子菜单的分组：

```tsx
// 在 menuItems 中，替换：
{ key: '/schedule', icon: <CalendarOutlined />, label: '刊期表管理' },

// 改为：
{
  key: 'schedule-management',
  icon: <CalendarOutlined />,
  label: '刊期表管理',
  children: [
    { key: '/schedule', label: '期刊表' },
    { key: '/schedule/import', label: '导入期刊表' },
  ],
},
```

更新 `getSelectedKey` 函数：

```tsx
const getSelectedKey = () => {
  const path = location.pathname;
  if (path.startsWith('/report/') || path.startsWith('/shipping/') || path.startsWith('/history-import')) return '/';
  if (path.startsWith('/recipients')) return '/recipients';
  if (path.startsWith('/history')) return '/history';
  if (path === '/schedule/import') return '/schedule/import';
  if (path.startsWith('/schedule')) return '/schedule';
  if (path.startsWith('/templates')) return '/templates';
  return path;
};
```

更新 `getOpenKeys` 函数：

```tsx
const getOpenKeys = () => {
  const path = location.pathname;
  if (path === '/' || path.startsWith('/report/') || path.startsWith('/shipping/') || path.startsWith('/history-import') || path.startsWith('/history') || path.startsWith('/templates')) {
    return ['print-management'];
  }
  if (path.startsWith('/schedule')) {
    return ['schedule-management'];
  }
  return [];
};
```

- [ ] **Step 2: 修改 App.tsx 路由**

```tsx
// 替换：
import PublicationScheduleManager from './pages/PublicationScheduleManager';

// 改为：
import ScheduleView from './pages/ScheduleView';
import ScheduleImport from './pages/ScheduleImport';
```

```tsx
// 替换路由行：
<Route path="/schedule" element={<PublicationScheduleManager />} />

// 改为：
<Route path="/schedule" element={<ScheduleView />} />
<Route path="/schedule/import" element={<ScheduleImport />} />
```

- [ ] **Step 3: 删除旧文件**

```bash
git rm frontend/src/pages/PublicationScheduleManager.tsx
```

- [ ] **Step 4: 更新测试文件导入**

修改 `frontend/src/pages/PublicationScheduleManager.test.tsx`：
- 更新导入路径从 `PublicationScheduleManager` 改为 `ScheduleImport`（测试的是上传/提交功能）
- 更新文件名为 `ScheduleImport.test.tsx`（`git mv`）

- [ ] **Step 5: 验证 TypeScript 编译**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: 运行测试**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: split schedule management into two sub-nav pages"
```

---

### Task 4: 验证和文档更新

**Files:**
- Modify: `docs/user-guide.md` (如存在)

- [ ] **Step 1: 最终 TypeScript 编译验证**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: 运行全部测试**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 3: 更新文档**

若 `docs/user-guide.md` 中有刊期表管理相关内容，更新为新的二级导航结构说明。

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs: update user guide for schedule sub-navigation"
```
