import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import { expect } from 'storybook/test'
import { withRouter } from 'storybook-addon-remix-react-router'
import HistoryImport from './HistoryImport'

const preview = {
  issue_number: 2635,
  shipping_issue_source: '每周合计!B1',
  publish_date: '2026-01-05',
  page_count: 24,
  report_entry_count: 31,
  temp_detail_count: 0,
  shipping_detail_count: 83,
  shipping_fixed_detail_count: 3,
  shipping_fixed_quantity: 30,
  shipping_resulting_detail_count: 86,
  shipping_resulting_quantity: 1569,
  readiness: {
    same_issue: true,
    issue_exists: false,
    can_commit: true,
    errors: [],
  },
  errors: [],
  warnings: [],
  can_commit: true,
  import_session_id: 'history-import-preview-2635',
  manual_temp_print_required_quantity: 0,
  manual_temp_print_self_quantity: 0,
  manual_temp_rows: [],
  report_rows: [],
  source_total: 6000,
  mapped_total: 6000,
  unmapped_report_items: [],
  report_mapping_options: [],
}

const meta = {
  title: '页面/发行计划/印数管理/往期导入',
  component: HistoryImport,
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: '往期导入预览显示工作簿主期号及其权威来源页签和单元格。',
      },
    },
  },
} satisfies Meta<typeof HistoryImport>

export default meta
type Story = StoryObj<typeof meta>

export const OriginalWorkbookIssueSource: Story = {
  name: '原始中通主期号来源',
  parameters: {
    msw: {
      handlers: [
        http.post('/api/history-import/preview', () => HttpResponse.json(preview)),
      ],
    },
  },
  play: async ({ canvas, canvasElement, userEvent }) => {
    const inputs = canvasElement.querySelectorAll<HTMLInputElement>('input[type="file"]')
    if (inputs.length !== 2) throw new Error('未找到两处往期导入文件上传控件')

    const xlsxType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    await userEvent.upload(inputs[0], new File(['report'], '第2635期印数表.xlsx', { type: xlsxType }))
    await userEvent.upload(
      inputs[1],
      new File(['shipping'], '2026年1月5日《中国经营报》中通快递发货明细（2635）.xlsx', { type: xlsxType }),
    )
    await userEvent.click(canvas.getByRole('button', { name: '预览导入' }))

    await expect(await canvas.findByText('第 2635 期')).toBeVisible()
    await expect(await canvas.findByText('发货期号来源：每周合计!B1')).toBeVisible()
  },
}
