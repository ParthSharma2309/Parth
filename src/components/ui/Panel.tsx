import React from 'react';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'paper' | 'canvas' | 'night';
}

export const Panel: React.FC<PanelProps> = ({
  children,
  variant = 'paper',
  className = '',
  style,
  ...props
}) => {
  return (
    <div
      style={{
        background: 'var(--card)',
        borderRadius: '36px',
        boxShadow: 'var(--sh)',
        ...style,
      }}
      className={`p-6 md:p-8 text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] transition-all duration-200 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
