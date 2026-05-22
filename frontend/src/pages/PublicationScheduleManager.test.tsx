import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PublicationScheduleManager from './PublicationScheduleManager';

const state = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: state.isAdmin }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'schedule' ? [] : [],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('../api/schedule', () => ({
  getSchedule: vi.fn(),
  getScheduleUploads: vi.fn(),
  previewScheduleUpload: vi.fn(),
}));

vi.mock('antd', async () => {
  const React = await import('react');
  const passthrough = ({ children, title, message, description }: {
    children?: React.ReactNode;
    title?: React.ReactNode;
    message?: React.ReactNode;
    description?: React.ReactNode;
  }) => React.createElement('div', null, title, message, description, children);

  return {
    Alert: passthrough,
    Card: passthrough,
    Col: passthrough,
    Row: passthrough,
    Select: () => React.createElement('div'),
    Space: passthrough,
    Statistic: ({ title, value, suffix }: {
      title?: React.ReactNode;
      value?: React.ReactNode;
      suffix?: React.ReactNode;
    }) => React.createElement('div', null, title, value, suffix),
    Table: () => React.createElement('div'),
    Tag: passthrough,
    Typography: { Text: passthrough },
    Upload: Object.assign(passthrough, {
      Dragger: passthrough,
      LIST_IGNORE: 'LIST_IGNORE',
    }),
    message: { error: vi.fn(), success: vi.fn() },
  };
});

vi.mock('@ant-design/icons', () => ({
  InboxOutlined: () => <span />,
}));

describe('PublicationScheduleManager', () => {
  afterEach(() => {
    state.isAdmin = false;
  });

  it('hides the PDF upload preview card from non-admin users', () => {
    state.isAdmin = false;

    const html = renderToString(<PublicationScheduleManager />);

    expect(html).not.toContain('上传 PDF 预览');
  });

  it('shows the PDF upload preview card to admin users', () => {
    state.isAdmin = true;

    const html = renderToString(<PublicationScheduleManager />);

    expect(html).toContain('上传 PDF 预览');
  });
});
