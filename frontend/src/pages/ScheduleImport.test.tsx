import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { commitScheduleUpload, updateScheduleUploadRows } from '../api/schedule';
import type { SchedulePreview } from '../api/schedule';
import ScheduleImport from './ScheduleImport';

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
  updateScheduleUploadRows: vi.fn(),
  commitScheduleUpload: vi.fn(),
  discardScheduleUpload: vi.fn(),
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
    DatePicker: () => React.createElement('input', { type: 'date' }),
    InputNumber: () => React.createElement('input', { type: 'number' }),
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
    Switch: () => React.createElement('input', { type: 'checkbox' }),
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
  DeleteOutlined: () => <span />,
  InboxOutlined: () => <span />,
}));

describe('ScheduleImport', () => {
  beforeEach(() => {
    state.reactStateValues = [];
    state.reactSetters = [];
    state.invalidateQueries.mockReset();
    state.invalidateQueries.mockResolvedValue(undefined);
    state.popconfirmOnConfirm = undefined;
    vi.mocked(commitScheduleUpload).mockReset();
    vi.mocked(updateScheduleUploadRows).mockReset();
    vi.mocked(message.success).mockReset();
    vi.mocked(message.error).mockReset();
  });

  afterEach(() => {
    state.isAdmin = false;
  });

  it('shows admin warning to non-admin users inside the upload card', () => {
    state.isAdmin = false;

    const html = renderToString(<ScheduleImport />);

    expect(html).toContain('仅管理员可上传刊期 PDF');
  });

  it('shows the PDF upload dragger to admin users', () => {
    state.isAdmin = true;

    const html = renderToString(<ScheduleImport />);

    expect(html).toContain('上传 PDF 预览');
    expect(html).not.toContain('仅管理员可上传刊期 PDF');
  });

  it('shows the confirm save action to admins when a preview exists', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf', null];

    const html = renderToString(<ScheduleImport />);

    expect(html).toContain('确认保存');
    expect(html).toContain('确认保存后将更新 2026 年的正式刊期表');  });

  it('does not show the confirm save action to non-admin users', () => {
    state.isAdmin = false;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf', null];

    const html = renderToString(<ScheduleImport />);

    expect(html).not.toContain('确认保存');
  });

  it('disables the confirm save action when preview cannot be committed', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, { ...preview, can_commit: false }, false, false, null, 'schedule.pdf', null];

    const html = renderToString(<ScheduleImport />);

    expect(html).toContain('<button disabled="">确认保存</button>');
  });

  it('shows manual correction controls when a preview exists', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf', null, preview.rows, false];

    const html = renderToString(<ScheduleImport />);

    expect(html).toContain('新增一行');
    expect(html).toContain('应用手动修正并重新校验');
  });

  it('disables upload and year selection while committing a preview', () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, true, null, 'schedule.pdf', null];

    const html = renderToString(<ScheduleImport />);

    expect(html).toContain('data-testid="schedule-upload-dragger" data-disabled="true"');
    expect(html).toContain('<select disabled=""></select>');
  });

  it('commits preview rows and clears preview state after confirmation succeeds', async () => {
    state.isAdmin = true;
    state.reactStateValues = [2026, preview, false, false, null, 'schedule.pdf', null];
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

    renderToString(<ScheduleImport />);
    await state.popconfirmOnConfirm?.();

    expect(commitScheduleUpload).toHaveBeenCalledWith(preview.upload_id, null);
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['schedule', preview.year] });
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['scheduleUploads', preview.year] });
    expect(state.reactSetters[0]).toHaveBeenCalledWith(preview.year);
    expect(state.reactSetters[1]).toHaveBeenCalledWith(null);
    expect(state.reactSetters[4]).toHaveBeenCalledWith(null);
    expect(state.reactSetters[5]).toHaveBeenCalledWith(null);
    expect(state.reactSetters[6]).toHaveBeenCalledWith(null);
    expect(message.success).toHaveBeenCalledWith('2026 年刊期表已保存');
  });
});
