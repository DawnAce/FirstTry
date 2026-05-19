import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import ReportEditor from './pages/ReportEditor';
import Recipients from './pages/Recipients';
import ShippingPreview from './pages/ShippingPreview';
import History from './pages/History';
import Templates from './pages/Templates';
import HistoryImport from './pages/HistoryImport';
import Login from './pages/Login';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return <>{children}</>;
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
            <Route path="/shipping/:issueId" element={<ShippingPreview />} />
            <Route path="/history" element={<History />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/history-import" element={<HistoryImport />} />
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
