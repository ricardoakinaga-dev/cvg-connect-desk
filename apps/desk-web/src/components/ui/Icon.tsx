import type { SVGProps } from 'react';

export type IconName =
  | 'inbox' | 'contacts' | 'tutors' | 'patients' | 'kanban' | 'tasks'
  | 'notes' | 'alerts' | 'dashboard' | 'sectors' | 'labels' | 'groups'
  | 'admin' | 'audit' | 'settings' | 'logout' | 'menu' | 'close'
  | 'search' | 'transfer' | 'info' | 'plus' | 'send' | 'attachment'
  | 'smile' | 'back' | 'eye' | 'eyeOff' | 'activity' | 'clock'
  | 'message' | 'check' | 'warning' | 'bell' | 'refresh';

const paths: Record<IconName, React.ReactNode> = {
  inbox: <><path d="M4 4h16v12H4z"/><path d="M4 13h4l2 3h4l2-3h4"/></>,
  contacts: <><circle cx="12" cy="8" r="3.25"/><path d="M5.5 20c.4-4 2.6-6 6.5-6s6.1 2 6.5 6"/></>,
  tutors: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.2"/><path d="M3.5 20c.3-4 2.2-6 5.5-6s5.2 2 5.5 6M15 15c3.2 0 4.8 1.7 5 5"/></>,
  patients: <><path d="M8.2 12.8c-2.9 1.6-3.6 5-.9 6.3 2.2 1.1 3.1-.9 4.7-.9s2.5 2 4.7.9c2.7-1.3 2-4.7-.9-6.3-1.3-.8-2.3-2.1-3.8-2.1s-2.5 1.3-3.8 2.1Z"/><circle cx="6" cy="8" r="2"/><circle cx="10" cy="5" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="14" cy="5" r="2"/></>,
  kanban: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16M5.5 8h1M11.5 11h1M17.5 7h1"/></>,
  tasks: <><path d="M9 5h11M9 12h11M9 19h11"/><path d="m3.5 5 1 1 2-2M3.5 12l1 1 2-2M3.5 19l1 1 2-2"/></>,
  notes: <><path d="M5 3h11l3 3v15H5z"/><path d="M15 3v4h4M8 11h8M8 15h8"/></>,
  alerts: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM10 20h4"/></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  sectors: <><path d="M4 21V7l8-4 8 4v14M8 10h2M14 10h2M8 14h2M14 14h2M10 21v-3h4v3"/></>,
  labels: <><path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8" cy="8" r="1"/></>,
  groups: <><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M3 20c.4-4 2.3-6 6-6s5.6 2 6 6M15 14c3.6 0 5.4 2 5.7 5"/></>,
  admin: <><circle cx="12" cy="8" r="3"/><path d="M6 21v-2a6 6 0 0 1 12 0v2M18.5 4.5l1 1M5.5 4.5l-1 1"/></>,
  audit: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M8 10.5l1.7 1.7L13.5 8"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  logout: <><path d="M10 5H5v14h5M14 16l4-4-4-4M18 12H9"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>, close: <path d="m6 6 12 12M18 6 6 18"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  transfer: <><path d="M4 7h13M14 4l3 3-3 3M20 17H7M10 14l-3 3 3 3"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, send: <path d="m4 4 17 8-17 8 3-8-3-8Zm3 8h14"/>,
  attachment: <path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.5 3.5 0 0 1 5 5l-9.5 9.5a2 2 0 0 1-3-3L15 6"/>,
  smile: <><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
  back: <path d="m15 18-6-6 6-6M9 12h11"/>, eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.5"/></>,
  eyeOff: <><path d="m4 4 16 16M10.7 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-2.1 2.7M6.6 6.6C4 8.3 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.8-.5"/></>,
  activity: <path d="M3 12h4l2-6 4 12 2-6h6"/>, clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  message: <path d="M4 5h16v11H9l-5 4V5Z"/>, check: <path d="m5 12 4 4L19 6"/>,
  warning: <><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8ZM10 20h4"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 8a7 7 0 0 1 11.8-1L20 12M4 12l2.1 5a7 7 0 0 0 11.8-1"/></>,
};

export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {paths[name]}
    </svg>
  );
}
