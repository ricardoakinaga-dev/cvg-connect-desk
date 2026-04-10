import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Kanban } from '../pages/Kanban';

const mocks = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPatchMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
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

    render(<Kanban />);

    expect(await screen.findByText('Ana Costa')).toBeTruthy();
    expect(screen.getByText('Em atendimento')).toBeTruthy();

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
});
