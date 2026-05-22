import type { Issue } from '../api/issues';

export function formatIssueReportTitle(issue: Pick<Issue, 'issue_number' | 'publish_date' | 'year_issue_label'>) {
  const yearIssuePart = issue.year_issue_label ? ` 第${issue.year_issue_label}期` : '';
  const publishYear = issue.publish_date.slice(0, 4);
  return `${publishYear}年《中国经营报》第${issue.issue_number}期${yearIssuePart} 报数表`;
}
