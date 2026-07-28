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
  title: '业务组件/AppLayout（应用框架）',
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
export const LoggedIn: Story = {}

// 非管理员（操作员）：角色标签渲染为「操作员」。
export const Operator: Story = {
  parameters: {
    auth: {
      ...adminAuth,
      user: { id: 2, username: '李操作', role: 'operator' },
      isAdmin: false,
    },
  },
}

// 样式校验（全项目唯一 CssCheck）：断言 logo 标题解析出的 font-weight 为 700，
// 证明共享 preview 真正加载了 src/index.css（.app-sider-logo-title 规则），而非仅渲染了无样式 DOM。
export const CssCheck: Story = {
  play: async ({ canvas }) => {
    const title = canvas.getByText('发行系统')
    // .app-sider-logo-title { font-weight: 700 } —— src/index.css
    await expect(getComputedStyle(title).fontWeight).toBe('700')
  },
}
