import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { BusinessCenterPortal } from './BusinessPortal'

const meta = {
  title: '页面/发行履约/发行履约',
  component: BusinessCenterPortal,
  decorators: [withRouter],
  parameters: {
    reactRouter: reactRouterParameters({
      location: { pathParams: { centerKey: 'fulfilment' } },
      routing: { path: '/business/:centerKey' },
    }),
  },
} satisfies Meta<typeof BusinessCenterPortal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { name: '默认' }
