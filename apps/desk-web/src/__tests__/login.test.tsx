import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Login } from '../pages/Login';

const loginMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('../store/auth', () => ({
  useAuthStore: () => ({
    login: loginMock,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

describe('Login page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('submits credentials and navigates to inbox on success', async () => {
    loginMock.mockResolvedValue(undefined);

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'admin@cvg.local' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'senha-segura' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    await waitFor(() => {
      expect(loginMock).toHaveBeenCalledWith('admin@cvg.local', 'senha-segura');
    });
    expect(navigateMock).toHaveBeenCalledWith('/inbox');
  });

  it('shows a visible error when login fails', async () => {
    loginMock.mockRejectedValue(new Error('Credenciais inválidas'));

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'admin@cvg.local' } });
    fireEvent.change(screen.getByPlaceholderText('Senha'), { target: { value: 'errada' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(await screen.findByText('Credenciais inválidas')).toBeTruthy();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
