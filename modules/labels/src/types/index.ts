export interface Label {
  id: string;
  name: string;
  color: string;
  description: string | null;
  category: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateLabelInput {
  name: string;
  color?: string;
  description?: string;
  category?: string;
}

export interface UpdateLabelInput {
  name?: string;
  color?: string;
  description?: string;
  category?: string;
}

export interface LabelAssignment {
  conversationId?: string;
  contactId?: string;
  labelId: string;
  userId?: string;
}
