import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, within, waitFor } from 'storybook/test'
import { IssueDeleteConfirmButton } from './IssueDeleteConfirmButton'

const meta = {
  title: '业务组件/IssueDeleteConfirmButton',
  component: IssueDeleteConfirmButton,
  parameters: {
    docs: {
      description: {
        component:
          '整期删除的「强确认」按钮：点击后弹出二次确认弹窗，必须输入正确的期号才能点「确认删除整期」，用于防止误删整期数据。',
      },
    },
  },
  args: {
    issueNumber: 2652,
    // fn() 会生成一个 spy，play 函数里可断言它被调用
    onConfirm: fn(async () => {}),
  },
  argTypes: {
    onConfirm: { table: { disable: true } },
  },
} satisfies Meta<typeof IssueDeleteConfirmButton>

export default meta
type Story = StoryObj<typeof meta>

// 默认：仅展示触发按钮（可手动点击体验弹窗各状态）
export const Default: Story = {}

// 自定义按钮文案
export const CustomText: Story = {
  args: { buttonText: '删除整期' },
}

// 交互测试（UT）：打开弹窗 → 确认禁用 → 输错仍禁用 → 输对启用 → 确认触发回调 → 弹窗关闭
export const ConfirmFlow: Story = {
  name: '交互：完整确认流程',
  play: async ({ canvas, userEvent, args }) => {
    // 1) 点击触发按钮，打开确认弹窗
    await userEvent.click(canvas.getByRole('button', { name: /删除/ }))

    // 弹窗渲染在 document.body 的 portal 里，要在 body 范围内查找
    const body = within(document.body)
    const dialog = await body.findByRole('dialog')
    const scope = within(dialog)

    const okButton = scope.getByRole('button', { name: '确认删除整期' })
    const input = scope.getByPlaceholderText('输入 2652 确认删除')

    // 2) 初始：期号未输入 → 确认按钮禁用
    await expect(okButton).toBeDisabled()

    // 3) 输入错误期号 → 仍禁用
    await userEvent.type(input, '9999')
    await expect(okButton).toBeDisabled()

    // 4) 改为正确期号 → 启用
    await userEvent.clear(input)
    await userEvent.type(input, '2652')
    await expect(okButton).toBeEnabled()

    // 5) 点击确认 → onConfirm 被调用一次
    await userEvent.click(okButton)
    await expect(args.onConfirm).toHaveBeenCalledTimes(1)

    // 6) 弹窗关闭
    await waitFor(() => expect(dialog).not.toBeVisible())
  },
}
