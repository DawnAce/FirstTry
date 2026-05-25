import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './client';
import { commitScheduleUpload, updateScheduleUploadRows } from './schedule';

vi.mock('./client', () => ({
  default: {
    post: vi.fn(),
    put: vi.fn(),
  },
}));

describe('commitScheduleUpload', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
  });

  it('posts to the commit endpoint without client-supplied rows', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 12 } });

    await commitScheduleUpload(12);

    expect(api.post).toHaveBeenCalledWith('/schedule/uploads/12/commit', null, { params: undefined });
  });

  it('puts edited preview rows to the upload rows endpoint', async () => {
    const rows = [{ publish_date: '2025-01-06', issue_number: 2586, is_suspended: false }];
    vi.mocked(api.put).mockResolvedValue({ data: { rows } });

    await updateScheduleUploadRows(12, rows);

    expect(api.put).toHaveBeenCalledWith('/schedule/uploads/12/rows', { rows });
  });
});