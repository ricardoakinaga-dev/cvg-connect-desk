import type { User } from './store/auth';
import type { IconName } from './components/ui/Icon';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permission?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * A UI only reflects the permissions returned by `/auth/me`; the API remains
 * the authorization boundary for every route and operation.
 */
export const navGroups: NavGroup[] = [
  {
    label: 'Operação',
    items: [
      { to: '/inbox', label: 'Inbox', icon: 'inbox', permission: 'chat:read' },
      { to: '/contacts', label: 'Contatos', icon: 'contacts', permission: 'chat:read' },
      { to: '/tutors', label: 'Tutores', icon: 'tutors', permission: 'chat:read' },
      { to: '/patients', label: 'Pacientes', icon: 'patients', permission: 'chat:read' },
      { to: '/kanban', label: 'Kanban', icon: 'kanban', permission: 'chat:read' },
    ],
  },
  {
    label: 'Trabalho',
    items: [
      { to: '/tasks', label: 'Tarefas', icon: 'tasks', permission: 'tasks:read' },
      { to: '/notes', label: 'Notas', icon: 'notes', permission: 'notes:read' },
      { to: '/alerts', label: 'Alertas', icon: 'alerts', permission: 'alerts:read' },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard:read' },
      { to: '/sectors', label: 'Setores', icon: 'sectors', permission: 'chat:read' },
      { to: '/labels', label: 'Labels', icon: 'labels', permission: 'chat:read' },
      { to: '/contact-groups', label: 'Grupos', icon: 'groups', permission: 'chat:read' },
      { to: '/admin', label: 'Administração', icon: 'admin', permission: 'admin:read' },
      { to: '/audit', label: 'Auditoria', icon: 'audit', permission: 'admin:read' },
    ],
  },
];

export function userHasPermission(user: User | null, permission?: string): boolean {
  if (!permission) return true;
  return user?.permissions?.includes(permission) ?? false;
}

export function visibleNavGroups(user: User | null): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => userHasPermission(user, item.permission)),
    }))
    .filter((group) => group.items.length > 0);
}

export function defaultNavigationPath(user: User | null): string {
  return visibleNavGroups(user)[0]?.items[0]?.to ?? '/settings';
}
