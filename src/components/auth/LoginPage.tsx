import React, { useState, useEffect, useRef, useId } from 'react';
import {
  FileText,
  Mail,
  Lock,
  User,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Check,
  X,
  Laptop,
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  Clock,
  BookOpen,
  Library,
  HelpCircle,
  Copy,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { auth, isFirebaseConfigured } from '../../lib/firebase.ts';
import { useToast } from '../ui/Toast.tsx';

interface LoginPageProps {
  onSuccess?: () => void;
  targetTabName?: string;
}

type TabMode = 'signin' | 'signup';

interface PasswordCriteria {
  hasMinLength: boolean;
  hasUpperAndLower: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onSuccess, targetTabName }) => {
  const {
    signIn,
    signUp,
    signInWithGoogle,
    continueAsGuest,
    resetPassword,
    sendVerification,
    user,
  } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabMode>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  // Validation & Error states
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Forgot Password inline panel
  const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState('');
  const [forgotPasswordSuccess, setForgotPasswordSuccess] = useState(false);
  const [forgotPasswordTimer, setForgotPasswordTimer] = useState(0);

  // Email Verification Screen
  const [showVerificationScreen, setShowVerificationScreen] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [verificationResendTimer, setVerificationResendTimer] = useState(0);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);

  // Brute Force Lockout
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockoutTimer, setLockoutTimer] = useState(0);

  // Terms & Privacy Modals
  const [activeLegalModal, setActiveLegalModal] = useState<'terms' | 'privacy' | null>(null);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const errorLiveId = useId();

  // Trigger shake effect on form errors
  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 450);
  };

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutTimer <= 0) return;
    const interval = setInterval(() => {
      setLockoutTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTimer]);

  // Forgot password resend countdown
  useEffect(() => {
    if (forgotPasswordTimer <= 0) return;
    const interval = setInterval(() => {
      setForgotPasswordTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [forgotPasswordTimer]);

  // Verification resend countdown
  useEffect(() => {
    if (verificationResendTimer <= 0) return;
    const interval = setInterval(() => {
      setVerificationResendTimer((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [verificationResendTimer]);

  // Password criteria computation
  const criteria: PasswordCriteria = {
    hasMinLength: password.length >= 8,
    hasUpperAndLower: /[a-z]/.test(password) && /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
  };

  const strengthCount = Object.values(criteria).filter(Boolean).length;
  const strengthTier =
    password.length === 0
      ? 'empty'
      : strengthCount <= 1
      ? 'weak'
      : strengthCount === 2
      ? 'fair'
      : strengthCount === 3
      ? 'good'
      : 'strong';

  // Completion action: Confetti + View Transition + Toast
  const handleSuccessTransition = (name: string) => {
    try {
      confetti({
        particleCount: 90,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#3a4bff', '#ff3d8b', '#ffd23f', '#14c9b0', '#c8f43a'],
      });
    } catch {
      // Ignore confetti error
    }

    showToast({
      message: `Welcome back, ${name}!`,
      type: 'success',
      duration: 3500,
    });

    const finish = () => {
      onSuccess?.();
    };

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (document as any).startViewTransition(() => {
        finish();
      });
    } else {
      finish();
    }
  };

  // Human-readable Firebase Error Formatter
  const parseFirebaseError = (
    err: unknown
  ): { message: string; showSwitchToSignIn?: boolean; code?: string; unauthorizedDomain?: string } => {
    const authErr = err as { code?: string; message?: string };
    const code = authErr?.code || '';
    const raw = authErr?.message || (err instanceof Error ? err.message : String(err));
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'current domain';

    // 1. Domain Authorization for OAuth
    if (code === 'auth/unauthorized-domain' || raw.includes('auth/unauthorized-domain')) {
      return {
        code: 'auth/unauthorized-domain',
        unauthorizedDomain: currentHost,
        message: `Domain unauthorized for Google Sign-In (auth/unauthorized-domain): The host "${currentHost}" is not listed in your Firebase Authorized Domains. To resolve this, open Firebase Console > Authentication > Settings > Authorized domains, and add "${currentHost}".`,
      };
    }

    // 2. Popup Blocker
    if (code === 'auth/popup-blocked' || raw.includes('auth/popup-blocked')) {
      return {
        code: 'auth/popup-blocked',
        message:
          'Popup blocked by browser (auth/popup-blocked): The Google sign-in window was blocked. Please allow popups for this site in your browser address bar/settings and try again.',
      };
    }

    // 3. User closed popup before completion
    if (code === 'auth/popup-closed-by-user' || raw.includes('auth/popup-closed-by-user')) {
      return {
        code: 'auth/popup-closed-by-user',
        message:
          'Google Sign-In cancelled (auth/popup-closed-by-user): The sign-in window was closed before completion. Please try again.',
      };
    }

    // 4. Cancelled popup request (another popup already active)
    if (code === 'auth/cancelled-popup-request' || raw.includes('auth/cancelled-popup-request')) {
      return {
        code: 'auth/cancelled-popup-request',
        message:
          'Request cancelled (auth/cancelled-popup-request): Another sign-in window was already active. Please use the open popup.',
      };
    }

    // 5. Operation not allowed / Google provider disabled
    if (code === 'auth/operation-not-allowed' || raw.includes('auth/operation-not-allowed')) {
      return {
        code: 'auth/operation-not-allowed',
        message:
          'Provider disabled (auth/operation-not-allowed): Google sign-in is not enabled in Firebase Console (Authentication > Sign-in method).',
      };
    }

    // 6. Account exists with different credential
    if (
      code === 'auth/account-exists-with-different-credential' ||
      raw.includes('auth/account-exists-with-different-credential')
    ) {
      return {
        code: 'auth/account-exists-with-different-credential',
        showSwitchToSignIn: true,
        message:
          'Account exists (auth/account-exists-with-different-credential): An account already exists with this email using password sign-in. Please log in with your email and password.',
      };
    }

    // 7. Auth domain configuration error
    if (code === 'auth/auth-domain-config-required' || raw.includes('auth/auth-domain-config-required')) {
      return {
        code: 'auth/auth-domain-config-required',
        message:
          'Configuration error (auth/auth-domain-config-required): The Firebase authDomain configuration is missing or invalid.',
      };
    }

    // 8. Credentials error
    if (
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      raw.includes('auth/wrong-password') ||
      raw.includes('auth/invalid-credential')
    ) {
      return {
        code: code || 'auth/invalid-credential',
        message: 'Incorrect email or password. Please verify your credentials or reset your password.',
      };
    }

    // 9. User not found
    if (code === 'auth/user-not-found' || raw.includes('auth/user-not-found')) {
      return {
        code: 'auth/user-not-found',
        message: 'No account found with this email. Would you like to create an account instead?',
      };
    }

    // 10. Email in use
    if (code === 'auth/email-already-in-use' || raw.includes('auth/email-already-in-use')) {
      return {
        code: 'auth/email-already-in-use',
        message: 'This email is already registered. Please sign in instead.',
        showSwitchToSignIn: true,
      };
    }

    // 11. Rate limit / too many requests
    if (code === 'auth/too-many-requests' || raw.includes('auth/too-many-requests')) {
      setLockoutTimer(30);
      return {
        code: 'auth/too-many-requests',
        message:
          'Too many failed login attempts (auth/too-many-requests). For your security, this account is temporarily locked for 30 seconds.',
      };
    }

    // 12. Network error
    if (code === 'auth/network-request-failed' || raw.includes('auth/network-request-failed')) {
      return {
        code: 'auth/network-request-failed',
        message:
          'Network offline (auth/network-request-failed): Unable to connect to Firebase servers. Please check your internet connection and try again.',
      };
    }

    // 13. Invalid email
    if (code === 'auth/invalid-email' || raw.includes('auth/invalid-email')) {
      return {
        code: 'auth/invalid-email',
        message: 'Please enter a valid email address (e.g., researcher@university.edu).',
      };
    }

    // 14. Weak password
    if (code === 'auth/weak-password' || raw.includes('auth/weak-password')) {
      return {
        code: 'auth/weak-password',
        message: 'Password is too weak. Please use at least 8 characters with numbers and symbols.',
      };
    }

    // 15. User disabled
    if (code === 'auth/user-disabled' || raw.includes('auth/user-disabled')) {
      return {
        code: 'auth/user-disabled',
        message: 'Account suspended (auth/user-disabled): This account has been disabled.',
      };
    }

    return {
      code,
      message: code ? `Authentication error (${code}): ${raw}` : raw,
    };
  };

  // Field validation on blur
  const validateEmail = () => {
    const val = email.trim();
    if (!val) {
      setEmailError('Email is required.');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setEmailError('Please enter a valid email address.');
      return false;
    }
    setEmailError(null);
    return true;
  };

  const validatePassword = () => {
    if (!password) {
      setPasswordError('Password is required.');
      return false;
    }
    if (activeTab === 'signup' && strengthCount < 2) {
      setPasswordError('Please choose a password of at least "fair" strength.');
      return false;
    }
    setPasswordError(null);
    return true;
  };

  const validateConfirmPassword = () => {
    if (activeTab === 'signup') {
      if (!confirmPassword) {
        setConfirmPasswordError('Please confirm your password.');
        return false;
      }
      if (confirmPassword !== password) {
        setConfirmPasswordError('Passwords do not match.');
        return false;
      }
    }
    setConfirmPasswordError(null);
    return true;
  };

  const validateTerms = () => {
    if (activeTab === 'signup' && !agreedToTerms) {
      setTermsError('You must agree to the Terms of Service and Privacy Policy.');
      return false;
    }
    setTermsError(null);
    return true;
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lockoutTimer > 0) return;

    setGeneralError(null);
    setUnauthorizedDomain(null);

    const isEmailValid = validateEmail();
    const isPassValid = validatePassword();
    const isConfirmValid = validateConfirmPassword();
    const isTermsValid = validateTerms();

    if (!isEmailValid || !isPassValid || !isConfirmValid || !isTermsValid) {
      triggerShake();
      return;
    }

    setIsSubmitting(true);

    try {
      if (activeTab === 'signin') {
        await signIn(email.trim(), password, rememberMe);
        setFailedAttempts(0);
        const name = email.split('@')[0];
        handleSuccessTransition(name);
      } else {
        // Sign up
        await signUp(email.trim(), password, fullName.trim() || undefined, rememberMe);
        setFailedAttempts(0);
        setRegisteredEmail(email.trim());
        setShowVerificationScreen(true);
      }
    } catch (err: unknown) {
      const parsed = parseFirebaseError(err);
      console.error('[DocuMind Auth] Form sign-in failed:', {
        code: parsed.code || 'unknown',
        mode: activeTab,
      });
      setGeneralError(parsed.message);
      triggerShake();

      if (activeTab === 'signin') {
        const newFailed = failedAttempts + 1;
        setFailedAttempts(newFailed);
        if (newFailed >= 5) {
          setLockoutTimer(30);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Google Sign-In Handler
  const handleGoogleSignIn = async () => {
    if (lockoutTimer > 0) return;
    setGeneralError(null);
    setUnauthorizedDomain(null);
    setIsSubmitting(true);

    try {
      await signInWithGoogle(rememberMe);
      const current = auth?.currentUser;
      const name = current?.displayName || current?.email?.split('@')[0] || 'Researcher';
      handleSuccessTransition(name);
    } catch (err: unknown) {
      const parsed = parseFirebaseError(err);
      console.error('[DocuMind Auth] Google Sign-In encountered error:', {
        code: parsed.code || 'unknown',
        message: parsed.message,
        hostname: typeof window !== 'undefined' ? window.location.hostname : undefined,
      });
      setGeneralError(parsed.message);
      if (parsed.unauthorizedDomain) {
        setUnauthorizedDomain(parsed.unauthorizedDomain);
      }
      triggerShake();
    } finally {
      setIsSubmitting(false);
    }
  };

  // Continue as Guest Handler
  const handleGuestLogin = () => {
    continueAsGuest();
    showToast({
      message: 'Operating in local Guest mode. Documents are saved only in this browser.',
      type: 'info',
    });
    handleSuccessTransition('Guest');
  };

  // Send Password Reset
  const handleSendPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotPasswordEmail.trim()) {
      showToast({ message: 'Please enter your email address.', type: 'error' });
      return;
    }

    try {
      await resetPassword(forgotPasswordEmail.trim());
      setForgotPasswordSuccess(true);
      setForgotPasswordTimer(60);
      showToast({ message: 'Password reset link sent to your email!', type: 'success' });
    } catch (err: unknown) {
      const parsed = parseFirebaseError(err);
      showToast({ message: parsed.message, type: 'error' });
    }
  };

  // Resend Verification Email
  const handleResendVerification = async () => {
    try {
      await sendVerification();
      setVerificationResendTimer(60);
      showToast({ message: 'Verification link resent! Check your inbox.', type: 'success' });
    } catch (err: unknown) {
      const parsed = parseFirebaseError(err);
      showToast({ message: parsed.message, type: 'error' });
    }
  };

  // Check if email has been verified via user.reload()
  const handleCheckEmailVerified = async () => {
    setIsCheckingVerification(true);
    try {
      if (auth?.currentUser) {
        await auth.currentUser.reload();
        if (auth.currentUser.emailVerified) {
          showToast({ message: 'Email confirmed! Welcome to DocuMind.', type: 'success' });
          handleSuccessTransition(auth.currentUser.displayName || registeredEmail.split('@')[0]);
          return;
        }
      }
      showToast({
        message: 'Email not verified yet. Please click the link in your inbox.',
        type: 'info',
      });
    } catch (err: unknown) {
      showToast({ message: 'Failed to reload session state.', type: 'error' });
    } finally {
      setIsCheckingVerification(false);
    }
  };

  // Switch to sign in with prefilled email
  const handleSwitchToSignIn = () => {
    setActiveTab('signin');
    setGeneralError(null);
    setUnauthorizedDomain(null);
  };

  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--ink)] flex flex-col items-center justify-center p-3 sm:p-6 lg:p-10 font-sans selection:bg-[var(--a2)]/30 selection:text-[var(--ink)]">
      {/* Accessibility live announcement region */}
      <div id={errorLiveId} aria-live="polite" className="sr-only">
        {generalError || emailError || passwordError || confirmPasswordError || termsError}
      </div>

      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-stretch">
        {/* ==================================================================== */}
        {/* LEFT PANEL (55% on desktop: lg:col-span-7)                           */}
        {/* ==================================================================== */}
        <div className="lg:col-span-7 mesh-gradient-panel relative rounded-[32px] sm:rounded-[40px] p-6 sm:p-10 lg:p-12 flex flex-col justify-between overflow-hidden border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] shadow-[var(--sh)]">
          {/* Grain texture overlay */}
          <div className="grain-overlay absolute inset-0 pointer-events-none" />

          {/* Top Brand Logo */}
          <div className="relative z-10 flex items-center justify-between">
            <div
              className="flex items-center gap-2 select-none"
              style={{
                fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                fontWeight: 800,
                fontSize: '24px',
                letterSpacing: '-0.03em',
              }}
            >
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-[var(--a1)] to-[var(--a2)] text-white shadow-lg flex items-center justify-center">
                <FileText className="w-5 h-5" />
              </div>
              <span className="text-[var(--ink)]">Docu</span>
              <span
                style={{
                  background: 'linear-gradient(90deg, var(--a1), var(--a2))',
                  WebkitBackgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                Mind
              </span>
            </div>

            {targetTabName && (
              <span className="text-[11px] font-mono font-medium px-3 py-1 rounded-full bg-[var(--card)]/60 border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] text-[var(--mute)]">
                Target: {targetTabName}
              </span>
            )}
          </div>

          {/* Central Hero Typography & Floating Verified Card */}
          <div className="relative z-10 my-8 lg:my-12 space-y-6">
            <div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-[var(--ink)] leading-[1.08]">
                Read less.{' '}
                <span className="ser text-4xl sm:text-5xl lg:text-6xl font-normal text-[var(--a2)]">
                  Know
                </span>{' '}
                more.
              </h1>
              <p className="mt-3 text-sm sm:text-base text-[var(--mute)] max-w-lg leading-relaxed">
                Every synthesis backed by verbatim passage quotes from your local corpus.
                Mathematical bounds, zero hallucinations, verifiable citations.
              </p>
            </div>

            {/* Floating Verified Answer Card with rotating conic gradient border */}
            <div className="animate-bob pt-2">
              <div className="rotating-border-card max-w-md rounded-[26px] p-5 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[var(--teal)] animate-ping" />
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--teal)] flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Verified Citation
                    </span>
                  </div>
                  <span className="mono text-[10px]">BM25 + RRF #1</span>
                </div>

                <p className="text-xs text-[var(--mute)] font-medium italic mb-2">
                  "What was the clinical efficacy outcome in Phase III?"
                </p>
                <p className="text-xs sm:text-sm text-[var(--ink)] leading-relaxed font-medium">
                  The target compound demonstrated a 42% reduction in progression risk{' '}
                  <span className="citation-pill" title="Click to view verified source chunk">
                    p. 14
                  </span>{' '}
                  with statistically confirmed biomarker clearance.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Feature Chips */}
          <div className="relative z-10 flex flex-wrap gap-2 pt-4 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--card)]/80 text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] shadow-sm">
              <BookOpen className="w-3.5 h-3.5 text-[var(--a1)]" />
              Page-level citations
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--card)]/80 text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] shadow-sm">
              <ShieldCheck className="w-3.5 h-3.5 text-[var(--a2)]" />
              Honest "I don't know"
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--card)]/80 text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] shadow-sm">
              <Library className="w-3.5 h-3.5 text-[var(--teal)]" />
              Your library everywhere
            </span>
          </div>
        </div>

        {/* ==================================================================== */}
        {/* RIGHT PANEL (45% on desktop: lg:col-span-5)                          */}
        {/* ==================================================================== */}
        <div
          className={`lg:col-span-5 bg-[var(--card)] rounded-[32px] sm:rounded-[40px] p-6 sm:p-8 lg:p-10 shadow-[var(--sh)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] flex flex-col justify-center relative transition-transform ${
            isShaking ? 'animate-shake' : ''
          }`}
        >
          {/* Brute-force Lockout Alert */}
          {lockoutTimer > 0 && (
            <div className="mb-6 p-4 rounded-3xl bg-rose-500/10 border border-rose-500/40 text-rose-500 text-xs flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 shrink-0 text-rose-500 animate-pulse" />
              <div className="flex-1">
                <p className="font-bold">Security Lockout Active</p>
                <p className="text-[11px] text-[var(--mute)] mt-0.5">
                  Too many failed attempts. Login unlocked in{' '}
                  <span className="font-mono font-bold text-rose-500">{lockoutTimer}s</span>.
                </p>
              </div>
            </div>
          )}

          {/* Email Verification Screen (If just signed up) */}
          {showVerificationScreen ? (
            <div className="text-center py-4 space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-[var(--a1)]/10 text-[var(--a1)] flex items-center justify-center mx-auto border border-[var(--a1)]/25">
                <Mail className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-[var(--ink)]">Verify Your Email</h3>
                <p className="text-xs text-[var(--mute)] mt-1.5 leading-relaxed">
                  We sent a confirmation link to <strong className="text-[var(--ink)]">{registeredEmail}</strong>.
                  Please click the link in your inbox to enable cloud sync.
                </p>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={handleCheckEmailVerified}
                  disabled={isCheckingVerification}
                  className="w-full py-3 px-6 rounded-full bg-gradient-to-r from-[var(--a1)] to-[var(--a2)] text-white font-bold text-sm shadow-md hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isCheckingVerification ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>I've verified my email</span>
                </button>

                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={verificationResendTimer > 0}
                  className="w-full py-2.5 px-4 rounded-full border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)] transition-colors disabled:opacity-50"
                >
                  {verificationResendTimer > 0
                    ? `Resend available in ${verificationResendTimer}s`
                    : 'Resend verification link'}
                </button>

                <button
                  type="button"
                  onClick={() => handleSuccessTransition(registeredEmail.split('@')[0])}
                  className="text-xs text-[var(--mute)] hover:text-[var(--ink)] hover:underline pt-2 block mx-auto"
                >
                  Continue to Workspace (local mode active)
                </button>
              </div>
            </div>
          ) : isForgotPasswordOpen ? (
            /* Forgot Password Inline Panel */
            <div className="py-2 space-y-4">
              <div>
                <h3 className="text-xl font-bold text-[var(--ink)]">Reset Password</h3>
                <p className="text-xs text-[var(--mute)] mt-1">
                  Enter your email address and we'll send you a password reset link.
                </p>
              </div>

              {forgotPasswordSuccess ? (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Check your inbox</span>
                  </div>
                  <p className="text-[11px] text-[var(--mute)]">
                    If an account exists for {forgotPasswordEmail}, you will receive a reset email shortly.
                  </p>
                  {forgotPasswordTimer > 0 ? (
                    <p className="text-[10px] text-[var(--mute)] font-mono">
                      Resend link available in {forgotPasswordTimer}s
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendPasswordReset}
                      className="text-xs text-[var(--a1)] hover:underline font-bold"
                    >
                      Resend reset link
                    </button>
                  )}
                </div>
              ) : (
                <form onSubmit={handleSendPasswordReset} className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mute)] mb-1">
                      Email address
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-[var(--mute)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        required
                        value={forgotPasswordEmail}
                        onChange={(e) => setForgotPasswordEmail(e.target.value)}
                        placeholder="researcher@university.edu"
                        className="w-full bg-[var(--bg)] border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] rounded-full py-2.5 pl-10 pr-4 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--a1)] transition-all"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 rounded-full bg-gradient-to-r from-[var(--a1)] to-[var(--a2)] text-white text-xs font-bold shadow hover:brightness-110 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    Send Reset Link
                  </button>
                </form>
              )}

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setIsForgotPasswordOpen(false)}
                  className="text-xs text-[var(--mute)] hover:text-[var(--ink)] hover:underline"
                >
                  ← Back to Sign in
                </button>
              </div>
            </div>
          ) : (
            /* Main Form */
            <div className="space-y-5">
              {/* Segmented Pill Toggle with Sliding Highlight */}
              <div
                role="tablist"
                aria-label="Authentication mode"
                className="relative flex items-center p-1 bg-[color-mix(in_srgb,var(--mute)_14%,transparent)] rounded-full border border-[color-mix(in_srgb,var(--mute)_18%,transparent)]"
              >
                {/* Sliding highlight indicator */}
                <div
                  className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-[var(--card)] shadow-md transition-all duration-300 ease-out ${
                    activeTab === 'signin' ? 'left-1' : 'left-[calc(50%+2px)]'
                  }`}
                />

                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'signin'}
                  onClick={() => {
                    setActiveTab('signin');
                    setGeneralError(null);
                    setUnauthorizedDomain(null);
                  }}
                  className={`relative z-10 flex-1 py-2 text-xs font-bold text-center rounded-full transition-colors cursor-pointer ${
                    activeTab === 'signin' ? 'text-[var(--ink)]' : 'text-[var(--mute)] hover:text-[var(--ink)]'
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'signup'}
                  onClick={() => {
                    setActiveTab('signup');
                    setGeneralError(null);
                    setUnauthorizedDomain(null);
                  }}
                  className={`relative z-10 flex-1 py-2 text-xs font-bold text-center rounded-full transition-colors cursor-pointer ${
                    activeTab === 'signup' ? 'text-[var(--ink)]' : 'text-[var(--mute)] hover:text-[var(--ink)]'
                  }`}
                >
                  Create account
                </button>
              </div>

              {/* Continue with Google (Outlined pill with Google G icon) */}
              {isFirebaseConfigured && (
                <div>
                  <button
                    type="button"
                    onClick={handleGoogleSignIn}
                    disabled={isSubmitting || lockoutTimer > 0}
                    className="w-full py-2.5 px-4 rounded-full border-2 border-[color-mix(in_srgb,var(--mute)_30%,transparent)] hover:border-[var(--ink)] bg-[var(--card)] text-xs font-bold text-[var(--ink)] transition-all flex items-center justify-center gap-2.5 shadow-sm hover:shadow hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 cursor-pointer"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                    <span>Continue with Google</span>
                  </button>

                  <div className="relative my-4 text-center">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-[color-mix(in_srgb,var(--mute)_20%,transparent)]" />
                    </div>
                    <span className="relative px-3 bg-[var(--card)] text-[11px] font-medium text-[var(--mute)]">
                      or use email
                    </span>
                  </div>
                </div>
              )}

              {/* General Error Banner */}
              {generalError && (
                <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 text-xs flex items-start gap-2.5 animate-in fade-in">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2">
                    <p className="leading-relaxed">{generalError}</p>
                    {unauthorizedDomain && (
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(unauthorizedDomain);
                            showToast({
                              message: `Copied "${unauthorizedDomain}" to clipboard.`,
                              type: 'success',
                            });
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-[11px] font-mono font-bold text-[var(--ink)] cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy domain: {unauthorizedDomain}</span>
                        </button>
                      </div>
                    )}
                    {generalError.includes('already registered') && (
                      <button
                        type="button"
                        onClick={handleSwitchToSignIn}
                        className="mt-1 text-[11px] font-bold text-[var(--a1)] hover:underline block"
                      >
                        Switch to Sign in →
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Email + Password Form */}
              <form onSubmit={handleSubmit} noValidate className="space-y-3.5">
                {/* Full name field (Sign up only) */}
                {activeTab === 'signup' && (
                  <div className="space-y-1 animate-in fade-in duration-200">
                    <label
                      htmlFor="login-name"
                      className="block text-xs font-semibold text-[var(--mute)]"
                    >
                      Full name
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[var(--mute)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="login-name"
                        type="text"
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Dr. Eleanor Vance"
                        className="w-full bg-[var(--bg)] border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] rounded-full py-2.5 pl-10 pr-4 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--a1)] transition-all placeholder:text-[var(--mute)]/60"
                      />
                    </div>
                  </div>
                )}

                {/* Email field */}
                <div className="space-y-1">
                  <label
                    htmlFor="login-email"
                    className="block text-xs font-semibold text-[var(--mute)]"
                  >
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[var(--mute)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="login-email"
                      ref={emailInputRef}
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onBlur={validateEmail}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (emailError) setEmailError(null);
                      }}
                      placeholder="researcher@university.edu"
                      className={`w-full bg-[var(--bg)] border rounded-full py-2.5 pl-10 pr-4 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--a1)] transition-all placeholder:text-[var(--mute)]/60 ${
                        emailError
                          ? 'border-rose-500 focus:ring-rose-500'
                          : 'border-[color-mix(in_srgb,var(--mute)_25%,transparent)]'
                      }`}
                    />
                  </div>
                  {emailError && (
                    <p className="text-[11px] text-rose-500 px-3 pt-0.5">{emailError}</p>
                  )}
                </div>

                {/* Password field */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-semibold text-[var(--mute)]"
                    >
                      Password
                    </label>
                    {activeTab === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setForgotPasswordEmail(email);
                          setIsForgotPasswordOpen(true);
                        }}
                        className="text-[11px] font-semibold text-[var(--a1)] hover:underline"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-[var(--mute)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={activeTab === 'signin' ? 'current-password' : 'new-password'}
                      required
                      value={password}
                      onBlur={validatePassword}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (passwordError) setPasswordError(null);
                      }}
                      placeholder="••••••••"
                      className={`w-full bg-[var(--bg)] border rounded-full py-2.5 pl-10 pr-10 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--a1)] transition-all placeholder:text-[var(--mute)]/60 ${
                        passwordError
                          ? 'border-rose-500 focus:ring-rose-500'
                          : 'border-[color-mix(in_srgb,var(--mute)_25%,transparent)]'
                      }`}
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--mute)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {passwordError && (
                    <p className="text-[11px] text-rose-500 px-3 pt-0.5">{passwordError}</p>
                  )}
                </div>

                {/* Password Strength Meter (Sign Up Only) */}
                {activeTab === 'signup' && (
                  <div className="p-3 bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] rounded-2xl border border-[color-mix(in_srgb,var(--mute)_15%,transparent)] space-y-2 animate-in fade-in duration-200">
                    {/* 4 segments meter */}
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          strengthTier !== 'empty'
                            ? strengthTier === 'weak'
                              ? 'bg-[var(--err)]'
                              : strengthTier === 'fair'
                              ? 'bg-[var(--sun)]'
                              : strengthTier === 'good'
                              ? 'bg-[var(--teal)]'
                              : 'bg-[var(--lime)]'
                            : 'bg-[color-mix(in_srgb,var(--mute)_20%,transparent)]'
                        }`}
                      />
                      <div
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          ['fair', 'good', 'strong'].includes(strengthTier)
                            ? strengthTier === 'fair'
                              ? 'bg-[var(--sun)]'
                              : strengthTier === 'good'
                              ? 'bg-[var(--teal)]'
                              : 'bg-[var(--lime)]'
                            : 'bg-[color-mix(in_srgb,var(--mute)_20%,transparent)]'
                        }`}
                      />
                      <div
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          ['good', 'strong'].includes(strengthTier)
                            ? strengthTier === 'good'
                              ? 'bg-[var(--teal)]'
                              : 'bg-[var(--lime)]'
                            : 'bg-[color-mix(in_srgb,var(--mute)_20%,transparent)]'
                        }`}
                      />
                      <div
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          strengthTier === 'strong'
                            ? 'bg-[var(--lime)]'
                            : 'bg-[color-mix(in_srgb,var(--mute)_20%,transparent)]'
                        }`}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] mono">
                      <span className="text-[var(--mute)]">Password strength:</span>
                      <span
                        className={`font-bold capitalize ${
                          strengthTier === 'weak'
                            ? 'text-[var(--err)]'
                            : strengthTier === 'fair'
                            ? 'text-amber-500'
                            : strengthTier === 'good'
                            ? 'text-[var(--teal)]'
                            : strengthTier === 'strong'
                            ? 'text-emerald-500'
                            : 'text-[var(--mute)]'
                        }`}
                      >
                        {strengthTier === 'empty' ? 'Enter password' : strengthTier}
                      </span>
                    </div>

                    {/* Live criteria checklist */}
                    <div className="grid grid-cols-2 gap-1 pt-1 text-[10px]">
                      <span
                        className={`flex items-center gap-1 ${
                          criteria.hasMinLength ? 'text-emerald-500 font-semibold' : 'text-[var(--mute)]'
                        }`}
                      >
                        {criteria.hasMinLength ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        8+ characters
                      </span>
                      <span
                        className={`flex items-center gap-1 ${
                          criteria.hasUpperAndLower ? 'text-emerald-500 font-semibold' : 'text-[var(--mute)]'
                        }`}
                      >
                        {criteria.hasUpperAndLower ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Upper & lower
                      </span>
                      <span
                        className={`flex items-center gap-1 ${
                          criteria.hasNumber ? 'text-emerald-500 font-semibold' : 'text-[var(--mute)]'
                        }`}
                      >
                        {criteria.hasNumber ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Number (0-9)
                      </span>
                      <span
                        className={`flex items-center gap-1 ${
                          criteria.hasSpecialChar ? 'text-emerald-500 font-semibold' : 'text-[var(--mute)]'
                        }`}
                      >
                        {criteria.hasSpecialChar ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        Symbol (!@#$)
                      </span>
                    </div>
                  </div>
                )}

                {/* Confirm Password field (Sign Up Only) */}
                {activeTab === 'signup' && (
                  <div className="space-y-1 animate-in fade-in duration-200">
                    <label
                      htmlFor="login-confirm-password"
                      className="block text-xs font-semibold text-[var(--mute)]"
                    >
                      Confirm password
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[var(--mute)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        id="login-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        value={confirmPassword}
                        onBlur={validateConfirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (confirmPasswordError) setConfirmPasswordError(null);
                        }}
                        placeholder="••••••••"
                        className={`w-full bg-[var(--bg)] border rounded-full py-2.5 pl-10 pr-10 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--a1)] transition-all placeholder:text-[var(--mute)]/60 ${
                          confirmPasswordError
                            ? 'border-rose-500 focus:ring-rose-500'
                            : 'border-[color-mix(in_srgb,var(--mute)_25%,transparent)]'
                        }`}
                      />
                      <button
                        type="button"
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--mute)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {confirmPasswordError && (
                      <p className="text-[11px] text-rose-500 px-3 pt-0.5">{confirmPasswordError}</p>
                    )}
                  </div>
                )}

                {/* Remember Me Pill Toggle (Sign in) OR Terms Checkbox (Sign up) */}
                {activeTab === 'signin' ? (
                  <div className="flex items-center justify-between pt-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-[var(--mute)] select-none">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={rememberMe}
                        onClick={() => setRememberMe(!rememberMe)}
                        className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 ${
                          rememberMe ? 'bg-[var(--a1)]' : 'bg-[color-mix(in_srgb,var(--mute)_30%,transparent)]'
                        }`}
                      >
                        <span
                          className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                            rememberMe ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <span>Remember me</span>
                    </label>
                  </div>
                ) : (
                  <div className="pt-1">
                    <label className="flex items-start gap-2 cursor-pointer text-[11px] text-[var(--mute)] select-none">
                      <input
                        type="checkbox"
                        checked={agreedToTerms}
                        onChange={(e) => {
                          setAgreedToTerms(e.target.checked);
                          if (termsError) setTermsError(null);
                        }}
                        className="mt-0.5 rounded border-[var(--mute)] text-[var(--a1)] focus:ring-[var(--a1)] cursor-pointer"
                      />
                      <span>
                        I agree to the{' '}
                        <button
                          type="button"
                          onClick={() => setActiveLegalModal('terms')}
                          className="text-[var(--a1)] font-semibold hover:underline"
                        >
                          Terms of Service
                        </button>{' '}
                        and{' '}
                        <button
                          type="button"
                          onClick={() => setActiveLegalModal('privacy')}
                          className="text-[var(--a1)] font-semibold hover:underline"
                        >
                          Privacy Policy
                        </button>
                        .
                      </span>
                    </label>
                    {termsError && (
                      <p className="text-[11px] text-rose-500 pt-1">{termsError}</p>
                    )}
                  </div>
                )}

                {/* Submit Pill Button */}
                <button
                  type="submit"
                  disabled={isSubmitting || lockoutTimer > 0}
                  className="w-full py-3 px-6 rounded-full bg-gradient-to-r from-[var(--a1)] to-[var(--a2)] text-white font-bold text-sm shadow-lg shadow-[var(--a2)]/30 hover:shadow-xl hover:brightness-110 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 mt-2"
                >
                  {isSubmitting ? (
                    <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : activeTab === 'signin' ? (
                    <>
                      <span>Sign In</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <>
                      <span>Create Account</span>
                      <Sparkles className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Continue as Guest Button */}
              <div className="pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)] text-center">
                <button
                  type="button"
                  onClick={handleGuestLogin}
                  className="text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)] hover:underline inline-flex items-center gap-1.5 py-1 px-3 rounded-full hover:bg-[color-mix(in_srgb,var(--mute)_10%,transparent)] transition-all cursor-pointer"
                >
                  <Laptop className="w-3.5 h-3.5 text-[var(--tang)]" />
                  <span>Continue as guest (data stays on this device)</span>
                </button>
                <p className="text-[10px] text-[var(--mute)] mt-1 max-w-xs mx-auto">
                  Instant local research without an account. All documents and embeddings remain in your browser's IndexedDB.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================================================================== */}
      {/* Terms & Privacy Modal                                                */}
      {/* ==================================================================== */}
      {activeLegalModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
        >
          <div className="bg-[var(--card)] border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] rounded-[32px] p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-[var(--a1)]" />
                {activeLegalModal === 'terms' ? 'Terms of Service' : 'Privacy Policy & Data Security'}
              </h3>
              <button
                type="button"
                onClick={() => setActiveLegalModal(null)}
                className="w-8 h-8 rounded-full border border-[var(--mute)]/30 hover:bg-[var(--mute)]/15 flex items-center justify-center text-[var(--mute)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {activeLegalModal === 'terms' ? (
              <div className="text-xs text-[var(--mute)] space-y-3 leading-relaxed">
                <p>
                  <strong>1. Ownership & Research License:</strong> You retain full copyright and ownership
                  over all PDF documents, research notes, and synthesis output processed within DocuMind.
                </p>
                <p>
                  <strong>2. Local-First Guarantees:</strong> In Guest Mode, zero documents, vector embeddings,
                  or conversation messages ever leave your browser device. All indexing is performed via local
                  PDF.js extraction and client IndexedDB persistence.
                </p>
                <p>
                  <strong>3. Cloud Sync Terms:</strong> When logged into a registered account with a verified email,
                  your documents and chat threads are synchronized strictly to your private UID node under Google Cloud
                  Firestore and Cloud Storage.
                </p>
                <p>
                  <strong>4. Fair Use & Rate Limiting:</strong> Account and guest rate limits are enforced per-user
                  to safeguard against distributed denial of service and API quota abuse.
                </p>
              </div>
            ) : (
              <div className="text-xs text-[var(--mute)] space-y-3 leading-relaxed">
                <div className="p-3 rounded-2xl bg-[var(--a1)]/10 border border-[var(--a1)]/20 text-[var(--ink)] font-medium">
                  🔒 Explicit Cloud &amp; Gemini Transmission Boundaries:
                </div>
                <p>
                  <strong>What is stored in the Cloud:</strong> When signed in, only your user account profile,
                  document metadata, encrypted PDF files in Cloud Storage (under <code className="text-[var(--ink)]">users/{"{uid}"}/pdfs</code>),
                  extracted passage chunks, and private research conversation threads are saved.
                </p>
                <p>
                  <strong>What is sent to Google Gemini:</strong> Only the specific question you submit, your last 4
                  conversation turns, and the top relevant retrieved document passages needed for answer synthesis are
                  transmitted via server-side TLS encryption.
                </p>
                <p>
                  <strong>Zero Training on User Data:</strong> Neither your original documents nor your research queries
                  are ever retained to train public Gemini foundation models.
                </p>
              </div>
            )}

            <div className="pt-2 text-right">
              <button
                type="button"
                onClick={() => setActiveLegalModal(null)}
                className="btn sm"
                style={{ borderRadius: '99px' }}
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
