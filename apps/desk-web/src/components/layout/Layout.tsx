import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import { Icon } from '../ui/Icon';
import { Button } from '../ui';
import { useRealtimeStatus } from '../../hooks/useRealtimeStatus';
import { ConnectionStatus, presencePresentation } from './ConnectionStatus';
import { navGroups, visibleNavGroups, userHasPermission } from '../../navigation';
import { realtimeClient } from '../../lib/realtime';
import './Layout.css';

export function Layout() {
  const { user, logout } = useAuthStore();
  const connection = useRealtimeStatus();
  const presence = presencePresentation(connection);
  const location = useLocation();
  const accessibleNavGroups = visibleNavGroups(user);
  const [navOpen, setNavOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const initials = useMemo(() => (user?.name || 'CVG').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(), [user?.name]);
  const activeLabel = navGroups.flatMap((group) => group.items).find((item) => location.pathname.startsWith(item.to) && userHasPermission(user, item.permission))?.label || 'CVG Desk';

  useEffect(() => setNavOpen(false), [location.pathname]);
  useEffect(() => {
    const activeItem = sidebarRef.current?.querySelector<HTMLElement>('.nav-item.active');
    activeItem?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [location.pathname]);
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

  const handleLogout = async () => {
    realtimeClient.disconnect();
    await logout();
  };

  return (
    <div className={`layout ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main-content">Ir para o conteúdo</a>
      <header className="mobile-topbar">
        <Button ref={menuButtonRef} variant="ghost" size="icon" className="topbar-menu" aria-label="Abrir navegação" aria-expanded={navOpen} onClick={() => setNavOpen(true)} icon="menu" />
        <div className="topbar-brand"><img src="/assets/brand/cvg-logo.webp" alt="" /><span>{activeLabel}</span></div>
        <ConnectionStatus state={connection} className="topbar-status" />
      </header>
      <button className="nav-backdrop" type="button" aria-label="Fechar navegação" aria-hidden={!navOpen} tabIndex={navOpen ? 0 : -1} onClick={() => setNavOpen(false)} />
      <aside ref={sidebarRef} className="sidebar" aria-label="Navegação principal" aria-hidden={compactNav && !navOpen ? true : undefined}>
        <div className="sidebar-header">
          <NavLink to="/inbox" className="brand-lockup" aria-label="CVG Connect Desk — ir para Inbox">
            <span className="brand-mark"><img src="/assets/brand/cvg-logo.webp" alt="Logo do Centro Veterinário Guarapiranga" /></span>
            <span className="brand-copy"><strong>CVG Connect</strong><small>Desk operacional</small></span>
          </NavLink>
          <Button variant="ghost" size="icon" className="nav-close" aria-label="Fechar navegação" onClick={() => setNavOpen(false)} icon="close" />
        </div>
        <div className="system-presence" role={compactNav ? undefined : 'status'} aria-live={compactNav ? undefined : 'polite'}>
          <span className={`presence-pulse ${presence.modifier}`} aria-hidden="true" />
          <span><strong>{presence.title}</strong><small>{presence.detail}</small></span>
        </div>
        <nav className="sidebar-nav">
          {accessibleNavGroups.map((group) => <div className="nav-section" key={group.label}>
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
          <Button variant="ghost" className="btn-logout" onClick={() => void handleLogout()} icon="logout">Sair com segurança</Button>
        </div>
      </aside>
      <main ref={mainRef} className="main-content" id="main-content" tabIndex={-1}><Outlet /></main>
    </div>
  );
}
