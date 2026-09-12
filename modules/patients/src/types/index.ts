export interface CreatePatientInput {
  name: string;
  species?: string | null;
  breed?: string | null;
  tutorId?: string | null;
  externalId?: string | null;
}

export interface UpdatePatientInput {
  name?: string;
  species?: string | null;
  breed?: string | null;
  tutorId?: string | null;
  externalId?: string | null;
}

export interface PatientWithDetails {
  id: string;
  externalId: string | null;
  name: string;
  species: string | null;
  breed: string | null;
  tutorId: string | null;
  createdAt: Date;
  updatedAt: Date;
  tutor: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
  conversationCount: number;
  taskCount: number;
}
