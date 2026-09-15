import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';

export interface User {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions?: string[];
  permissionsAuthoritative?: boolean;
  sectors?: Array<{
    id: string;
    name: string;
    code?: string;
    accessLevel?: 'read' | 'write' | 'admin';
  }>;
}

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'error' | 'forbidden';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authStatus: AuthStatus;
  bootError: string | null;
  error: string | null;
  /** Aviso exibido no login após uma sessão expirada (não persistido). */
  sessionNotice: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  expireSession: (notice?: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: true,
      authStatus: 'checking',
      bootError: null,
      error: null,
      sessionNotice: null,

      login: async (email: string, password: string) => {
        // Keep the public login mounted while credentials are checked. The
        // route gate reserves `checking` for the initial session bootstrap;
        // replacing the form during a failed login would erase its error.
        set({ isLoading: true, bootError: null, error: null, sessionNotice: null });
        
        try {
          const response = await api.post<{ user: User; token: string }>('/auth/login', {
            email,
            password,
          });
          
          set({
            user: response.user,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
            authStatus: 'authenticated',
            bootError: null,
            error: null,
            sessionNotice: null,
          });
        } catch (error) {
          set({
            isLoading: false,
            authStatus: 'unauthenticated',
            bootError: null,
            error: error instanceof Error ? error.message : 'Login failed',
          });
          throw error;
        }
      },
      
      logout: async () => {
        const { token } = get();
        
        try {
          if (token) {
            await api.post('/auth/logout');
          }
        } catch {
          // Logout local prossegue mesmo se o servidor estiver inalcançável.
        } finally {
          set({
            user: null,
            token: null,
            isAuthenticated: false,
            isLoading: false,
            authStatus: 'unauthenticated',
            bootError: null,
            error: null,
            sessionNotice: null,
          });
        }
      },

      /**
       * Limpa imediatamente todo o estado sensível da sessão (usuário, token,
       * flag de autenticação) e registra o aviso exibido no login. Chamado
       * quando a API confirma 401 em requisição autenticada.
       */
      expireSession: (notice = 'Sua sessão expirou. Entre novamente para continuar.') => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          authStatus: 'unauthenticated',
          bootError: null,
          error: null,
          sessionNotice: notice,
        });
      },

      checkAuth: async () => {
        const { token } = get();

        set({ isLoading: true, authStatus: 'checking', bootError: null, error: null });
        
        if (!token) {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            authStatus: 'unauthenticated',
          });
          return;
        }
        
        try {
          const response = await api.get<{ user: User }>('/auth/me');
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
            authStatus: 'authenticated',
            bootError: null,
            error: null,
          });
        } catch (error) {
          const status = (error as { status?: unknown } | null)?.status;

          if (status === 401) {
            set({
              user: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
              authStatus: 'unauthenticated',
              bootError: null,
              error: null,
              sessionNotice: 'Sua sessão expirou. Entre novamente para continuar.',
            });
            return;
          }

          if (status === 403) {
            set({
              user: null,
              token: null,
              isAuthenticated: false,
              isLoading: false,
              authStatus: 'forbidden',
              bootError: null,
              error: null,
              sessionNotice: 'Sua sessão não tem permissão para acessar o CVG Connect Desk.',
            });
            return;
          }

          // Keep the persisted principal for a retry, but never release a
          // protected route until `/auth/me` has been confirmed.
          set({
            isAuthenticated: false,
            isLoading: false,
            authStatus: 'error',
            bootError: 'Não foi possível validar sua sessão. Verifique a conexão e tente novamente.',
            error: null,
          });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
