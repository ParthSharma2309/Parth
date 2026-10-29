import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  Trash2,
  Sliders,
  Download,
  Upload,
  Sun,
  Moon,
  Sparkles,
  Layers,
  Cpu,
  Palette,
  Check,
  HardDrive,
  ShieldAlert,
  AlertTriangle,
  FileArchive,
  Wrench,
  RefreshCw,
  RotateCcw,
  User,
  LogOut,
  ShieldCheck,
  Mail,
  KeyRound,
  Copy,
  Laptop,
  Clock,
} from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { SettingsState } from '../../types/index.ts';
import { MODEL_CONFIG, getModelSimilarityThreshold } from '../../config/models.ts';
import {
  getSettings,
  saveSettings,
  getStorageEstimate,
  StorageEstimateInfo,
  exportBackupFile,
  parseBackupFile,
  BackupFileSummary,
  importBackupData,
  clearChats,
  clearEvaluationHistory,
  clearAllExceptSettings,
  fullReset,
  checkDatabaseIntegrity,
  repairDatabaseIntegrity,
  IntegrityReport,
  requestPersistentStorage,
} from '../../services/storage.ts';
import { calibrateThresholdForModel } from '../../services/calibration.ts';
import { useToast } from '../ui/Toast.tsx';

interface SettingsPageProps {
  onRefreshData: () => void;
}

