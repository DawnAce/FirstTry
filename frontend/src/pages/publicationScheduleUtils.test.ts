import { describe, expect, it } from 'vitest';
import {
  formatIssueRange,
  groupScheduleRowsByMonth,
  rowHasError,
  summarizeScheduleRows,
  getBeijingDate,
  getSchedulePublicationStatus,
  summarizeScheduleProgress,
  findNextScheduledIssue,
} from './publicationScheduleUtils';
import type { ScheduleEntry } from '../api/schedule';

const entry = (overrides: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: 1,
  year: 2026,
  issue_number: 2668,
  publish_date: '2026-09-07',
  is_suspended: false,
  page_count: 24,
  actual_page_count: null,
  ...overrides,
});

describe('publicationScheduleUtils', () => {
  it('uses the Beijing calendar date across midnight and the year boundary', () => {
    expect(getBeijingDate(new Date('2026-09-09T15:59:59Z'))).toBe('2026-09-09');
    expect(getBeijingDate(new Date('2026-09-09T16:00:00Z'))).toBe('2026-09-10');
    expect(getBeijingDate(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });

  it('classifies past, same-day and future dates independently of print records', () => {
    expect(getSchedulePublicationStatus(entry({ publish_date: '2024-01-01' }), '2026-09-10')).toBe('published');
    expect(getSchedulePublicationStatus(entry({ publish_date: '2026-09-10' }), '2026-09-10')).toBe('published');
    expect(getSchedulePublicationStatus(entry({ publish_date: '2026-09-14', actual_page_count: 24 }), '2026-09-10')).toBe('unpublished');
    expect(getSchedulePublicationStatus(entry({ is_suspended: true }), '2026-09-10')).toBe('suspended');
  });

  it('keeps calendar progress separate from missing or partial page-count comparisons', () => {
    const rows = [
      entry(),
      entry({ id: 2, publish_date: '2026-09-14', actual_page_count: 16 }),
      entry({ id: 3, publish_date: '2026-09-21', page_count: null, actual_page_count: 24 }),
      entry({ id: 4, is_suspended: true, issue_number: null, actual_page_count: 16 }),
    ];
    expect(summarizeScheduleProgress(rows, '2026-09-10')).toEqual({
      plannedCount: 3, publishedCount: 1, unpublishedCount: 2, suspendedCount: 1,
      actualCount: 2, comparableCount: 1, mismatchCount: 1,
    });
    expect(summarizeScheduleProgress([entry()], '2026-09-10')).toMatchObject({
      publishedCount: 1, actualCount: 0, comparableCount: 0, mismatchCount: 0,
    });
    expect(summarizeScheduleProgress([entry({ actual_page_count: 24 })], '2026-09-10')).toMatchObject({
      comparableCount: 1, mismatchCount: 0,
    });
  });

  it('handles empty and all-suspended years without inventing publication progress', () => {
    expect(summarizeScheduleProgress([], '2026-09-10')).toMatchObject({ plannedCount: 0, publishedCount: 0, unpublishedCount: 0, comparableCount: 0 });
    expect(summarizeScheduleProgress([entry({ is_suspended: true, issue_number: null })], '2026-09-10')).toMatchObject({ plannedCount: 0, publishedCount: 0, unpublishedCount: 0, suspendedCount: 1 });
  });

  it('selects the earliest future non-suspended issue even if rows are unsorted', () => {
    const next = entry({ id: 2, publish_date: '2026-09-14' });
    expect(findNextScheduledIssue([
      entry({ id: 4, publish_date: '2026-09-21' }),
      entry({ id: 3, publish_date: '2026-09-11', is_suspended: true, issue_number: null }),
      entry({ publish_date: '2026-09-10' }), next,
    ], '2026-09-10')).toBe(next);
    expect(findNextScheduledIssue([entry()], '2026-09-10')).toBeUndefined();
    expect(findNextScheduledIssue([], '2026-09-10')).toBeUndefined();
  });

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
