import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Row, Select, Space, Statistic, Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import { getSchedule, getScheduleUploads } from '../api/schedule';
import type { ScheduleEntry, ScheduleUpload } from '../api/schedule';
import { groupScheduleRowsByMonth, summarizeScheduleRows } from './publicationScheduleUtils';

const DEFAULT_YEAR = 2026;

function buildYearOptions() {
  const currentYear = dayjs().year();
  return Array.from(new Set([DEFAULT_YEAR, currentYear - 1, currentYear, currentYear + 1]))
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderIssue(row: ScheduleEntry) {
  if (row.is_suspended) return <Tag color="default">休刊</Tag>;
  return row.issue_number === null ? '-' : `第 ${row.issue_number} 期`;
}

function renderStatus(status: ScheduleUpload['status']) {
  const colorMap: Record<ScheduleUpload['status'], string> = {
    previewed: 'processing',
    committed: 'success',
    failed: 'error',
  };
  return <Tag color={colorMap[status]}>{status}</Tag>;
}

export default function PublicationScheduleManager() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const yearOptions = useMemo(buildYearOptions, []);

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
  const issueRange = summary.first_issue_number === null || summary.last_issue_number === null
    ? '-'
    : `${summary.first_issue_number} - ${summary.last_issue_number}`;

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
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--color-text)' }}>
              刊期表管理
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)' }}>
              查看年度出版计划和刊期表上传记录
            </p>
          </div>
          <Select value={year} options={yearOptions} onChange={setYear} style={{ width: 140 }} />
        </div>

        {(scheduleQuery.isError || uploadsQuery.isError) && (
          <Alert type="error" showIcon message="加载刊期表数据失败，请稍后重试" />
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

        {scheduleRows.length === 0 && !scheduleQuery.isLoading ? (
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
          <Table<ScheduleUpload>
            rowKey="id"
            columns={uploadColumns}
            dataSource={uploadsQuery.data ?? []}
            pagination={false}
            size="middle"
          />
        </Card>
      </Space>
    </div>
  );
}
