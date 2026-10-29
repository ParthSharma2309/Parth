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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[4px] transition-opacity duration-200"
      aria-modal="true"
      role="dialog"
      aria-labelledby="modal-title"
    >
      {/* Backdrop click area */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Modal surface with 36px radius and var(--sh) */}
      <div
        style={{
          borderRadius: '36px',
          boxShadow: 'var(--sh)',
        }}
        className={`relative w-full ${maxWidthClass} bg-[var(--card)] border border-[color-mix(in_srgb,var(--mute)_24%,transparent)] overflow-hidden flex flex-col max-h-[90vh] text-[var(--ink)]`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4.5 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)] bg-[color-mix(in_srgb,var(--card)_94%,var(--ink))]">
          <div>
            <h3 id="modal-title" className="text-lg font-bold text-[var(--ink)]">
              {title}
            </h3>
            {description && (
              <p className="font-sans text-xs text-[var(--mute)] mt-0.5">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[var(--mute)] hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] rounded-full transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content body */}
        <div className="px-6 py-5 overflow-y-auto text-sm text-[var(--ink)] font-sans leading-relaxed">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-[color-mix(in_srgb,var(--mute)_18%,transparent)] bg-[color-mix(in_srgb,var(--card)_94%,var(--ink))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
