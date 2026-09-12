import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { Icon, type IconName } from '../ui/Icon';
import './Layout.css';

type NavItem = { to: string; label: string; icon: IconName };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { label: 'Operação', items: [
    { to: '/inbox', label: 'Inbox', icon: 'inbox' }, { to: '/contacts', label: 'Contatos', icon: 'contacts' },
    { to: '/tutors', label: 'Tutores', icon: 'tutors' }, { to: '/patients', label: 'Pacientes', icon: 'patients' },
    { to: '/kanban', label: 'Kanban', icon: 'kanban' },
  ] },
  { label: 'Trabalho', items: [
    { to: '/tasks', label: 'Tarefas', icon: 'tasks' }, { to: '/notes', label: 'Notas', icon: 'notes' },
    { to: '/alerts', label: 'Alertas', icon: 'alerts' },
  ] },
  { label: 'Gestão', items: [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }, { to: '/sectors', label: 'Setores', icon: 'sectors' },
    { to: '/labels', label: 'Labels', icon: 'labels' }, { to: '/contact-groups', label: 'Grupos', icon: 'groups' },
    { to: '/admin', label: 'Administração', icon: 'admin' }, { to: '/audit', label: 'Auditoria', icon: 'audit' },
  ] },
];

export function Layout() {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const initials = useMemo(() => (user?.name || 'CVG').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(), [user?.name]);
  const activeLabel = navGroups.flatMap((group) => group.items).find((item) => location.pathname.startsWith(item.to))?.label || 'CVG Desk';

  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 860px)');
    const sync = () => setCompactNav(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (compactNav && !navOpen) sidebarRef.current?.setAttribute('inert', '');
    else sidebarRef.current?.removeAttribute('inert');
  }, [compactNav, navOpen]);
  useEffect(() => {
    if (!navOpen) return undefined;
    mainRef.current?.setAttribute('inert', '');
    const focusable = () => Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])') || []);
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setNavOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); mainRef.current?.removeAttribute('inert'); menuButtonRef.current?.focus(); };
  }, [navOpen]);

  return (
    <div className={`layout ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
      <header className="mobile-topbar">
        <button ref={menuButtonRef} className="topbar-menu" type="button" aria-label="Abrir navegação" aria-expanded={navOpen} onClick={() => setNavOpen(true)}><Icon name="menu" /></button>
        <div className="topbar-brand"><img src="/assets/brand/cvg-logo.webp" alt="" /><span>{activeLabel}</span></div>
        <span className="topbar-status" aria-label="Sistema online"><i /> Online</span>
      </header>
      <button className="nav-backdrop" type="button" aria-label="Fechar navegação" aria-hidden={!navOpen} tabIndex={navOpen ? 0 : -1} onClick={() => setNavOpen(false)} />
      <aside ref={sidebarRef} className="sidebar" aria-label="Navegação principal" aria-hidden={compactNav && !navOpen ? true : undefined}>
        <div className="sidebar-header">
          <NavLink to="/inbox" className="brand-lockup" aria-label="CVG Connect Desk — ir para Inbox">
            <span className="brand-mark"><img src="/assets/brand/cvg-logo.webp" alt="Logo do Centro Veterinário Guarapiranga" /></span>
            <span className="brand-copy"><strong>CVG Connect</strong><small>Desk operacional</small></span>
          </NavLink>
          <button className="nav-close" type="button" aria-label="Fechar navegação" onClick={() => setNavOpen(false)}><Icon name="close" /></button>
        </div>
        <div className="system-presence"><span className="presence-pulse" /><span><strong>Central ativa</strong><small>Operação em tempo real</small></span></div>
        <nav className="sidebar-nav">
          {navGroups.map((group) => <div className="nav-section" key={group.label}>
            <div className="nav-section-label">{group.label}</div>
            {group.items.map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span className="nav-icon"><Icon name={item.icon} /></span><span>{item.label}</span><span className="nav-active-dot" aria-hidden="true" />
            </NavLink>)}
          </div>)}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/settings" className={({ isActive }) => `user-card ${isActive ? 'active' : ''}`}>
            <span className="user-avatar">{initials}</span><span className="user-copy"><strong>{user?.name || 'Configurações'}</strong><small>{user?.roles?.[0] || 'Equipe CVG'}</small></span><Icon name="settings" size={18} />
          </NavLink>
          <button onClick={() => void logout()} className="btn-logout"><Icon name="logout" size={18} /><span>Sair com segurança</span></button>
        </div>
      </aside>
      <main ref={mainRef} className="main-content" id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
