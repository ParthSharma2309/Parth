import React, { useState, useEffect } from 'react';
import { WifiOff, AlertTriangle } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const [isOffline, setIsOffline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? !navigator.onLine : false;
  });

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full bg-[#17133b] text-[#ffd23f] px-4 py-2 text-xs flex items-center justify-between gap-3 border-b border-[#ffd23f]/30 z-50 shrink-0"
    >
      <div className="flex items-center gap-2">
        <WifiOff size={14} className="shrink-0 text-[#ff7a2f]" />
        <span className="font-semibold">Offline Mode</span>
        <span className="text-white/80 hidden sm:inline">
          — Your local documents, notes, and previous answers remain fully readable. New AI queries require an active connection.
        </span>
      </div>
      <span className="mono text-[11px] text-[#ffd23f] px-2 py-0.5 rounded-full bg-white/10 shrink-0">
        IndexedDB Active
      </span>
    </div>
  );
};
