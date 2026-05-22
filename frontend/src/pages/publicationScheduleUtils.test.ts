import { describe, expect, it } from 'vitest';
import {
  formatIssueRange,
  groupScheduleRowsByMonth,
  rowHasError,
  summarizeScheduleRows,
} from './publicationScheduleUtils';

describe('publicationScheduleUtils', () => {
  it('groups schedule rows by month and sorts within each group', () => {
    const groups = groupScheduleRowsByMonth([
      { publish_date: '2026-02-09', issue_number: 2640, is_suspended: false },
      { publish_date: '2026-01-12', issue_number: 2636, is_suspended: false },
      { publish_date: '2026-01-05', issue_number: 2635, is_suspended: false },
    ]);

    expect(groups).toEqual([
      {
        month: 1,
        rows: [
          { publish_date: '2026-01-05', issue_number: 2635, is_suspended: false },
          { publish_date: '2026-01-12', issue_number: 2636, is_suspended: false },
        ],
      },
      {
        month: 2,
        rows: [
          { publish_date: '2026-02-09', issue_number: 2640, is_suspended: false },
        ],
      },
    ]);
  });

  it('summarizes published and suspended rows', () => {
    expect(summarizeScheduleRows([
      { publish_date: '2026-01-05', issue_number: 2635, is_suspended: false },
      { publish_date: '2026-02-16', issue_number: null, is_suspended: true },
      { publish_date: '2026-03-02', issue_number: 2641, is_suspended: false },
    ])).toEqual({
      total_rows: 3,
      published_count: 2,
      suspended_count: 1,
      first_issue_number: 2635,
      last_issue_number: 2641,
    });
  });

  it('formats issue ranges and uses a dash when either boundary is missing', () => {
    expect(formatIssueRange({ first_issue_number: 2635, last_issue_number: 2683 })).toBe('2635 - 2683');
    expect(formatIssueRange({ first_issue_number: null, last_issue_number: 2683 })).toBe('-');
    expect(formatIssueRange({ first_issue_number: 2635, last_issue_number: null })).toBe('-');
  });

  it('detects errors that mention a row date', () => {
    expect(rowHasError(
      { publish_date: '2026-02-16', issue_number: null, is_suspended: true },
      ['2026-02-16 是休刊行，不能填写期号'],
    )).toBe(true);
  });
});
