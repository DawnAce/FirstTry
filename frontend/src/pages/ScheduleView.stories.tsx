import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import dayjs from 'dayjs';
import type { ScheduleEntry } from '../api/schedule';
import { getBeijingDate } from './publicationScheduleUtils';
import ScheduleView from './ScheduleView';

const today = dayjs(getBeijingDate());
const year = today.year();
const schedule: ScheduleEntry[] = [-14, -7, 0, 4, 11, 18, 25].map((offset, index) => {
  const date = today.add(offset, 'day');
  return {
    id: index + 1, year: date.year(), publish_date: date.format('YYYY-MM-DD'),
    issue_number: index === 5 ? null : 9001 + index,
    is_suspended: index === 5,
    page_count: index === 5 ? null : 24,
    actual_page_count: index === 0 || index === 3 ? 24 : index === 1 ? 16 : null,
  };
});
const historical: ScheduleEntry[] = [
  { id: 101, year: 2024, issue_number: 2401, publish_date: '2024-01-01', is_suspended: false, page_count: 24, actual_page_count: null },
  { id: 102, year: 2024, issue_number: 2402, publish_date: '2024-01-08', is_suspended: false, page_count: null, actual_page_count: null },
  { id: 103, year: 2024, issue_number: null, publish_date: '2024-01-15', is_suspended: true, page_count: null, actual_page_count: null },
];
const future: ScheduleEntry[] = [
  { id: 201, year: year + 1, issue_number: 9101, publish_date: `${year + 1}-01-04`, is_suspended: false, page_count: 24, actual_page_count: null },
  { id: 202, year: year + 1, issue_number: 9102, publish_date: `${year + 1}-01-11`, is_suspended: false, page_count: 24, actual_page_count: null },
];
const yearsHandler = http.get('/api/schedule/years', () => HttpResponse.json([2024, year, year + 1]));
const scheduleHandler = http.get('/api/schedule', ({ request }) => {
  const selected = Number(new URL(request.url).searchParams.get('year'));
  return HttpResponse.json(selected === 2024 ? historical : selected === year + 1 ? future : schedule.filter(row => row.year === selected));
});

const meta = {
  title: '页面/发行计划/刊期表管理/期刊表',
  component: ScheduleView,
  tags: ['ai-generated'],
  parameters: {
    layout: 'fullscreen',
    msw: { handlers: [yearsHandler, scheduleHandler] },
    docs: { description: { component: '按北京时间出版日期显示出刊进度；计划版数与实际版数独立，历史刊期缺少印数记录时明确提示。所有数据均为合成样例。' } },
  },
} satisfies Meta<typeof ScheduleView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  name: '出刊进度与版数调整',
  play: async ({ canvas, canvasElement, userEvent }) => {
    await expect(await canvas.findByText('第 9003 期')).toBeVisible();
    await expect(canvas.getByText('已出刊（按刊期）')).toBeVisible();
    await expect(canvas.getByText('未录入印数')).toBeVisible();
    const next = schedule.find(row => row.year === year && row.publish_date > today.format('YYYY-MM-DD'));
    if (next) {
      const issueLabel = `第 ${next.issue_number} 期`;
      const cell = canvas.getByText(issueLabel).closest('td')!;
      const column = Array.from(cell.parentElement!.children).indexOf(cell);
      await userEvent.click(canvas.getByRole('combobox', { name: '出刊状态' }));
      await userEvent.click(await within(document.body).findByText('未出刊', { selector: '.ant-select-item-option-content' }));
      await userEvent.click(canvas.getByRole('button', { name: /查.*询/ }));
      await waitFor(() => expect(canvasElement.querySelectorAll('.mx-cell.published')).toHaveLength(0));
      expect(canvasElement.querySelectorAll('.mx-cell.rest')).toHaveLength(0);
      const filteredCell = canvas.getByText(issueLabel).closest('td')!;
      expect(Array.from(filteredCell.parentElement!.children).indexOf(filteredCell)).toBe(column);
      expect(canvasElement.querySelectorAll('.mx-cell.next')).toHaveLength(1);
      await userEvent.click(canvas.getByRole('button', { name: /重.*置/ }));
      await expect(await canvas.findByText('未录入印数')).toBeVisible();
    }
  },
};

export const HistoricalScheduleOnly: Story = {
  name: '2024年仅有刊期表',
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByText('第 9003 期');
    await userEvent.click(canvas.getByRole('combobox', { name: '年份' }));
    await userEvent.click(await within(document.body).findByText('2024 年', { selector: '.ant-select-item-option-content' }));
    await expect(await canvas.findByText('第 2401 期')).toBeVisible();
    expect(canvas.getAllByText('已出刊（按刊期）')).toHaveLength(2);
    expect(canvas.getAllByText('未录入印数')).toHaveLength(2);
    expect(canvas.queryByText('实际 24 版')).not.toBeInTheDocument();
    await expect(canvas.getByText('暂无实际版数可对比')).toBeVisible();
    expect(canvasElement.querySelectorAll('.mx-cell.next')).toHaveLength(0);
    const adjustment = canvas.getByText('版数调整').closest('.ui-metric-card')!;
    expect(within(adjustment as HTMLElement).getByText('—')).toBeVisible();
  },
};

export const FutureScheduleOnly: Story = {
  name: '未来年度仅有计划',
  play: async ({ canvas, canvasElement, userEvent }) => {
    await canvas.findByText('第 9003 期');
    await userEvent.click(canvas.getByRole('combobox', { name: '年份' }));
    await userEvent.click(await within(document.body).findByText(`${year + 1} 年`, { selector: '.ant-select-item-option-content' }));
    await expect(await canvas.findByText('第 9101 期')).toBeVisible();
    expect(canvasElement.querySelectorAll('.mx-cell.published')).toHaveLength(0);
    expect(canvasElement.querySelectorAll('.mx-cell.unpublished')).toHaveLength(2);
    expect(canvasElement.querySelectorAll('.mx-cell.next')).toHaveLength(1);
    await expect(canvas.getByText('暂无实际版数可对比')).toBeVisible();
  },
};

export const DarkCompact: Story = {
  name: '暗色与紧凑密度',
  globals: { theme: 'dark', density: 'compact' },
};

export const Empty: Story = {
  name: '空状态',
  parameters: { msw: { handlers: [yearsHandler, http.get('/api/schedule', () => HttpResponse.json([]))] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('暂无该年份刊期表')).toBeVisible();
    expect(canvas.getAllByRole('button', { name: /暂无刊期/ })).toHaveLength(12);
    for (const month of canvas.getAllByRole('button', { name: /暂无刊期/ })) expect(month).toBeDisabled();
  },
};

export const LoadError: Story = {
  name: '加载失败',
  parameters: { msw: { handlers: [yearsHandler, http.get('/api/schedule', () => new HttpResponse(null, { status: 500 }))] } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('加载刊期表数据失败，请稍后重试')).toBeVisible();
    expect(canvas.queryByText('当前筛选条件下暂无刊期记录')).not.toBeInTheDocument();
  },
};

export const Loading: Story = {
  name: '加载中',
  parameters: { msw: { handlers: [yearsHandler, http.get('/api/schedule', async () => { await delay('infinite'); return HttpResponse.json([]); })] } },
};
