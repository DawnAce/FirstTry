import { Layout, Menu, Button, Space } from 'antd';
import { DashboardOutlined, UserOutlined, LogoutOutlined, CalendarOutlined } from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const { Sider, Content } = Layout;

const menuItems = [
  {
    key: 'print-management',
    icon: <DashboardOutlined />,
    label: '印数管理',
    children: [
      { key: '/', label: '印数报数' },
      { key: '/history', label: '历史期数' },
      { key: '/templates', label: '报数模板' },
    ],
  },
  { key: '/recipients', icon: <UserOutlined />, label: '物流管理' },
  {
    key: 'schedule-management',
    icon: <CalendarOutlined />,
    label: '刊期表管理',
    children: [
      { key: '/schedule', label: '期刊表' },
      { key: '/schedule/import', label: '导入期刊表' },
    ],
  },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Map sub-routes to their parent menu key
  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.startsWith('/report/') || path.startsWith('/shipping/') || path.startsWith('/history-import')) return '/';
    if (path.startsWith('/recipients')) return '/recipients';
    if (path.startsWith('/history')) return '/history';
    if (path === '/schedule/import') return '/schedule/import';
    if (path.startsWith('/schedule')) return '/schedule';
    if (path.startsWith('/templates')) return '/templates';
    return path;
  };

  // Auto-open the sub-menu that contains the current route
  const getOpenKeys = () => {
    const path = location.pathname;
    if (path === '/' || path.startsWith('/report/') || path.startsWith('/shipping/') || path.startsWith('/history-import') || path.startsWith('/history') || path.startsWith('/templates')) {
      return ['print-management'];
    }
    if (path.startsWith('/schedule')) {
      return ['schedule-management'];
    }
    return [];
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsed={false}
        width={240}
        style={{
          background: '#fff',
          borderRight: '1px solid rgba(0,0,0,0.06)',
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}>
          <div style={{
            height: 72,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '0 24px',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
          }}>
            <span style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#1d1d1f',
              letterSpacing: '-0.01em',
            }}>
              发行系统
            </span>
            <span style={{
              fontSize: 12,
              color: '#86868b',
              marginTop: 2,
            }}>
              中国经营报
            </span>
          </div>
          <div style={{ flex: 1, padding: '12px 8px', overflow: 'auto' }}>
            <Menu
              mode="inline"
              selectedKeys={[getSelectedKey()]}
              defaultOpenKeys={getOpenKeys()}
              onClick={({key}) => navigate(key)}
              items={menuItems}
            />
          </div>
          {/* User info pinned at bottom */}
          <div style={{
            flexShrink: 0,
            padding: '16px 24px',
            borderTop: '1px solid rgba(0,0,0,0.04)',
          }}>
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <span style={{ fontSize: 13, color: '#1d1d1f', fontWeight: 500 }}>
                {user?.username}
                <span style={{ fontSize: 11, color: '#86868b', marginLeft: 6 }}>
                  {user?.role === 'admin' ? '管理员' : '操作员'}
                </span>
              </span>
              <Button size="small" type="text" onClick={logout} style={{ padding: 0, color: '#86868b' }}>
                <LogoutOutlined /> 退出登录
              </Button>
            </Space>
          </div>
        </div>
      </Sider>
      <Layout>
        <Content style={{
          padding: 32,
          background: '#f5f5f7',
          minHeight: '100vh',
        }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
