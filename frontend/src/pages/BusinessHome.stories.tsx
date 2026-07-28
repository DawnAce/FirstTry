import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { BusinessHome } from './BusinessPortal'

const meta = {
  title: '页面/业务首页',
  component: BusinessHome,
  decorators: [withRouter],
  parameters: {
    reactRouter: reactRouterParameters({ routing: { path: '/' } }),
  },
} satisfies Meta<typeof BusinessHome>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: '默认' }
