import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, style, ...props }, ref) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div className="w-full space-y-1.5 font-sans">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-semibold text-[var(--ink)]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          style={{
            borderRadius: '99px',
            background: 'var(--card)',
            color: 'var(--ink)',
            borderColor: error ? 'var(--err)' : 'color-mix(in srgb, var(--mute) 24%, transparent)',
            ...style,
          }}
          className={`h-11 w-full px-5 text-sm border focus:outline-hidden focus:border-[var(--a1)] transition-all duration-200 placeholder:text-[var(--mute)]/60 disabled:opacity-50 ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-[var(--err)] font-medium">{error}</p>}
        {!error && helperText && <p className="text-xs text-[var(--mute)]">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
