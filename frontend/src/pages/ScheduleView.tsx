import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, InputNumber, Row, Select, Table } from 'antd';
import {
  CalendarOutlined,
  CoffeeOutlined,
  ReadOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  UpOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { TableProps } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { getSchedule, getScheduleYears } from '../api/schedule';
import type { ScheduleEntry } from '../api/schedule';
import { formatIssueRange, groupScheduleRowsByMonth, summarizeScheduleRows } from './publicationScheduleUtils';

const { RangePicker } = DatePicker;

const FALLBACK_YEAR = 2026;
const DEFAULT_YEAR = dayjs().year();
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

type StatusFilterValue = 'all' | 'normal' | 'suspended';
type MonthDotStatus = 'normal' | 'adjust' | 'rest';

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '正常', value: 'normal' },
  { label: '休刊', value: 'suspended' },
];

interface Filters {
  month: number | null;
  dateRange: [Dayjs, Dayjs] | null;
  issueNumber: number | null;
  status: StatusFilterValue;
}

const EMPTY_FILTERS: Filters = { month: null, dateRange: null, issueNumber: null, status: 'all' };

function isMismatch(row: ScheduleEntry): boolean {
  return row.actual_page_count != null && row.page_count != null && row.actual_page_count !== row.page_count;
}

// A month's overview dot: 版次调整(橙) 若有计划≠实际；否则该月无出版期(空/全休刊)→休刊(灰)；否则正常(绿)。
function monthDotStatus(rows: ScheduleEntry[]): MonthDotStatus {
  if (rows.some(isMismatch)) return 'adjust';
  const published = rows.filter((row) => !row.is_suspended && row.issue_number !== null);
  return published.length === 0 ? 'rest' : 'normal';
}

