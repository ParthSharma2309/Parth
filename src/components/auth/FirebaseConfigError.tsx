import React, { useState } from 'react';
import { AlertTriangle, Copy, Check, ShieldAlert, ArrowRight, RefreshCw, KeyRound } from 'lucide-react';
import { missingFirebaseKeys } from '../../lib/firebase.ts';

interface FirebaseConfigErrorProps {
  onContinueAsGuest: () => void;
}

export const FirebaseConfigError: React.FC<FirebaseConfigErrorProps> = ({ onContinueAsGuest }) => {
  const [copied, setCopied] = useState(false);

  const envSnippet = `# Add your Firebase Client SDK configuration to .env:
VITE_FIREBASE_API_KEY="AIzaSy..."
VITE_FIREBASE_AUTH_DOMAIN="your-app.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="your-project-id"
VITE_FIREBASE_STORAGE_BUCKET="your-app.firebasestorage.app"
VITE_FIREBASE_MESSAGING_SENDER_ID="123456789012"
VITE_FIREBASE_APP_ID="1:123456789012:web:abcdef123456"`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(envSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[var(--bg-main)] text-[var(--fg-main)] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-[var(--surface)] border border-[color-mix(in_srgb,var(--amber)_40%,transparent)] rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden backdrop-blur-xl">
        <div className="absolute top-0 right-0 w-80 h-80 bg-[color-mix(in_srgb,var(--amber)_10%,transparent)] rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

        <div className="flex items-start gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-[color-mix(in_srgb,var(--amber)_15%,transparent)] text-[var(--amber)] flex items-center justify-center shrink-0 border border-[color-mix(in_srgb,var(--amber)_30%,transparent)]">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Firebase Configuration Missing</h1>
            <p className="text-sm text-[var(--mute)] mt-1">
              DocuMind requires Firebase for multi-device cloud synchronization, authentication, and PDF cloud storage.
            </p>
          </div>
        </div>

        <div className="bg-[color-mix(in_srgb,var(--bg-main)_70%,transparent)] border border-[var(--border)] rounded-2xl p-4 mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--amber)] flex items-center gap-2 mb-2">
            <KeyRound className="w-3.5 h-3.5" /> Missing Environment Variables:
          </h2>
          <div className="flex flex-wrap gap-2">
            {missingFirebaseKeys.map((key) => (
              <span
                key={key}
                className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-[color-mix(in_srgb,var(--amber)_12%,transparent)] text-[var(--amber)] border border-[color-mix(in_srgb,var(--amber)_25%,transparent)]"
              >
                {key}
              </span>
            ))}
          </div>
        </div>

        <div className="relative mb-6">
          <div className="flex items-center justify-between text-xs text-[var(--mute)] mb-1.5 px-1">
            <span>Expected configuration in <code className="text-[var(--fg-main)]">.env</code>:</span>
            <button
              onClick={copyToClipboard}
              className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)] hover:underline"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy template'}
            </button>
          </div>
          <pre className="text-xs font-mono bg-black/60 border border-[var(--border)] rounded-2xl p-4 overflow-x-auto text-emerald-400">
            {envSnippet}
          </pre>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-[var(--border)]">
          <button
            onClick={() => window.location.reload()}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-[var(--border)] text-xs font-semibold hover:bg-[color-mix(in_srgb,var(--surface-hover)_50%,transparent)] transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Reload after updating .env
          </button>

          <button
            onClick={onContinueAsGuest}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white font-medium text-xs shadow-lg shadow-amber-500/20 hover:brightness-110 transition-all cursor-pointer"
          >
            Continue as Guest (Local-Only Mode)
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
