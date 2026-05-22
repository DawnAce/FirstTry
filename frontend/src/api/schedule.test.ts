import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from './client';
import { commitScheduleUpload } from './schedule';

vi.mock('./client', () => ({
  default: {
    post: vi.fn(),
  },
}));

describe('commitScheduleUpload', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('posts to the commit endpoint without client-supplied rows', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 12 } });

    await commitScheduleUpload(12);

    expect(api.post).toHaveBeenCalledWith('/schedule/uploads/12/commit');
  });
});