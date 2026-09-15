import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, iconRight, disabled, className, type = 'button', children, ...rest },
  ref
) {
  const classes = ['ui-btn', `ui-btn--${variant}`];
  if (size !== 'md') classes.push(`ui-btn--${size}`);
  if (className) classes.push(className);

  return (
    <button
      ref={ref}
      type={type}
      className={classes.join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ui-spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={18} /> : null}
      {children}
      {!loading && iconRight ? <Icon name={iconRight} size={18} /> : null}
    </button>
  );
});
