import dayjs from 'dayjs';
import type { ScheduleDraftRow, ScheduleEntry, ScheduleSummary } from '../api/schedule';

export interface ScheduleMonthGroup<T> {
  month: number;
  rows: T[];
}

type RowWithDate = { publish_date: string };

type IssueRange = Pick<ScheduleSummary, 'first_issue_number' | 'last_issue_number'>;

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
