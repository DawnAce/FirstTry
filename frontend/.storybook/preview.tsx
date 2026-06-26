import type { Preview, Decorator } from '@storybook/react-vite'
import { ConfigProvider, App as AntApp, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { initialize, mswLoader } from 'msw-storybook-addon'
import { AuthContext } from '../src/contexts/AuthContext'
// 加载项目全局样式：设计 token（--color-accent 等）与自定义样式，让组件与生产一致。
import '../src/index.css'

dayjs.locale('zh-cn')

// 启动 MSW；未被 story 显式 mock 的请求一律放行（不报错）。
initialize({ onUnhandledRequest: 'bypass' })

const { defaultAlgorithm, darkAlgorithm } = theme

// 单例 QueryClient：retry:false 让 loading / error 状态确定，beforeEach 清缓存避免 story 间串味。
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      gcTime: Infinity,
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  },
})

// antd：ConfigProvider(中文) + App（别名 AntApp，避免和项目 ./App 路由根重名）+ 亮暗主题
const withAntd: Decorator = (Story, context) => {
  const isDark = context.globals.theme === 'dark'
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ algorithm: isDark ? darkAlgorithm : defaultAlgorithm }}
    >
      <AntApp>
        <div style={{ padding: 24, minHeight: '100vh', background: isDark ? '#141414' : '#fff' }}>
          <Story />
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

const withQuery: Decorator = (Story) => (
  <QueryClientProvider client={queryClient}>
    <Story />
  </QueryClientProvider>
)

// 假登录态：story 通过 parameters.auth 注入；默认未登录。
const withAuth: Decorator = (Story, { parameters }) => {
  const auth = parameters.auth ?? {
    user: null,
    isAdmin: false,
    isLoggedIn: false,
    setAuth: () => {},
    logout: () => {},
  }
  return (
    <AuthContext.Provider value={auth}>
      <Story />
    </AuthContext.Provider>
  )
}

const preview: Preview = {
  // MSW 作为 loader 在渲染前启动；页面 story 用 parameters.msw.handlers 假造 /api 数据。
  loaders: [mswLoader],
  beforeEach: () => {
    queryClient.clear()
  },
  // 数组内：靠前=内层、靠后=外层 → 嵌套为 Auth > Antd > Query > Story。
  // 路由按页面在各自 meta 里用 withRouter 注入（每页有自己的路由参数）。
  decorators: [withQuery, withAntd, withAuth],
  globalTypes: {
    theme: {
      description: '主题（亮 / 暗）',
      defaultValue: 'light',
      toolbar: {
        title: '主题',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: '亮色' },
          { value: 'dark', icon: 'moon', title: '暗色' },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      // 'todo' - 仅在测试 UI 里展示无障碍问题；'error' - CI 失败；'off' - 跳过
      test: 'todo',
    },
  },
}

export default preview
