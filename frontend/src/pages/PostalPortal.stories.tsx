import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { PostalPortal } from './BusinessPortal'

const meta = {
  title: '页面/发行履约/邮局管理',
  component: PostalPortal,
  decorators: [withRouter],
  parameters: {
    reactRouter: reactRouterParameters({ routing: { path: '/business/fulfilment/postal' } }),
  },
} satisfies Meta<typeof PostalPortal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: '默认' }
