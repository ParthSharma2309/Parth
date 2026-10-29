import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  disabled,
  ...props
}) => {
  let variantClass = 'btn';
  if (variant === 'secondary' || variant === 'ghost') {
    variantClass = 'btn outline';
  } else if (variant === 'danger') {
    variantClass = 'btn !bg-[var(--err)] !shadow-[0_10px_22px_-8px_var(--err)]';
  }

  const sizeClass = size === 'sm' ? 'sm' : '';

  return (
    <button
      className={`${variantClass} ${sizeClass} ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
