export interface CreateTutorInput {
  name: string;
  phone?: string;
  email?: string;
  externalId?: string;
}

export interface UpdateTutorInput {
  name?: string;
  phone?: string;
  email?: string;
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
}
