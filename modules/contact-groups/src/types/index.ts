export interface ContactGroup {
  id: string;
  name: string;
  description: string | null;
  groupType: 'internal' | 'external' | 'mixed' | 'sector' | 'custom';
  sectorId: string | null;
  color: string;
  icon: string;
  isSystem: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  memberCount?: number;
}

export interface CreateGroupInput {
  name: string;
  description?: string;
  groupType?: 'internal' | 'external' | 'mixed' | 'sector' | 'custom';
  sectorId?: string;
  color?: string;
  icon?: string;
}
