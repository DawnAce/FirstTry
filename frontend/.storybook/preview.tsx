import type { Preview, Decorator } from '@storybook/react-vite'
import { ConfigProvider, App as AntApp, theme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
// 加载项目全局样式：设计 token（--color-accent 等）与 AppLayout/表格等自定义样式，
// 让 Storybook 里的组件与生产环境一致。
import '../src/index.css'

dayjs.locale('zh-cn')

const { defaultAlgorithm, darkAlgorithm } = theme

// 全局 decorator：每个 story 都包进 ConfigProvider(中文) → antd App。
// 注意 antd 的 App 与项目里的 ./App（路由根）重名，这里别名为 AntApp。
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

const preview: Preview = {
  decorators: [withAntd],
  // 工具栏里的亮/暗主题切换（值是字符串，decorator 再映射到 antd algorithm）
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
      // 'todo' - 仅在测试 UI 里展示无障碍问题
      // 'error' - CI 上无障碍问题直接失败
      // 'off'   - 完全跳过无障碍检查
      test: 'todo',
    },
  },
}

export default preview
