import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { expect } from 'storybook/test'
import History from './History'

const issues = [
  {
    id: 1,
    issue_number: 2650,
    year_issue_index: 1,
    year_issue_label: '1',
    publish_date: '2026-01-09',
    page_count: 16,
    planned_page_count: 16,
    status: 'draft',
    notes: null,
    created_at: '2026-01-05T09:00:00',
    updated_at: '2026-01-05T09:00:00',
    print_total: 128600,
  },
  {
    id: 2,
    issue_number: 2649,
    year_issue_index: 52,
    year_issue_label: '52',
    publish_date: '2025-12-26',
    page_count: 20,
    planned_page_count: 20,
    status: 'confirmed',
    notes: null,
    created_at: '2025-12-22T09:00:00',
    updated_at: '2025-12-23T10:00:00',
    print_total: 126800,
  },
] as const

const meta = {
  title: '页面/History（历史期数）',
  component: History,
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({ routing: { path: '/history' } }),
    msw: {
      handlers: [http.get('/api/issues', () => HttpResponse.json(issues))],
    },
  },
} satisfies Meta<typeof History>

export default meta
type Story = StoryObj<typeof meta>

export const Loaded: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('第 2650 期')).toBeVisible()
    await expect(await canvas.findByText('第 2649 期')).toBeVisible()
  },
}
