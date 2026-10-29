import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search,
  User,
  LogOut,
  Settings,
  ShieldCheck,
  Laptop,
  ChevronDown,
  Sun,
  Moon,
  Cloud,
  CloudOff,
  RefreshCw,
  Sparkles,
  Check,
} from 'lucide-react';
import { DocumentRecord, SettingsState } from '../../types/index.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import { getSettings, saveSettings } from '../../services/storage.ts';

export type NavTab =
  | 'workspace'
  | 'documents'
  | 'dashboard'
  | 'notebook'
  | 'evaluation'
  | 'settings'
  | 'landing';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  documents?: DocumentRecord[];
  onOpenCommandPalette?: () => void;
}

type ThemeMode = 'light' | 'dark' | 'system';

interface UserMenuProps {
  onNavigateSettings: () => void;
}

const UserProfileNavButton: React.FC<UserMenuProps> = ({ onNavigateSettings }) => {
  const { user, isGuest, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Network & Sync status state
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('system');

  // Load current theme preference
  useEffect(() => {
    getSettings()
      .then((s) => {
        if (s && s.darkMode) {
          setCurrentTheme(s.darkMode);
        }
      })
      .catch(() => {
        // Fallback to checking html class
        if (document.documentElement.classList.contains('dark')) {
          setCurrentTheme('dark');
        } else if (document.documentElement.classList.contains('light')) {
          setCurrentTheme('light');
        } else {
          setCurrentTheme('system');
        }
      });
  }, []);

  // Listen to network status changes
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Trigger a brief syncing visual pulse
      setIsSyncing(true);
      const timer = setTimeout(() => setIsSyncing(false), 1200);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsSyncing(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Close dropdown on click outside or escape key
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const applyTheme = useCallback(async (mode: ThemeMode) => {
    setCurrentTheme(mode);
    const root = document.documentElement;
    if (mode === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    } else {
      root.classList.remove('light', 'dark');
      root.removeAttribute('data-theme');
    }

    try {
      const s = await getSettings();
      await saveSettings({ ...s, darkMode: mode });
    } catch (err) {
      console.warn('Could not persist theme preference:', err);
    }
  }, []);

  if (!user) return null;

  const displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'Guest');
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex items-center gap-2" ref={menuRef}>
      {/* 1. Sync Indicator or Guest Mode Badge on the Navbar */}
      {isGuest ? (
        <button
          type="button"
          onClick={onNavigateSettings}
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all cursor-pointer whitespace-nowrap shadow-xs"
          title="Guest mode: documents stay on this device. Click to create an account and enable cloud sync."
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
          <span className="hidden md:inline">Guest mode - Create account to sync</span>
          <span className="md:hidden">Guest mode</span>
        </button>
      ) : (
        <div
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors whitespace-nowrap"
          style={{
            borderColor: !isOnline
              ? 'rgba(229, 72, 77, 0.4)'
              : isSyncing
              ? 'rgba(255, 210, 63, 0.4)'
              : 'rgba(20, 201, 176, 0.35)',
            background: !isOnline
              ? 'rgba(229, 72, 77, 0.1)'
              : isSyncing
              ? 'rgba(255, 210, 63, 0.1)'
              : 'rgba(20, 201, 176, 0.1)',
            color: !isOnline ? 'var(--err)' : isSyncing ? 'var(--sun)' : 'var(--teal)',
          }}
          title={
            !isOnline
              ? 'Offline: Changes are saved locally and will sync when reconnected'
              : isSyncing
              ? 'Syncing changes to Firebase Firestore...'
              : 'Saved: All documents and data synced to cloud'
          }
        >
          {!isOnline ? (
            <>
              <span className="w-2 h-2 rounded-full bg-[var(--err)] animate-pulse shrink-0" />
              <span className="text-[11px] font-medium">Offline - will sync</span>
            </>
          ) : isSyncing ? (
            <>
              <RefreshCw className="w-3 h-3 animate-spin shrink-0 text-[var(--sun)]" />
              <span className="text-[11px] font-medium">Syncing</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-[var(--teal)] shadow-[0_0_8px_var(--teal)] shrink-0" />
              <span className="text-[11px] font-medium">Saved</span>
            </>
          )}
        </div>
      )}

      {/* 2. Interactive Avatar Pill */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 rounded-full border border-[color-mix(in_srgb,var(--mute)_25%,transparent)] bg-[var(--card)] hover:bg-[color-mix(in_srgb,var(--card)_80%,var(--ink))] text-xs transition-all cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-[var(--a1)]"
          aria-expanded={isOpen}
          aria-haspopup="true"
          title="Account & Session Menu"
        >
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt={displayName}
              className="w-6 h-6 rounded-full object-cover border border-[color-mix(in_srgb,var(--mute)_30%,transparent)]"
            />
          ) : (
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] text-white shadow-xs shrink-0"
              style={{
                background: isGuest
                  ? 'linear-gradient(135deg, var(--tang), var(--sun))'
                  : 'linear-gradient(135deg, var(--a1), var(--a2))',
              }}
            >
              {isGuest ? <Laptop className="w-3.5 h-3.5" /> : initial}
            </div>
          )}
          <span className="hidden sm:inline font-semibold text-[12px] text-[var(--ink)] max-w-[100px] truncate">
            {displayName}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-[var(--mute)] transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* 3. User Dropdown Menu */}
        {isOpen && (
          <div
            className="absolute right-0 top-full mt-2 w-72 rounded-3xl bg-[var(--card)] border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] shadow-[var(--sh)] p-3 z-50 text-[var(--ink)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150"
            role="menu"
            aria-orientation="vertical"
          >
            {/* User Profile Header */}
            <div className="flex items-center gap-3 p-2 rounded-2xl bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] mb-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={displayName}
                  className="w-10 h-10 rounded-full object-cover border border-[color-mix(in_srgb,var(--mute)_30%,transparent)] shrink-0"
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-sm text-white shadow-xs shrink-0"
                  style={{
                    background: isGuest
                      ? 'linear-gradient(135deg, var(--tang), var(--sun))'
                      : 'linear-gradient(135deg, var(--a1), var(--a2))',
                  }}
                >
                  {isGuest ? <Laptop className="w-5 h-5" /> : initial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-bold truncate text-[var(--ink)]">{displayName}</p>
                  {isGuest ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-500 dark:text-amber-400 font-semibold uppercase">
                      Guest
                    </span>
                  ) : (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      Pro
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[var(--mute)] truncate font-mono mt-0.5">
                  {user.email || 'Local guest mode'}
                </p>
              </div>
            </div>

            {/* Sync Status Section */}
            <div className="px-3 py-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--mute)_15%,transparent)] bg-[color-mix(in_srgb,var(--card)_60%,transparent)] mb-2.5">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="font-semibold text-[var(--ink)] flex items-center gap-1.5">
                  {isGuest ? (
                    <Laptop className="w-3.5 h-3.5 text-amber-500" />
                  ) : !isOnline ? (
                    <CloudOff className="w-3.5 h-3.5 text-[var(--err)]" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 text-[var(--teal)]" />
                  )}
                  Sync Status
                </span>
                <span
                  className="font-medium text-[10px] px-1.5 py-0.2 rounded-full"
                  style={{
                    color: isGuest
                      ? 'var(--tang)'
                      : !isOnline
                      ? 'var(--err)'
                      : isSyncing
                      ? 'var(--sun)'
                      : 'var(--teal)',
                    background: isGuest
                      ? 'rgba(255, 122, 47, 0.12)'
                      : !isOnline
                      ? 'rgba(229, 72, 77, 0.12)'
                      : isSyncing
                      ? 'rgba(255, 210, 63, 0.12)'
                      : 'rgba(20, 201, 176, 0.12)',
                  }}
                >
                  {isGuest
                    ? 'Local Only'
                    : !isOnline
                    ? 'Offline'
                    : isSyncing
                    ? 'Syncing'
                    : 'Saved'}
                </span>
              </div>
              <p className="text-[10.5px] text-[var(--mute)] leading-relaxed">
                {isGuest
                  ? 'Data stored locally in browser IndexedDB. Create an account to sync across devices.'
                  : !isOnline
                  ? 'Network disconnected. Local modifications will sync automatically when back online.'
                  : 'All research documents, chunks, notes, and conversations are safely synced.'}
              </p>
            </div>

            {/* Quick Theme Switcher */}
            <div className="px-2 py-2 mb-2">
              <div className="text-[11px] font-semibold text-[var(--mute)] uppercase tracking-wider mb-1.5 px-1">
                Theme
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[color-mix(in_srgb,var(--mute)_12%,transparent)]">
                <button
                  type="button"
                  onClick={() => applyTheme('light')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    currentTheme === 'light'
                      ? 'bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold'
                      : 'text-[var(--mute)] hover:text-[var(--ink)]'
                  }`}
                  title="Light Theme"
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyTheme('dark')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    currentTheme === 'dark'
                      ? 'bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold'
                      : 'text-[var(--mute)] hover:text-[var(--ink)]'
                  }`}
                  title="Dark Theme"
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>Dark</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyTheme('system')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                    currentTheme === 'system'
                      ? 'bg-[var(--card)] text-[var(--ink)] shadow-xs font-semibold'
                      : 'text-[var(--mute)] hover:text-[var(--ink)]'
                  }`}
                  title="System Theme"
                >
                  <Laptop className="w-3.5 h-3.5" />
                  <span>Auto</span>
                </button>
              </div>
            </div>

            <div className="h-px bg-[color-mix(in_srgb,var(--mute)_18%,transparent)] my-1" />

            {/* Actions */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNavigateSettings();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-xl hover:bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] text-[var(--ink)] transition-colors cursor-pointer text-left"
            >
              <Settings className="w-3.5 h-3.5 text-[var(--mute)]" />
              <span>Account & Settings</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                signOut();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium rounded-xl hover:bg-rose-500/10 text-rose-500 dark:text-rose-400 transition-colors cursor-pointer text-left mt-0.5"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  onOpenCommandPalette,
}) => {
  const tabs: Array<{ id: NavTab; label: string }> = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'documents', label: 'Documents' },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'notebook', label: 'Notebook' },
    { id: 'evaluation', label: 'Evaluation' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <header className="nav" aria-label="Main Navigation">
      {/* Logo: Bricolage Grotesque 800 20px, Docu plain + Mind gradient text */}
      <div
        onClick={() => onTabChange('landing')}
        className="cursor-pointer select-none shrink-0 pr-3 flex items-center"
        style={{
          fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
          fontWeight: 800,
          fontSize: '20px',
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}
        title="DocuMind Home"
      >
        <span style={{ color: 'var(--ink)' }}>Docu</span>
        <span
          style={{
            background: 'linear-gradient(90deg,var(--a1),var(--a2))',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
          }}
        >
          Mind
        </span>
      </div>

      {/* Tabs */}
      <nav className="flex items-center gap-[2px]">
        {tabs.map((tab) => {
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`nav-tab ${isActive ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Search & Actions (⌘K) button pill with 1px border in var(--mute) */}
      <div className="flex items-center gap-2 ml-auto shrink-0">
        {onOpenCommandPalette && (
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="nav-search"
            title="Command Palette (Cmd+K)"
          >
            <Search size={13} style={{ color: 'var(--a1)' }} />
            <span className="hidden sm:inline">Search & Actions</span>
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 mono text-[10px] rounded border border-[var(--mute)]">
              ⌘K
            </kbd>
          </button>
        )}

        <UserProfileNavButton onNavigateSettings={() => onTabChange('settings')} />
      </div>
    </header>
  );
};
