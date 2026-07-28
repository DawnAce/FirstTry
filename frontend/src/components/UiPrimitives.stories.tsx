import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, Col, Row, Space } from 'antd'
import { CheckOutlined, ClockCircleOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import { expect, fn } from 'storybook/test'
import { MetricCard, PageHeader, StatusPill } from './UiPrimitives'

const onMetricClick = fn()

const meta: Meta = {
  title: '设计系统/通用模式',
}
export default meta
type Story = StoryObj

export const PageHeaders: Story = {
  name: '页面标题栏',
  render: () => (
    <PageHeader
      title="订单管理"
      description="管理订单全生命周期"
      actions={<><Button icon={<DownloadOutlined />}>导出</Button><Button type="primary" icon={<PlusOutlined />}>新增订单</Button></>}
    />
  ),
}

export const MetricCards: Story = {
  name: '指标卡片',
  render: () => (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}><MetricCard label="已创建报数" value={42} suffix="期" icon="📝" note="系统内全部期数" /></Col>
      <Col xs={24} md={8}><MetricCard label="待确认" value={3} suffix="期" icon={<ClockCircleOutlined />} tone="warning" note="需要尽快处理" noteTone="warning" /></Col>
      <Col xs={24} md={8}><MetricCard label="已完成" value={39} suffix="期" icon={<CheckOutlined />} tone="success" note="确认并锁定" /></Col>
    </Row>
  ),
}

export const Statuses: Story = {
  name: '语义状态',
  render: () => (
    <Space wrap>
      <StatusPill>默认</StatusPill>
      <StatusPill tone="info">处理中</StatusPill>
      <StatusPill tone="success">已完成</StatusPill>
      <StatusPill tone="warning">待确认</StatusPill>
      <StatusPill tone="danger">失败</StatusPill>
      <StatusPill tone="purple">已归档</StatusPill>
    </Space>
  ),
}

export const MetricInteraction: Story = {
  name: '指标卡键盘交互',
  render: () => <MetricCard label="待确认" value={3} suffix="期" tone="warning" onClick={onMetricClick} />,
  play: async ({ canvas, userEvent }) => {
    onMetricClick.mockClear()
    const card = canvas.getByRole('button')
    card.focus()
    await userEvent.keyboard('{Enter}')
    await expect(onMetricClick).toHaveBeenCalledOnce()
  },
}
