import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { expect } from 'storybook/test'
import AppLayout from './AppLayout'

// 已登录管理员的假登录态：AppLayout 读取 user（显示用户名/角色）与 logout。
const adminAuth = {
  user: { id: 1, username: '张编辑', role: 'admin' },
  isAdmin: true,
  isLoggedIn: true,
  setAuth: () => {},
  logout: () => {},
}

// AppLayout 是所有已登录路由的业务门户外壳（上下文 Sider + Header + Outlet）。
// 它依赖 react-router（useNavigate/useLocation/Outlet）与 AuthContext，
// 故 meta 里用 withRouter 注入路由、parameters.auth 注入假登录态。
const meta = {
  title: '设计系统/业务框架/应用框架',
  component: AppLayout,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({ routing: { path: '/' } }),
    auth: adminAuth,
    docs: {
      description: {
        component:
          '应用框架：左侧上下文导航 Sider + 顶部 Header + 内容区 Outlet。依赖路由与登录态，故用 withRouter 注入路由、parameters.auth 注入假登录态。',
      },
    },
  },
} satisfies Meta<typeof AppLayout>

export default meta
type Story = StoryObj<typeof meta>

// 已登录管理员：Sider logo「发行系统」、业务首页入口、Header 搜索/通知/帮助，用户名与「管理员」角色。
export const LoggedIn: Story = { name: '管理员' }

// 非管理员（操作员）：角色标签渲染为「操作员」。
export const Operator: Story = {
  name: '操作员',
  parameters: {
    auth: {
      ...adminAuth,
      user: { id: 2, username: '李操作', role: 'operator' },
      isAdmin: false,
    },
  },
}

// 发行履约下的邮局与快递使用同一套展开式树形导航，不再进入邮局中间页。
export const FulfilmentNavigation: Story = {
  name: '发行履约展开导航',
  parameters: {
    reactRouter: reactRouterParameters({
      location: { path: '/post-delivery/deliveries' },
      routing: { path: '/post-delivery/deliveries' },
    }),
  },
  play: async ({ canvas }) => {
    await expect((await canvas.findAllByText('发行履约')).length).toBeGreaterThan(0)
    await expect((await canvas.findAllByText('邮局管理')).length).toBeGreaterThan(0)
    await expect((await canvas.findAllByText('投递明细')).length).toBeGreaterThan(0)
    await expect(canvas.getByText('待续投')).toBeVisible()
    await expect(canvas.getByText('订报转投')).toBeVisible()
    await expect(canvas.getByText('邮局工单')).toBeVisible()
    await expect(canvas.getByText('快递管理')).toBeVisible()
    await expect(canvas.getByText('发货计划')).toBeVisible()
    await expect(canvas.getByText('实际发货')).toBeVisible()
    await expect(canvas.getByRole('menuitem', { name: /邮局管理/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('menuitem', { name: /快递管理/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('menuitem', { name: /投递明细/ })).toHaveClass('ant-menu-item-selected')
  },
}

export const FulfilmentCourierNavigation: Story = {
  name: '发行履约快递选中态',
  parameters: {
    reactRouter: reactRouterParameters({
      location: { path: '/logistics/shipments' },
      routing: { path: '/logistics/shipments' },
    }),
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('menuitem', { name: /邮局管理/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('menuitem', { name: /快递管理/ })).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByRole('menuitem', { name: /实际发货/ })).toHaveClass('ant-menu-item-selected')
  },
}

// 样式校验（全项目唯一 CssCheck）：断言 logo 标题解析出的 font-weight 为 700，
// 证明共享 preview 真正加载了 src/index.css（.app-sider-logo-title 规则），而非仅渲染了无样式 DOM。
export const CssCheck: Story = {
  name: '样式检查',
  play: async ({ canvas }) => {
    const title = canvas.getByText('发行系统')
    // .app-sider-logo-title { font-weight: 700 } —— src/index.css
    await expect(getComputedStyle(title).fontWeight).toBe('700')
  },
}
