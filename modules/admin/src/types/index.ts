// Types for Admin module — defined locally since @cvg/database exports tables, not types

// User
export interface UserListItem {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  roleIds?: string[];
  isActive?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  password?: string;
  roleIds?: string[];
  isActive?: boolean;
}

// Role
export interface RoleListItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
  _count?: { permissions: number };
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  permissionIds?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissionIds?: string[];
}

// Permission
export type PermissionName = 
  | 'chat:read' | 'chat:write'
  | 'tasks:read' | 'tasks:write'
  | 'notes:read' | 'notes:write'
  | 'alerts:read' | 'alerts:write'
  | 'dashboard:read'
  | 'admin:read' | 'admin:write'
  | 'audit:read';

export interface PermissionItem {
  id: string;
  name: PermissionName | string;
  description: string | null;
  createdAt: Date;
}

export interface CreatePermissionInput {
  name: PermissionName;
  description?: string;
}

// Queue
export interface QueueItem {
  id: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface CreateQueueInput {
  name: string;
  description?: string;
}

export interface UpdateQueueInput {
  name?: string;
  description?: string;
}

// Team
export interface TeamItem {
  id: string;
  name: string;
  createdAt: Date;
  _count?: { users: number };
}

export interface CreateTeamInput {
  name: string;
}

export interface UpdateTeamInput {
  name?: string;
}

// Assignment
export interface AssignUserToTeamInput {
  userId: string;
  teamId: string;
}

export interface AssignUserToQueueInput {
  userId: string;
  queueId: string;
}
