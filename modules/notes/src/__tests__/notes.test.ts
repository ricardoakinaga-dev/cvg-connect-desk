import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../infrastructure/repositories/note.repository', () => ({
  noteRepository: {
    create: vi.fn(),
    findByConversationId: vi.fn(),
    findByTaskId: vi.fn(),
  },
}));

vi.mock('@cvg/audit', () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

import { createNote } from '../application/use-cases/create-note.use-case';
import { noteRepository } from '../infrastructure/repositories/note.repository';

describe('createNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deve retornar erro quando content está vazio', async () => {
    const result = await createNote({ content: '', authorId: 'user-001', referenceType: 'conversation', referenceId: 'conv-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando authorId está vazio', async () => {
    const result = await createNote({ content: 'Nota', authorId: '', referenceType: 'conversation', referenceId: 'conv-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve retornar erro quando nenhuma referência é fornecida', async () => {
    const result = await createNote({ content: 'Nota', authorId: 'user-001' });
    expect(result.isErr()).toBe(true);
  });

  it('deve criar nota com conversationId (compat retroativa)', async () => {
    vi.mocked(noteRepository.create).mockResolvedValue({
      id: 'note-001', conversationId: 'conv-001', content: 'Nota interna',
      authorId: 'user-001', referenceType: 'conversation', referenceId: 'conv-001',
      createdAt: new Date(),
    } as any);

    const result = await createNote({
      content: 'Nota interna', authorId: 'user-001',
      conversationId: 'conv-001', userId: 'user-001',
    });

    expect(result.isOk()).toBe(true);
    expect(noteRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-001', referenceType: 'conversation', referenceId: 'conv-001' })
    );
  });

  it('deve criar nota com taskId (compat retroativa)', async () => {
    vi.mocked(noteRepository.create).mockResolvedValue({
      id: 'note-002', taskId: 'task-001', content: 'Nota da task',
      authorId: 'user-001', referenceType: 'task', referenceId: 'task-001',
      createdAt: new Date(),
    } as any);

    const result = await createNote({
      content: 'Nota da task', authorId: 'user-001', taskId: 'task-001',
    });

    expect(result.isOk()).toBe(true);
  });

  it('deve criar nota com referenceType tutor', async () => {
    vi.mocked(noteRepository.create).mockResolvedValue({
      id: 'note-003', content: 'Nota do tutor',
      authorId: 'user-001', referenceType: 'tutor', referenceId: 'tutor-001',
      createdAt: new Date(),
    } as any);

    const result = await createNote({
      content: 'Nota do tutor', authorId: 'user-001',
      referenceType: 'tutor', referenceId: 'tutor-001',
    });

    expect(result.isOk()).toBe(true);
    expect(noteRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ referenceType: 'tutor', referenceId: 'tutor-001' })
    );
  });

  it('deve criar nota com referenceType patient', async () => {
    vi.mocked(noteRepository.create).mockResolvedValue({
      id: 'note-004', content: 'Nota do paciente',
      authorId: 'user-001', referenceType: 'patient', referenceId: 'patient-001',
      createdAt: new Date(),
    } as any);

    const result = await createNote({
      content: 'Nota do paciente', authorId: 'user-001',
      referenceType: 'patient', referenceId: 'patient-001',
    });

    expect(result.isOk()).toBe(true);
  });
});
