import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './client';
import {
  downloadIssueShippingExport,
  getIssueShippingExportFallbackFilename,
  getIssueShippingExportUrl,
  resolveDownloadFilename,
} from './exports';

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('getIssueShippingExportUrl', () => {
  it('builds the existing shipping export endpoint for an issue', () => {
    expect(getIssueShippingExportUrl(2649)).toBe('/api/issues/2649/export/shipping');
  });
});

describe('downloadIssueShippingExport', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('downloads through the authenticated api client as a blob', async () => {
    const blob = new Blob(['xlsx']);
    vi.mocked(api.get).mockResolvedValue({ data: blob });

    const response = await downloadIssueShippingExport(1);

    expect(response.data).toBe(blob);
    expect(api.get).toHaveBeenCalledWith('/issues/1/export/shipping', {
      responseType: 'blob',
    });
  });
});

describe('resolveDownloadFilename', () => {
  it('uses RFC 5987 encoded filename from content-disposition when present', () => {
    const filename = '2026年4月27日《中国经营报》中通快递发货明细（2649）.xlsx';
    const header = `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;

    expect(resolveDownloadFilename(header, 'fallback.xlsx')).toBe(filename);
  });

  it('falls back when content-disposition is missing a filename', () => {
    expect(resolveDownloadFilename('attachment', 'fallback.xlsx')).toBe('fallback.xlsx');
  });
});

describe('getIssueShippingExportFallbackFilename', () => {
  it('builds a readable fallback filename from the selected issue', () => {
    expect(
      getIssueShippingExportFallbackFilename({
        issue_number: 2649,
        publish_date: '2026-04-27',
      }),
    ).toBe('2026年4月27日《中国经营报》中通快递发货明细（2649）.xlsx');
  });
});
