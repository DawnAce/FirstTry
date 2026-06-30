import type { Meta, StoryObj } from '@storybook/react-vite'
import { withRouter, reactRouterParameters } from 'storybook-addon-remix-react-router'
import { http, HttpResponse } from 'msw'
import { expect, fn, within, waitFor } from 'storybook/test'
import Login from './Login'

// setAuth 间谍：play 里断言登录成功后被正确调用。模块级声明，各 story 共享、beforeEach 清空。
const setAuthSpy = fn()

const loggedOutAuth = {
  user: null,
  isAdmin: false,
  isLoggedIn: false,
  setAuth: setAuthSpy,
  logout: () => {},
}

const meta = {
  title: '页面/Login（登录）',
  component: Login,
  tags: ['ai-generated'],
  decorators: [withRouter],
  parameters: {
    layout: 'fullscreen',
    reactRouter: reactRouterParameters({ routing: { path: '/login' } }),
    auth: loggedOutAuth,
    docs: {
      description: {
        component:
          '登录页：用户名/密码表单，提交时 POST /api/auth/login。挂载时无网络请求；本 story 用 MSW 假造成功/失败响应，演示提交流程（含 setAuth 间谍断言）。',
      },
    },
  },
  beforeEach: () => {
    setAuthSpy.mockClear()
  },
} satisfies Meta<typeof Login>

export default meta
type Story = StoryObj<typeof meta>

// 静态渲染：登录卡片（标题 + 用户名/密码输入 + 登录按钮）。
export const Default: Story = {}

// 交互：填入账号密码 → 点登录 → MSW 返回 token → setAuth 被调用（id 固定为 0，见 Login.tsx）。
export const LoginSuccess: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/auth/login', () =>
          HttpResponse.json({
            access_token: 'fake-jwt-token-abc123',
            token_type: 'bearer',
            username: 'admin',
            role: 'admin',
          }),
        ),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByPlaceholderText('用户名'), 'admin')
    await userEvent.type(canvas.getByPlaceholderText('密码'), 'secret123')
    // antd v6 在两个中文字之间插入空格，按钮无障碍名实为「登 录」
    await userEvent.click(canvas.getByRole('button', { name: /登\s*录/ }))
    await waitFor(() =>
      expect(setAuthSpy).toHaveBeenCalledWith('fake-jwt-token-abc123', {
        id: 0,
        username: 'admin',
        role: 'admin',
      }),
    )
  },
}

// 交互：服务端返回 401 → 页面 message.error 显示后端 detail，且 setAuth 不被调用。
export const LoginFailure: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/auth/login', () =>
          HttpResponse.json({ detail: '用户名或密码错误' }, { status: 401 }),
        ),
      ],
    },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByPlaceholderText('用户名'), 'admin')
    await userEvent.type(canvas.getByPlaceholderText('密码'), 'wrongpass')
    await userEvent.click(canvas.getByRole('button', { name: /登\s*录/ }))
    // antd message 渲染在 document.body 的 portal 中
    await waitFor(() =>
      expect(within(document.body).getByText('用户名或密码错误')).toBeInTheDocument(),
    )
    expect(setAuthSpy).not.toHaveBeenCalled()
  },
}
