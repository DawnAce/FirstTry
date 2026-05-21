import type { AxiosResponse } from 'axios';
import api from './client';

interface IssueShippingExportFilenameSource {
  issue_number: number;
  publish_date: string;
}

export const getIssueShippingExportUrl = (issueId: number) =>
  `/api/issues/${issueId}/export/shipping`;

export const getIssueShippingExportPath = (issueId: number) =>
  `/issues/${issueId}/export/shipping`;

export const downloadIssueShippingExport = (issueId: number): Promise<AxiosResponse<Blob>> =>
  api.get<Blob>(getIssueShippingExportPath(issueId), { responseType: 'blob' });

export const resolveDownloadFilename = (
  contentDisposition: string | null | undefined,
  fallback: string,
) => {
  if (!contentDisposition) return fallback;

  const encodedMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const plainMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1] ?? fallback;
};

export const getIssueShippingExportFallbackFilename = ({
  issue_number,
  publish_date,
}: IssueShippingExportFilenameSource) => {
  const date = new Date(publish_date);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日《中国经营报》中通快递发货明细（${issue_number}）.xlsx`;
};
