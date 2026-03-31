export interface Contact {
  id: string;
  externalId: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
  tutorId: string | null;
  patientId: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
  // Joined fields
  labels?: ContactLabel[];
  groups?: ContactGroup[];
  activeConversationId?: string | null;
  lastMessageAt?: string | null;
}

export interface ContactLabel {
  id: string;
  name: string;
  color: string;
}

export interface ContactGroup {
  id: string;
  name: string;
  icon: string;
}

export interface CreateContactInput {
  name: string;
  phone: string;
  email?: string;
  externalId?: string;
  notes?: string;
}

export interface UpdateContactInput {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface ContactWithDetails extends Contact {
  conversations: {
    id: string;
    status: string;
    createdAt: string;
    lastMessage?: string;
  }[];
  notesCount: number;
  tasksCount: number;
}
