import { Layout, Menu, Button, Space } from '@arco-design/web-react';
import { IconDashboard, IconUser, IconHistory, IconSettings, IconExport } from '@arco-design/web-react/icon';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const { Sider, Content } = Layout;
const MenuItem = Menu.Item;

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Map sub-routes to their parent menu key
  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.startsWith('/report/') || path.startsWith('/shipping/')) return '/';
    if (path.startsWith('/recipients')) return '/recipients';
    if (path.startsWith('/history')) return '/history';
    if (path.startsWith('/templates')) return '/templates';
    return path;
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsed={false}
        width={240}
        style={{
          background: '#fff',
          borderRight: '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <div style={{
          height: 72,
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
            印数报数系统
          </span>
          <span style={{
            fontSize: 12,
            color: '#86868b',
            marginTop: 2,
          }}>
            中国经营报
          </span>
        </div>
        <div style={{ padding: '12px 8px' }}>
          <Menu
            selectedKeys={[getSelectedKey()]}
            onClickMenuItem={(key) => navigate(key)}
          >
            <MenuItem key="/">
              <IconDashboard /> 首页
            </MenuItem>
            <MenuItem key="/recipients">
              <IconUser /> 收件人管理
            </MenuItem>
            <MenuItem key="/history">
              <IconHistory /> 历史记录
            </MenuItem>
            <MenuItem key="/templates">
              <IconSettings /> 模板管理
            </MenuItem>
          </Menu>
        </div>
        {/* User info at bottom */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
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
            <Button size="mini" type="text" onClick={logout} style={{ padding: 0, color: '#86868b' }}>
              <IconExport /> 退出登录
            </Button>
          </Space>
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
