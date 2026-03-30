export interface Sector {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  icon: string;
  isActive: boolean;
  autoAssign: boolean;
  maxConcurrent: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectorInput {
  name: string;
  code: string;
  description?: string;
  color?: string;
  icon?: string;
  autoAssign?: boolean;
  maxConcurrent?: number;
}

export interface UpdateSectorInput {
  name?: string;
  description?: string;
  color?: string;
  icon?: string;
  isActive?: boolean;
  autoAssign?: boolean;
  maxConcurrent?: number;
}

export interface SectorStats {
  sectorId: string;
  sectorName: string;
  totalConversations: number;
  activeConversations: number;
  pendingConversations: number;
  avgResponseTime: number | null;
}
