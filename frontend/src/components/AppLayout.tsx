import { useState } from 'react';
import { Layout, Menu, Input, Badge, Avatar, Dropdown, Tooltip } from 'antd';
import {
  HomeOutlined,
  BarChartOutlined,
  UserOutlined,
  CalendarOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
  QuestionCircleOutlined,
  LogoutOutlined,
  CarOutlined,
  FileTextOutlined,
  TeamOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import type { MenuProps } from 'antd';

const { Sider, Content, Header } = Layout;
const { Search } = Input;

const menuItems: MenuProps['items'] = [
  {
    key: '/dashboard',
    icon: <HomeOutlined />,
    label: '仪表盘',
    disabled: true,
  },
  {
    key: 'print-management',
    icon: <BarChartOutlined />,
    label: '印数管理',
    children: [
      { key: '/', label: '印数报数' },
      { key: '/history', label: '历史期数' },
      { key: '/templates', label: '报数模板' },
    ],
  },
  {
    key: '/recipients',
    icon: <CarOutlined />,
    label: '物流管理',
  },
  {
    key: 'schedule-management',
    icon: <CalendarOutlined />,
    label: '刊期表管理',
    children: [
      { key: '/schedule', label: '期刊表' },
      { key: '/schedule/import', label: '导入期刊表' },
    ],
  },
  {
    key: '/orders',
    icon: <FileTextOutlined />,
    label: '订单管理',
    disabled: true,
  },
  {
    key: '/customers',
    icon: <TeamOutlined />,
    label: '客户管理',
    disabled: true,
  },
  {
    key: '/contracts',
    icon: <FileTextOutlined />,
    label: '合同管理',
    disabled: true,
  },
  {
    key: '/finance',
    icon: <DollarOutlined />,
    label: '财务管理',
    disabled: true,
  },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

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

  const userMenuItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: logout,
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        collapsedWidth={64}
        className="app-sider"
      >
        <div className="app-sider-inner">
          {/* Logo */}
          <div className="app-sider-logo">
            <div className="app-sider-logo-icon">
              <BarChartOutlined style={{ fontSize: 20, color: '#fff' }} />
            </div>
            {!collapsed && (
              <div className="app-sider-logo-text">
                <span className="app-sider-logo-title">发行系统</span>
                <span className="app-sider-logo-subtitle">中国经营报</span>
              </div>
            )}
          </div>

          {/* Navigation menu */}
          <div className="app-sider-menu">
            <Menu
              mode="inline"
              selectedKeys={[getSelectedKey()]}
              defaultOpenKeys={getOpenKeys()}
              onClick={({ key }) => {
                if (!key.startsWith('/dashboard') && !key.startsWith('/orders') && !key.startsWith('/customers') && !key.startsWith('/contracts') && !key.startsWith('/finance')) {
                  navigate(key);
                }
              }}
              items={menuItems}
            />
          </div>

          {/* User info at bottom */}
          <div className="app-sider-footer">
            <Dropdown menu={{ items: userMenuItems }} placement="topRight" trigger={['click']}>
              <div className="app-sider-user">
                <Avatar size={32} icon={<UserOutlined />} style={{ background: 'var(--color-accent)', flexShrink: 0 }} />
                {!collapsed && (
                  <div className="app-sider-user-info">
                    <span className="app-sider-user-name">{user?.username}</span>
                    <span className="app-sider-user-role">
                      {user?.role === 'admin' ? '管理员' : '操作员'}
                    </span>
                  </div>
                )}
              </div>
            </Dropdown>
          </div>
        </div>
      </Sider>

      <Layout>
        {/* Top navigation bar */}
        <Header className="app-header">
          <div className="app-header-left">
            <button
              className="app-header-trigger"
              onClick={() => setCollapsed(!collapsed)}
              aria-label={collapsed ? '展开菜单' : '收起菜单'}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </button>
            <Search
              placeholder="搜索期数、报刊、状态"
              className="app-header-search"
              allowClear
              onSearch={() => {}}
            />
          </div>

          <div className="app-header-right">
            <Tooltip title="通知">
              <Badge count={0} overflowCount={99}>
                <button className="app-header-icon-btn" aria-label="通知">
                  <BellOutlined />
                </button>
              </Badge>
            </Tooltip>
            <Tooltip title="帮助">
              <button className="app-header-icon-btn" aria-label="帮助">
                <QuestionCircleOutlined />
              </button>
            </Tooltip>
            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
              <div className="app-header-user">
                <Avatar size={32} icon={<UserOutlined />} style={{ background: 'var(--color-accent)' }} />
                <div className="app-header-user-text">
                  <span className="app-header-user-name">{user?.username}</span>
                  <span className="app-header-user-role">
                    {user?.role === 'admin' ? '管理员' : '操作员'}
                  </span>
                </div>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
