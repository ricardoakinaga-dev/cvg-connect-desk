import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import './Layout.css';

export function Layout() {
  const { user, logout } = useAuthStore();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">🐾 CVG Desk</h1>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-section-label">Operação</div>
          <NavLink to="/inbox" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📥</span><span>Inbox</span>
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">👤</span><span>Contatos</span>
          </NavLink>
          <NavLink to="/tutors" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">👨‍👩‍👦</span><span>Tutores</span>
          </NavLink>
          <NavLink to="/patients" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🐾</span><span>Pacientes</span>
          </NavLink>
          <NavLink to="/kanban" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📋</span><span>Kanban</span>
          </NavLink>

          <div className="nav-section-label">Trabalho</div>
          <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">✓</span><span>Tarefas</span>
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📝</span><span>Notas</span>
          </NavLink>
          <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🔔</span><span>Alertas</span>
          </NavLink>

          <div className="nav-section-label">Gestão</div>
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">📊</span><span>Dashboard</span>
          </NavLink>
          <NavLink to="/sectors" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🏢</span><span>Setores</span>
          </NavLink>
          <NavLink to="/labels" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🏷️</span><span>Labels</span>
          </NavLink>
          <NavLink to="/contact-groups" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">👥</span><span>Grupos</span>
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">⚙️</span><span>Administração</span>
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">🔍</span><span>Auditoria</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `nav-item settings-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">👤</span><span>{user?.name || 'Configurações'}</span>
          </NavLink>
          <button onClick={logout} className="btn-logout">Sair</button>
        </div>
      </aside>

      <main className="main-content"><Outlet /></main>
    </div>
  );
}
