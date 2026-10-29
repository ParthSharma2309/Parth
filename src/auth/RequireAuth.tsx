import React, { useState } from 'react';
import { useAuth } from './AuthProvider.tsx';
import { LoginPage } from '../components/auth/LoginPage.tsx';
import { InactivityGuard } from './InactivityGuard.tsx';
import { AlertCircle, Mail, CheckCircle2, RefreshCw } from 'lucide-react';

interface RequireAuthProps {
  children: React.ReactNode;
  currentTabName?: string;
  autoSignOutMinutes?: number;
  onLoginSuccess?: () => void;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({
  children,
  currentTabName,
  autoSignOutMinutes = 30,
  onLoginSuccess,
}) => {
  const { user, loading, isGuest, sendVerification } = useAuth();
  const [resendingVerification, setResendingVerification] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-main)] text-[var(--fg-main)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
          <p className="text-xs text-[var(--mute)] font-medium">Verifying DocuMind Session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage targetTabName={currentTabName} onSuccess={onLoginSuccess} />;
  }

  const handleResend = async () => {
    setResendingVerification(true);
    setResendStatus(null);
    try {
      await sendVerification();
      setResendStatus('Verification email sent! Please check your inbox.');
    } catch (err: unknown) {
      setResendStatus(err instanceof Error ? err.message : 'Failed to send email.');
    } finally {
      setResendingVerification(false);
    }
  };

  const needsEmailVerification = !isGuest && user && !('isGuest' in user) && !user.emailVerified;

  return (
    <>
      {/* Email verification banner if signed up with unverified email */}
      {needsEmailVerification && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 text-amber-300 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 z-40 relative">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 shrink-0 text-amber-400" />
            <span>
              <strong>Email Verification Required:</strong> Please verify your email (
              <span className="font-mono">{user.email}</span>) to enable cloud synchronization.
              Local research features remain fully functional.
            </span>
          </div>
          <div className="flex items-center gap-2">
            {resendStatus && <span className="text-[11px] text-emerald-400">{resendStatus}</span>}
            <button
              onClick={handleResend}
              disabled={resendingVerification}
              className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 font-medium text-amber-200 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              {resendingVerification ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Resend verification email
            </button>
          </div>
        </div>
      )}

      {children}

      <InactivityGuard timeoutMinutes={autoSignOutMinutes} />
    </>
  );
};
