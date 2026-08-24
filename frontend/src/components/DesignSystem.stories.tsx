import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Alert, Button, Card, Input, Select, Space, Statistic, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { designTokens } from '../theme'

// 设计系统概览：把项目里复用的颜色 token、按钮与状态标签集中展示，
// 方便设计师 / PM / 开发在一个地方浏览统一的视觉规范。
const meta: Meta = {
  title: '设计系统/基础规范',
  parameters: {
    docs: {
      description: {
        component: '所有示例与业务页面共用同一套主题。可用顶部工具栏统一切换主题、密度和圆角。',
      },
    },
  },
}
export default meta
type Story = StoryObj

function Swatch({ name, variable, fallback }: { name: string; variable: string; fallback: string }) {
  return (
    <div style={{ width: 180 }}>
      <div
        style={{
          height: 64,
          borderRadius: 'var(--radius-input)',
          background: `var(${variable})`,
          border: '1px solid var(--color-border)',
        }}
      />
      <div style={{ marginTop: 8, fontWeight: 600 }}>{name}</div>
      <div style={{ color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: 12 }}>
        {variable} · {fallback}
      </div>
    </div>
  )
}

// 颜色 token 来自 src/theme.tsx；Storybook 与生产入口都通过 DesignSystemProvider 使用它们。
export const Colors: Story = {
  name: '颜色',
  render: () => (
    <div>
      <Typography.Title level={4}>基础颜色</Typography.Title>
      <Space size={24} wrap>
        <Swatch name="品牌色" variable="--color-accent" fallback={designTokens.color.brand} />
        <Swatch name="页面背景" variable="--color-bg" fallback={designTokens.color.background} />
        <Swatch name="容器背景" variable="--color-card" fallback={designTokens.color.surface} />
        <Swatch name="弱背景" variable="--color-bg-subtle" fallback={designTokens.color.subtle} />
        <Swatch name="主文字" variable="--color-text-primary" fallback={designTokens.color.textPrimary} />
        <Swatch name="次文字" variable="--color-text-secondary" fallback={designTokens.color.textSecondary} />
      </Space>

      <Typography.Title level={4} style={{ marginTop: 32 }}>
        语义色
      </Typography.Title>
      <Space size={24} wrap>
        <Swatch name="成功" variable="--color-success" fallback={designTokens.color.success} />
        <Swatch name="提醒" variable="--color-warning" fallback={designTokens.color.warning} />
        <Swatch name="危险" variable="--color-danger" fallback={designTokens.color.danger} />
        <Swatch name="辅助紫" variable="--color-purple" fallback={designTokens.color.purple} />
      </Space>
    </div>
  ),
}

export const ThemeWorkbench: Story = {
  name: '主题工作台',
  render: () => (
    <Space orientation="vertical" size="large" style={{ width: '100%' }}>
      <div>
        <Typography.Title level={2} style={{ marginBottom: 4 }}>发行系统 UI 工作台</Typography.Title>
        <Typography.Text type="secondary">从顶部工具栏切换亮暗、密度和圆角，下面以及所有页面 Story 会同步变化。</Typography.Text>
      </div>
      <Space size="middle" wrap>
        <Card><Statistic title="本期发行" value={128600} suffix="份" /></Card>
        <Card><Statistic title="待处理" value={12} styles={{ content: { color: 'var(--color-warning)' } }} /></Card>
        <Card><Statistic title="异常" value={3} styles={{ content: { color: 'var(--color-danger)' } }} /></Card>
      </Space>
      <Card title="常用控件">
        <Space wrap>
          <Input placeholder="输入关键词" style={{ width: 220 }} />
          <Select defaultValue="all" style={{ width: 140 }} options={[{ value: 'all', label: '全部状态' }]} />
          <Button type="primary">主要操作</Button>
          <Button>次要操作</Button>
          <Button danger>危险操作</Button>
        </Space>
      </Card>
      <Alert showIcon type="info" title="信息提示" description="业务信息使用语义色，不再在页面里单独定义色值。" />
    </Space>
  ),
}

// 按钮：项目里常见的几种用法
export const Buttons: Story = {
  name: '按钮',
  render: () => (
    <Space orientation="vertical" size={16}>
      <Space size={16} wrap>
        <Button type="primary" icon={<ReloadOutlined />}>
          重新生成
        </Button>
        <Button icon={<DownloadOutlined />}>导出</Button>
        <Button danger icon={<DeleteOutlined />}>
          删除
        </Button>
        <Button type="primary" loading>
          提交中
        </Button>
        <Button type="primary" disabled>标记每月两次合寄</Button>
        <Button disabled>不可用</Button>
      </Space>
      <div className="ant-modal" style={{ position: 'static', width: 'fit-content', paddingBottom: 0 }}>
        <div className="ant-modal-footer">
          <Button type="primary" disabled>弹窗确认</Button>
        </div>
      </div>
    </Space>
  ),
  play: async ({ canvas, globals }) => {
    const enabledPrimaryButton = await canvas.findByRole('button', { name: /重新生成/ })
    await expect(getComputedStyle(enabledPrimaryButton).color).toBe('rgb(255, 255, 255)')
    const disabledPrimaryButton = await canvas.findByRole('button', { name: '标记每月两次合寄' })
    await expect(disabledPrimaryButton).toBeDisabled()
    await expect(getComputedStyle(disabledPrimaryButton).backgroundColor).not.toBe('rgb(0, 113, 227)')
    await expect(getComputedStyle(disabledPrimaryButton).color)
      .not.toBe(getComputedStyle(disabledPrimaryButton).backgroundColor)
    const disabledModalButton = await canvas.findByRole('button', { name: '弹窗确认' })
    await expect(disabledModalButton).toBeDisabled()
    await expect(getComputedStyle(disabledModalButton).backgroundImage).toBe('none')
    if (globals.theme === 'dark') {
      await expect(getComputedStyle(disabledModalButton.closest('.ant-modal-footer')!).backgroundColor)
        .not.toBe('rgb(255, 255, 255)')
    }
  },
}

export const ButtonsDark: Story = {
  ...Buttons,
  name: '按钮（暗色）',
  globals: { theme: 'dark' },
}

// 状态标签：发货明细里按收件人类型着色
export const StatusTags: Story = {
  name: '标签',
  render: () => (
    <Space size={12} wrap>
      <Tag color="blue">对公</Tag>
      <Tag color="green">读者</Tag>
      <Tag color="orange">样报</Tag>
    </Space>
  ),
}

// 一个最小的表格示例，展示中文 locale 下的分页文案等
export const SampleTable: Story = {
  name: '表格',
  render: () => (
    <Table
      size="middle"
      rowKey="id"
      pagination={{ pageSize: 5 }}
      columns={[
        { title: '序号', dataIndex: 'id', width: 80 },
        { title: '收件人', dataIndex: 'name' },
        { title: '份数', dataIndex: 'qty', width: 100 },
        {
          title: '类型',
          dataIndex: 'type',
          width: 100,
          render: (t: string) => {
            const map: Record<string, { c: string; l: string }> = {
              corporate: { c: 'blue', l: '对公' },
              reader: { c: 'green', l: '读者' },
              sample: { c: 'orange', l: '样报' },
            }
            const v = map[t]
            return <Tag color={v.c}>{v.l}</Tag>
          },
        },
      ]}
      dataSource={[
        { id: 1, name: '张三', qty: 12, type: 'corporate' },
        { id: 2, name: '李四', qty: 3, type: 'reader' },
        { id: 3, name: '王五', qty: 1, type: 'sample' },
      ]}
    />
  ),
}
