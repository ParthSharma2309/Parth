import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = 'md',
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const maxWidthClass = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  }[maxWidth];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-[2px] transition-opacity duration-200"
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      {/* Backdrop click area */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal surface */}
      <div
        className={`relative w-full ${maxWidthClass} bg-[#18181a] rounded-[4px] shadow-2xl border border-[rgba(242,239,235,0.15)] overflow-hidden flex flex-col max-h-[90vh] text-[#f2efeb]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(242,239,235,0.1)] bg-[#0e0e0f]">
          <div>
            <h2 id="modal-title" className="font-syne text-base font-bold text-[#f2efeb] uppercase tracking-tight">
              {title}
            </h2>
            {description && (
              <p className="font-sans text-xs text-[#f2efeb]/60 mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#f2efeb]/60 hover:text-[#f2efeb] hover:bg-[#222226] rounded-[2px] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content body */}
        <div className="px-6 py-5 overflow-y-auto text-sm text-[#f2efeb] font-sans leading-relaxed">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-6 py-3.5 border-t border-[rgba(242,239,235,0.1)] bg-[#0e0e0f]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
