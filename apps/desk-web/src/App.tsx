import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Inbox } from './pages/Inbox';
import { Tasks } from './pages/Tasks';
import { Alerts } from './pages/Alerts';
import { Notes } from './pages/Notes';
import { Admin } from './pages/Admin';
import { Audit } from './pages/Audit';
import { Settings } from './pages/Settings';
import { Labels } from './pages/Labels';
import { Sectors } from './pages/Sectors';
import { ContactGroups } from './pages/ContactGroups';
import { Kanban } from './pages/Kanban';
import { Contacts } from './pages/Contacts';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/inbox" replace />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="kanban" element={<Kanban />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="notes" element={<Notes />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="sectors" element={<Sectors />} />
            <Route path="labels" element={<Labels />} />
            <Route path="contact-groups" element={<ContactGroups />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="admin" element={<Admin />} />
            <Route path="audit" element={<Audit />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
