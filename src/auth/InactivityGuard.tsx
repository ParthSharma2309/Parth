import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, ShieldAlert, LogOut, CheckCircle } from 'lucide-react';
import { useAuth } from './AuthProvider.tsx';

interface InactivityGuardProps {
  timeoutMinutes?: number; // default: 30 minutes, 0 = disabled
}

export const InactivityGuard: React.FC<InactivityGuardProps> = ({ timeoutMinutes = 30 }) => {
  const { user, signOut } = useAuth();
  const [showWarning, setShowWarning] = useState<boolean>(false);
  const [secondsLeft, setSecondsLeft] = useState<number>(60);

  const lastActivityRef = useRef<number>(Date.now());
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  const timeoutMs = (timeoutMinutes || 30) * 60 * 1000;
  const warningLeadMs = 60 * 1000; // 60-second lead warning

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setShowWarning(false);
    setSecondsLeft(60);
  }, []);

  const handleStaySignedIn = () => {
    resetTimer();
  };

  const handleManualSignOut = () => {
    setShowWarning(false);
    signOut();
  };

  useEffect(() => {
    if (!user || timeoutMinutes <= 0) {
      setShowWarning(false);
      return;
    }

    const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
    const handleActivity = () => {
      // Only reset activity timestamp if warning modal is not currently displayed
      if (!showWarning) {
        lastActivityRef.current = Date.now();
      }
    };

    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));

    // Check timer every 2 seconds
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = now - lastActivityRef.current;
      const remainingMs = timeoutMs - elapsed;

      if (remainingMs <= 0) {
        // Inactivity limit reached - force sign out
        setShowWarning(false);
        signOut();
      } else if (remainingMs <= warningLeadMs) {
        setShowWarning(true);
        setSecondsLeft(Math.max(1, Math.ceil(remainingMs / 1000)));
      } else {
        setShowWarning(false);
      }
    }, 1000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleActivity));
      clearInterval(interval);
    };
  }, [user, timeoutMinutes, timeoutMs, warningLeadMs, showWarning, signOut]);

  if (!showWarning || !user) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 max-w-sm w-full animate-bounce-short">
      <div className="bg-[var(--surface)] border border-[color-mix(in_srgb,var(--amber)_50%,transparent)] rounded-2xl p-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/30">
            <Clock className="w-5 h-5 animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                Inactivity Warning
              </h4>
              <span className="text-xs font-mono font-bold text-amber-300 px-1.5 py-0.5 rounded bg-amber-500/20">
                {secondsLeft}s
              </span>
            </div>
            <p className="text-xs text-[var(--mute)] mt-1">
              You will be automatically signed out due to inactivity in {secondsLeft} seconds.
            </p>

            <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={handleStaySignedIn}
                className="flex-1 py-1.5 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-white font-semibold text-xs shadow hover:brightness-110 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Stay Signed In
              </button>
              <button
                type="button"
                onClick={handleManualSignOut}
                className="py-1.5 px-3 rounded-lg border border-[var(--border)] text-xs text-[var(--mute)] hover:text-rose-400 hover:border-rose-500/40 transition-colors flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
