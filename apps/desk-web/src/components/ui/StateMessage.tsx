import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = 'Carregando…', className }: LoadingStateProps) {
  return (
    <div className={['ui-state', 'ui-loading', className].filter(Boolean).join(' ')} role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
      <p className="ui-state__description">{label}</p>
    </div>
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconName;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon = 'info', action, className }: EmptyStateProps) {
  return (
    <div className={['ui-state', 'ui-empty', className].filter(Boolean).join(' ')}>
      <span className="ui-state__icon" aria-hidden="true"><Icon name={icon} size={28} /></span>
      <div className="ui-state__body">
        <p className="ui-state__title">{title}</p>
        {description ? <p className="ui-state__description">{description}</p> : null}
        {action}
      </div>
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({ title = 'Não foi possível carregar', message, onRetry, retryLabel = 'Tentar novamente', className }: ErrorStateProps) {
  return (
    <div className={['ui-state', 'ui-error', className].filter(Boolean).join(' ')} role="alert">
      <span className="ui-error__icon" aria-hidden="true"><Icon name="warning" size={28} /></span>
      <div className="ui-state__body">
        <p className="ui-state__title">{title}</p>
        {message ? <p className="ui-state__description ui-error__message">{message}</p> : null}
        {onRetry ? <Button variant="secondary" size="sm" icon="refresh" onClick={onRetry}>{retryLabel}</Button> : null}
      </div>
    </div>
  );
}
