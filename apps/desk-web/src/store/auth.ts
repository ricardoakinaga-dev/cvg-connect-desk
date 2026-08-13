import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';

interface User {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
      
      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        
        try {
          const response = await api.post<{ user: User }>('/auth/login', {
            email,
            password,
          });
          
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error) {
          set({
            isLoading: false,
            error: error instanceof Error ? error.message : 'Login failed',
          });
          throw error;
        }
      },
      
      logout: async () => {
        try {
          if (get().isAuthenticated) {
            await api.post('/auth/logout');
          }
        } catch {
          // Logout is best-effort: local session state must be cleared even if the API call fails.
        } finally {
          set({ user: null, isAuthenticated: false, error: null });
        }
      },

      checkAuth: async () => {
        set({ isLoading: true });
        
        try {
          const response = await api.get<{ user: User }>('/auth/me');
          set({
            user: response.user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
