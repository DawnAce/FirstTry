import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import './index.css'
import App from './App'
import { DesignSystemProvider } from './theme'

dayjs.locale('zh-cn')

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Page navigation should reuse data that was just loaded by a portal or
      // sibling page. Mutations explicitly invalidate their domain keys.
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesignSystemProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </DesignSystemProvider>
  </React.StrictMode>,
)
