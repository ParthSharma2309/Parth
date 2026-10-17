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
  const baseStyles =
    'inline-flex items-center justify-center font-sans font-medium transition-colors cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#9A6B2F] focus:ring-offset-1';

  const sizeStyles = {
    sm: 'h-8 px-3 text-xs rounded-[3px] gap-1.5',
    md: 'h-10 px-4 text-[15px] rounded-[4px] gap-2',
    lg: 'h-12 px-6 text-base rounded-[4px] gap-2.5',
  }[size];

  const variantStyles = {
    primary: 'bg-[#1E4336] hover:bg-[#16352B] text-[#FBF8F2] border border-[#1E4336]',
    secondary: 'bg-transparent hover:bg-[#D9D0C3]/20 text-[#1C1914] border border-[#D9D0C3]',
    ghost: 'bg-transparent hover:bg-[#D9D0C3]/20 text-[#1C1914] border border-transparent',
    danger: 'bg-[#9F1239] hover:bg-[#800f2e] text-[#FBF8F2] border border-[#9F1239]',
  }[variant];

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
};