interface GranularClearActionConfig {
  id: 'chats' | 'evals' | 'allExceptSettings' | 'fullReset';
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<{ undo: () => Promise<void> }>;
  successMessage: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onRefreshData }) => {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageEstimateInfo | null>(null);
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);

  // Loading & interaction states
  const [isCalibrating, setIsCalibrating] = useState<boolean>(false);
  const [calibrationProgress, setCalibrationProgress] = useState<string>('');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState<boolean>(false);
  const [isRepairingIntegrity, setIsRepairingIntegrity] = useState<boolean>(false);

  // Modals state
  const [pendingBackupSummary, setPendingBackupSummary] = useState<BackupFileSummary | null>(null);
  const [activeClearAction, setActiveClearAction] = useState<GranularClearActionConfig | null>(null);
  const [isExecutingClear, setIsExecutingClear] = useState<boolean>(false);

  // Authentication & Cloud Sync state
  const { user, isGuest, signOut, sendVerification, upgradeGuestAccount } = useAuth();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeEmail, setUpgradeEmail] = useState('');
  const [upgradePassword, setUpgradePassword] = useState('');
  const [upgradeName, setUpgradeName] = useState('');
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [showSecurityRules, setShowSecurityRules] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadSettingsAndDiagnostics();
  }, []);

  const loadSettingsAndDiagnostics = async () => {
    try {
      const [s, est, rep] = await Promise.all([
        getSettings(),
        getStorageEstimate(),
        checkDatabaseIntegrity(),
      ]);
      setSettings(s);
      setStorageInfo(est);
      setIntegrityReport(rep);
      applyTheme(s.darkMode);
      if (s.accentTheme) {
        applyAccent(s.accentTheme);
      }
    } catch (err) {
      console.error('Failed to load settings & diagnostics:', err);
    }
  };

  const applyTheme = (theme: 'light' | 'dark' | 'system') => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.dataset.theme = 'dark';
    } else if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
      root.dataset.theme = 'light';
    } else {
      root.classList.remove('light', 'dark');
      delete root.dataset.theme;
    }
  };

  const applyAccent = (accent: 'sunset' | 'ocean' | 'forest') => {
    document.documentElement.dataset.accent = accent;
  };

  const updateSetting = async <K extends keyof SettingsState>(
    key: K,
    val: SettingsState[K]
  ) => {
    if (!settings) return;
    const updated = { ...settings, [key]: val };
    setSettings(updated);
    await saveSettings(updated);
  };

  const handleEmbeddingModelChange = async (newModel: string) => {
    if (!settings) return;
    const cleanModel = newModel.replace(/^models\//, '');
    const modelTh =
      settings.similarityThresholds?.[cleanModel] ??
      settings.similarityThresholds?.[newModel] ??
      getModelSimilarityThreshold(newModel);

    const updatedThresholds = {
      ...(settings.similarityThresholds || MODEL_CONFIG.similarityThresholds),
      [newModel]: modelTh,
      [cleanModel]: modelTh,
    };

    const updated: SettingsState = {
      ...settings,
      embeddingModel: newModel,
      similarityThreshold: modelTh,
      similarityThresholds: updatedThresholds,
    };
    setSettings(updated);
    await saveSettings(updated);
    showToast({
      message: `Active embedding model set to ${newModel} (Threshold: ${modelTh.toFixed(2)})`,
      type: 'info',
    });
  };

  const handleThresholdChange = async (val: number) => {
    if (!settings) return;
    const cleanModel = settings.embeddingModel.replace(/^models\//, '');
    const updatedThresholds = {
      ...(settings.similarityThresholds || MODEL_CONFIG.similarityThresholds),
      [settings.embeddingModel]: val,
      [cleanModel]: val,
    };
    const updated: SettingsState = {
      ...settings,
      similarityThreshold: val,
      similarityThresholds: updatedThresholds,
    };
    setSettings(updated);
    await saveSettings(updated);
  };

  const handleCalibrateThreshold = async () => {
    if (!settings) return;
    setIsCalibrating(true);
    setCalibrationProgress('Starting evaluation probes...');
    try {
      const res = await calibrateThresholdForModel(settings.embeddingModel, (curr, total) => {
        setCalibrationProgress(`Evaluating probe ${curr}/${total}...`);
      });
      const cleanModel = settings.embeddingModel.replace(/^models\//, '');
      const updatedThresholds = {
        ...(settings.similarityThresholds || MODEL_CONFIG.similarityThresholds),
        [settings.embeddingModel]: res.suggestedThreshold,
        [cleanModel]: res.suggestedThreshold,
      };
      const updated: SettingsState = {
        ...settings,
        similarityThreshold: res.suggestedThreshold,
        similarityThresholds: updatedThresholds,
      };
      setSettings(updated);
      await saveSettings(updated);
      showToast({
        message: `Calibrated threshold for ${settings.embeddingModel}: ${res.suggestedThreshold.toFixed(2)} (F1: ${Math.round(res.f1Score * 100)}%)`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({ message: `Calibration failed: ${err.message}`, type: 'error' });
    } finally {
      setIsCalibrating(false);
      setCalibrationProgress('');
    }
  };

  const handleAccentChange = (accent: 'sunset' | 'ocean' | 'forest') => {
    applyAccent(accent);
    updateSetting('accentTheme', accent);
    showToast({ message: `Accent theme set to ${accent}`, type: 'success' });
  };

  const handleThemeToggle = () => {
    if (!settings) return;
    const nextTheme = settings.darkMode === 'dark' ? 'light' : 'dark';
    applyTheme(nextTheme);
    updateSetting('darkMode', nextTheme);
  };

  // ----------------- BACKUP EXPORT & IMPORT (Requirement 3) -----------------
  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const { blob, fileName } = await exportBackupFile();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({
        message: `Compressed backup exported (${(blob.size / 1024).toFixed(1)} KB)`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({ message: `Export failed: ${err.message}`, type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleBackupFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const summary = await parseBackupFile(file);
      setPendingBackupSummary(summary);
    } catch (err: any) {
      showToast({ message: `Backup parse error: ${err.message}`, type: 'error' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExecuteImport = async (mode: 'merge' | 'replace') => {
    if (!pendingBackupSummary) return;
    setIsImporting(true);
    try {
      const counts = await importBackupData(pendingBackupSummary.data, mode);
      setPendingBackupSummary(null);
      await loadSettingsAndDiagnostics();
      onRefreshData();
      showToast({
        message: `Backup ${mode === 'replace' ? 'replaced & restored' : 'merged'} (${counts.documents} docs, ${counts.chunks} passages, ${counts.messages} msgs)`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({ message: `Import error: ${err.message}`, type: 'error' });
    } finally {
      setIsImporting(false);
    }
  };

  // ----------------- GRANULAR CLEAR ACTIONS WITH 5-SECOND UNDO (Requirement 4) -----------------
  const handleExecuteClearAction = async () => {
    if (!activeClearAction) return;
    setIsExecutingClear(true);
    try {
      const result = await activeClearAction.action();
      setActiveClearAction(null);
      await loadSettingsAndDiagnostics();
      onRefreshData();

      // Launch 5-second Undo toast
      showToast({
        message: activeClearAction.successMessage,
        type: 'info',
        duration: 5000,
        undoAction: async () => {
          await result.undo();
          await loadSettingsAndDiagnostics();
          onRefreshData();
          showToast({ message: 'Action undone! Restored successfully.', type: 'success' });
        },
      });
    } catch (err: any) {
      showToast({ message: `Failed: ${err.message}`, type: 'error' });
    } finally {
      setIsExecutingClear(false);
    }
  };

  // ----------------- INTEGRITY DIAGNOSTIC & REPAIR (Requirement 5) -----------------
  const handleCheckIntegrity = async () => {
    setIsCheckingIntegrity(true);
    try {
      const rep = await checkDatabaseIntegrity();
      setIntegrityReport(rep);
      showToast({
        message: rep.hasIssues
          ? `Integrity check: Issues found (${rep.orphanChunksCount} orphans, ${rep.emptyDocIds.length} empty docs)`
          : 'Integrity check: Database is healthy and all records are consistent.',
        type: rep.hasIssues ? 'error' : 'success',
      });
    } catch (err: any) {
      showToast({ message: `Integrity check failed: ${err.message}`, type: 'error' });
    } finally {
      setIsCheckingIntegrity(false);
    }
  };

  const handleRepairIntegrity = async () => {
    setIsRepairingIntegrity(true);
    try {
      const res = await repairDatabaseIntegrity(integrityReport || undefined);
      const rep = await checkDatabaseIntegrity();
      setIntegrityReport(rep);
      await loadSettingsAndDiagnostics();
      onRefreshData();
      showToast({
        message: `Database repaired: resolved ${res.repairedCount} items.`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({ message: `Repair failed: ${err.message}`, type: 'error' });
    } finally {
      setIsRepairingIntegrity(false);
    }
  };

  const handleUpgradeGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!upgradeEmail || !upgradePassword) {
      showToast({ message: 'Email and password are required to upgrade.', type: 'error' });
      return;
    }
    if (upgradePassword.length < 6) {
      showToast({ message: 'Password must be at least 6 characters.', type: 'error' });
      return;
    }

    setIsUpgrading(true);
    try {
      await upgradeGuestAccount(upgradeEmail.trim(), upgradePassword, upgradeName.trim() || undefined);
      setShowUpgradeModal(false);
      showToast({
        message: 'Account created! All local research data has been migrated to Firebase Cloud.',
        type: 'success',
      });
      onRefreshData();
    } catch (err: any) {
      showToast({ message: `Upgrade failed: ${err.message}`, type: 'error' });
    } finally {
      setIsUpgrading(false);
    }
  };

  const handleResendVerificationEmail = async () => {
    try {
      await sendVerification();
      showToast({ message: 'Verification email sent! Check your inbox.', type: 'success' });
    } catch (err: any) {
      showToast({ message: `Failed to send email: ${err.message}`, type: 'error' });
    }
  };

  if (!settings) return null;

  return (
    <div className="space-y-8 max-w-4xl mx-auto pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[color-mix(in_srgb,var(--mute)_20%,transparent)] pb-6">
        <div>
          <h2 className="text-2xl font-black text-[var(--ink)] tracking-tight">Studio Settings</h2>
          <p className="text-sm text-[var(--mute)] mt-1">
            Configure UI themes, hybrid retrieval parameters, local storage quotas, and compressed backups.
          </p>
        </div>

        {/* Compressed Backup Export & Import Action Buttons (Requirement 3) */}
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleBackupFileChosen}
            accept=".json.gz,.gz,.json"
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{ borderRadius: '99px' }}
            className="btn outline sm flex items-center gap-1.5 cursor-pointer"
            title="Import compressed .json.gz or .json backup"
          >
            <Upload size={14} />
            <span>Import Backup</span>
          </button>
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={isExporting}
            style={{ borderRadius: '99px' }}
            className="btn sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Export full portable compressed .json.gz backup"
          >
            <Download size={14} />
            <span>{isExporting ? 'Exporting...' : 'Export Backup (.gz)'}</span>
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* CARD 0: User Account, Cloud Sync & Security */}
        <div
          style={{
            borderRadius: '36px',
            padding: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] space-y-4"
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] pb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-[var(--a1)]" />
              <h3 className="text-base font-bold text-[var(--ink)]">User Account &amp; Cloud Security</h3>
            </div>
            <div className="flex items-center gap-2">
              {isGuest ? (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/30 flex items-center gap-1">
                  <Laptop size={12} />
                  Guest Mode (Local Only)
                </span>
              ) : user?.emailVerified ? (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 flex items-center gap-1">
                  <Check size={12} />
                  Verified &amp; Cloud Sync Active
                </span>
              ) : (
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/30 flex items-center gap-1">
                  <AlertTriangle size={12} />
                  Unverified (Cloud Sync Paused)
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-[color-mix(in_srgb,var(--bg-main)_70%,transparent)] border border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 text-white font-bold flex items-center justify-center text-sm shadow">
                  {isGuest ? <Laptop size={18} /> : (user?.displayName || user?.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold text-[var(--ink)] truncate">
                    {user?.displayName || (isGuest ? 'Guest Researcher' : user?.email?.split('@')[0])}
                  </h4>
                  <p className="text-xs text-[var(--mute)] truncate font-mono">
                    {user?.email || 'Local session storage (no cloud sync)'}
                  </p>
                </div>
              </div>

              {isGuest && (
                <div className="mt-3 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                  <p className="text-xs text-[var(--mute)] mb-2">
                    Guest data is saved locally in IndexedDB. Upgrade to a registered account to sync across devices.
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowUpgradeModal(true)}
                    className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white text-xs font-semibold shadow hover:brightness-110 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sparkles size={13} />
                    Upgrade Account &amp; Migrate Data
                  </button>
                </div>
              )}

              {!isGuest && !user?.emailVerified && (
                <div className="mt-3 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                  <p className="text-xs text-amber-400 mb-2">
                    Verify your email to activate Firestore multi-device synchronization.
                  </p>
                  <button
                    type="button"
                    onClick={handleResendVerificationEmail}
                    className="py-1.5 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold border border-amber-500/30 transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <Mail size={13} />
                    Resend Verification Link
                  </button>
                </div>
              )}
            </div>

            {/* Inactivity Auto Sign-Out Setting (Requirement 4) */}
            <div className="p-4 rounded-2xl bg-[color-mix(in_srgb,var(--bg-main)_70%,transparent)] border border-[color-mix(in_srgb,var(--mute)_15%,transparent)] flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Clock size={16} className="text-[var(--a1)]" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
                    Inactivity Auto Sign-Out
                  </h4>
                </div>
                <p className="text-xs text-[var(--mute)]">
                  Automatically signs out your session after an idle period, displaying a 60-second warning countdown.
                </p>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs text-[var(--mute)]">Timeout:</span>
                <select
                  value={settings.autoSignOutMinutes ?? 30}
                  onChange={(e) => {
                    const mins = parseInt(e.target.value, 10);
                    const updated = { ...settings, autoSignOutMinutes: mins };
                    setSettings(updated);
                    saveSettings(updated);
                    showToast({
                      message: mins === 0 ? 'Auto sign-out disabled.' : `Auto sign-out set to ${mins} minutes.`,
                      type: 'success',
                    });
                  }}
                  className="bg-[var(--surface)] border border-[color-mix(in_srgb,var(--mute)_30%,transparent)] rounded-xl px-3 py-1.5 text-xs text-[var(--ink)] focus:outline-none focus:border-[var(--a1)] cursor-pointer"
                >
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes (Default)</option>
                  <option value={60}>60 minutes</option>
                  <option value={0}>Disabled (Never)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Row & Security Rules Toggle */}
          <div className="pt-2 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)] flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowSecurityRules(!showSecurityRules)}
              className="text-xs text-[var(--a1)] hover:underline font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <KeyRound size={13} />
              {showSecurityRules ? 'Hide Security Rules Reference' : 'View Firebase Security Rules (Firestore & Storage)'}
            </button>

            <button
              type="button"
              onClick={() => signOut()}
              className="py-1.5 px-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ml-auto"
            >
              <LogOut size={13} />
              Sign Out
            </button>
          </div>

          {/* Expandable Firebase Security Rules Panel (Requirement 6) */}
          {showSecurityRules && (
            <div className="mt-3 p-4 rounded-2xl bg-black/60 border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] space-y-4 text-xs font-mono">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-emerald-400 font-bold">1. Firestore Security Rules (firestore.rules)</span>
                <button
                  type="button"
                  onClick={() => {
                    const rulesText = `rules_version = '2';\\nservice cloud.firestore {\\n  match /databases/{database}/documents {\\n    match /{document=**} { allow read, write: if false; }\\n    function isSignedIn() { return request.auth != null && request.auth.uid != null; }\\n    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }\\n    match /users/{uid}/{document=**} {\\n      allow read, write: if isOwner(uid);\\n    }\\n  }\\n}`;
                    navigator.clipboard.writeText(rulesText);
                    setCopiedRules(true);
                    setTimeout(() => setCopiedRules(false), 2000);
                  }}
                  className="text-[11px] text-[var(--a1)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  {copiedRules ? <Check size={12} /> : <Copy size={12} />}
                  {copiedRules ? 'Copied' : 'Copy Rules'}
                </button>
              </div>
              <pre className="text-[11px] text-emerald-300/90 whitespace-pre overflow-x-auto max-h-48 p-2 rounded bg-white/5">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} { allow read, write: if false; }
    function isSignedIn() { return request.auth != null && request.auth.uid != null; }
    function isOwner(uid) { return isSignedIn() && request.auth.uid == uid; }
    match /users/{uid}/{document=**} {
      allow read, write: if isOwner(uid);
    }
  }
}`}
              </pre>

              <div className="flex items-center justify-between pb-2 border-b border-white/10 pt-2">
                <span className="text-amber-400 font-bold">2. Cloud Storage Security Rules (storage.rules)</span>
              </div>
              <pre className="text-[11px] text-amber-300/90 whitespace-pre overflow-x-auto max-h-36 p-2 rounded bg-white/5">
{`rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} { allow read, write: if false; }
    match /users/{uid}/pdfs/{docId} {
      allow read, delete: if request.auth != null && request.auth.uid == uid;
      allow write: if request.auth != null &&
        request.auth.uid == uid &&
        request.resource.size <= 25 * 1024 * 1024 &&
        request.resource.contentType == 'application/pdf';
    }
  }
}`}
              </pre>
            </div>
          )}
        </div>

        {/* Upgrade Guest Modal */}
        {showUpgradeModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-3xl p-6 max-w-md w-full shadow-2xl relative">
              <h3 className="text-lg font-bold text-[var(--ink)] mb-1">Upgrade to Cloud Account</h3>
              <p className="text-xs text-[var(--mute)] mb-4">
                Enter your details to create an account. All your existing documents, chats, and notes will be seamlessly uploaded to Firebase.
              </p>

              <form onSubmit={handleUpgradeGuest} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--mute)] mb-1">Display Name (Optional)</label>
                  <input
                    type="text"
                    value={upgradeName}
                    onChange={(e) => setUpgradeName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-[var(--a1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--mute)] mb-1">Email</label>
                  <input
                    type="email"
                    required
                    value={upgradeEmail}
                    onChange={(e) => setUpgradeEmail(e.target.value)}
                    placeholder="researcher@university.edu"
                    className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-[var(--a1)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--mute)] mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={upgradePassword}
                    onChange={(e) => setUpgradePassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-[var(--bg-main)] border border-[var(--border)] rounded-xl py-2 px-3 text-xs focus:outline-none focus:border-[var(--a1)]"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setShowUpgradeModal(false)}
                    className="px-4 py-2 text-xs rounded-xl border border-[var(--border)] hover:bg-[var(--surface-hover)] text-[var(--mute)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isUpgrading}
                    className="px-5 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow hover:brightness-110 disabled:opacity-50"
                  >
                    {isUpgrading ? 'Migrating Data...' : 'Create & Migrate'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CARD 1: Local Storage Usage & Persistence (Requirement 2) */}
        <div
          style={{
            borderRadius: '36px',
            padding: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] space-y-4"
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] pb-3">
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-[var(--a1)]" />
              <h3 className="text-base font-bold text-[var(--ink)]">Browser Storage &amp; Persistence</h3>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${
                  storageInfo?.isPersisted
                    ? 'bg-[var(--teal)]/10 text-[var(--teal)] border-[var(--teal)]/30'
                    : 'bg-[var(--mute)]/10 text-[var(--mute)] border-[var(--mute)]/30'
                }`}
              >
                {storageInfo?.isPersisted ? '✓ Storage Persisted' : 'Transient Storage'}
              </span>
            </div>
          </div>

          {/* High storage usage warning banner (>= 80%) (Requirement 2) */}
          {storageInfo?.isHighUsage && (
            <div className="p-3 bg-[var(--err)]/15 border border-[var(--err)]/40 rounded-2xl flex items-center gap-3 text-xs text-[var(--err)]">
              <AlertTriangle size={16} className="shrink-0" />
              <div>
                <span className="font-bold">Storage Warning:</span> Local storage usage has reached{' '}
                {storageInfo.usagePercent}% of your browser quota. Export a compressed backup and remove unused documents to prevent browser eviction.
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--mute)]">
                Used: <strong className="text-[var(--ink)]">{storageInfo?.usageMB || 0} MB</strong> of{' '}
                <strong className="text-[var(--ink)]">{storageInfo ? (storageInfo.quotaMB > 1024 ? `${(storageInfo.quotaMB / 1024).toFixed(1)} GB` : `${storageInfo.quotaMB} MB`) : 'Calculating...'}</strong>
              </span>
              <span className="mono font-bold text-[var(--a1)]">
                {storageInfo?.usagePercent || 0}% used
              </span>
            </div>
            <div className="w-full h-3 bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  storageInfo?.isHighUsage
                    ? 'bg-[var(--err)]'
                    : storageInfo?.usagePercent && storageInfo.usagePercent > 50
                    ? 'bg-[var(--yellow)]'
                    : 'bg-[var(--a1)]'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, storageInfo?.usagePercent || 0))}%` }}
              />
            </div>
          </div>
        </div>

        {/* CARD 2: Appearance & Theme Swatches */}
        <div
          style={{
            borderRadius: '36px',
            padding: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] space-y-6"
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] pb-3">
            <div className="flex items-center gap-2">
              <Palette size={18} className="text-[var(--a1)]" />
              <h3 className="text-base font-bold text-[var(--ink)]">Appearance &amp; Theme</h3>
            </div>
            <span className="mono text-xs text-[var(--mute)]">Aesthetic Controls</span>
          </div>

          <div className="space-y-3">
            <div>
              <span className="font-bold text-sm block">Accent Color Palette</span>
              <p className="text-xs text-[var(--mute)]">
                Choose the brand duo gradient for primary buttons, active pills, and glows.
              </p>
            </div>

            <div className="flex items-center gap-4 pt-1">
              {/* Sunset Swatch */}
              <button
                type="button"
                onClick={() => handleAccentChange('sunset')}
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #FF6B4A, #9B51E0)',
                }}
                className={`flex items-center justify-center transition-transform cursor-pointer shadow-md ${
                  settings.accentTheme === 'sunset' || !settings.accentTheme
                    ? 'ring-4 ring-[var(--ink)] scale-110'
                    : 'hover:scale-105 opacity-80'
                }`}
                title="Sunset (Orange + Purple / Default)"
              >
                {(settings.accentTheme === 'sunset' || !settings.accentTheme) && (
                  <Check size={16} className="text-white stroke-[3]" />
                )}
              </button>

              {/* Ocean Swatch */}
              <button
                type="button"
                onClick={() => handleAccentChange('ocean')}
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0077ff, #14c9b0)',
                }}
                className={`flex items-center justify-center transition-transform cursor-pointer shadow-md ${
                  settings.accentTheme === 'ocean'
                    ? 'ring-4 ring-[var(--ink)] scale-110'
                    : 'hover:scale-105 opacity-80'
                }`}
                title="Ocean (Deep Blue + Teal)"
              >
                {settings.accentTheme === 'ocean' && (
                  <Check size={16} className="text-white stroke-[3]" />
                )}
              </button>

              {/* Forest Swatch */}
              <button
                type="button"
                onClick={() => handleAccentChange('forest')}
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #12a150, #c8a400)',
                }}
                className={`flex items-center justify-center transition-transform cursor-pointer shadow-md ${
                  settings.accentTheme === 'forest'
                    ? 'ring-4 ring-[var(--ink)] scale-110'
                    : 'hover:scale-105 opacity-80'
                }`}
                title="Forest (Green + Gold)"
              >
                {settings.accentTheme === 'forest' && (
                  <Check size={16} className="text-white stroke-[3]" />
                )}
              </button>

              <span className="mono text-xs text-[var(--mute)]">
                Selected: {settings.accentTheme || 'sunset'}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
            <div>
              <span className="font-bold text-sm block">Dark Theme</span>
              <p className="text-xs text-[var(--mute)]">
                Toggle deep dark contrast theme with glowing accents.
              </p>
            </div>
            <button
              type="button"
              onClick={handleThemeToggle}
              className={`tg2 ${settings.darkMode === 'dark' ? 'on' : ''}`}
              title="Toggle Dark Theme"
              aria-label="Toggle Dark Theme"
            >
              <div className="tg2-knob" />
            </button>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
            <div>
              <span className="font-bold text-sm block">Reduce Motion</span>
              <p className="text-xs text-[var(--mute)]">
                Disable transition animations, 3D flips, and hover lifts.
              </p>
            </div>
            <button
              type="button"
              onClick={() => updateSetting('reduceMotion', !settings.reduceMotion)}
              className={`tg2 ${settings.reduceMotion ? 'on' : ''}`}
              title="Toggle Reduce Motion"
              aria-label="Toggle Reduce Motion"
            >
              <div className="tg2-knob" />
            </button>
          </div>
        </div>

        {/* CARD 3: Pipeline, Models & Calibrate Threshold (Requirement 2) */}
        <div
          style={{
            borderRadius: '36px',
            padding: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] space-y-6"
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] pb-3">
            <div className="flex items-center gap-2">
              <Layers size={18} className="text-[var(--a1)]" />
              <h3 className="text-base font-bold text-[var(--ink)]">Retrieval &amp; Grounding Pipeline</h3>
            </div>
            <span className="mono text-xs text-[var(--mute)]">Evidence Controls</span>
          </div>

          {/* Embedding Model Choice Dropdown */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-sm block">Gemini Embedding Model</span>
                <p className="text-xs text-[var(--mute)]">
                  Vector model used for dense semantic retrieval across all candidate chunks.
                </p>
              </div>
              <Layers size={16} className="text-[var(--a1)]" />
            </div>
            <select
              value={settings.embeddingModel}
              onChange={(e) => handleEmbeddingModelChange(e.target.value)}
              style={{ borderRadius: '99px' }}
              className="w-full px-4 py-2.5 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs font-semibold text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)] cursor-pointer"
            >
              {MODEL_CONFIG.supportedEmbeddingModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Abstention Similarity Threshold with Calibrate Button (Requirement 2) */}
          <div className="pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)] space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-bold text-sm block">
                  Abstention Relevance Threshold ({settings.embeddingModel})
                </span>
                <p className="text-xs text-[var(--mute)]">
                  Per-model semantic cosine cutoff below which DocuMind abstains honestly.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCalibrateThreshold}
                  disabled={isCalibrating}
                  style={{ borderRadius: '99px' }}
                  className="px-3 py-1.5 bg-[var(--a1)] text-white hover:opacity-90 active:scale-95 transition-all text-xs font-bold flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                  title="Run evaluation set to automatically calibrate the optimal threshold"
                >
                  <Sparkles size={13} className={isCalibrating ? 'animate-spin' : ''} />
                  <span>{isCalibrating ? 'Calibrating...' : 'Calibrate'}</span>
                </button>
                <span className="mono font-bold text-sm text-[var(--a1)] px-3 py-1 rounded-full bg-[var(--a1)]/10">
                  {(settings.similarityThreshold ?? 0.45).toFixed(2)}
                </span>
              </div>
            </div>

            {calibrationProgress && (
              <div className="mono text-xs text-[var(--a1)] animate-pulse">
                {calibrationProgress}
              </div>
            )}

            <input
              type="range"
              min={0.20}
              max={0.70}
              step={0.01}
              value={settings.similarityThreshold ?? 0.45}
              onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
              className="w-full accent-[var(--a1)] cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-[var(--mute)]">
              <span>0.20 (permissive)</span>
              <span>
                Model default: {getModelSimilarityThreshold(settings.embeddingModel).toFixed(2)}
              </span>
              <span>0.70 (strict)</span>
            </div>
          </div>

          {/* Gemini Synthesis Model Choice */}
          <div className="pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)] space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-sm block">Gemini Synthesis Model</span>
                <p className="text-xs text-[var(--mute)]">
                  Select the reasoning model used for evidence grounding and answer generation.
                </p>
              </div>
              <Cpu size={16} className="text-[var(--a1)]" />
            </div>
            <select
              value={settings.generationModel}
              onChange={(e) => updateSetting('generationModel', e.target.value)}
              style={{ borderRadius: '99px' }}
              className="w-full px-4 py-2.5 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs font-semibold text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)] cursor-pointer"
            >
              {MODEL_CONFIG.supportedGenerationModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* CARD 4: Database Integrity & Diagnostics (Requirement 5) */}
        <div
          style={{
            borderRadius: '36px',
            padding: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] space-y-4"
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] pb-3">
            <div className="flex items-center gap-2">
              <Wrench size={18} className="text-[var(--a1)]" />
              <h3 className="text-base font-bold text-[var(--ink)]">Database Integrity &amp; Diagnostic</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCheckIntegrity}
                disabled={isCheckingIntegrity}
                style={{ borderRadius: '99px' }}
                className="btn outline sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={isCheckingIntegrity ? 'animate-spin' : ''} />
                <span>{isCheckingIntegrity ? 'Checking...' : 'Check Integrity'}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    integrityReport?.hasIssues
                      ? 'bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/30'
                      : 'bg-[var(--teal)]/10 text-[var(--teal)] border border-[var(--teal)]/30'
                  }`}
                >
                  {integrityReport?.hasIssues ? '⚠️ Inconsistencies Detected' : '✓ All Records Healthy'}
                </span>
                <span className="mono text-xs text-[var(--mute)]">
                  {integrityReport?.totalDocuments || 0} docs, {integrityReport?.totalChunks || 0} chunks, {integrityReport?.totalBlobs || 0} PDFs
                </span>
              </div>
              <p className="text-xs text-[var(--mute)] mt-1.5">
                {integrityReport?.hasIssues
                  ? `Found ${integrityReport.orphanChunksCount} orphan passages, ${integrityReport.emptyDocIds.length} empty docs, and ${integrityReport.missingBlobDocIds.length} missing PDF blobs.`
                  : 'No orphan chunks, unindexed documents, or detached blobs found.'}
              </p>
            </div>

            {integrityReport?.hasIssues && (
              <button
                type="button"
                onClick={handleRepairIntegrity}
                disabled={isRepairingIntegrity}
                style={{ borderRadius: '99px' }}
                className="btn sm !bg-[var(--ink)] text-white hover:opacity-90 active:scale-95 shrink-0"
              >
                <Wrench size={13} />
                <span>{isRepairingIntegrity ? 'Repairing...' : 'One-Click Repair'}</span>
              </button>
            )}
          </div>
        </div>

        {/* CARD 5: Granular Clear Actions & Danger Zone (Requirement 4) */}
        <div
          style={{
            borderRadius: '36px',
            padding: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="border border-[color-mix(in_srgb,var(--err)_35%,transparent)] space-y-4"
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] pb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={18} className="text-[var(--err)]" />
              <h3 className="text-base font-bold text-[var(--err)]">Granular Storage Clean-up &amp; Reset</h3>
            </div>
            <span className="mono text-xs text-[var(--mute)]">5s Undo Window</span>
          </div>

          <p className="text-xs text-[var(--mute)]">
            Execute targeted deletions with a 5-second reversible Undo window before hard-delete.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            {/* Action 1: Clear Chats */}
            <div className="p-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--mute)_6%,transparent)] border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] flex items-center justify-between gap-3">
              <div>
                <span className="font-bold text-xs block text-[var(--ink)]">Clear Chats</span>
                <span className="text-[11px] text-[var(--mute)]">Wipe conversation &amp; message history</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveClearAction({
                    id: 'chats',
                    title: 'Clear All Conversation Chats?',
                    description: 'This will remove all stored chat messages and conversation threads from IndexedDB. Your indexed PDF documents and notes are preserved.',
                    confirmLabel: 'Clear Chats',
                    action: clearChats,
                    successMessage: 'All chat conversations cleared.',
                  })
                }
                style={{ borderRadius: '99px' }}
                className="btn outline sm !text-xs !py-1 !px-3 shrink-0"
              >
                Clear
              </button>
            </div>

            {/* Action 2: Clear Evaluation History */}
            <div className="p-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--mute)_6%,transparent)] border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] flex items-center justify-between gap-3">
              <div>
                <span className="font-bold text-xs block text-[var(--ink)]">Clear Evaluation Runs</span>
                <span className="text-[11px] text-[var(--mute)]">Wipe benchmark &amp; run history</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveClearAction({
                    id: 'evals',
                    title: 'Clear Evaluation Run History?',
                    description: 'This will remove previous evaluation test run records from IndexedDB. Your test items and documents are kept.',
                    confirmLabel: 'Clear Evaluations',
                    action: clearEvaluationHistory,
                    successMessage: 'Evaluation run history cleared.',
                  })
                }
                style={{ borderRadius: '99px' }}
                className="btn outline sm !text-xs !py-1 !px-3 shrink-0"
              >
                Clear
              </button>
            </div>

            {/* Action 3: Clear Everything EXCEPT Settings */}
            <div className="p-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--mute)_6%,transparent)] border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] flex items-center justify-between gap-3">
              <div>
                <span className="font-bold text-xs block text-[var(--ink)]">Clear Data (Keep Settings)</span>
                <span className="text-[11px] text-[var(--mute)]">Wipe docs, vectors &amp; chats; keep config</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveClearAction({
                    id: 'allExceptSettings',
                    title: 'Wipe All Research Data?',
                    description: 'This will purge all PDF documents, vector passages, chats, and notebook items, but keeps your custom theme and pipeline settings intact.',
                    confirmLabel: 'Wipe Data',
                    action: clearAllExceptSettings,
                    successMessage: 'All research data cleared (settings kept).',
                  })
                }
                style={{ borderRadius: '99px' }}
                className="btn outline sm !border-[var(--err)]/40 !text-[var(--err)] !text-xs !py-1 !px-3 shrink-0"
              >
                Clear Data
              </button>
            </div>

            {/* Action 4: Full Factory Reset */}
            <div className="p-3.5 rounded-2xl bg-[color-mix(in_srgb,var(--err)_6%,transparent)] border border-[color-mix(in_srgb,var(--err)_25%,transparent)] flex items-center justify-between gap-3">
              <div>
                <span className="font-bold text-xs block text-[var(--err)]">Full Factory Reset</span>
                <span className="text-[11px] text-[var(--mute)]">Complete IndexedDB purge &amp; defaults</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setActiveClearAction({
                    id: 'fullReset',
                    title: 'Perform Full Factory Reset?',
                    description: 'This permanently wipes all local storage including documents, embeddings, chats, notes, and custom configuration settings.',
                    confirmLabel: 'Factory Reset',
                    action: fullReset,
                    successMessage: 'Complete application reset performed.',
                  })
                }
                style={{ borderRadius: '99px' }}
                className="btn sm !bg-[var(--err)] !text-xs !py-1 !px-3 shrink-0"
              >
                Reset All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* IMPORT BACKUP MODAL: Offers Merge vs Replace (Requirement 3) */}
      {pendingBackupSummary && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[3px] animate-in fade-in"
        >
          <div
            style={{ borderRadius: '36px', boxShadow: 'var(--sh)' }}
            className="bg-[var(--card)] p-6 sm:p-7 border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] max-w-md w-full space-y-4 shadow-2xl text-[var(--ink)] animate-in zoom-in-95"
          >
            <div className="flex items-center gap-2 text-[var(--a1)]">
              <FileArchive size={20} />
              <h3 className="text-lg font-bold text-[var(--ink)]">Import Backup File</h3>
            </div>

            <div className="p-3 bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] rounded-2xl space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-[var(--mute)]">Schema Version:</span>
                <span className="font-bold mono">v{pendingBackupSummary.schemaVersion}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mute)]">Exported On:</span>
                <span className="font-bold">{new Date(pendingBackupSummary.exportedAt).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mute)]">PDF Documents:</span>
                <span className="font-bold mono">{pendingBackupSummary.documentCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mute)]">Passage Chunks:</span>
                <span className="font-bold mono">{pendingBackupSummary.chunkCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mute)]">Raw PDF Blobs:</span>
                <span className="font-bold mono">{pendingBackupSummary.pdfBlobCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--mute)]">Chat Messages:</span>
                <span className="font-bold mono">{pendingBackupSummary.messageCount}</span>
              </div>
            </div>

            <p className="text-xs text-[var(--mute)] leading-relaxed">
              Choose how you would like to restore this backup:
            </p>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleExecuteImport('merge')}
                disabled={isImporting}
                style={{ borderRadius: '99px' }}
                className="btn sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span>Merge (Keep Existing &amp; Add New)</span>
              </button>
              <button
                type="button"
                onClick={() => handleExecuteImport('replace')}
                disabled={isImporting}
                style={{ borderRadius: '99px' }}
                className="btn outline sm !border-[var(--err)]/40 !text-[var(--err)] hover:!bg-[var(--err)]/10 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <span>Replace (Wipe Existing &amp; Restore)</span>
              </button>
              <button
                type="button"
                onClick={() => setPendingBackupSummary(null)}
                disabled={isImporting}
                style={{ borderRadius: '99px' }}
                className="btn outline sm text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION MODAL FOR DESTRUCTIVE ACTIONS (Requirement 4) */}
      {activeClearAction && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[3px] animate-in fade-in"
        >
          <div
            style={{ borderRadius: '36px', boxShadow: 'var(--sh)' }}
            className="bg-[var(--card)] p-6 sm:p-7 border border-[var(--err)]/40 max-w-sm w-full space-y-4 shadow-2xl text-[var(--ink)] animate-in zoom-in-95"
          >
            <div className="flex items-center gap-2 text-[var(--err)]">
              <AlertTriangle size={20} />
              <h3 className="text-lg font-bold">{activeClearAction.title}</h3>
            </div>
            <p className="text-xs text-[var(--mute)] leading-relaxed">
              {activeClearAction.description}
            </p>
            <div className="p-2.5 bg-[var(--a1)]/10 border border-[var(--a1)]/20 rounded-xl text-[11px] text-[var(--a1)]">
              💡 <strong>Safety feature:</strong> An Undo toast will be available for 5 seconds right after deletion.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActiveClearAction(null)}
                className="btn outline sm"
                disabled={isExecutingClear}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteClearAction}
                disabled={isExecutingClear}
                className="btn sm !bg-[var(--err)]"
              >
                {isExecutingClear ? 'Executing...' : activeClearAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
