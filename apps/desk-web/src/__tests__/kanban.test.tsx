import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Kanban } from '../pages/Kanban';

const mocks = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPatchMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  getErrorMessage: (error: unknown, fallback = 'Erro inesperado') => error instanceof Error && error.message ? error.message : fallback,
  api: {
    get: mocks.apiGetMock,
    patch: mocks.apiPatchMock,
  },
}));

describe('Kanban page', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders columns and moves a card to another status', async () => {
    mocks.apiGetMock.mockResolvedValue({
      columns: [
        {
          status: 'novo',
          label: 'Novo',
          icon: '🟢',
          color: '#22c55e',
          count: 1,
          cards: [
            {
              id: 'card_1',
              contactName: 'Ana Costa',
              contactPhone: null,
              lastMessage: 'Preciso reagendar',
              assignedUserName: 'Dra. Sofia Lima',
              sectorName: 'Suporte',
              sectorColor: '#22c55e',
              sectorIcon: '🩺',
              labels: [{ name: 'Urgente', color: '#ef4444' }],
              priority: 'high',
              minutesSinceUpdate: 35,
            },
          ],
        },
        {
          status: 'em_atendimento',
          label: 'Em atendimento',
          icon: '🔵',
          color: '#3b82f6',
          count: 0,
          cards: [],
        },
      ],
      filters: {
        sectors: [
          { id: 'sector_1', name: 'Suporte', icon: '🩺', color: '#22c55e' },
        ],
        labels: [],
      },
    });

    render(<MemoryRouter><Kanban /></MemoryRouter>);

    expect(await screen.findByText('Ana Costa')).toBeTruthy();
    expect(screen.getByText('Em atendimento')).toBeTruthy();
    expect(screen.getByText('Abrir')).toBeTruthy();
    expect(screen.getByText('Avançar')).toBeTruthy();

    const sourceCard = screen.getByText('Ana Costa').closest('.kanban-card');
    const targetColumn = screen.getByText('Em atendimento').closest('.kanban-column');

    expect(sourceCard).toBeTruthy();
    expect(targetColumn).toBeTruthy();

    fireEvent.dragStart(sourceCard as Element);
    fireEvent.drop(targetColumn as Element);

    await waitFor(() => {
      expect(mocks.apiPatchMock).toHaveBeenCalledWith('/kanban/card/card_1/move', { status: 'em_atendimento' });
    });
  });

  it('shows an error state and retries loading the board', async () => {
    mocks.apiGetMock.mockRejectedValue(new Error('Internal server error'));

    render(<MemoryRouter><Kanban /></MemoryRouter>);

    expect(await screen.findByText('Internal server error')).toBeTruthy();

    mocks.apiGetMock.mockResolvedValue({
      columns: [],
      filters: { sectors: [], labels: [] },
    });
    fireEvent.click(screen.getByText('Tentar novamente'));

    await waitFor(() => {
      expect(mocks.apiGetMock).toHaveBeenCalledTimes(2);
    });
  });
});
