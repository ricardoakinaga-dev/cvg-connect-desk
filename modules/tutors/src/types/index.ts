export interface CreateTutorInput {
  name: string;
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
}

export interface UpdateTutorInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
}

export interface TutorWithPatients {
  id: string;
  externalId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
  patients: {
    id: string;
    name: string;
    species: string | null;
    breed: string | null;
  }[];
  conversationCount: number;
  taskCount: number;
}
