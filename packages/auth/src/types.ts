import { FastifyRequest } from 'fastify';

export interface User {
  id: string;
  email: string;
  name: string;
  roles: string[];
}

export interface AuthContext {
  user: User;
}

export interface AuthGuard {
  (request: FastifyRequest): Promise<AuthContext>;
}
