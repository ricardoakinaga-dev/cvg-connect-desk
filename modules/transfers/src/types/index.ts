export interface ContactTransfer {
  id: string;
  contactId: string;
  conversationId: string | null;
  fromSectorId: string | null;
  toSectorId: string;
  fromUserId: string | null;
  toUserId: string | null;
  reason: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  resolvedAt: string | null;
}
