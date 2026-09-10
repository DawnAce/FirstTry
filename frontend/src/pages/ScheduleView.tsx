import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Col, DatePicker, InputNumber, Row, Select, Tooltip } from 'antd';
import {
  ReloadOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  SearchOutlined,
  StopOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { getSchedule, getScheduleYears } from '../api/schedule';
import type { ScheduleEntry } from '../api/schedule';
import {
  findNextScheduledIssue,
  formatIssueRange,
  getBeijingDate,
  getSchedulePublicationStatus,
  groupScheduleRowsByMonth,
  isPageCountMismatch,
  summarizeScheduleProgress,
  summarizeScheduleRows,
} from './publicationScheduleUtils';
import type { SchedulePublicationStatus } from './publicationScheduleUtils';
import { MetricCard, PageHeader } from '../components/UiPrimitives';
import { useAuth } from '../contexts/AuthContext';

const { RangePicker } = DatePicker;

const FALLBACK_YEAR = 2026;
const EMPTY_SCHEDULE: ScheduleEntry[] = [];
type StatusFilterValue = 'all' | SchedulePublicationStatus;

const STATUS_OPTIONS: Array<{ label: string; value: StatusFilterValue }> = [
  { label: '全部', value: 'all' },
  { label: '已出刊', value: 'published' },
  { label: '未出刊', value: 'unpublished' },
  { label: '休刊', value: 'suspended' },
];

interface Filters {
  month: number | null;
  dateRange: [Dayjs, Dayjs] | null;
  issueNumber: number | null;
  status: StatusFilterValue;
}

const EMPTY_FILTERS: Filters = { month: null, dateRange: null, issueNumber: null, status: 'all' };

// 跨北京时间零点自动刷新；标签页恢复前台时也重算，避免长期打开时停留在昨天。
function usePublicationDate(): string {
  const [today, setToday] = useState(() => getBeijingDate());
  useEffect(() => {
    let timer: number;
    const scheduleRefresh = () => {
      const now = new Date();
      const midnight = Date.parse(`${getBeijingDate(now)}T00:00:00+08:00`) + 86_400_000;
      timer = window.setTimeout(refresh, midnight - now.getTime());
    };
    const refresh = () => {
      window.clearTimeout(timer);
      setToday(getBeijingDate());
      scheduleRefresh();
    };
    scheduleRefresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return today;
}

function buildYearOptions(selectedYear: number, dataYears: number[]) {
  const currentYear = Number(getBeijingDate().slice(0, 4));
  return Array.from(
    new Set([FALLBACK_YEAR, currentYear - 1, currentYear, currentYear + 1, selectedYear, ...dataYears]),
  )
    .sort((a, b) => a - b)
    .map((year) => ({ label: `${year} 年`, value: year }));
}

function PublicationProgress({ published, planned }: { published: number; planned: number }) {
  return (
    <span className="sched-progress" aria-hidden="true">
      <span style={{ width: `${planned > 0 ? published / planned * 100 : 0}%` }} />
    </span>
  );
}

function renderMatrixCell(row: ScheduleEntry | undefined, today: string, nextIssueId?: number): ReactNode {
  if (!row) return <div className="mx-empty">—</div>;
  if (row.is_suspended) {
    return (
      <div className="mx-cell rest">
        <span className="mx-date">{dayjs(row.publish_date).format('MM-DD')}</span>
        <StopOutlined />
        <span className="mx-rest-text">休刊</span>
      </div>
    );
  }
  const planned = row.page_count;
  const actual = row.actual_page_count;
  const mismatch = isPageCountMismatch(row);
  const status = getSchedulePublicationStatus(row, today);
  const isPublished = status === 'published';
  const isNext = row.id === nextIssueId;
  const missingPrint = actual == null;
  return (
    <div className={`mx-cell ${status}${isNext ? ' next' : ''}`}>
      <span className="mx-cell-heading">
        <span className="mx-date">{dayjs(row.publish_date).format('MM-DD')}</span>
        {isNext && <span className="mx-next-label">下一期</span>}
      </span>
      <span className="mx-issue">{row.issue_number !== null ? `第 ${row.issue_number} 期` : '—'}</span>
      <span className="mx-publication-status">
        {isPublished ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
        {isPublished ? (missingPrint ? '已出刊（按刊期）' : '已出刊') : '未出刊'}
      </span>
      {mismatch ? (
        <Tooltip title={`计划 ${planned} 版，实际 ${actual} 版`} trigger={['hover', 'focus']}>
          <span className="mx-meta mx-adjustment" tabIndex={0}>调整 · 实际 {actual} 版</span>
        </Tooltip>
      ) : (
        <span className="mx-meta">
          {actual != null ? `实际 ${actual} 版` : planned != null ? `计划 ${planned} 版` : '计划版数未提供'}
        </span>
      )}
      {isPublished && missingPrint && <span className="mx-missing-print">未录入印数</span>}
    </div>
  );
}

export default function ScheduleView() {
  const { canMutate } = useAuth();
  const today = usePublicationDate();
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);

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

  const scheduleRows = scheduleQuery.data ?? EMPTY_SCHEDULE;
  const yearSummary = useMemo(() => summarizeScheduleRows(scheduleRows), [scheduleRows]);
  const issueRange = useMemo(() => formatIssueRange(yearSummary), [yearSummary]);
  const yearProgress = useMemo(() => summarizeScheduleProgress(scheduleRows, today), [scheduleRows, today]);
  const nextIssue = useMemo(() => findNextScheduledIssue(scheduleRows, today), [scheduleRows, today]);
  const monthGroups = useMemo(() => groupScheduleRowsByMonth(scheduleRows), [scheduleRows]);

  const monthOptions = useMemo(
    () => monthGroups.map((group) => ({ label: `${group.month} 月`, value: group.month })),
    [monthGroups],
  );

  // 年度概览与月度进度均使用完整刊期，不因只查看未出刊等筛选条件改变分母。
  const monthProgress = useMemo(() => {
    return Array.from({ length: 12 }, (_unused, index) => {
      const month = index + 1;
      const rows = monthGroups.find((group) => group.month === month)?.rows ?? [];
      return { month, ...summarizeScheduleProgress(rows, today), count: rows.length };
    });
  }, [monthGroups, today]);

  const filteredRows = useMemo(() => scheduleRows.filter((row) => {
    const rowDate = dayjs(row.publish_date);
    if (applied.month !== null && rowDate.month() + 1 !== applied.month) return false;
    if (applied.dateRange) {
      const [start, end] = applied.dateRange;
      if (rowDate.isBefore(start, 'day') || rowDate.isAfter(end, 'day')) return false;
    }
    if (applied.issueNumber !== null && row.issue_number !== applied.issueNumber) return false;
    if (applied.status !== 'all' && getSchedulePublicationStatus(row, today) !== applied.status) return false;
    return true;
  }), [scheduleRows, applied, today]);

  const filteredProgress = useMemo(() => summarizeScheduleProgress(filteredRows, today), [filteredRows, today]);
  const filteredMonthGroups = useMemo(() => {
    const visibleIds = new Set(filteredRows.map((row) => row.id));
    return monthGroups
      .filter((group) => group.rows.some((row) => visibleIds.has(row.id)))
      .map((group) => ({ ...group, rows: group.rows.map((row) => visibleIds.has(row.id) ? row : undefined) }));
  }, [monthGroups, filteredRows]);

  // 矩阵列数 = 各月周数的最大值（一个月最多 5 个出刊周），至少 1 列。
  const weekColumns = useMemo(() => {
    const maxWeeks = filteredMonthGroups.reduce((max, group) => Math.max(max, group.rows.length), 1);
    return Array.from({ length: maxWeeks }, (_unused, index) => index);
  }, [filteredMonthGroups]);

  const statCards: Array<{ icon: ReactNode; tone: 'info' | 'success' | 'purple' | 'warning'; label: string; value: ReactNode; suffix?: string; note?: ReactNode }> = [
    {
      icon: '📅',
      tone: 'info',
      label: '全年计划',
      value: yearSummary.published_count,
      suffix: '期',
      note: <><span className="sched-published-count">已出刊 {yearProgress.publishedCount}</span> · 未出刊 {yearProgress.unpublishedCount}（按刊期）</>,
    },
    {
      icon: '☕',
      tone: 'success',
      label: '休刊次数',
      value: yearSummary.suspended_count,
      suffix: '次',
      note: '不计入出刊期数',
    },
    {
      icon: '📰',
      tone: 'purple',
      label: '期号范围',
      value: issueRange,
      note: `${year} 年度总期号`,
    },
    {
      icon: '⚠️',
      tone: 'warning',
      label: '版数调整',
      value: yearProgress.comparableCount > 0 ? yearProgress.mismatchCount : '—',
      suffix: yearProgress.comparableCount > 0 ? '期' : undefined,
      note: yearProgress.comparableCount > 0
        ? `已对比 ${yearProgress.comparableCount} / 全年 ${yearProgress.plannedCount} 期`
        : yearProgress.actualCount > 0 ? '暂无计划版数可对比' : '暂无实际版数可对比',
    },
  ];

  const handleYearChange = (nextYear: number) => {
    setYear(nextYear);
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
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

  const hasData = scheduleRows.length > 0;

  return (
    <div className="sched-page">
      <PageHeader
        title="期刊表"
        description="按年份查看出版安排、出刊进度与版数信息"
        actions={<>
          {canMutate && <Button type="primary" icon={<UploadOutlined />} href="/schedule/import">导入期刊表</Button>}
          <Select
            aria-label="年份"
            value={year}
            options={yearOptions}
            onChange={handleYearChange}
            style={{ width: 140 }}
          />
        </>}
      />

      {scheduleQuery.isError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} title="加载刊期表数据失败，请稍后重试" />
      )}

      {/* 统计卡 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {statCards.map((card, idx) => (
          <Col xs={12} md={6} key={idx} style={{ display: 'flex' }}>
            <MetricCard
              loading={scheduleQuery.isLoading}
              icon={card.icon}
              tone={card.tone}
              label={card.label}
              value={scheduleQuery.isError ? '—' : card.value}
              suffix={scheduleQuery.isError ? undefined : card.suffix}
              note={scheduleQuery.isError ? '数据加载失败' : card.note}
            />
          </Col>
        ))}
      </Row>

      {/* 年度概览 */}
      <Card className="sched-overview" style={{ marginBottom: 16 }} loading={scheduleQuery.isLoading}>
        <div className="sched-overview-heading">
          <div className="sched-overview-title">年度概览（{year} 年）</div>
          <span className="sched-note">截至 {today}（北京时间）· 已出刊按出版日期判断</span>
        </div>
        <div className="sched-overview-row">
          <div className="sched-months">
            {monthProgress.map((m) => (
              <button
                type="button"
                key={m.month}
                className={`sched-month${applied.month === m.month ? ' on' : ''}${today.startsWith(`${year}-${String(m.month).padStart(2, '0')}`) ? ' current' : ''}`}
                disabled={m.count === 0 || scheduleQuery.isError}
                aria-pressed={applied.month === m.month}
                aria-label={`${m.month} 月，${m.count > 0 ? `已出刊 ${m.publishedCount} 期，共 ${m.plannedCount} 期，休刊 ${m.suspendedCount} 次` : '暂无刊期'}`}
                onClick={() => jumpToMonth(m.month)}
              >
                <span className="sched-month-name">{m.month} 月</span>
                <span className="sched-month-count">{m.count > 0 ? `${m.publishedCount} / ${m.plannedCount}` : '暂无'}</span>
                <PublicationProgress published={m.publishedCount} planned={m.plannedCount} />
              </button>
            ))}
          </div>
        </div>
        <div className="sched-overview-footer sched-note">
          <span>每月进度：已出刊 / 计划期数 · 休刊不计入</span>
          {nextIssue && !scheduleQuery.isError && <span>本年下一期：第 {nextIssue.issue_number} 期 · {nextIssue.publish_date}</span>}
        </div>
      </Card>

      {/* 筛选 */}
      <Card className="sched-filter" style={{ marginBottom: 16 }} styles={{ body: { padding: '16px 20px' } }}>
        <div className="sched-toolbar">
          <div className="sched-field">
            <label htmlFor="schedule-month">月份</label>
            <Select<number>
              id="schedule-month"
              allowClear
              placeholder="全部月份"
              options={monthOptions}
              value={draft.month ?? undefined}
              onChange={(value) => setDraft((prev) => ({ ...prev, month: value ?? null }))}
              style={{ width: 150 }}
            />
          </div>
          <div className="sched-field">
            <label htmlFor="schedule-start-date">出版日期</label>
            <RangePicker
              id={{ start: 'schedule-start-date', end: 'schedule-end-date' }}
              aria-label="出版日期"
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
            <label htmlFor="schedule-issue-number">期号</label>
            <InputNumber
              id="schedule-issue-number"
              min={1}
              precision={0}
              placeholder="输入期号"
              value={draft.issueNumber}
              onChange={(value) => setDraft((prev) => ({ ...prev, issueNumber: value ?? null }))}
              style={{ width: 150 }}
            />
          </div>
          <div className="sched-field">
            <label htmlFor="schedule-status">出刊状态</label>
            <Select<StatusFilterValue>
              id="schedule-status"
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
        <div className="sched-count" aria-live="polite">
          {scheduleQuery.isError ? '刊期数据加载失败' : scheduleQuery.isLoading ? '正在加载刊期数据…' : <>
            共 <b>{filteredRows.length}</b> 条记录 · 已出刊 {filteredProgress.publishedCount} 期 · 未出刊 {filteredProgress.unpublishedCount} 期 · 休刊 {filteredProgress.suspendedCount} 次
          </>}
        </div>
      </Card>

      {/* 全年排期矩阵 */}
      {scheduleQuery.isError ? null : !hasData && !scheduleQuery.isLoading ? (
        <Card><Alert type="info" showIcon title="暂无该年份刊期表" /></Card>
      ) : filteredRows.length === 0 && !scheduleQuery.isLoading ? (
        <Card><Alert type="info" showIcon title="当前筛选条件下暂无刊期记录" /></Card>
      ) : (
        <Card className="sched-matrix-card" styles={{ body: { padding: 16 } }} loading={scheduleQuery.isLoading}>
          <div className="sched-matrix-heading">
            <div className="sched-matrix-title">{year} 年全年排期矩阵</div>
            <div className="sched-legend">
              <span><span className="sched-swatch published" />已出刊</span>
              <span><span className="sched-swatch" />未出刊</span>
              <span><span className="sched-swatch next" />下一期</span>
              <span><span className="sched-swatch rest" />休刊</span>
            </div>
          </div>
          <div className="sched-matrix-wrap">
            <table className="sched-matrix" aria-label="全年排期矩阵">
              <thead>
                <tr>
                  <th className="col-month">月份</th>
                  {weekColumns.map((i) => (
                    <th key={i} className="col-issue">第 {i + 1} 期</th>
                  ))}
                  <th className="col-state">月度进度</th>
                </tr>
              </thead>
              <tbody>
                {filteredMonthGroups.map((group) => {
                  const progress = monthProgress[group.month - 1];
                  return (
                    <tr key={group.month}>
                      <td className="mx-month">{group.month} 月</td>
                      {weekColumns.map((i) => (
                        <td key={i} className="mx-td">{renderMatrixCell(group.rows[i], today, nextIssue?.id)}</td>
                      ))}
                      <td className="mx-state-td">
                        <div className="mx-month-progress">
                          <span>已出 {progress.publishedCount} / 共 {progress.plannedCount}</span>
                          <PublicationProgress published={progress.publishedCount} planned={progress.plannedCount} />
                          {progress.suspendedCount > 0 && <span className="sched-note">含 {progress.suspendedCount} 次休刊</span>}
                          {progress.mismatchCount > 0 && <span className="mx-adjustment-count">{progress.mismatchCount} 期版数调整</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sched-note sched-matrix-note">月度进度按整月统计；“未录入印数”仅表示缺少印数记录，不影响按刊期计算的出刊进度。</div>
        </Card>
      )}
    </div>
  );
}
