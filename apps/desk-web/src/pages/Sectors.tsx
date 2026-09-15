import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState } from '../components/ui';
import './Sectors.css';

interface Sector {
  id: string;
  name: string;
  code: string;
  description: string | null;
  color: string;
  icon: string;
  isActive: boolean;
  autoAssign: boolean;
  maxConcurrent: number;
}

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

function loadFailureFrom(error: unknown): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver os setores.', retryable: false };
  }
  if (status === 401) {
    return { title: 'Sessão expirada', message: 'Entre novamente para continuar.', retryable: false };
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!status && (offline || /failed to fetch|network|sem conexão/i.test(raw))) {
    return { title: 'Sem conexão', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.', retryable: true };
  }
  return { title: 'Não foi possível carregar', message: raw || 'O servidor não respondeu como esperado.', retryable: true };
}

function messageFromError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  return raw || 'Não foi possível concluir a operação.';
}

const emptySector = { name: '', code: '', description: '', color: '#4361ee', icon: '📋' };

export function Sectors() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newSector, setNewSector] = useState(emptySector);
  const [formErrors, setFormErrors] = useState<{ name?: string; code?: string }>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleErrors, setToggleErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const fetchSectors = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Sector[]>('/sectors?all=true');
      setSectors(Array.isArray(data) ? data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(loadFailureFrom(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchSectors(); }, [fetchSectors]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const openCreate = () => {
    setFormErrors({});
    setCreateError(null);
    setShowCreate(true);
  };

  const closeCreate = () => {
    if (saving) return;
    setShowCreate(false);
    setCreateError(null);
    setFormErrors({});
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const errors: { name?: string; code?: string } = {};
    if (!newSector.name.trim()) errors.name = 'Informe o nome do setor.';
    if (!newSector.code.trim()) errors.code = 'Informe o código do setor.';
    if (errors.name || errors.code) {
      setFormErrors(errors);
      setCreateError(null);
      (errors.name ? nameRef : codeRef).current?.focus();
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      await api.post('/sectors', {
        ...newSector,
        name: newSector.name.trim(),
        code: newSector.code.trim(),
        description: newSector.description.trim() || undefined,
      });
      setNewSector(emptySector);
      setShowCreate(false);
      setFeedback('Setor criado.');
      await fetchSectors();
    } catch (err) {
      setCreateError(messageFromError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (sector: Sector) => {
    if (togglingId) return;
    setTogglingId(sector.id);
    setToggleErrors(current => {
      if (!current[sector.id]) return current;
      const next = { ...current };
      delete next[sector.id];
      return next;
    });
    try {
      await api.put(`/sectors/${sector.id}`, { isActive: !sector.isActive });
      setFeedback(sector.isActive ? `Setor “${sector.name}” desativado.` : `Setor “${sector.name}” ativado.`);
      await fetchSectors();
    } catch (err) {
      setToggleErrors(current => ({ ...current, [sector.id]: messageFromError(err) }));
    } finally {
      setTogglingId(null);
    }
  };

  const iconOptions: Array<{ value: string; label: string }> = [
    { value: '📋', label: 'Triagem' }, { value: '🏥', label: 'Clínica' },
    { value: '🩺', label: 'Atendimento' }, { value: '🏨', label: 'Internação' },
    { value: '💊', label: 'Farmácia' }, { value: '🔬', label: 'Diagnóstico' },
    { value: '📞', label: 'Contato' }, { value: '🐾', label: 'Pacientes' },
  ];

  return (
    <div className="sectors-page" aria-busy={loading || undefined}>
      <div className="page-header">
        <h1><Icon name="sectors" /> Setores</h1>
        <Button icon={showCreate ? 'close' : 'plus'} onClick={() => (showCreate ? closeCreate() : openCreate())}>
          {showCreate ? 'Cancelar' : 'Novo setor'}
        </Button>
      </div>

      {feedback && (
        <div className="ui-alert ui-alert--success sectors-feedback" role="status">
          <Icon name="check" size={18} />
          <span>{feedback}</span>
        </div>
      )}

      {showCreate && (
        <form className="create-form" onSubmit={handleCreate} noValidate>
          {createError && (
            <div className="ui-alert create-form-error" role="alert">
              <Icon name="warning" size={18} />
              <span>Não foi possível criar o setor: {createError}. Os dados digitados foram mantidos.</span>
            </div>
          )}
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="sector-name">Nome *</label>
            <input
              ref={nameRef}
              id="sector-name"
              className="ui-input"
              maxLength={100}
              aria-invalid={formErrors.name ? true : undefined}
              aria-describedby={formErrors.name ? 'sector-name-error' : undefined}
              value={newSector.name}
              onChange={e => {
                setNewSector({ ...newSector, name: e.target.value });
                setFormErrors(current => ({ ...current, name: undefined }));
              }}
            />
            {formErrors.name && <p id="sector-name-error" className="ui-field__error" role="alert">{formErrors.name}</p>}
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor="sector-code">Código *</label>
            <input
              ref={codeRef}
              id="sector-code"
              className="ui-input"
              maxLength={50}
              placeholder="ex: recepcao"
              aria-invalid={formErrors.code ? true : undefined}
              aria-describedby={formErrors.code ? 'sector-code-error' : undefined}
              value={newSector.code}
              onChange={e => {
                setNewSector({ ...newSector, code: e.target.value.toLowerCase().replace(/\s/g, '-') });
                setFormErrors(current => ({ ...current, code: undefined }));
              }}
            />
            {formErrors.code && <p id="sector-code-error" className="ui-field__error" role="alert">{formErrors.code}</p>}
          </div>
          <div className="ui-field icon-field">
            <span className="ui-field__label" id="sector-icon-label">Ícone</span>
            <div className="icon-picker" role="group" aria-labelledby="sector-icon-label">
              {iconOptions.map(option => (
                <button
                  key={option.value}
                  aria-label={`Ícone ${option.label}`}
                  aria-pressed={newSector.icon === option.value}
                  title={option.label}
                  type="button"
                  className={`icon-option ${newSector.icon === option.value ? 'selected' : ''}`}
                  onClick={() => setNewSector({ ...newSector, icon: option.value })}
                >
                  <span aria-hidden="true">{option.value}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="ui-field color-field">
            <label className="ui-field__label" htmlFor="sector-color">Cor</label>
            <input aria-label="Cor do setor" id="sector-color" type="color" value={newSector.color} onChange={e => setNewSector({ ...newSector, color: e.target.value })} className="color-picker" />
          </div>
          <div className="ui-field description-field">
            <label className="ui-field__label" htmlFor="sector-description">Descrição (opcional)</label>
            <input id="sector-description" className="ui-input" value={newSector.description} onChange={e => setNewSector({ ...newSector, description: e.target.value })} />
          </div>
          <Button type="submit" loading={saving}>{saving ? 'Criando…' : 'Criar Setor'}</Button>
        </form>
      )}

      {loading ? (
        <LoadingState label="Carregando setores…" />
      ) : loadError ? (
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void fetchSectors(); } : undefined}
        />
      ) : sectors.length === 0 ? (
        <EmptyState
          title="Nenhum setor cadastrado"
          description="Crie o primeiro setor para organizar a operação."
          icon="sectors"
          action={<Button size="sm" icon="plus" onClick={openCreate}>Novo setor</Button>}
        />
      ) : (
        <div className="sectors-grid">
          {sectors.map(sector => (
            <div key={sector.id} className="sector-card" style={{ borderTopColor: sector.color }} aria-busy={togglingId === sector.id || undefined}>
              <div className="sector-icon" style={{ background: sector.color }} aria-hidden="true">{sector.icon}</div>
              <div className="sector-info">
                <div className="sector-name">{sector.name}</div>
                <div className="sector-code">{sector.code}</div>
                {sector.description && <div className="sector-desc">{sector.description}</div>}
                <div className="sector-badges">
                  <Badge tone={sector.isActive ? 'success' : 'neutral'} status={false}>{sector.isActive ? 'Ativo' : 'Inativo'}</Badge>
                  {sector.autoAssign && <Badge tone="info">Auto-assign</Badge>}
                  {sector.maxConcurrent > 0 && <Badge tone="neutral">Max: {sector.maxConcurrent}</Badge>}
                </div>
                {toggleErrors[sector.id] && (
                  <p className="sector-error" role="alert">Não foi possível atualizar o setor: {toggleErrors[sector.id]}</p>
                )}
              </div>
              <div className="sector-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={sector.isActive ? 'close' : 'check'}
                  disabled={Boolean(togglingId)}
                  loading={togglingId === sector.id}
                  aria-label={`${sector.isActive ? 'Desativar' : 'Ativar'} setor ${sector.name}`}
                  onClick={() => void handleToggleActive(sector)}
                >
                  {sector.isActive ? 'Desativar' : 'Ativar'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
