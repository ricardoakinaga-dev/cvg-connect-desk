import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
  leadingIcon?: IconName;
  containerClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, leadingIcon, containerClassName, className, id, ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const classes = ['ui-input', className].filter(Boolean).join(' ');

  return (
    <div className={['ui-field', containerClassName].filter(Boolean).join(' ')}>
      <label className="ui-field__label" htmlFor={inputId}>{label}</label>
      <div className="ui-field__control">
        {leadingIcon ? <Icon name={leadingIcon} size={18} /> : null}
        <input
          ref={ref}
          id={inputId}
          className={classes}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
      </div>
      {hint ? <p id={hintId} className="ui-field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="ui-field__error" role="alert">{error}</p> : null}
    </div>
  );
});