function buildYearOptions(selectedYear: number, dataYears: number[]) {
  const currentYear = dayjs().year();
  return Array.from(
    new Set([FALLBACK_YEAR, currentYear - 1, currentYear, currentYear + 1, selectedYear, ...dataYears]),
  )
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function renderPageCount(record: ScheduleEntry): ReactNode {
  const planned = record.page_count;
  const actual = record.actual_page_count;
  if (planned == null && actual == null) return <span className="sched-muted">—</span>;
  const mismatch = actual != null && planned != null && actual !== planned;
  return (
    <span className="sched-pages">
      {planned != null && <span>计划 {planned} 版</span>}
      {actual != null && (
        <span className={`actual${mismatch ? ' mismatch' : ''}`}>
          实际 {actual} 版{mismatch ? ' ⚠' : ''}
        </span>
      )}
    </span>
  );
}

export default function ScheduleView() {
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [expandedMonths, setExpandedMonths] = useState<Set<number>>(new Set());

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
  const mismatchCount = useMemo(() => scheduleRows.filter(isMismatch).length, [scheduleRows]);

  const monthOptions = useMemo(
    () => groupScheduleRowsByMonth(scheduleRows).map((group) => ({ label: `${group.month} 月`, value: group.month })),
    [scheduleRows],
  );

  // 年度概览：12 个月各自一个圆点（基于全年数据，不受筛选影响）。
  const monthDots = useMemo(() => {
    const byMonth = new Map<number, ScheduleEntry[]>();
    scheduleRows.forEach((row) => {
      const m = dayjs(row.publish_date).month() + 1;
      byMonth.set(m, [...(byMonth.get(m) ?? []), row]);
    });
    return Array.from({ length: 12 }, (_unused, index) => {
      const month = index + 1;
      const rows = byMonth.get(month) ?? [];
      return { month, status: monthDotStatus(rows), count: rows.length };
    });
  }, [scheduleRows]);

  const filteredRows = useMemo(() => scheduleRows.filter((row) => {
    const rowDate = dayjs(row.publish_date);
    if (applied.month !== null && rowDate.month() + 1 !== applied.month) return false;
    if (applied.dateRange) {
      const [start, end] = applied.dateRange;
      if (rowDate.isBefore(start, 'day') || rowDate.isAfter(end, 'day')) return false;
    }
    if (applied.issueNumber !== null && row.issue_number !== applied.issueNumber) return false;
    if (applied.status === 'normal' && row.is_suspended) return false;
    if (applied.status === 'suspended' && !row.is_suspended) return false;
    return true;
  }), [scheduleRows, applied]);

  const filteredMonthGroups = useMemo(() => groupScheduleRowsByMonth(filteredRows), [filteredRows]);

  const statCards: Array<{ icon: ReactNode; bg: string; label: string; value: ReactNode; suffix?: string; valueColor?: string }> = [
    {
      icon: <CalendarOutlined style={{ fontSize: 22, color: 'var(--color-accent)' }} />,
      bg: 'rgba(0, 113, 227, 0.08)',
      label: '出版期数',
      value: yearSummary.published_count,
      suffix: '期',
    },
    {
      icon: <CoffeeOutlined style={{ fontSize: 22, color: '#52c41a' }} />,
      bg: 'rgba(82, 196, 26, 0.12)',
      label: '休刊次数',
      value: yearSummary.suspended_count,
      suffix: '次',
    },
    {
      icon: <ReadOutlined style={{ fontSize: 22, color: '#722ed1' }} />,
      bg: 'rgba(114, 46, 209, 0.08)',
      label: '期号范围',
      value: issueRange,
    },
    {
      icon: <WarningOutlined style={{ fontSize: 22, color: '#fa8c16' }} />,
      bg: 'rgba(250, 140, 22, 0.10)',
      label: '异常版次',
      value: mismatchCount,
      suffix: '次',
      valueColor: mismatchCount > 0 ? '#fa8c16' : undefined,
    },
  ];

  const tableColumns: TableProps<ScheduleEntry>['columns'] = [
    {
      title: '出版日期',
      dataIndex: 'publish_date',
      key: 'publish_date',
      width: 118,
      render: (value: string, record) => (
        <div>
          <div className="sched-date-main">{dayjs(value).format('YYYY-MM-DD')}</div>
          <div className="sched-date-wk">{WEEKDAYS[dayjs(value).day()]}{record.is_suspended ? ' · 休刊' : ''}</div>
        </div>
      ),
    },
    {
      title: '期号',
      key: 'issue_number',
      width: 92,
      render: (_value: unknown, record) => (
        record.is_suspended || record.issue_number === null
          ? <span className="sched-muted">—</span>
          : <span className="sched-issue">第 {record.issue_number} 期</span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'is_suspended',
      key: 'status',
      width: 84,
      render: (value: boolean) => (
        value
          ? <span className="sched-status rest"><span className="sched-status-dot" />休刊</span>
          : <span className="sched-status normal"><span className="sched-status-dot" />正常</span>
      ),
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
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setExpandedMonths(new Set());
  };

  const applyFilters = () => setApplied(draft);
  const resetFilters = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const jumpToMonth = (month: number) => {
    setDraft((prev) => ({ ...prev, month: prev.month === month ? null : month }));
    setApplied((prev) => ({ ...prev, month: prev.month === month ? null : month }));
  };

  const toggleMonth = (month: number) => {
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  };

  const hasData = scheduleRows.length > 0;

  return (
    <div className="sched-page">
      <div className="sched-head">
        <div>
          <h1 className="sched-title">期刊表</h1>
          <p className="sched-sub">按年份查看出版安排、休刊情况与版数信息</p>
        </div>
        <Select
          value={year}
          options={yearOptions}
          onChange={handleYearChange}
          style={{ width: 140 }}
        />
      </div>

      {scheduleQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title="加载刊期表数据失败，请稍后重试" />
      )}

      {/* 统计卡 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {statCards.map((card, idx) => (
          <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
            <Card className="dashboard-stat-card" size="small" style={{ flex: 1 }} loading={scheduleQuery.isLoading}>
              <div className="dashboard-stat-card-inner" style={{ alignItems: 'center' }}>
                <div className="dashboard-stat-icon" style={{ background: card.bg }}>{card.icon}</div>
                <div className="dashboard-stat-content">
                  <div className="dashboard-stat-label">{card.label}</div>
                  <div className="dashboard-stat-value" style={card.valueColor ? { color: card.valueColor } : undefined}>
                    {card.value}
                    {card.suffix && <span className="dashboard-stat-suffix"> {card.suffix}</span>}
                  </div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 年度概览 */}
      <Card className="sched-overview" style={{ marginBottom: 16 }} loading={scheduleQuery.isLoading}>
        <div className="sched-overview-title">年度概览（{year} 年）</div>
        <div className="sched-overview-row">
          <div className="sched-months">
            {monthDots.map((m) => (
              <button
                type="button"
                key={m.month}
                className={`sched-month${applied.month === m.month ? ' on' : ''}`}
                onClick={() => jumpToMonth(m.month)}
                title={m.count > 0 ? `${m.month} 月 · ${m.count} 行` : `${m.month} 月 · 暂无`}
              >
                <span className="sched-month-name">{m.month} 月</span>
                <span className={`sched-dot ${m.status}`} />
              </button>
            ))}
          </div>
          <div className="sched-legend">
            <span><span className="sched-dot normal" />正常</span>
            <span><span className="sched-dot adjust" />版次调整</span>
            <span><span className="sched-dot rest" />休刊</span>
          </div>
        </div>
      </Card>

      {/* 筛选 */}
      <Card className="sched-filter" style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 20px' } }}>
        <div className="sched-toolbar">
          <div className="sched-field">
            <label>月份</label>
            <Select<number>
              allowClear
              placeholder="全部月份"
              options={monthOptions}
              value={draft.month ?? undefined}
              onChange={(value) => setDraft((prev) => ({ ...prev, month: value ?? null }))}
              style={{ width: 150 }}
            />
          </div>
          <div className="sched-field">
            <label>出版日期</label>
            <RangePicker
              allowClear
              value={draft.dateRange}
              onChange={(value) => setDraft((prev) => ({
                ...prev,
                dateRange: value && value[0] && value[1] ? [value[0], value[1]] : null,
              }))}
              style={{ width: 250 }}
            />
          </div>
          <div className="sched-field">
            <label>期号</label>
            <InputNumber
              min={1}
              precision={0}
              placeholder="输入期号"
              value={draft.issueNumber}
              onChange={(value) => setDraft((prev) => ({ ...prev, issueNumber: value ?? null }))}
              style={{ width: 150 }}
            />
          </div>
          <div className="sched-field">
            <label>状态</label>
            <Select<StatusFilterValue>
              options={STATUS_OPTIONS}
              value={draft.status}
              onChange={(value) => setDraft((prev) => ({ ...prev, status: value }))}
              style={{ width: 130 }}
            />
          </div>
          <div className="sched-actions">
            <Button type="primary" icon={<SearchOutlined />} onClick={applyFilters}>查询</Button>
            <Button icon={<ReloadOutlined />} onClick={resetFilters}>重置</Button>
          </div>
        </div>
        <div className="sched-count">
          共 <b>{filteredRows.length}</b> 条记录符合当前筛选条件
        </div>
      </Card>

      {/* 月份卡片 */}
      {!hasData && !scheduleQuery.isLoading && !scheduleQuery.isError ? (
        <Card><Alert type="info" showIcon title="暂无该年份刊期表" /></Card>
      ) : filteredRows.length === 0 && !scheduleQuery.isLoading ? (
        <Card><Alert type="info" showIcon title="当前筛选条件下暂无刊期记录" /></Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filteredMonthGroups.map((group) => {
            const published = group.rows.filter((row) => !row.is_suspended && row.issue_number !== null).length;
            const suspended = group.rows.filter((row) => row.is_suspended).length;
            const status = monthDotStatus(group.rows);
            const expanded = expandedMonths.has(group.month);
            const visibleRows = expanded ? group.rows : group.rows.slice(0, 4);
            return (
              <Col xs={24} xl={12} key={group.month}>
                <Card
                  className="sched-month-card"
                  styles={{ body: { padding: 0 } }}
                  title={`${year} 年 ${group.month} 月`}
                  extra={(
                    <span className="sched-mc-meta">
                      {published} 期 / {suspended} 次休刊
                      <span className={`sched-dot ${status}`} />
                    </span>
                  )}
                >
                  <Table<ScheduleEntry>
                    rowKey="id"
                    columns={tableColumns}
                    dataSource={visibleRows}
                    pagination={false}
                    size="small"
                  />
                  {group.rows.length > 4 && (
                    <div className="sched-more" onClick={() => toggleMonth(group.month)}>
                      {expanded ? <>收起 <UpOutlined /></> : <>查看全部（{group.rows.length} 期）<RightOutlined /></>}
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
    </div>
  );
}
