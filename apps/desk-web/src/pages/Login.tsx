import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState, Icon } from '../components/ui';
import { useAuthStore } from '../store/auth';
import './Login.css';

type LoginErrorKind = 'none' | 'offline' | 'invalid' | 'forbidden' | 'rate-limit' | 'server' | 'unknown';

interface LoginError {
  kind: LoginErrorKind;
  message: string;
}

function describeLoginError(error: unknown, online: boolean): LoginError {
  const err = (error ?? {}) as { status?: unknown; message?: unknown };
  const status = typeof err.status === 'number' ? err.status : undefined;
  const serverMessage = typeof err.message === 'string' ? err.message : '';

  if (!online) {
    return { kind: 'offline', message: 'Sem conexão com a internet. Verifique sua rede e tente novamente.' };
  }
  if (status === 0 || serverMessage === 'Failed to fetch' || serverMessage === 'Network request failed') {
    return { kind: 'offline', message: 'Não foi possível alcançar o servidor. Verifique sua conexão e tente novamente.' };
  }
  if (status === 401) {
    return { kind: 'invalid', message: serverMessage || 'E-mail ou senha inválidos.' };
  }
  if (status === 403) {
    return { kind: 'forbidden', message: 'Seu usuário não tem permissão para acessar o CVG Connect Desk.' };
  }
  if (status === 429) {
    return { kind: 'rate-limit', message: 'Muitas tentativas de acesso. Aguarde alguns instantes e tente novamente.' };
  }
  if (status !== undefined && status >= 500) {
    return { kind: 'server', message: 'O servidor não conseguiu concluir o login. Tente novamente em instantes.' };
  }
  return { kind: 'unknown', message: serverMessage || 'Não foi possível entrar.' };
}

/** Estado real da rede do navegador; nunca é um texto fixo de "Online". */
function useNetworkStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return online;
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, sessionNotice } = useAuthStore();
  const navigate = useNavigate();
  const online = useNetworkStatus();

  const submit = async () => {
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate('/inbox');
    } catch (err: unknown) {
      setError(describeLoginError(err, online));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit();
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
        <div className={`login-presence ${online ? '' : 'is-offline'}`} role="status" aria-live="polite">
          <span className="presence-pulse" aria-hidden="true" />
          <span>
            <strong>{online ? 'Rede disponível' : 'Sem conexão'}</strong>
            <small>{online ? 'A autenticação é verificada no acesso' : 'Verifique sua rede antes de entrar'}</small>
          </span>
        </div>
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
          <form className="login-form" onSubmit={handleSubmit} aria-busy={loading}>
            {sessionNotice && (
              <p className="login-notice" role="status" aria-live="polite">
                <Icon name="info" size={16} /><span>{sessionNotice}</span>
              </p>
            )}
            {error && (
              <ErrorState
                className="login-error"
                title={error.kind === 'forbidden' ? 'Acesso negado' : 'Não foi possível entrar'}
                message={error.message}
                onRetry={error.kind === 'forbidden' ? undefined : () => void submit()}
              />
            )}
            <label className="login-field">
              <span>Email</span>
              <span className="field-control"><Icon name="contacts" size={19} /><input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" disabled={loading} autoFocus /></span>
            </label>
            <label className="login-field">
              <span>Senha</span>
              <span className="field-control"><Icon name="settings" size={19} /><input type={showPassword ? 'text' : 'password'} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" disabled={loading} /><button type="button" className="password-toggle" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword((value) => !value)} disabled={loading}><Icon name={showPassword ? 'eyeOff' : 'eye'} size={19} /></button></span>
            </label>
            <button type="submit" className="btn-login" disabled={loading} aria-busy={loading}>
              {loading
                ? <><span className="btn-spinner" aria-hidden="true" /><span role="status" aria-live="polite">Autenticando…</span></>
                : <>Entrar <Icon name="send" size={18} /></>}
            </button>
          </form>
          <div className="login-footer"><Icon name="activity" size={16} /><span>Ambiente operacional do CVG</span><strong>v1.0</strong></div>
        </div>
      </section>
    </main>
  );
}
