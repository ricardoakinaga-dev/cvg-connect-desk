import type { ElementType, HTMLAttributes } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export function Card({ as = 'div', interactive = false, padding = 'md', className, children, ...rest }: CardProps) {
  const Tag = as;
  const classes = ['ui-card'];
  if (interactive) classes.push('ui-card--interactive');
  if (padding !== 'md') classes.push(`ui-card--${padding}`);
  if (className) classes.push(className);
  return (
    <Tag className={classes.join(' ')} {...rest}>
      {children}
    </Tag>
  );
}
