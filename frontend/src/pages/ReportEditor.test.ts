import { describe, expect, it } from 'vitest';
import { formatIssueReportTitle } from './ReportEditor';

describe('formatIssueReportTitle', () => {
  it('includes the annual sequence label when the issue has one', () => {
    expect(
      formatIssueReportTitle({
        issue_number: 2648,
        publish_date: '2026-04-20',
        year_issue_label: '十四',
      }),
    ).toBe('2026年《中国经营报》第2648期 第十四期 报数表');
  });

  it('uses the publication year instead of a hardcoded year', () => {
    expect(
      formatIssueReportTitle({
        issue_number: 2700,
        publish_date: '2027-01-04',
        year_issue_label: '一',
      }),
    ).toBe('2027年《中国经营报》第2700期 第一期 报数表');
  });

  it('omits the annual sequence text when the label is unavailable', () => {
    expect(
      formatIssueReportTitle({
        issue_number: 2700,
        publish_date: '2027-01-04',
        year_issue_label: null,
      }),
    ).toBe('2027年《中国经营报》第2700期 报数表');
  });
});
