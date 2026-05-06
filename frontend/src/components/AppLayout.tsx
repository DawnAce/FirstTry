import { Layout, Menu } from '@arco-design/web-react';
import { IconDashboard, IconUser, IconHistory } from '@arco-design/web-react/icon';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const { Sider, Content } = Layout;
const MenuItem = Menu.Item;

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

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
            selectedKeys={[location.pathname]}
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
          </Menu>
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
