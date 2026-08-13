import { Outlet, NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import './Layout.css';

export function Layout() {
  const { user, logout } = useAuthStore();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo"><span className="logo-mark">CVG</span><span>Desk</span></h1>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-section-label">Operação</div>
          <NavLink to="/inbox" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">IN</span><span>Inbox</span>
          </NavLink>
          <NavLink to="/contacts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">CT</span><span>Contatos</span>
          </NavLink>
          <NavLink to="/kanban" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">KB</span><span>Kanban</span>
          </NavLink>

          <div className="nav-section-label">Trabalho</div>
          <NavLink to="/tasks" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">TK</span><span>Tarefas</span>
          </NavLink>
          <NavLink to="/notes" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">NT</span><span>Notas</span>
          </NavLink>
          <NavLink to="/alerts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">AL</span><span>Alertas</span>
          </NavLink>

          <div className="nav-section-label">Gestão</div>
          <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">DB</span><span>Dashboard</span>
          </NavLink>
          <NavLink to="/sectors" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">ST</span><span>Setores</span>
          </NavLink>
          <NavLink to="/labels" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">LB</span><span>Labels</span>
          </NavLink>
          <NavLink to="/contact-groups" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">GP</span><span>Grupos</span>
          </NavLink>
          <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">AD</span><span>Administração</span>
          </NavLink>
          <NavLink to="/audit" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">AU</span><span>Auditoria</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `nav-item settings-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">US</span><span>{user?.name || 'Configurações'}</span>
          </NavLink>
          <button onClick={logout} className="btn-logout">Sair</button>
        </div>
      </aside>

      <main className="main-content"><Outlet /></main>
    </div>
  );
}
