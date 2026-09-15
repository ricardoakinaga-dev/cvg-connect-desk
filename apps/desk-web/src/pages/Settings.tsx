import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, TextField } from '../components/ui';
import './Settings.css';

interface UserProfile {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  roles: string[];
  permissions: string[];
}

interface AuthMeResponse {
  user: Partial<UserProfile> & {
    id: string;
    name: string;
    email: string;
  };
}

interface LoadFailure {
  title: string;
  message: string;
  retryable: boolean;
}

interface PasswordErrors {
  current?: string;
  newPass?: string;
  confirm?: string;
}

function loadFailureFrom(error: unknown): LoadFailure {
  const status = (error as { status?: number } | null)?.status ?? 0;
  const raw = error instanceof Error ? error.message.trim() : '';
  if (status === 403) {
    return { title: 'Acesso negado', message: 'Você não tem permissão para ver este perfil.', retryable: false };
  }
  if (status === 401) {
    return { title: 'Sessão expirada', message: 'Entre novamente para continuar.', retryable: false };
  }
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (!status && (offline || /failed to fetch|network|sem conexão/i.test(raw))) {
    return { title: 'Sem conexão', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.', retryable: true };
  }
  return { title: 'Não foi possível carregar o perfil', message: raw || 'O servidor não respondeu como esperado.', retryable: true };
}

function messageFromError(error: unknown): string {
  const raw = error instanceof Error ? error.message.trim() : '';
  return raw || 'Erro ao alterar senha.';
}

export function Settings() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [passwordErrors, setPasswordErrors] = useState<PasswordErrors>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<AuthMeResponse>('/auth/me');
      const data = response.user;
      if (!data?.id || !data.name || !data.email) {
        throw new Error('O servidor não respondeu com um perfil válido.');
      }
      setProfile({
        id: data.id,
        name: data.name,
        email: data.email,
        isActive: data.isActive !== false,
        createdAt: data.createdAt ?? '',
        roles: data.roles ?? [],
        permissions: data.permissions ?? [],
      });
      setLoadError(null);
    } catch (error) {
      setLoadError(loadFailureFrom(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const openPasswordForm = () => {
    setShowPassword(true);
    setPasswordErrors({});
    setMessage(null);
  };

  const closePasswordForm = () => {
    if (saving) return;
    setShowPassword(false);
    setPasswordErrors({});
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    const errors: PasswordErrors = {};
    if (!passwords.current) errors.current = 'Informe a senha atual.';
    if (!passwords.newPass) errors.newPass = 'Informe a nova senha.';
    else if (passwords.newPass.length < 6) errors.newPass = 'A senha deve ter pelo menos 6 caracteres.';
    if (!passwords.confirm) errors.confirm = 'Confirme a nova senha.';
    else if (passwords.confirm !== passwords.newPass) errors.confirm = 'As senhas não coincidem.';

    if (errors.current || errors.newPass || errors.confirm) {
      setPasswordErrors(errors);
      setMessage(null);
      (errors.current ? currentPasswordRef : errors.newPass ? newPasswordRef : confirmPasswordRef).current?.focus();
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.newPass,
      });
      setMessage({ type: 'success', text: 'Senha alterada com sucesso!' });
      setPasswords({ current: '', newPass: '', confirm: '' });
      setPasswordErrors({});
      setShowPassword(false);
    } catch (err) {
      setMessage({ type: 'error', text: messageFromError(err) });
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="settings-page">
        <div className="page-header">
          <h1><Icon name="settings" /> Configurações</h1>
        </div>
        <LoadingState label="Carregando configurações…" />
      </div>
    );
  }

  if (loadError && !profile) {
    return (
      <div className="settings-page">
        <div className="page-header">
          <h1><Icon name="settings" /> Configurações</h1>
        </div>
        <ErrorState
          title={loadError.title}
          message={loadError.message}
          onRetry={loadError.retryable ? () => { void fetchProfile(); } : undefined}
        />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="settings-page">
        <div className="page-header">
          <h1><Icon name="settings" /> Configurações</h1>
        </div>
        <EmptyState
          title="Perfil indisponível"
          description="Não há dados de perfil para exibir no momento."
          icon="contacts"
        />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1><Icon name="settings" /> Configurações</h1>
      </div>

      {message && (
        <div className={`ui-alert ${message.type === 'success' ? 'ui-alert--success' : ''}`} role={message.type === 'success' ? 'status' : 'alert'}>
          <Icon name={message.type === 'success' ? 'check' : 'warning'} size={18} />
          <span>{message.text}</span>
        </div>
      )}

      {/* Perfil */}
      <div className="settings-section">
        <h2><Icon name="contacts" size={18} /> Perfil</h2>
        <div className="profile-card">
          <div className="profile-avatar" aria-hidden="true">
            {profile.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="profile-info">
            <div className="profile-name">{profile.name}</div>
            <div className="profile-email">{profile.email}</div>
            <div className="profile-meta">
              <Badge tone={profile.isActive ? 'success' : 'neutral'} status>{profile.isActive ? 'Ativo' : 'Inativo'}</Badge>
              <span className="profile-date">Membro desde {profile.createdAt ? formatDate(profile.createdAt) : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Papéis */}
      <div className="settings-section">
        <h2><Icon name="settings" size={18} /> Papéis atribuídos</h2>
        <div className="roles-list">
          {profile.roles && profile.roles.length > 0 ? (
            profile.roles.map(role => (
              <span key={role} className="role-badge">{role}</span>
            ))
          ) : (
            <span className="no-data">Nenhum papel atribuído.</span>
          )}
        </div>
      </div>

      {/* Permissões */}
      <div className="settings-section">
        <h2><Icon name="check" size={18} /> Permissões</h2>
        <div className="permissions-grid">
          {profile.permissions && profile.permissions.length > 0 ? (
            profile.permissions.map(perm => (
              <div key={perm} className="permission-item">
                <span className="permission-check" aria-hidden="true">✓</span>
                <span>{perm}</span>
              </div>
            ))
          ) : (
            <span className="no-data">Nenhuma permissão atribuída a este usuário.</span>
          )}
        </div>
      </div>

      {/* Alterar Senha */}
      <div className="settings-section">
        <h2>
          <span><Icon name="settings" size={18} /> Segurança</span>
          {showPassword ? (
            <Button variant="secondary" size="sm" onClick={closePasswordForm} disabled={saving}>Cancelar</Button>
          ) : (
            <Button variant="secondary" size="sm" icon="settings" onClick={openPasswordForm}>Alterar Senha</Button>
          )}
        </h2>
        {showPassword && (
          <form className="password-form" onSubmit={handlePasswordChange} noValidate>
            <TextField
              ref={currentPasswordRef}
              label="Senha atual"
              type="password"
              autoComplete="current-password"
              value={passwords.current}
              error={passwordErrors.current}
              disabled={saving}
              autoFocus
              onChange={e => { setPasswords({ ...passwords, current: e.target.value }); setPasswordErrors(current => ({ ...current, current: undefined })); }}
            />
            <TextField
              ref={newPasswordRef}
              label="Nova senha"
              type="password"
              autoComplete="new-password"
              value={passwords.newPass}
              error={passwordErrors.newPass}
              hint="Mínimo de 6 caracteres."
              disabled={saving}
              onChange={e => { setPasswords({ ...passwords, newPass: e.target.value }); setPasswordErrors(current => ({ ...current, newPass: undefined })); }}
            />
            <TextField
              ref={confirmPasswordRef}
              label="Confirmar nova senha"
              type="password"
              autoComplete="new-password"
              value={passwords.confirm}
              error={passwordErrors.confirm}
              disabled={saving}
              onChange={e => { setPasswords({ ...passwords, confirm: e.target.value }); setPasswordErrors(current => ({ ...current, confirm: undefined })); }}
            />
            <div className="password-form__actions">
              <Button type="submit" loading={saving}>{saving ? 'Salvando…' : 'Salvar Nova Senha'}</Button>
            </div>
          </form>
        )}
      </div>

      {/* Sessão */}
      <div className="settings-section">
        <h2><Icon name="info" size={18} /> Sessão</h2>
        <div className="session-info">
          <div><strong>ID do Usuário:</strong> <code>{profile.id}</code></div>
          <div><strong>Estado:</strong> <code>Sessão protegida</code></div>
          <div className="session-note">Os dados exibidos vêm de <code>/auth/me</code>; a credencial de sessão nunca é exibida na interface.</div>
        </div>
      </div>
    </div>
  );
}
