import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, Space, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons'

// 设计系统概览：把项目里复用的颜色 token、按钮与状态标签集中展示，
// 方便设计师 / PM / 开发在一个地方浏览统一的视觉规范。
const meta: Meta = {
  title: '设计系统/概览',
  parameters: {
    layout: 'fullscreen',
    options: { showPanel: false },
  },
}
export default meta
type Story = StoryObj

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ width: 160 }}>
      <div
        style={{
          height: 64,
          borderRadius: 8,
          background: value,
          border: '1px solid rgba(0,0,0,0.06)',
        }}
      />
      <div style={{ marginTop: 8, fontWeight: 600 }}>{name}</div>
      <div style={{ color: '#86868b', fontFamily: 'monospace', fontSize: 12 }}>{value}</div>
    </div>
  )
}

// 颜色 token（取自 src/index.css 与业务里的语义色）
export const Colors: Story = {
  render: () => (
    <div>
      <Typography.Title level={4}>品牌色</Typography.Title>
      <Space size={24} wrap>
        <Swatch name="accent" value="#0071e3" />
        <Swatch name="accent-hover" value="#0077ed" />
      </Space>

      <Typography.Title level={4} style={{ marginTop: 32 }}>
        收件人类型语义色
      </Typography.Title>
      <Space size={24} wrap>
        <Swatch name="对公 / blue" value="#1677ff" />
        <Swatch name="读者 / green" value="#52c41a" />
        <Swatch name="样报 / orange" value="#fa8c16" />
      </Space>
    </div>
  ),
}

// 按钮：项目里常见的几种用法
export const Buttons: Story = {
  render: () => (
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
      <Button disabled>不可用</Button>
    </Space>
  ),
}

// 状态标签：发货明细里按收件人类型着色
export const StatusTags: Story = {
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
