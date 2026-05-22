import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Col, Popconfirm, Row, Select, Space, Statistic, Table, Tag, Typography, Upload, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { TableProps, UploadProps } from 'antd';
import dayjs from 'dayjs';
import { commitScheduleUpload, getSchedule, getScheduleUploads, previewScheduleUpload } from '../api/schedule';
import type { ScheduleDraftRow, ScheduleEntry, SchedulePreview, ScheduleUpload } from '../api/schedule';
import { useAuth } from '../contexts/AuthContext';
import {
  formatIssueRange,
  groupScheduleRowsByMonth,
  rowHasError,
  summarizeScheduleRows,
} from './publicationScheduleUtils';

const DEFAULT_YEAR = 2026;
const { Dragger } = Upload;
const { Text } = Typography;

function buildYearOptions(selectedYear: number) {
  const currentYear = dayjs().year();
  return Array.from(new Set([DEFAULT_YEAR, currentYear - 1, currentYear, currentYear + 1, selectedYear]))
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderIssue(row: Pick<ScheduleDraftRow | ScheduleEntry, 'is_suspended' | 'issue_number'>) {
  if (row.is_suspended) return <Tag color="default">休刊</Tag>;
  return row.issue_number === null ? '-' : `第 ${row.issue_number} 期`;
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

export default function PublicationScheduleManager() {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewFileName, setPreviewFileName] = useState<string | null>(null);
  const yearOptions = useMemo(() => buildYearOptions(year), [year]);

  const scheduleQuery = useQuery({
    queryKey: ['schedule', year],
    queryFn: async () => {
      const res = await getSchedule(year);
      return res.data;
    },
  });

  const uploadsQuery = useQuery({
    queryKey: ['scheduleUploads', year],
    queryFn: async () => {
      const res = await getScheduleUploads(year);
      return res.data;
    },
  });

  const scheduleRows = scheduleQuery.data ?? [];
  const summary = useMemo(() => summarizeScheduleRows(scheduleRows), [scheduleRows]);
  const monthGroups = useMemo(() => groupScheduleRowsByMonth(scheduleRows), [scheduleRows]);
  const issueRange = formatIssueRange(summary);
  const previewMonthGroups = useMemo(() => groupScheduleRowsByMonth(preview?.rows ?? []), [preview?.rows]);
  const previewIssueRange = preview ? formatIssueRange(preview.summary) : '-';

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
  };

  const handleCommitPreview = async () => {
    if (!preview) return;
    if (!preview.can_commit) {
      message.warning('当前预览存在校验问题，暂不能保存');
      return;
    }

    setCommitting(true);
    try {
      await commitScheduleUpload(preview.upload_id, preview.rows);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['schedule', preview.year] }),
        queryClient.invalidateQueries({ queryKey: ['scheduleUploads', preview.year] }),
      ]);
      setYear(preview.year);
      setPreview(null);
      setPreviewError(null);
      setPreviewFileName(null);
      message.success(`${preview.year} 年刊期表已保存`);
    } catch (error: unknown) {
      const errorMessage = getApiErrorMessage(error, '刊期表保存失败，请稍后重试');
      message.error(errorMessage);
    } finally {
      setCommitting(false);
    }
  };

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
  ];

  const previewColumns: TableProps<ScheduleDraftRow>['columns'] = [
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
      title: '校验状态',
      key: 'validation_status',
      render: (_value: unknown, record) => (
        rowHasError(record, preview?.errors ?? [])
          ? <Tag color="red">需检查</Tag>
          : <Tag color="green">正常</Tag>
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
  ];

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              刊期表管理
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)' }}>
              查看年度出版计划和刊期表上传记录
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

        {scheduleQuery.isError && (
          <Alert type="error" showIcon message="加载刊期表数据失败，请稍后重试" />
        )}

        {isAdmin && (
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
                      ? '确认保存后将替换该年份的正式刊期表。'
                      : '请处理校验问题后再保存；本次预览尚未修改正式刊期表。'}
                  />

                  <Popconfirm
                    title="确认保存刊期表？"
                    description={`保存后将替换 ${preview.year} 年正式刊期表。`}
                    okText="确认保存"
                    cancelText="取消"
                    disabled={!preview.can_commit || committing}
                    onConfirm={handleCommitPreview}
                  >
                    <Button type="primary" loading={committing} disabled={!preview.can_commit || committing}>
                      确认保存
                    </Button>
                  </Popconfirm>

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
                      <Table<ScheduleDraftRow>
                        rowKey={(record, index) => `${record.publish_date}-${index ?? 0}`}
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
        )}

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="计划周数" value={summary.total_rows} suffix="周" />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="出版期数" value={summary.published_count} suffix="期" />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="休刊次数" value={summary.suspended_count} suffix="次" />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="期号范围" value={issueRange} />
            </Card>
          </Col>
        </Row>

        {scheduleRows.length === 0 && !scheduleQuery.isLoading && !scheduleQuery.isError ? (
          <Card>
            <Alert type="info" showIcon message="暂无该年份刊期表" />
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
