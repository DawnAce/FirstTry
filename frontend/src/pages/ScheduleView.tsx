import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, DatePicker, InputNumber, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { getSchedule, getScheduleYears } from '../api/schedule';
import type { ScheduleEntry } from '../api/schedule';
import { formatIssueRange, groupScheduleRowsByMonth, summarizeScheduleRows } from './publicationScheduleUtils';

const FALLBACK_YEAR = 2026;
const DEFAULT_YEAR = dayjs().year();

type StatusFilterValue = 'all' | 'normal' | 'suspended';

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '休刊', value: 'suspended' },
];

function buildYearOptions(selectedYear: number, dataYears: number[]) {
  const currentYear = dayjs().year();
  // Always show the near window for new imports, plus every year that actually
  // has schedule rows (incl. historical ones like 2024), plus the selected year.
  return Array.from(
    new Set([FALLBACK_YEAR, currentYear - 1, currentYear, currentYear + 1, selectedYear, ...dataYears]),
  )
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderIssue(row: Pick<ScheduleEntry, 'is_suspended' | 'issue_number'>) {
  if (row.is_suspended) return <Tag color="default">休刊</Tag>;
  return row.issue_number === null ? '-' : `第 ${row.issue_number} 期`;
}

function renderPublishStatus(isSuspended: boolean) {
  return isSuspended ? <Tag color="orange">休刊</Tag> : <Tag color="green">正常</Tag>;
}

function renderPageCount(record: ScheduleEntry) {
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
}

export default function ScheduleView() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [month, setMonth] = useState<number | null>(null);
  const [publishDate, setPublishDate] = useState<Dayjs | null>(null);
  const [issueNumber, setIssueNumber] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilterValue>('all');

  const yearsQuery = useQuery({
    queryKey: ['schedule-years'],
    queryFn: async () => {
      const res = await getScheduleYears();
      return res.data;
    },
  });

  const yearOptions = useMemo(
    () => buildYearOptions(year, yearsQuery.data ?? []),
    [year, yearsQuery.data],
  );

  const scheduleQuery = useQuery({
    queryKey: ['schedule', year],
    queryFn: async () => {
      const res = await getSchedule(year);
      return res.data;
    },
  });

  const scheduleRows = scheduleQuery.data ?? [];
  const yearSummary = useMemo(() => summarizeScheduleRows(scheduleRows), [scheduleRows]);
  const issueRange = useMemo(() => formatIssueRange(yearSummary), [yearSummary]);

  const monthOptions = useMemo(
    () => groupScheduleRowsByMonth(scheduleRows).map((group) => ({ label: `${group.month} 月`, value: group.month })),
    [scheduleRows],
  );

  const filteredRows = useMemo(() => scheduleRows.filter((row) => {
    const rowDate = dayjs(row.publish_date);

    if (month !== null && rowDate.month() + 1 !== month) return false;
    if (publishDate && rowDate.format('YYYY-MM-DD') !== publishDate.format('YYYY-MM-DD')) return false;
    if (issueNumber !== null && row.issue_number !== issueNumber) return false;
    if (status === 'normal' && row.is_suspended) return false;
    if (status === 'suspended' && !row.is_suspended) return false;

    return true;
  }), [scheduleRows, month, publishDate, issueNumber, status]);

  const filteredMonthGroups = useMemo(() => groupScheduleRowsByMonth(filteredRows), [filteredRows]);

  const tableColumns: TableProps<ScheduleEntry>['columns'] = [
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
      dataIndex: 'is_suspended',
      key: 'status',
      render: (value: boolean) => renderPublishStatus(value),
    },
    {
      title: '版数',
      dataIndex: 'page_count',
      key: 'page_count',
      render: (_value: number | null | undefined, record) => renderPageCount(record),
    },
  ];

  const handleYearChange = (nextYear: number) => {
    setYear(nextYear);
    setMonth(null);
    setPublishDate(null);
    setIssueNumber(null);
    setStatus('all');
  };

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <Space direction="vertical" size={24} style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              期刊表
            </h1>
            <p style={{ margin: '8px 0 0', color: 'var(--color-text-secondary)' }}>
              按年份查看出版安排、休刊情况与版数信息
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

        <Row gutter={[16, 16]}>
          <Col xs={24} md={8}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="出版期数" value={yearSummary.published_count} suffix="期" />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="休刊次数" value={yearSummary.suspended_count} suffix="次" />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card loading={scheduleQuery.isLoading}>
              <Statistic title="期号范围" value={issueRange} />
            </Card>
          </Col>
        </Row>

        <Card>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <div style={{ color: 'var(--color-text-secondary)', marginBottom: 8 }}>月份</div>
              <Select<number>
                allowClear
                placeholder="全部月份"
                options={monthOptions}
                value={month ?? undefined}
                onChange={(value) => setMonth(value ?? null)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <div style={{ color: 'var(--color-text-secondary)', marginBottom: 8 }}>出版日期</div>
              <DatePicker
                allowClear
                value={publishDate}
                onChange={(value) => setPublishDate(value)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <div style={{ color: 'var(--color-text-secondary)', marginBottom: 8 }}>期号</div>
              <InputNumber
                min={1}
                precision={0}
                placeholder="输入期号"
                value={issueNumber}
                onChange={(value) => setIssueNumber(value ?? null)}
                style={{ width: '100%' }}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <div style={{ color: 'var(--color-text-secondary)', marginBottom: 8 }}>状态</div>
              <Select<StatusFilterValue>
                options={STATUS_OPTIONS}
                value={status}
                onChange={(value) => setStatus(value)}
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
          <div style={{ marginTop: 16 }}>
            <Typography.Text type="secondary">
              共 {filteredRows.length} 条记录符合当前筛选条件
            </Typography.Text>
          </div>
        </Card>

        {scheduleRows.length === 0 && !scheduleQuery.isLoading && !scheduleQuery.isError ? (
          <Card>
            <Alert type="info" showIcon message="暂无该年份刊期表" />
          </Card>
        ) : filteredRows.length === 0 && !scheduleQuery.isLoading ? (
          <Card>
            <Alert type="info" showIcon message="当前筛选条件下暂无刊期记录" />
          </Card>
        ) : (
          filteredMonthGroups.map((group) => (
            <Card key={group.month} title={`${year} 年 ${group.month} 月`} loading={scheduleQuery.isLoading}>
              <Table<ScheduleEntry>
                rowKey="id"
                columns={tableColumns}
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
