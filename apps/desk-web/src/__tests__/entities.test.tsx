import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Patients } from '../pages/Patients';
import { Tutors } from '../pages/Tutors';

const mocks = vi.hoisted(() => ({
  tutorList: vi.fn(),
  tutorGet: vi.fn(),
  tutorCreate: vi.fn(),
  tutorUpdate: vi.fn(),
  tutorDelete: vi.fn(),
  patientList: vi.fn(),
  patientGet: vi.fn(),
  patientCreate: vi.fn(),
  patientUpdate: vi.fn(),
  patientDelete: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  tutorApi: {
    list: mocks.tutorList,
    get: mocks.tutorGet,
    create: mocks.tutorCreate,
    update: mocks.tutorUpdate,
    delete: mocks.tutorDelete,
  },
  patientApi: {
    list: mocks.patientList,
    get: mocks.patientGet,
    create: mocks.patientCreate,
    update: mocks.patientUpdate,
    delete: mocks.patientDelete,
  },
}));

describe('Tutor and patient pages', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('lists a tutor and loads its linked details', async () => {
    const tutor = {
      id: 'tutor-1',
      externalId: null,
      name: 'Maria Silva',
      phone: '11999990000',
      email: 'maria@example.com',
      createdAt: '2026-09-12T12:00:00.000Z',
      updatedAt: '2026-09-12T12:00:00.000Z',
    };
    mocks.tutorList.mockResolvedValue([tutor]);
    mocks.tutorGet.mockResolvedValue({
      ...tutor,
      patients: [{ id: 'patient-1', name: 'Rex', species: 'Cachorro', breed: 'SRD' }],
      conversationCount: 2,
      taskCount: 1,
    });

    render(<Tutors />);

    fireEvent.click(await screen.findByRole('cell', { name: 'Maria Silva' }));
    await waitFor(() => expect(mocks.tutorGet).toHaveBeenCalledWith('tutor-1'));
    expect(await screen.findByText('Rex')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('lists patients and forwards the selected species filter', async () => {
    mocks.patientList.mockResolvedValue([{
      id: 'patient-1',
      externalId: null,
      name: 'Rex',
      species: 'Cachorro',
      breed: 'SRD',
      tutorId: 'tutor-1',
      createdAt: '2026-09-12T12:00:00.000Z',
      updatedAt: '2026-09-12T12:00:00.000Z',
      tutor: { id: 'tutor-1', name: 'Maria Silva', phone: '11999990000' },
    }]);
    mocks.tutorList.mockResolvedValue([{ id: 'tutor-1', name: 'Maria Silva', phone: '11999990000' }]);

    render(<Patients />);

    expect(await screen.findByRole('cell', { name: /Rex/ })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar espécie' }), { target: { value: 'gato' } });

    await waitFor(() => expect(mocks.patientList).toHaveBeenLastCalledWith({ search: undefined, species: 'gato' }));
    expect(screen.getByText('Maria Silva')).toBeTruthy();
  });
});
