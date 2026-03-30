import { useState, useEffect } from 'react';
import { useAuthStore } from '../store/auth';
import { api } from '../lib/api';
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

export function Settings() {
  const { user, token } = useAuthStore();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [passwords, setPasswords] = useState({ current: '', newPass: '', confirm: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const data = await api.get<UserProfile>('/auth/me');
        setProfile(data);
      } catch {
        // fallback to store data
        if (user) {
          setProfile({
            id: user.id,
            name: user.name,
            email: user.email,
            isActive: true,
            createdAt: new Date().toISOString(),
            roles: user.roles || [],
            permissions: [],
          });
        }
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user, token]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (passwords.newPass !== passwords.confirm) {
      setMessage({ type: 'error', text: 'As senhas não coincidem.' });
      return;
    }
    if (passwords.newPass.length < 6) {
      setMessage({ type: 'error', text: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.newPass,
      });
      setMessage({ type: 'success', text: 'Senha alterada com sucesso!' });
      setPasswords({ current: '', newPass: '', confirm: '' });
      setShowPassword(false);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Erro ao alterar senha.' });
    }
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  if (loading) return <div className="settings-page"><div className="loading">Carregando...</div></div>;

  return (
    <div className="settings-page">
      <div className="page-header">
        <h2>👤 Configurações</h2>
      </div>

      {message && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      {/* Perfil */}
      <div className="settings-section">
        <h3>📋 Perfil</h3>
        <div className="profile-card">
          <div className="profile-avatar">
            {profile?.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="profile-info">
            <div className="profile-name">{profile?.name}</div>
            <div className="profile-email">{profile?.email}</div>
            <div className="profile-meta">
              <span className={`badge ${profile?.isActive ? 'active' : 'inactive'}`}>
                {profile?.isActive ? 'Ativo' : 'Inativo'}
              </span>
              <span className="profile-date">Membro desde {profile?.createdAt ? formatDate(profile.createdAt) : '—'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Papéis */}
      <div className="settings-section">
        <h3>🔑 Papéis Atribuídos</h3>
        <div className="roles-list">
          {profile?.roles && profile.roles.length > 0 ? (
            profile.roles.map(role => (
              <span key={role} className="role-badge">{role}</span>
            ))
          ) : (
            <span className="no-data">Nenhum papel atribuído</span>
          )}
        </div>
      </div>

      {/* Permissões */}
      <div className="settings-section">
        <h3>🛡️ Permissões</h3>
        <div className="permissions-grid">
          {profile?.permissions && profile.permissions.length > 0 ? (
            profile.permissions.map(perm => (
              <div key={perm} className="permission-item">
                <span className="permission-check">✓</span>
                <span>{perm}</span>
              </div>
            ))
          ) : (
            <span className="no-data">Permissões serão exibidas quando disponíveis via API</span>
          )}
        </div>
      </div>

      {/* Alterar Senha */}
      <div className="settings-section">
        <h3>
          🔒 Segurança
          <button className="btn-toggle" onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? 'Cancelar' : 'Alterar Senha'}
          </button>
        </h3>
        {showPassword && (
          <form className="password-form" onSubmit={handlePasswordChange}>
            <input type="password" placeholder="Senha atual" value={passwords.current} onChange={e => setPasswords({ ...passwords, current: e.target.value })} required />
            <input type="password" placeholder="Nova senha" value={passwords.newPass} onChange={e => setPasswords({ ...passwords, newPass: e.target.value })} required />
            <input type="password" placeholder="Confirmar nova senha" value={passwords.confirm} onChange={e => setPasswords({ ...passwords, confirm: e.target.value })} required />
            <button type="submit" className="btn-primary">Salvar Nova Senha</button>
          </form>
        )}
      </div>

      {/* Sessão */}
      <div className="settings-section">
        <h3>ℹ️ Sessão</h3>
        <div className="session-info">
          <div><strong>ID do Usuário:</strong> <code>{profile?.id}</code></div>
          <div><strong>Token:</strong> <code>{token ? `${token.slice(0, 20)}...` : 'N/A'}</code></div>
        </div>
      </div>
    </div>
  );
}
