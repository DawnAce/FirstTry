import dayjs from 'dayjs';
import type { ScheduleDraftRow, ScheduleEntry, ScheduleSummary } from '../api/schedule';

export interface ScheduleMonthGroup<T> {
  month: number;
  rows: T[];
}

type RowWithDate = { publish_date: string };

type IssueRange = Pick<ScheduleSummary, 'first_issue_number' | 'last_issue_number'>;

export type SchedulePublicationStatus = 'published' | 'unpublished' | 'suspended';

const beijingDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function getBeijingDate(now: Date = new Date()): string {
  return beijingDateFormatter.format(now);
}

export function getSchedulePublicationStatus(
  row: Pick<ScheduleEntry, 'is_suspended' | 'publish_date'>,
  today: string,
): SchedulePublicationStatus {
  if (row.is_suspended) return 'suspended';
  // 接口日期为 YYYY-MM-DD；出刊进度只看北京时间日期，不看印数工作流状态。
  return row.publish_date <= today ? 'published' : 'unpublished';
}

export function isPageCountMismatch(row: ScheduleEntry): boolean {
  return !row.is_suspended && row.actual_page_count != null && row.page_count != null
    && row.actual_page_count !== row.page_count;
}

export function summarizeScheduleProgress(rows: ScheduleEntry[], today: string) {
  const planned = rows.filter((row) => !row.is_suspended && row.issue_number !== null);
  const publishedCount = planned.filter((row) => getSchedulePublicationStatus(row, today) === 'published').length;
  return {
    plannedCount: planned.length,
    publishedCount,
    unpublishedCount: planned.length - publishedCount,
    suspendedCount: rows.filter((row) => row.is_suspended).length,
    actualCount: planned.filter((row) => row.actual_page_count != null).length,
    comparableCount: planned.filter((row) => row.actual_page_count != null && row.page_count != null).length,
    mismatchCount: planned.filter(isPageCountMismatch).length,
  };
}

export function findNextScheduledIssue(rows: ScheduleEntry[], today: string): ScheduleEntry | undefined {
  return rows
    .filter((row) => row.issue_number !== null && getSchedulePublicationStatus(row, today) === 'unpublished')
    .reduce<ScheduleEntry | undefined>((next, row) => !next || row.publish_date < next.publish_date ? row : next, undefined);
}

export function groupScheduleRowsByMonth<T extends RowWithDate>(rows: T[]): ScheduleMonthGroup<T>[] {
  const groups = new Map<number, T[]>();
  [...rows]
    .sort((a, b) => a.publish_date.localeCompare(b.publish_date))
    .forEach((row) => {
      const month = dayjs(row.publish_date).month() + 1;
      groups.set(month, [...(groups.get(month) ?? []), row]);
    });

  return Array.from(groups.entries()).map(([month, groupedRows]) => ({
    month,
    rows: groupedRows,
  }));
}

export function summarizeScheduleRows(rows: Array<ScheduleDraftRow | ScheduleEntry>): ScheduleSummary {
  const published = rows.filter((row) => !row.is_suspended && row.issue_number !== null);
  const issueNumbers = published.map((row) => Number(row.issue_number));
  return {
    total_rows: rows.length,
    published_count: published.length,
    suspended_count: rows.filter((row) => row.is_suspended).length,
    first_issue_number: issueNumbers.length > 0 ? Math.min(...issueNumbers) : null,
    last_issue_number: issueNumbers.length > 0 ? Math.max(...issueNumbers) : null,
  };
}

export function formatIssueRange(summary: IssueRange): string {
  return summary.first_issue_number === null || summary.last_issue_number === null
    ? '-'
    : `${summary.first_issue_number} - ${summary.last_issue_number}`;
}

export function rowHasError(row: ScheduleDraftRow, errors: string[]): boolean {
  return errors.some((error) => error.includes(row.publish_date));
}
