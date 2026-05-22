import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { commitScheduleUpload } from '../api/schedule';
import type { SchedulePreview } from '../api/schedule';
import PublicationScheduleManager from './PublicationScheduleManager';

const state = vi.hoisted(() => ({
  isAdmin: false,
  reactStateValues: [] as unknown[],
  reactSetters: [] as ReturnType<typeof vi.fn>[],
  invalidateQueries: vi.fn(),
  popconfirmOnConfirm: undefined as (() => Promise<void>) | undefined,
}));

const preview: SchedulePreview = {
  upload_id: 12,
  year: 2026,
  rows: [{ publish_date: '2026-01-02', issue_number: 1, is_suspended: false }],
  summary: {
    total_rows: 1,
    published_count: 1,
    suspended_count: 0,
    first_issue_number: 1,
    last_issue_number: 1,
  },
  errors: [],
  can_commit: true,
};

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: vi.fn((initialValue: unknown) => {
      const index = state.reactSetters.length;
      const setter = vi.fn();
      state.reactSetters.push(setter);
      return [
        index < state.reactStateValues.length ? state.reactStateValues[index] : initialValue,
        setter,
      ];
    }),
  };
});

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAdmin: state.isAdmin }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
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
  commitScheduleUpload: vi.fn(),
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
    Button: ({ children, disabled }: { children?: React.ReactNode; disabled?: boolean }) => (
      React.createElement('button', { disabled }, children)
    ),
    Card: passthrough,
    Col: passthrough,
    Popconfirm: ({
      children,
      title,
      description,
      onConfirm,
    }: {
      children?: React.ReactNode;
      title?: React.ReactNode;
      description?: React.ReactNode;
      onConfirm?: () => Promise<void>;
    }) => {
      state.popconfirmOnConfirm = onConfirm;
      return React.createElement('div', null, title, description, children);
    },
    Row: passthrough,
    Select: ({ disabled }: { disabled?: boolean }) => React.createElement('select', { disabled }),
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
      Dragger: ({ children, disabled }: { children?: React.ReactNode; disabled?: boolean }) => (
        React.createElement('div', { 'data-testid': 'schedule-upload-dragger', 'data-disabled': disabled ? 'true' : 'false' }, children)
      ),
      LIST_IGNORE: 'LIST_IGNORE',
    }),
    message: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
  };
});

vi.mock('@ant-design/icons', () => ({
  InboxOutlined: () => <span />,
}));

describe('PublicationScheduleManager', () => {
  beforeEach(() => {
    state.reactStateValues = [];
    state.reactSetters = [];
    state.invalidateQueries.mockReset();
    state.invalidateQueries.mockResolvedValue(undefined);
    state.popconfirmOnConfirm = undefined;
    vi.mocked(commitScheduleUpload).mockReset();
    vi.mocked(message.success).mockReset();
    vi.mocked(message.error).mockReset();
  });

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

  it('shows the confirm save action to admins when a preview exists', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf'];

    const html = renderToString(<PublicationScheduleManager />);

    expect(html).toContain('确认保存');
    expect(html).toContain('保存后将替换 2026 年正式刊期表');
  });

  it('does not show the confirm save action to non-admin users', () => {
    state.isAdmin = false;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf'];

    const html = renderToString(<PublicationScheduleManager />);

    expect(html).not.toContain('确认保存');
  });

  it('disables the confirm save action when preview cannot be committed', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, { ...preview, can_commit: false }, false, false, null, 'schedule.pdf'];

    const html = renderToString(<PublicationScheduleManager />);

    expect(html).toContain('<button disabled="">确认保存</button>');
  });

  it('disables upload and year selection while committing a preview', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, true, null, 'schedule.pdf'];

    const html = renderToString(<PublicationScheduleManager />);

    expect(html).toContain('data-testid="schedule-upload-dragger" data-disabled="true"');
    expect(html).toContain('<select disabled=""></select>');
  });

  it('commits preview rows and clears preview state after confirmation succeeds', async () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf'];
    const commitResponse = {
      data: {
        id: 12,
        year: 2026,
        original_filename: 'schedule.pdf',
        status: 'committed',
        summary_json: preview.summary,
        error_json: null,
        uploaded_by: 'admin',
        created_at: null,
        committed_at: null,
      },
    } as Awaited<ReturnType<typeof commitScheduleUpload>>;
    vi.mocked(commitScheduleUpload).mockResolvedValue(commitResponse);

    renderToString(<PublicationScheduleManager />);
    await state.popconfirmOnConfirm?.();

    expect(commitScheduleUpload).toHaveBeenCalledWith(preview.upload_id);
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['schedule', preview.year] });
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['scheduleUploads', preview.year] });
    expect(state.reactSetters[0]).toHaveBeenCalledWith(preview.year);
    expect(state.reactSetters[1]).toHaveBeenCalledWith(null);
    expect(state.reactSetters[4]).toHaveBeenCalledWith(null);
    expect(state.reactSetters[5]).toHaveBeenCalledWith(null);
    expect(message.success).toHaveBeenCalledWith('2026 年刊期表已保存');
  });
});
