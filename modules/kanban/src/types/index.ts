export interface KanbanCard {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  patientName: string | null;
  lastMessage: string | null;
  assignedUserName: string | null;
  sectorName: string | null;
  sectorColor: string | null;
  sectorIcon: string | null;
  labels: { name: string; color: string }[];
  priority: 'low' | 'normal' | 'high' | 'urgent';
  minutesSinceUpdate: number;
  createdAt: string;
}

export interface KanbanColumn {
  status: string;
  label: string;
  icon: string;
  color: string;
  count: number;
  cards: KanbanCard[];
}

export interface KanbanBoard {
  columns: KanbanColumn[];
  filters: {
    sectors: { id: string; name: string; icon: string; color: string }[];
    labels: { id: string; name: string; color: string }[];
  };
  stats: {
    total: number;
    byStatus: Record<string, number>;
    bySector: Record<string, number>;
  };
}
