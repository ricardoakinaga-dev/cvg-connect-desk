import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Contacts } from '../pages/Contacts';
import { Tutors } from '../pages/Tutors';
import { Patients } from '../pages/Patients';
import { Notes } from '../pages/Notes';

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
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
  api: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    patch: vi.fn(),
    put: mocks.apiPut,
    delete: mocks.apiDelete,
    upload: vi.fn(),
  },
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

function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

const contact = {
  id: 'contact_1',
  name: 'Marina Souza',
  phone: '11999990001',
  email: 'marina@example.com',
  createdAt: '2026-09-12T12:00:00.000Z',
};

const contactDetail = {
  ...contact,
  externalId: null,
  metadata: null,
  conversations: [
    { id: 'conv_1', status: 'open', statusV2: 'em_atendimento', createdAt: '2026-09-12T13:00:00.000Z', lastMessage: 'Retorno confirmado.' },
  ],
  notesCount: 1,
  tasksCount: 0,
  labels: [],
  groups: [],
};

const contactNotes = [
  { id: 'note_10', referenceType: 'conversation', referenceId: 'conv_1', content: 'Nota do contato', authorUserId: null, createdAt: '2026-09-12T14:00:00.000Z' },
];

const tutor = {
  id: 'tutor_1',
  externalId: null,
  name: 'Marina Souza',
  phone: '11999990001',
  email: 'marina@example.com',
  createdAt: '2026-09-12T12:00:00.000Z',
  updatedAt: '2026-09-12T12:00:00.000Z',
};

function setupContactsApi() {
  mocks.apiGet.mockImplementation((endpoint: string) => {
    if (endpoint === '/contacts') return Promise.resolve([contact]);
    if (endpoint === '/contacts/contact_1') return Promise.resolve(contactDetail);
    if (endpoint.startsWith('/notes')) return Promise.resolve(contactNotes);
    return Promise.resolve([]);
  });
}

function renderContacts() {
  return render(
    <MemoryRouter initialEntries={['/contacts']}>
      <Contacts />
    </MemoryRouter>
  );
}

