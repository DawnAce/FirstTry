import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import { lazy, Suspense, type ReactNode } from 'react';

const Dashboard = lazy(() => import('./pages/DashboardPage'));
const ReportEditor = lazy(() => import('./pages/ReportEditor'));
const LogisticsOverview = lazy(() => import('./pages/LogisticsOverview'));
const PostDelivery = lazy(() => import('./pages/PostDelivery'));
const SubscriptionGeneration = lazy(() => import('./pages/SubscriptionGeneration'));
const History = lazy(() => import('./pages/History'));
const LogisticsIssues = lazy(() => import('./pages/LogisticsIssues'));
const LogisticsIssueDetail = lazy(() => import('./pages/LogisticsIssueDetail'));
const WaybillImportWorkbench = lazy(() => import('./pages/WaybillImportWorkbench'));
const Templates = lazy(() => import('./pages/Templates'));
const HistoryImport = lazy(() => import('./pages/HistoryImport'));
const ScheduleView = lazy(() => import('./pages/ScheduleView'));
const ScheduleImport = lazy(() => import('./pages/ScheduleImport'));
const OrderList = lazy(() => import('./pages/OrderList'));
const OrderEditor = lazy(() => import('./pages/OrderEditor'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const ProductCatalog = lazy(() => import('./pages/ProductCatalog'));
const OrderImport = lazy(() => import('./pages/OrderImport'));
const IssueDispatch = lazy(() => import('./pages/IssueDispatch'));
const Analytics = lazy(() => import('./pages/Analytics'));
const CustomerList = lazy(() => import('./pages/CustomerList'));
const ContractManagement = lazy(() => import('./pages/ContractManagement'));
const FinanceManagement = lazy(() => import('./pages/FinanceManagement'));
const Login = lazy(() => import('./pages/Login'));
const BusinessHome = lazy(() => import('./pages/BusinessPortal').then((module) => ({ default: module.BusinessHome })));
const BusinessCenterPortal = lazy(() => import('./pages/BusinessPortal').then((module) => ({ default: module.BusinessCenterPortal })));
const PostalPortal = lazy(() => import('./pages/BusinessPortal').then((module) => ({ default: module.PostalPortal })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireMutationAccess({ children, fallback }: { children: ReactNode; fallback: string }) {
  const { isViewer } = useAuth();
  if (isViewer) return <Navigate to={fallback} replace />;
  return <>{children}</>;
}

function LegacyShippingRedirect() {
  const { issueId } = useParams<{ issueId: string }>();
  const target = issueId ? `/logistics/issues/${issueId}` : '/logistics/issues';
  return <Navigate to={target} replace />;
}

// ZTO-MF 菜单现在打开工作台；但旧书签 /recipients?tab=shipping&issueId=N 仍要落到该期详情。
function WorkbenchOrRedirect() {
  const [searchParams] = useSearchParams();
  const issueId = searchParams.get('issueId');
  if (issueId) return <Navigate to={`/logistics/issues/${issueId}`} replace />;
  return <LogisticsOverview />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>页面加载中…</div>}>
          <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/" element={<BusinessHome />} />
            <Route path="/business/:centerKey" element={<BusinessCenterPortal />} />
            <Route path="/business/fulfilment/postal" element={<PostalPortal />} />
            <Route path="/print" element={<Dashboard />} />
            <Route path="/report/:issueId" element={<ReportEditor />} />
            <Route path="/recipients" element={<WorkbenchOrRedirect />} />
            <Route path="/logistics/issues" element={<LogisticsIssues />} />
            <Route path="/logistics/issues/:id" element={<LogisticsIssueDetail />} />
            <Route path="/logistics/issues/:id/waybills/import" element={<RequireMutationAccess fallback="/logistics/issues"><WaybillImportWorkbench /></RequireMutationAccess>} />
            <Route path="/post-delivery" element={<Navigate to="/post-delivery/deliveries" replace />} />
            <Route path="/post-delivery/subscription" element={<SubscriptionGeneration />} />
            <Route path="/post-delivery/:tab" element={<PostDelivery />} />
            <Route path="/shipping/:issueId" element={<LegacyShippingRedirect />} />
            <Route path="/history" element={<History />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/history-import" element={<RequireMutationAccess fallback="/history"><HistoryImport /></RequireMutationAccess>} />
            <Route path="/schedule" element={<ScheduleView />} />
            <Route path="/schedule/import" element={<RequireMutationAccess fallback="/schedule"><ScheduleImport /></RequireMutationAccess>} />
            <Route path="/orders" element={<OrderList />} />
            <Route path="/orders/new" element={<RequireMutationAccess fallback="/orders"><OrderEditor /></RequireMutationAccess>} />
            <Route path="/orders/import" element={<RequireMutationAccess fallback="/orders"><OrderImport /></RequireMutationAccess>} />
            <Route path="/orders/dispatch" element={<RequireMutationAccess fallback="/orders"><IssueDispatch /></RequireMutationAccess>} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/orders/:id/edit" element={<RequireMutationAccess fallback="/orders"><OrderEditor /></RequireMutationAccess>} />
            <Route path="/products" element={<ProductCatalog />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/customers" element={<CustomerList />} />
            <Route path="/contracts" element={<ContractManagement />} />
            <Route path="/finance" element={<FinanceManagement />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
