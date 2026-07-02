// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import JobExplorerPage from './pages/JobExplorerPage';
import JobDetailPage from './pages/JobDetailPage';
import QueuesPage from './pages/QueuesPage';
import WorkersPage from './pages/WorkersPage';
import DLQPage from './pages/DLQPage';
import AdminPage from './pages/AdminPage';
import Sidebar from './components/Sidebar';
import { getToken } from './lib/api';

// Protected layout — requires valid token in localStorage
function ProtectedLayout() {
  const token = getToken();
  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Outlet />
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedLayout />}>
          <Route path="/"                            element={<DashboardPage />} />
          <Route path="/jobs"                        element={<JobExplorerPage />} />
          <Route path="/jobs/:queueId/:jobId"        element={<JobDetailPage />} />
          <Route path="/queues"                      element={<QueuesPage />} />
          <Route path="/workers"                     element={<WorkersPage />} />
          <Route path="/dlq"                         element={<DLQPage />} />
          <Route path="/admin"                       element={<AdminPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
