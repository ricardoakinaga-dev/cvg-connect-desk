import { useEffect, useRef, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { SESSION_EXPIRED_EVENT } from './lib/api';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/layout/Layout';
import { ErrorState, LoadingState } from './components/ui';
import { defaultNavigationPath, userHasPermission } from './navigation';
import { realtimeClient } from './lib/realtime';
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
import { Tutors } from './pages/Tutors';
import { Patients } from './pages/Patients';
import './premium-surfaces.css';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { authStatus, bootError, checkAuth, isAuthenticated, isLoading } = useAuthStore();
  if (authStatus === 'checking' || isLoading) {
    return <LoadingState className="auth-gate" label="Carregando sua sessão…" />;
  }
  if (authStatus === 'error') {
    return (
      <div className="auth-gate">
        <ErrorState
          title="Sessão não validada"
          message={bootError ?? 'Não foi possível confirmar sua sessão.'}
          onRetry={() => void checkAuth()}
        />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { authStatus, isAuthenticated, user } = useAuthStore();
  if (authStatus === 'checking') {
    return <LoadingState className="auth-gate" label="Carregando sua sessão…" />;
  }
  if (isAuthenticated) return <Navigate to={defaultNavigationPath(user)} replace />;
  return <>{children}</>;
}

function PermissionDenied({ permission }: { permission: string }) {
  return (
    <div className="auth-gate">
      <ErrorState
        title="Acesso negado"
        message={`Seu usuário não possui a capacidade ${permission} para esta área.`}
      />
    </div>
  );
}

function CapabilityRoute({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuthStore();
  return userHasPermission(user, permission) ? <>{children}</> : <PermissionDenied permission={permission} />;
}

function AuthBootstrap() {
  const checkAuth = useAuthStore((state) => state.checkAuth);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void checkAuth();
  }, [checkAuth]);

  return null;
}

/**
 * Escuta o 401 confirmado pela API: limpa o estado sensível (store + storage)
 * e devolve o operador ao login com um aviso verdadeiro.
 */
export function SessionExpiredWatcher() {
  const expireSession = useAuthStore((state) => state.expireSession);
  const navigate = useNavigate();

  useEffect(() => {
    const handleExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ notice?: string }>).detail;
      realtimeClient.disconnect();
      expireSession(detail?.notice);
      navigate('/login', { replace: true });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleExpired);
  }, [expireSession, navigate]);

  return null;
}

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <SessionExpiredWatcher />
        <AuthBootstrap />
        <Routes>
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<DefaultRoute />} />
            <Route path="inbox" element={<CapabilityRoute permission="chat:read"><Inbox /></CapabilityRoute>} />
            <Route path="contacts" element={<CapabilityRoute permission="chat:read"><Contacts /></CapabilityRoute>} />
            <Route path="tutors" element={<CapabilityRoute permission="chat:read"><Tutors /></CapabilityRoute>} />
            <Route path="patients" element={<CapabilityRoute permission="chat:read"><Patients /></CapabilityRoute>} />
            <Route path="kanban" element={<CapabilityRoute permission="chat:read"><Kanban /></CapabilityRoute>} />
            <Route path="tasks" element={<CapabilityRoute permission="tasks:read"><Tasks /></CapabilityRoute>} />
            <Route path="notes" element={<CapabilityRoute permission="notes:read"><Notes /></CapabilityRoute>} />
            <Route path="alerts" element={<CapabilityRoute permission="alerts:read"><Alerts /></CapabilityRoute>} />
            <Route path="sectors" element={<CapabilityRoute permission="chat:read"><Sectors /></CapabilityRoute>} />
            <Route path="labels" element={<CapabilityRoute permission="chat:read"><Labels /></CapabilityRoute>} />
            <Route path="contact-groups" element={<CapabilityRoute permission="chat:read"><ContactGroups /></CapabilityRoute>} />
            <Route path="dashboard" element={<CapabilityRoute permission="dashboard:read"><Dashboard /></CapabilityRoute>} />
            <Route path="admin" element={<CapabilityRoute permission="admin:read"><Admin /></CapabilityRoute>} />
            <Route path="audit" element={<CapabilityRoute permission="admin:read"><Audit /></CapabilityRoute>} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function DefaultRoute() {
  const { user } = useAuthStore();
  return <Navigate to={defaultNavigationPath(user)} replace />;
}

export default App;
