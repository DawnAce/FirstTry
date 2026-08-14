import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';

const loadDashboard = () => import('./pages/DashboardPage');
const loadReportEditor = () => import('./pages/ReportEditor');
const loadLogisticsOverview = () => import('./pages/LogisticsOverview');
const loadPostDelivery = () => import('./pages/PostDelivery');
const loadSubscriptionGeneration = () => import('./pages/SubscriptionGeneration');
const loadHistory = () => import('./pages/History');
const loadLogisticsIssues = () => import('./pages/LogisticsIssues');
const loadLogisticsIssueDetail = () => import('./pages/LogisticsIssueDetail');
const loadWaybillImportWorkbench = () => import('./pages/WaybillImportWorkbench');
const loadTemplates = () => import('./pages/Templates');
const loadHistoryImport = () => import('./pages/HistoryImport');
const loadScheduleView = () => import('./pages/ScheduleView');
const loadScheduleImport = () => import('./pages/ScheduleImport');
const loadOrderList = () => import('./pages/OrderList');
const loadOrderEditor = () => import('./pages/OrderEditor');
const loadOrderDetail = () => import('./pages/OrderDetail');
const loadProductCatalog = () => import('./pages/ProductCatalog');
const loadOrderImport = () => import('./pages/OrderImport');
const loadIssueDispatch = () => import('./pages/IssueDispatch');
const loadAnalytics = () => import('./pages/Analytics');
const loadCustomerList = () => import('./pages/CustomerList');
const loadContractManagement = () => import('./pages/ContractManagement');
const loadFinanceManagement = () => import('./pages/FinanceManagement');
const loadLogin = () => import('./pages/Login');
const loadBusinessPortal = () => import('./pages/BusinessPortal');

const Dashboard = lazy(loadDashboard);
const ReportEditor = lazy(loadReportEditor);
const LogisticsOverview = lazy(loadLogisticsOverview);
const PostDelivery = lazy(loadPostDelivery);
const SubscriptionGeneration = lazy(loadSubscriptionGeneration);
const History = lazy(loadHistory);
const LogisticsIssues = lazy(loadLogisticsIssues);
const LogisticsIssueDetail = lazy(loadLogisticsIssueDetail);
const WaybillImportWorkbench = lazy(loadWaybillImportWorkbench);
const Templates = lazy(loadTemplates);
const HistoryImport = lazy(loadHistoryImport);
const ScheduleView = lazy(loadScheduleView);
const ScheduleImport = lazy(loadScheduleImport);
const OrderList = lazy(loadOrderList);
const OrderEditor = lazy(loadOrderEditor);
const OrderDetail = lazy(loadOrderDetail);
const ProductCatalog = lazy(loadProductCatalog);
const OrderImport = lazy(loadOrderImport);
const IssueDispatch = lazy(loadIssueDispatch);
const Analytics = lazy(loadAnalytics);
const CustomerList = lazy(loadCustomerList);
const ContractManagement = lazy(loadContractManagement);
const FinanceManagement = lazy(loadFinanceManagement);
const Login = lazy(loadLogin);
const BusinessHome = lazy(() => loadBusinessPortal().then((module) => ({ default: module.BusinessHome })));
const BusinessCenterPortal = lazy(() => loadBusinessPortal().then((module) => ({ default: module.BusinessCenterPortal })));
const PostalPortal = lazy(() => loadBusinessPortal().then((module) => ({ default: module.PostalPortal })));

const routeModuleLoaders = [
  loadDashboard, loadReportEditor, loadLogisticsOverview, loadPostDelivery,
  loadSubscriptionGeneration, loadHistory, loadLogisticsIssues,
  loadLogisticsIssueDetail, loadWaybillImportWorkbench, loadTemplates,
  loadHistoryImport, loadScheduleView, loadScheduleImport, loadOrderList,
  loadOrderEditor, loadOrderDetail, loadProductCatalog, loadOrderImport,
  loadIssueDispatch, loadAnalytics, loadCustomerList, loadContractManagement,
  loadFinanceManagement, loadBusinessPortal,
];

function RouteModulePreloader() {
  const { isLoggedIn } = useAuth();
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const timer = window.setTimeout(async () => {
      for (let index = 0; index < routeModuleLoaders.length; index += 4) {
        await Promise.allSettled(
          routeModuleLoaders.slice(index, index + 4).map((load) => load()),
        );
      }
    // Never compete with the current page's data requests. Once the first
    // screen has settled, warm route chunks in small batches for later clicks.
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [isLoggedIn]);
  return null;
}

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
      <RouteModulePreloader />
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
            <Route path="/logistics/issues" element={<Navigate to="/logistics/plans" replace />} />
            <Route path="/logistics/plans" element={<LogisticsIssues mode="plan" />} />
            <Route path="/logistics/shipments" element={<LogisticsIssues mode="actual" />} />
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
