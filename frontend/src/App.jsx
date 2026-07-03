// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
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
          {/* Dashboard */}
          <Route path="/"                              element={<DashboardPage />} />

          {/* Projects — the primary navigation layer */}
          <Route path="/projects"                      element={<ProjectsPage />} />
          <Route path="/projects/:projectId"           element={<ProjectDetailPage />} />

          {/* Job Explorer — global cross-project view */}
          <Route path="/jobs"                          element={<JobExplorerPage />} />
          <Route path="/jobs/:queueId/:jobId"          element={<JobDetailPage />} />

          {/* /queues → redirect to /projects so existing links don't break */}
          <Route path="/queues"                        element={<Navigate to="/projects" replace />} />

          {/* Workers, DLQ, Admin */}
          <Route path="/workers"                       element={<WorkersPage />} />
          <Route path="/dlq"                           element={<DLQPage />} />
          <Route path="/admin"                         element={<AdminPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
