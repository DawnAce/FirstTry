import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import '@arco-design/web-react/dist/css/arco.css';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import ReportEditor from './pages/ReportEditor';
import Recipients from './pages/Recipients';
import ShippingPreview from './pages/ShippingPreview';
import History from './pages/History';
import Templates from './pages/Templates';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/report/:issueId" element={<ReportEditor />} />
          <Route path="/recipients" element={<Recipients />} />
          <Route path="/shipping/:issueId" element={<ShippingPreview />} />
          <Route path="/history" element={<History />} />
          <Route path="/templates" element={<Templates />} />
        </Route>
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
