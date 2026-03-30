export type Permission =
  | 'chat:read'
  | 'chat:write'
  | 'chat:delete'
  | 'tasks:read'
  | 'tasks:write'
  | 'tasks:delete'
  | 'notes:read'
  | 'notes:write'
  | 'notes:delete'
  | 'alerts:read'
  | 'alerts:write'
  | 'alerts:delete'
  | 'admin:read'
  | 'admin:write'
  | 'dashboard:read';

export type Role = 'Admin' | 'Receptionist' | 'Veterinarian' | 'Manager';

export const RolePermissions: Record<Role, Permission[]> = {
  Admin: [
    'chat:read', 'chat:write', 'chat:delete',
    'tasks:read', 'tasks:write', 'tasks:delete',
    'notes:read', 'notes:write', 'notes:delete',
    'alerts:read', 'alerts:write', 'alerts:delete',
    'admin:read', 'admin:write',
    'dashboard:read',
  ],
  Receptionist: [
    'chat:read', 'chat:write',
    'tasks:read', 'tasks:write',
    'notes:read', 'notes:write',
    'alerts:read',
    'dashboard:read',
  ],
  Veterinarian: [
    'chat:read', 'chat:write',
    'tasks:read', 'tasks:write',
    'notes:read', 'notes:write',
    'alerts:read', 'alerts:write',
    'dashboard:read',
  ],
  Manager: [
    'chat:read', 'chat:write',
    'tasks:read', 'tasks:write',
    'notes:read',
    'alerts:read', 'alerts:write',
    'admin:read',
    'dashboard:read',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return RolePermissions[role]?.includes(permission) ?? false;
}
