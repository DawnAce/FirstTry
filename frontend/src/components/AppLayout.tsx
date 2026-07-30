import { Layout, Menu, Badge, Avatar, Dropdown, Tooltip } from 'antd';
import {
  UserOutlined,
  BellOutlined,
  QuestionCircleOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GlobalSearch from './GlobalSearch';
import {
  findBusinessCenter,
  findBusinessModule,
  findPostalFunction,
  isPostalContext,
  postalFunctions,
} from '../businessPortalConfig';
import type { MenuProps } from 'antd';

const { Sider, Content, Header } = Layout;

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const pathname = location.pathname;
  const center = findBusinessCenter(pathname);
  const module = findBusinessModule(center, pathname);
  const postalContext = isPostalContext(pathname);
  const postalFunction = findPostalFunction(pathname);
  const isBusinessHome = pathname === '/';
  const isCenterPortal = center?.path === pathname;
  const isPostalPortal = pathname === '/business/fulfilment/postal';

  const menuItems: MenuProps['items'] = isBusinessHome
    ? [{ key: '/', icon: <span className="business-nav-emoji">🏠</span>, label: '业务首页' }]
    : postalContext
      ? postalFunctions.map((item) => ({ key: item.path, icon: <span className="business-nav-emoji">{item.icon}</span>, label: item.title }))
      : center?.modules.map((item) => ({ key: item.path, icon: <span className="business-nav-emoji">{item.icon}</span>, label: item.title })) ?? [];

  const selectedKeys = isBusinessHome
    ? ['/']
    : postalContext
      ? postalFunction ? [postalFunction.path] : []
      : !isCenterPortal && module ? [module.path] : [];

  const breadcrumbs: Array<{ label: string; path?: string }> = [{ label: '业务首页', path: isBusinessHome ? undefined : '/' }];
  if (center) breadcrumbs.push({ label: center.title, path: isCenterPortal ? undefined : center.path });
  if (postalContext) {
    breadcrumbs.push({ label: '邮局管理', path: isPostalPortal ? undefined : '/business/fulfilment/postal' });
    if (postalFunction) breadcrumbs.push({ label: postalFunction.title });
  } else if (module && !isCenterPortal) {
    breadcrumbs.push({ label: module.title });
  }

  const userMenuItems: MenuProps['items'] = [{ key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: logout }];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={252} className="app-sider">
        <div className="app-sider-inner">
          <button className="app-sider-logo" onClick={() => navigate('/')} aria-label="返回业务首页">
            <span className="app-sider-logo-icon">发</span>
            <span className="app-sider-logo-text">
              <span className="app-sider-logo-title">发行系统</span>
              <span className="app-sider-logo-subtitle">中国经营报</span>
            </span>
          </button>

          <div className="app-sider-menu">
            {!isBusinessHome && (
              <button className="business-nav-back" onClick={() => navigate(postalContext ? '/business/fulfilment' : '/')}>
                ← 返回{postalContext ? '发行履约' : '业务首页'}
              </button>
            )}
            {center && <div className="business-nav-caption">{postalContext ? '邮局管理' : center.title}</div>}
            <Menu mode="inline" selectedKeys={selectedKeys} onClick={({ key }) => navigate(key)} items={menuItems} />
            <div className="business-nav-note">
              {isBusinessHome
                ? '具体业务菜单已收进各业务中心，首页不再平铺全部功能。'
                : postalContext
                  ? '投递明细、待续投、订报转投和邮局工单统一归属邮局管理。'
                  : `当前只显示“${center?.title}”下的功能，减少无关菜单干扰。`}
            </div>
          </div>

          <div className="app-sider-footer">
            <Dropdown menu={{ items: userMenuItems }} placement="topRight" trigger={['click']}>
              <div className="app-sider-user">
                <Avatar size={38} icon={<UserOutlined />} style={{ background: 'var(--color-accent)', flexShrink: 0 }} />
                <div className="app-sider-user-info">
                  <span className="app-sider-user-name">{user?.username}</span>
                  <span className="app-sider-user-role">{user?.role === 'admin' ? '管理员' : '操作员'}</span>
                </div>
              </div>
            </Dropdown>
          </div>
        </div>
      </Sider>

      <Layout>
        <Header className="app-header">
          <nav className="app-breadcrumb" aria-label="面包屑">
            {breadcrumbs.map((item, index) => (
              <span key={`${item.label}-${index}`}>
                {index > 0 && <i>/</i>}
                {item.path ? <button onClick={() => navigate(item.path!)}>{item.label}</button> : <b>{item.label}</b>}
              </span>
            ))}
          </nav>
          <div className="app-header-right">
            <GlobalSearch />
            <Tooltip title="帮助"><button className="app-header-icon-btn" aria-label="帮助"><QuestionCircleOutlined /></button></Tooltip>
            <Tooltip title="通知"><Badge count={0} overflowCount={99}><button className="app-header-icon-btn" aria-label="通知"><BellOutlined /></button></Badge></Tooltip>
          </div>
        </Header>
        <Content className="app-content"><Outlet /></Content>
      </Layout>
    </Layout>
  );
}
