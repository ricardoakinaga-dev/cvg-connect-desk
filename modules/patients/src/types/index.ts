export interface CreatePatientInput {
  name: string;
  species?: string;
  breed?: string;
  tutorId?: string;
  externalId?: string;
}

export interface UpdatePatientInput {
  name?: string;
  species?: string;
  breed?: string;
  tutorId?: string;
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
  tutor?: {
    id: string;
    name: string;
    phone: string | null;
  } | null;
  conversationCount: number;
  taskCount: number;
}
