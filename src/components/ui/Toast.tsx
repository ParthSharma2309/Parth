import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { CheckCircle2, AlertTriangle, Info, X, RotateCcw } from 'lucide-react';

export interface ToastItem {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info';
  undoAction?: () => void;
  undoLabel?: string;
  duration?: number;
}

interface ToastContextType {
  showToast: (toast: Omit<ToastItem, 'id'>) => string;
  dismissToast: (id: string) => void;
}

const defaultContext: ToastContextType = {
  showToast: (toast) => {
    console.log('[Toast fallback]', toast.message);
    return 'fallback_toast';
  },
  dismissToast: () => {},
};

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  return context || defaultContext;
}

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<string, any>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({ message, type = 'info', undoAction, undoLabel = 'Undo', duration = 5000 }: Omit<ToastItem, 'id'>) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newToast: ToastItem = { id, message, type, undoAction, undoLabel, duration };

      setToasts((prev) => [...prev.slice(-3), newToast]);

      const timer = setTimeout(() => {
        dismissToast(id);
      }, duration);
      timersRef.current.set(id, timer);

      return id;
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {/* Toast container floating near bottom */}
      <div className="fixed bottom-16 sm:bottom-6 right-4 sm:right-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            style={{
              borderRadius: '99px',
              boxShadow: 'var(--sh)',
            }}
            className="pointer-events-auto flex items-center justify-between gap-3 px-5 py-3 bg-[var(--card)] text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] animate-in fade-in slide-in-from-bottom-3 duration-200"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {toast.type === 'success' && <CheckCircle2 size={16} className="text-[var(--teal)] shrink-0" />}
              {toast.type === 'error' && <AlertTriangle size={16} className="text-[var(--err)] shrink-0" />}
              {toast.type === 'info' && <Info size={16} className="text-[var(--a1)] shrink-0" />}
              <span className="text-xs sm:text-sm font-semibold truncate">{toast.message}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {toast.undoAction && (
                <button
                  type="button"
                  onClick={() => {
                    toast.undoAction?.();
                    dismissToast(toast.id);
                  }}
                  className="btn sm !py-1 !px-3 !text-xs cursor-pointer"
                >
                  <RotateCcw size={11} />
                  <span>{toast.undoLabel || 'Undo'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="p-1 text-[var(--mute)] hover:text-[var(--ink)] rounded-full transition-colors cursor-pointer"
                aria-label="Dismiss toast"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
