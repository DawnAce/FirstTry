import { Layout, Menu } from '@arco-design/web-react';
import { IconDashboard, IconUser, IconHistory } from '@arco-design/web-react/icon';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';

const { Sider, Header, Content } = Layout;
const MenuItem = Menu.Item;

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsed={false}
        style={{ width: 200 }}
      >
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontWeight: 'bold',
          fontSize: 16,
        }}>
          中国经营报
        </div>
        <Menu
          selectedKeys={[location.pathname]}
          onClickMenuItem={(key) => navigate(key)}
          theme="dark"
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
      </Sider>
      <Layout>
        <Header style={{
          background: '#fff',
          padding: '0 24px',
          fontSize: 18,
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #e8e8e8',
        }}>
          印数报数系统
        </Header>
        <Content style={{ margin: 24, padding: 24, background: '#fff', borderRadius: 8 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
