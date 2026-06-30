import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/DashboardPage';
import ReportEditor from './pages/ReportEditor';
import Recipients from './pages/Recipients';
import History from './pages/History';
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
import Login from './pages/Login';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LegacyShippingRedirect() {
  const { issueId } = useParams<{ issueId: string }>();
  const target = issueId ? `/recipients?tab=shipping&issueId=${issueId}` : '/recipients?tab=shipping';
  return <Navigate to={target} replace />;
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
            <Route path="/recipients" element={<Recipients />} />
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
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
