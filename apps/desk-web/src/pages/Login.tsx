import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../lib/api';
import { useAuthStore } from '../store/auth';
import './Login.css';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/inbox');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Erro ao fazer login'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-bg">
        <div className="bg-grid" />
      </div>

      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">CVG</div>
          <h1>CVG Connect Desk</h1>
          <p>Sistema de Atendimento Digital</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && <div className="login-error">{error}</div>}

          <div className="input-group">
            <span className="input-icon">@</span>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>

          <div className="input-group">
            <span className="input-icon">#</span>
            <input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? <span className="btn-spinner" /> : 'Entrar'}
          </button>
        </form>

        <div className="login-footer">
          <span>CVG Connect Desk v1.0</span>
        </div>
      </div>
    </div>
  );
}
