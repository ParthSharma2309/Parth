import React from 'react';

export interface PanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  variant?: 'paper' | 'canvas' | 'night';
}

export const Panel: React.FC<PanelProps> = ({
  children,
  variant = 'paper',
  className = '',
  ...props
}) => {
  const bgStyles = {
    paper: 'bg-[#FBF8F2] border-[#D9D0C3] text-[#1C1914]',
    canvas: 'bg-[#F3EEE4] border-[#D9D0C3] text-[#1C1914]',
    night: 'bg-[#14110E] border-[#D9D0C3]/20 text-[#F3EEE4]',
  }[variant];

  return (
    <div
      className={`rounded-[8px] border p-5 ${bgStyles} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
