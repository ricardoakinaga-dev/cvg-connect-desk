import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: IconName;
  status?: boolean;
  children: ReactNode;
}

const toneIcon: Record<BadgeTone, IconName> = {
  neutral: 'info',
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'warning',
};

export function Badge({ tone = 'neutral', icon, status = false, className, children, ...rest }: BadgeProps) {
  const glyph = icon ?? (status ? toneIcon[tone] : undefined);
  const classes = ['ui-badge', `ui-badge--${tone}`];
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} {...rest}>
      {glyph ? <Icon name={glyph} size={12} /> : null}
      {children}
    </span>
  );
}
