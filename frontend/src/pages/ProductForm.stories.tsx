import type { Meta, StoryObj } from '@storybook/react-vite'
import { Form } from 'antd'
import { expect, waitFor } from 'storybook/test'
import { ProductFormFields, type ProductFormValues } from './ProductForm'

// ProductFormFields 用 Form.useFormInstance / Form.useWatch，必须渲染在持有 form 实例的 <Form> 内。
function FormHarness({
  editing,
  initialValues,
}: {
  editing: boolean
  initialValues?: Partial<ProductFormValues>
}) {
  const [form] = Form.useForm<ProductFormValues>()
  return (
    <Form
      form={form}
      layout="vertical"
      style={{ maxWidth: 760 }}
      initialValues={{
        active: true,
        publication_format: 'paper',
        fulfillment_type: 'subscription',
        coverage_rule: 'term_from_month',
        billing_type: 'paid',
        ...initialValues,
      }}
    >
      <ProductFormFields editing={editing} />
    </Form>
  )
}

const meta = {
  title: '业务组件/ProductFormFields（商品表单字段）',
  component: ProductFormFields,
  tags: ['ai-generated'],
  args: { editing: false },
  parameters: {
    docs: {
      description: {
        component:
          '商品库共享的表单字段（创建/编辑 Modal 内复用）。is_bundle 开关切换「刊物/投递」与「套餐组件」Form.List。需置于持有 form 实例的 <Form> 内渲染。',
      },
    },
  },
} satisfies Meta<typeof ProductFormFields>

export default meta
type Story = StoryObj<typeof meta>

// 非套餐默认表单
export const Default: Story = {
  render: () => <FormHarness editing={false} />,
}

// 编辑态：商品编码输入被禁用（editing prop 锁住唯一编码）
export const Editing: Story = {
  render: () => (
    <FormHarness
      editing
      initialValues={{ code: 'CBJ-1Y-POST-WK', display_name: '中国经营报 · 全年订阅 · 邮局周投' }}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByPlaceholderText('如：CBJ-1Y-POST-WK')).toBeDisabled()
  },
}

// 套餐态：打开「是否套餐」开关 → Form.useWatch 触发条件渲染，出现「套餐组件」Form.List 与「加一个刊物」按钮。
// （antd v6 下 Form.useWatch 不反映 initialValues，故用真实开关交互驱动；按钮带图标，名用子串匹配。）
export const Bundle: Story = {
  render: () => <FormHarness editing={false} />,
  play: async ({ canvas, userEvent }) => {
    // 第一个 switch 是「是否套餐」（active 开关在其后）
    await userEvent.click(canvas.getAllByRole('switch')[0])
    await expect(await canvas.findByRole('button', { name: /加一个刊物/ })).toBeInTheDocument()
  },
}

// 套餐交互：开套餐 → 点「加一个刊物」追加一行组件（含「拿余额」勾选）
export const BundleAddComponent: Story = {
  render: () => <FormHarness editing={false} />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('switch')[0])
    await userEvent.click(await canvas.findByRole('button', { name: /加一个刊物/ }))
    await waitFor(() => expect(canvas.getByText('拿余额')).toBeInTheDocument())
  },
}
