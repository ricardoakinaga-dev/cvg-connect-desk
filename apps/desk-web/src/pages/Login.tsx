import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/ui/Icon';
import { useAuthStore } from '../store/auth';
import './Login.css';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { await login(email, password); navigate('/inbox'); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : 'Erro ao fazer login'); }
    finally { setLoading(false); }
  };

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="CVG Connect Desk">
        <div className="login-visual-texture" />
        <div className="login-visual-copy">
          <span className="login-eyebrow"><i /> Centro Veterinário Guarapiranga</span>
          <h1>O plantão inteiro,<br /><em>em um só pulso.</em></h1>
          <p>Conversas, pacientes e prioridades conectados em uma central clínica precisa e humana.</p>
        </div>
        <img className="login-orbit" src="/assets/visual/cvg-orbit-pulso.webp" alt="" />
        <div className="login-presence"><span className="presence-pulse" /><span><strong>Operação disponível</strong><small>Canal interno protegido</small></span></div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <div className="login-header">
            <img className="login-logo" src="/assets/brand/cvg-logo.webp" alt="Logo do Centro Veterinário Guarapiranga" />
            <div><span className="login-product">CVG Connect</span><span className="login-product-detail">Desk operacional</span></div>
          </div>
          <div className="login-intro">
            <span className="login-kicker">Acesso seguro</span>
            <h2 id="login-title">Bem-vindo ao plantão.</h2>
            <p>Entre com suas credenciais para continuar.</p>
          </div>
          <form className="login-form" onSubmit={handleSubmit}>
            {error && <div className="login-error" role="alert" aria-live="polite"><Icon name="warning" size={18} /><span>{error}</span></div>}
            <label className="login-field">
              <span>Email</span>
              <span className="field-control"><Icon name="contacts" size={19} /><input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" autoFocus /></span>
            </label>
            <label className="login-field">
              <span>Senha</span>
              <span className="field-control"><Icon name="settings" size={19} /><input type={showPassword ? 'text' : 'password'} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /><button type="button" className="password-toggle" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword((value) => !value)}><Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} /></button></span>
            </label>
            <button type="submit" className="btn-login" disabled={loading} aria-busy={loading}>
              {loading ? <><span className="btn-spinner" /> Autenticando</> : <>Entrar <Icon name="send" size={18} /></>}
            </button>
          </form>
          <div className="login-footer"><Icon name="activity" size={16} /><span>Ambiente operacional do CVG</span><strong>v1.0</strong></div>
        </div>
      </section>
    </main>
  );
}
