import { BrowserRouter, Routes, Route, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/DashboardPage';
import ReportEditor from './pages/ReportEditor';
import LogisticsOverview from './pages/LogisticsOverview';
import PostDelivery from './pages/PostDelivery';
import History from './pages/History';
import LogisticsIssues from './pages/LogisticsIssues';
import LogisticsIssueDetail from './pages/LogisticsIssueDetail';
import Templates from './pages/Templates';
import HistoryImport from './pages/HistoryImport';
import ScheduleView from './pages/ScheduleView';
import ScheduleImport from './pages/ScheduleImport';
import OrderList from './pages/OrderList';
import OrderEditor from './pages/OrderEditor';
import OrderDetail from './pages/OrderDetail';
import ProductCatalog from './pages/ProductCatalog';
import OrderImport from './pages/OrderImport';
import IssueDispatch from './pages/IssueDispatch';
import Analytics from './pages/Analytics';
import CustomerList from './pages/CustomerList';
import ContractManagement from './pages/ContractManagement';
import FinanceManagement from './pages/FinanceManagement';
import Login from './pages/Login';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/report/:issueId" element={<ReportEditor />} />
            <Route path="/recipients" element={<WorkbenchOrRedirect />} />
            <Route path="/logistics/issues" element={<LogisticsIssues />} />
            <Route path="/logistics/issues/:id" element={<LogisticsIssueDetail />} />
            <Route path="/post-delivery" element={<PostDelivery />} />
            <Route path="/shipping/:issueId" element={<LegacyShippingRedirect />} />
            <Route path="/history" element={<History />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/history-import" element={<HistoryImport />} />
            <Route path="/schedule" element={<ScheduleView />} />
            <Route path="/schedule/import" element={<ScheduleImport />} />
            <Route path="/orders" element={<OrderList />} />
            <Route path="/orders/new" element={<OrderEditor />} />
            <Route path="/orders/import" element={<OrderImport />} />
            <Route path="/orders/dispatch" element={<IssueDispatch />} />
            <Route path="/orders/:id" element={<OrderDetail />} />
            <Route path="/orders/:id/edit" element={<OrderEditor />} />
            <Route path="/products" element={<ProductCatalog />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/customers" element={<CustomerList />} />
            <Route path="/contracts" element={<ContractManagement />} />
            <Route path="/finance" element={<FinanceManagement />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
