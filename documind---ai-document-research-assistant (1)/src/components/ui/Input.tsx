import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-[#1C1914]">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`h-10 w-full px-3.5 bg-[#FBF8F2] text-[#1C1914] placeholder-[#5C564C]/60 text-sm rounded-[4px] border border-[#D9D0C3] focus:border-[#9A6B2F] focus:outline-none focus:ring-1 focus:ring-[#9A6B2F] transition-colors disabled:opacity-50 disabled:bg-[#F3EEE4] ${
            error ? 'border-[#9F1239] focus:border-[#9F1239] focus:ring-[#9F1239]' : ''
          } ${className}`}
          {...props}
        />
        {error && <p className="text-xs text-[#9F1239] font-mono">{error}</p>}
        {!error && helperText && <p className="text-xs text-[#5C564C]">{helperText}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