describe('AAA-29 Contacts — estados reais e feedback', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('anuncia o carregamento da lista com role=status, não com spinner anônimo', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));

    renderContacts();

    const loading = screen.getByText('Carregando contatos…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 na lista vira role=alert com retry real e nunca vazio silencioso', async () => {
    mocks.apiGet
      .mockRejectedValueOnce(apiError('Falha simulada ao listar contatos', 500))
      .mockResolvedValue([contact]);

    renderContacts();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar contatos');
    expect(screen.queryByText('Nenhum contato encontrado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Marina Souza')).toBeTruthy();
    expect(mocks.apiGet).toHaveBeenCalledTimes(2);
  });

  it('403 na lista mostra acesso negado sem retry cego', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));

    renderContacts();

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(screen.queryByText('Nenhum contato encontrado')).toBeNull();
  });

  it('lista vazia real usa estado vazio, sem alerta', async () => {
    mocks.apiGet.mockResolvedValue([]);

    renderContacts();

    expect(await screen.findByText('Nenhum contato encontrado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('falha ao carregar o detalhe anuncia erro com retry e mantém a lista', async () => {
    mocks.apiGet
      .mockImplementationOnce(() => Promise.resolve([contact]))
      .mockRejectedValueOnce(apiError('Falha simulada ao carregar o contato', 500))
      .mockResolvedValue(contactDetail);

    renderContacts();
    fireEvent.click(await screen.findByText('Marina Souza'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao carregar o contato');
    expect(screen.getByText('Marina Souza')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Retorno confirmado.')).toBeTruthy();
  });

  it('falha nas notas do contato não vira “Nenhuma nota ainda” silencioso', async () => {
    mocks.apiGet
      .mockResolvedValueOnce([contact])
      .mockResolvedValueOnce(contactDetail)
      .mockRejectedValueOnce(apiError('Falha simulada nas notas', 500))
      .mockResolvedValue(contactNotes);

    renderContacts();
    fireEvent.click(await screen.findByText('Marina Souza'));
    fireEvent.click(await screen.findByRole('button', { name: 'Notas do contato' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Não foi possível carregar as notas');
    expect(screen.queryByText('Nenhuma nota ainda')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nota do contato')).toBeTruthy();
  });

  it('validação do cadastro foca o primeiro campo inválido sem chamar a API', async () => {
    setupContactsApi();
    renderContacts();
    await screen.findByText('Marina Souza');

    fireEvent.click(screen.getAllByRole('button', { name: 'Novo contato' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Criar Contato' }));

    const name = screen.getByLabelText('Nome *');
    const phone = screen.getByLabelText('Telefone *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(phone.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha ao criar mantém o diálogo aberto, os dados digitados e anuncia role=alert', async () => {
    setupContactsApi();
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao criar contato', 500));

    renderContacts();
    await screen.findByText('Marina Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Novo contato' })[0]);
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Contato Teste' } });
    fireEvent.change(screen.getByLabelText('Telefone *'), { target: { value: '11988887777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar Contato' }));

    const dialog = screen.getByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar contato');
    expect((screen.getByLabelText('Nome *') as HTMLInputElement).value).toBe('Contato Teste');
    expect((screen.getByLabelText('Telefone *') as HTMLInputElement).value).toBe('11988887777');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('criação bem-sucedida anuncia status, fecha o diálogo e recarrega a lista', async () => {
    setupContactsApi();
    mocks.apiPost.mockResolvedValue({ ...contact, id: 'contact_new' });
    mocks.apiGet.mockImplementation((endpoint: string) => {
      if (endpoint === '/contacts') return Promise.resolve([contact]);
      if (endpoint === '/contacts/contact_new') return Promise.resolve({ ...contactDetail, id: 'contact_new' });
      if (endpoint.startsWith('/notes')) return Promise.resolve(contactNotes);
      return Promise.resolve([]);
    });

    renderContacts();
    await screen.findByText('Marina Souza');
    fireEvent.click(screen.getAllByRole('button', { name: 'Novo contato' })[0]);
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Contato Teste' } });
    fireEvent.change(screen.getByLabelText('Telefone *'), { target: { value: '11988887777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar Contato' }));

    const feedback = await screen.findByText('Contato criado.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledWith('/contacts/contact_new'));
  });

  it('falha ao iniciar conversa usa role=alert e nunca window.alert', async () => {
    setupContactsApi();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao iniciar conversa', 500));

    renderContacts();
    fireEvent.click(await screen.findByText('Marina Souza'));
    await screen.findByText('Retorno confirmado.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Iniciar conversa' })[0]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao iniciar conversa');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('exclusão confirmada anuncia status; recusada não chama a API', async () => {
    setupContactsApi();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mocks.apiDelete.mockResolvedValue({ deleted: true });

    renderContacts();
    fireEvent.click(await screen.findByText('Marina Souza'));
    await screen.findByText('Retorno confirmado.');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir contato' }));

    const feedback = await screen.findByText('Contato excluído.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.apiDelete).toHaveBeenCalledWith('/contacts/contact_1');

    confirmSpy.mockReturnValue(false);
    fireEvent.click(screen.getByText('Marina Souza'));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir contato' }));
    expect(mocks.apiDelete).toHaveBeenCalledTimes(1);
  });
});

describe('AAA-29 Tutors — estados reais e feedback', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('anuncia o carregamento com role=status', () => {
    mocks.tutorList.mockImplementation(() => new Promise(() => {}));

    render(<Tutors />);

    const loading = screen.getByText('Carregando tutores…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 mostra erro real com retry e não exibe vazio falso', async () => {
    mocks.tutorList.mockRejectedValueOnce(apiError('Falha simulada ao listar tutores', 500)).mockResolvedValue([tutor]);

    render(<Tutors />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar tutores');
    expect(screen.queryByText('Nenhum tutor encontrado')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Marina Souza')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.tutorList.mockRejectedValue(apiError('Sem permissão', 403));

    render(<Tutors />);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa EmptyState com ação', async () => {
    mocks.tutorList.mockResolvedValue([]);

    render(<Tutors />);

    expect(await screen.findByText('Nenhum tutor encontrado')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('validação de nome em branco anuncia erro, marca aria-invalid e foca o campo', async () => {
    mocks.tutorList.mockResolvedValue([tutor]);
    render(<Tutors />);
    await screen.findByText('Marina Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Novo tutor' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const name = screen.getByLabelText('Nome *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.tutorCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('falha ao salvar mantém o diálogo, preserva o formulário e anuncia no diálogo', async () => {
    mocks.tutorList.mockResolvedValue([tutor]);
    mocks.tutorCreate.mockRejectedValue(apiError('Falha simulada ao salvar o tutor', 500));

    render(<Tutors />);
    await screen.findByText('Marina Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Novo tutor' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Tutor Teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const dialog = screen.getByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao salvar o tutor');
    expect((screen.getByLabelText('Nome *') as HTMLInputElement).value).toBe('Tutor Teste');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('salvamento bem-sucedido anuncia status e recarrega a lista', async () => {
    mocks.tutorList.mockResolvedValue([tutor]);
    mocks.tutorCreate.mockResolvedValue(tutor);

    render(<Tutors />);
    await screen.findByText('Marina Souza');
    fireEvent.click(screen.getByRole('button', { name: 'Novo tutor' }));
    fireEvent.change(screen.getByLabelText('Nome *'), { target: { value: 'Tutor Teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const feedback = await screen.findByText('Tutor cadastrado.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    expect(mocks.tutorCreate).toHaveBeenCalledWith({ name: 'Tutor Teste', phone: undefined, email: undefined });
    await waitFor(() => expect(mocks.tutorList).toHaveBeenCalledTimes(2));
  });

  it('falha no detalhe vira role=alert com retry', async () => {
    mocks.tutorList.mockResolvedValue([tutor]);
    mocks.tutorGet.mockRejectedValueOnce(apiError('Falha simulada no detalhe', 500)).mockResolvedValue({
      ...tutor,
      patients: [{ id: 'patient_1', name: 'Thor', species: 'Cachorro' }],
      conversationCount: 2,
      taskCount: 1,
    });

    render(<Tutors />);
    fireEvent.click(await screen.findByText('Marina Souza'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada no detalhe');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Thor')).toBeTruthy();
  });
});

describe('AAA-29 Patients — estados reais e feedback', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('falha ao carregar tutores no formulário é anunciada, sem fingir lista vazia, e o retry funciona', async () => {
    mocks.patientList.mockResolvedValue([]);
    mocks.tutorList.mockRejectedValue(apiError('Falha simulada ao listar tutores', 500));

    render(<Patients />);
    await screen.findByText('Nenhum paciente encontrado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Novo paciente' })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Não foi possível carregar a lista de tutores/)).toBeTruthy();
    expect(within(dialog).queryByRole('option', { name: /Sem tutor vinculado/ })).toBeNull();

    mocks.tutorList.mockResolvedValue([tutor]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(within(dialog).getByRole('option', { name: /Marina Souza/ })).toBeTruthy());
  });

  it('validação de nome vazio foca o campo e não chama a API', async () => {
    mocks.patientList.mockResolvedValue([]);
    mocks.tutorList.mockResolvedValue([tutor]);

    render(<Patients />);
    await screen.findByText('Nenhum paciente encontrado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Novo paciente' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const name = screen.getByLabelText('Nome do paciente *');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name);
    expect(mocks.patientCreate).not.toHaveBeenCalled();
  });

  it('falha ao salvar paciente preserva os dados e anuncia no diálogo', async () => {
    mocks.patientList.mockResolvedValue([]);
    mocks.tutorList.mockResolvedValue([tutor]);
    mocks.patientCreate.mockRejectedValue(apiError('Falha simulada ao salvar paciente', 500));

    render(<Patients />);
    await screen.findByText('Nenhum paciente encontrado');
    fireEvent.click(screen.getAllByRole('button', { name: 'Novo paciente' })[0]);
    fireEvent.change(screen.getByLabelText('Nome do paciente *'), { target: { value: 'Paciente Teste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    const dialog = screen.getByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao salvar paciente');
    expect((screen.getByLabelText('Nome do paciente *') as HTMLInputElement).value).toBe('Paciente Teste');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('AAA-29 Notes — estados reais e feedback', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('anuncia o carregamento com role=status', () => {
    mocks.apiGet.mockImplementation(() => new Promise(() => {}));

    render(<MemoryRouter><Notes /></MemoryRouter>);

    const loading = screen.getByText('Carregando notas…');
    expect(loading.closest('[role="status"]')).toBeTruthy();
  });

  it('falha 500 mostra role=alert com retry e não cai em vazio falso', async () => {
    mocks.apiGet.mockRejectedValueOnce(apiError('Falha simulada ao listar notas', 500)).mockResolvedValue([
      { id: 'note_1', referenceType: 'conversation', referenceId: 'conv_1', content: 'Nota real', authorUserId: null, createdAt: '2026-09-12T12:00:00.000Z' },
    ]);

    render(<MemoryRouter><Notes /></MemoryRouter>);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao listar notas');
    expect(screen.queryByText('Nenhuma nota registrada')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nota real')).toBeTruthy();
  });

  it('403 mostra acesso negado sem retry', async () => {
    mocks.apiGet.mockRejectedValue(apiError('Sem permissão', 403));

    render(<MemoryRouter><Notes /></MemoryRouter>);

    expect(await screen.findByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
  });

  it('lista vazia real usa EmptyState, sem alerta', async () => {
    mocks.apiGet.mockResolvedValue([]);

    render(<MemoryRouter><Notes /></MemoryRouter>);

    expect(await screen.findByText('Nenhuma nota registrada')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('validação exige conteúdo e referência, foca o campo e não chama a API', async () => {
    mocks.apiGet.mockResolvedValue([]);
    render(<MemoryRouter><Notes /></MemoryRouter>);
    await screen.findByText('Nenhuma nota registrada');
    fireEvent.click(screen.getAllByRole('button', { name: 'Nova nota' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Nota' }));

    const content = screen.getByLabelText('Conteúdo da nota');
    const reference = screen.getByLabelText('ID da referência');
    expect(content.getAttribute('aria-invalid')).toBe('true');
    expect(reference.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(content);
    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it('falha ao salvar nota preserva o texto digitado e anuncia o erro', async () => {
    mocks.apiGet.mockResolvedValue([]);
    mocks.apiPost.mockRejectedValue(apiError('Falha simulada ao criar nota', 500));

    render(<MemoryRouter><Notes /></MemoryRouter>);
    await screen.findByText('Nenhuma nota registrada');
    fireEvent.click(screen.getAllByRole('button', { name: 'Nova nota' })[0]);
    fireEvent.change(screen.getByLabelText('ID da referência'), { target: { value: 'conv_1' } });
    fireEvent.change(screen.getByLabelText('Conteúdo da nota'), { target: { value: 'Nota que não pode se perder' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Nota' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Falha simulada ao criar nota');
    expect((screen.getByLabelText('Conteúdo da nota') as HTMLTextAreaElement).value).toBe('Nota que não pode se perder');
    expect((screen.getByLabelText('ID da referência') as HTMLInputElement).value).toBe('conv_1');
  });

  it('sucesso anuncia status, limpa o formulário e recarrega as notas', async () => {
    mocks.apiGet.mockResolvedValue([]);
    mocks.apiPost.mockResolvedValue({ id: 'note_new' });

    render(<MemoryRouter><Notes /></MemoryRouter>);
    await screen.findByText('Nenhuma nota registrada');
    fireEvent.click(screen.getAllByRole('button', { name: 'Nova nota' })[0]);
    fireEvent.change(screen.getByLabelText('ID da referência'), { target: { value: 'conv_1' } });
    fireEvent.change(screen.getByLabelText('Conteúdo da nota'), { target: { value: 'Nova nota' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar Nota' }));

    const feedback = await screen.findByText('Nota registrada.');
    expect(feedback.closest('[role="status"]')).toBeTruthy();
    await waitFor(() => expect(mocks.apiGet).toHaveBeenCalledTimes(2));
  });

  it('filtro tem estado pressionado e vazio filtrado é distinto do vazio real', async () => {
    mocks.apiGet.mockResolvedValue([
      { id: 'note_1', referenceType: 'conversation', referenceId: 'conv_1', content: 'Nota real', authorUserId: null, createdAt: '2026-09-12T12:00:00.000Z' },
    ]);

    render(<MemoryRouter><Notes /></MemoryRouter>);
    await screen.findByText('Nota real');

    const todoChip = screen.getByRole('button', { name: 'Todos' });
    const taskChip = screen.getByRole('button', { name: 'Tarefa' });
    expect(todoChip.getAttribute('aria-pressed')).toBe('true');
    expect(taskChip.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(taskChip);
    expect(await screen.findByText('Nenhuma nota de Tarefa')).toBeTruthy();
    expect(screen.queryByText('Nenhuma nota registrada')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tarefa' }).getAttribute('aria-pressed')).toBe('true');
  });
});
