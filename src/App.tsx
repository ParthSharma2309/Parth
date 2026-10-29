/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { Navbar, NavTab } from './components/ui/Navbar.tsx';
import { Workspace } from './components/workspace/Workspace.tsx';
import { OfflineBanner } from './components/ui/OfflineBanner.tsx';
import { ErrorBoundary } from './components/ui/ErrorBoundary.tsx';
import { CommandPalette } from './components/ui/CommandPalette.tsx';
import { ToastProvider } from './components/ui/Toast.tsx';
import { useReveal } from './hooks/useReveal.ts';
import { DocumentRecord, CollectionRecord, ConversationRecord, Citation } from './types/index.ts';
import {
  getAllDocuments,
  saveDocument,
  getAllCollections,
  getAllConversations,
  getSettings,
  requestPersistentStorage,
  checkDatabaseIntegrity,
  repairDatabaseIntegrity,
  IntegrityReport,
} from './services/storage.ts';
import { fetchCloudDocuments } from './services/cloudSync.ts';
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx';
import { RequireAuth } from './auth/RequireAuth.tsx';
import { FirebaseConfigError } from './components/auth/FirebaseConfigError.tsx';
import { isFirebaseConfigured } from './lib/firebase.ts';

// Lazy-load secondary views for optimal initial bundle performance
const DocumentLibrary = lazy(() =>
  import('./components/documents/DocumentLibrary.tsx').then((m) => ({ default: m.DocumentLibrary }))
);
const Dashboard = lazy(() =>
  import('./components/dashboard/Dashboard.tsx').then((m) => ({ default: m.Dashboard }))
);
const NotebookPage = lazy(() =>
  import('./components/notebook/NotebookPage.tsx').then((m) => ({ default: m.NotebookPage }))
);
const EvaluationPage = lazy(() =>
  import('./components/evaluation/EvaluationPage.tsx').then((m) => ({ default: m.EvaluationPage }))
);
const SettingsPage = lazy(() =>
  import('./components/settings/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage }))
);
const LandingPage = lazy(() =>
  import('./components/landing/LandingPage.tsx').then((m) => ({ default: m.LandingPage }))
);

const PageShimmer: React.FC = () => (
  <div className="w-full py-16 space-y-6 animate-pulse">
    <div className="h-8 bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] rounded-2xl w-1/3" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="h-44 bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] rounded-3xl" />
      <div className="h-44 bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] rounded-3xl" />
      <div className="h-44 bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] rounded-3xl" />
    </div>
  </div>
);

function AppInner() {
  useReveal();
  const { user, loading, isGuest, continueAsGuest } = useAuth();
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [integrityReport, setIntegrityReport] = useState<IntegrityReport | null>(null);
  const [isRepairingIntegrity, setIsRepairingIntegrity] = useState<boolean>(false);
  const [settings, setSettings] = useState<import('./types/index.ts').SettingsState | null>(null);

  // Navigation parameters for opening a specific document or citation in workspace
  const [workspaceInitialDocId, setWorkspaceInitialDocId] = useState<string | undefined>(undefined);
  const [workspaceInitialCitation, setWorkspaceInitialCitation] = useState<Citation | null>(null);
  const [workspaceOpenDeskOnLoad, setWorkspaceOpenDeskOnLoad] = useState<boolean>(false);

  const refreshData = useCallback(async () => {
    try {
      const [docs, cols, convs] = await Promise.all([
        getAllDocuments(),
        getAllCollections(),
        getAllConversations(),
      ]);

      // If registered user, fetch cloud-synced documents
      if (user && !isGuest) {
        try {
          const cloudDocs = await fetchCloudDocuments();
          if (cloudDocs) {
            const docMap = new Map<string, DocumentRecord>();
            // 1. Add authoritative cloud records scoped to this user
            for (const cd of cloudDocs) {
              const normalized = { ...cd, ownerId: cd.ownerId || user.uid };
              docMap.set(cd.id, normalized);
              saveDocument(normalized).catch(() => {});
            }
            // 2. Merge local records matching this user's UID
            for (const d of docs) {
              if (docMap.has(d.id)) {
                const cloudDoc = docMap.get(d.id)!;
                docMap.set(d.id, { ...d, ...cloudDoc });
              } else if (!d.storagePath && (!d.ownerId || d.ownerId === user.uid || d.userId === user.uid)) {
                // Pending local document
                docMap.set(d.id, d);
              }
            }
            const merged = Array.from(docMap.values());
            setDocuments(merged);
            setCollections(cols);
            setConversations(convs);
            return;
          }
        } catch (cloudErr) {
          console.warn('Could not fetch cloud documents:', cloudErr);
        }
      } else {
        // Guest or unauthenticated session: only show local guest documents (never cloud documents)
        const guestDocs = docs.filter((d) => !d.storagePath && (!d.ownerId || d.ownerId === 'guest'));
        setDocuments(guestDocs);
        setCollections(cols);
        setConversations(convs.filter((c) => !c.userId || c.userId === 'guest'));
        return;
      }

      setDocuments(docs);
      setCollections(cols);
      setConversations(convs);
    } catch (err) {
      console.error('Error refreshing app data:', err);
    }
  }, [user, isGuest]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // 5. Integrity check on startup: detect orphan chunks, empty docs, missing blobs (Requirement 5)
  useEffect(() => {
    checkDatabaseIntegrity()
      .then((rep) => {
        if (rep.hasIssues) {
          setIntegrityReport(rep);
        }
      })
      .catch((err) => console.warn('Integrity check skipped:', err));
  }, []);

  const handleRepairIntegrity = async () => {
    if (!integrityReport) return;
    setIsRepairingIntegrity(true);
    try {
      await repairDatabaseIntegrity(integrityReport);
      setIntegrityReport(null);
      await refreshData();
    } catch (err) {
      console.error('Integrity repair error:', err);
    } finally {
      setIsRepairingIntegrity(false);
    }
  };

  // Load and apply theme, accent preferences, and request persistent IndexedDB storage
  useEffect(() => {
    requestPersistentStorage().then((persisted) => {
      if (persisted) {
        console.log('DocuMind storage persistence granted.');
      }
    });

    getSettings().then((s) => {
      setSettings(s);
      const root = document.documentElement;
      if (s.darkMode === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
        root.setAttribute('data-theme', 'dark');
      } else if (s.darkMode === 'light') {
        root.classList.add('light');
        root.classList.remove('dark');
        root.setAttribute('data-theme', 'light');
      } else {
        root.classList.remove('light', 'dark');
        root.removeAttribute('data-theme');
      }
      if (s.accentTheme) {
        root.setAttribute('data-accent', s.accentTheme);
      }
      if (s.reduceMotion) {
        root.classList.add('reduce-motion');
      } else {
        root.classList.remove('reduce-motion');
      }
    }).catch(console.error);
  }, []);

  // Periodic status refresh for background processing documents
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === 'Processing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      refreshData();
    }, 2000);

    return () => clearInterval(interval);
  }, [documents, refreshData]);

  const handleTabChange = useCallback((tab: NavTab) => {
    if (tab === currentTab) return;
    if (typeof document !== 'undefined' && 'startViewTransition' in document && typeof (document as any).startViewTransition === 'function') {
      (document as any).startViewTransition(() => {
        setCurrentTab(tab);
      });
    } else {
      setCurrentTab(tab);
    }
  }, [currentTab]);

  // Global Keyboard Shortcuts (Cmd+K, /, Esc, and "g w" / "g d" chords)
  useEffect(() => {
    let pendingGKey = false;
    let gKeyTimeout: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) || (e.target as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      if (e.key === 'Escape') {
        setIsCommandPaletteOpen(false);
        pendingGKey = false;
        return;
      }

      // If user is inside an input, don't trigger navigation chords or slash
      if (isInput) return;

      if (e.key === '/') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // "g" chord navigation ("g w" -> Workspace, "g d" -> Documents)
      if (e.key.toLowerCase() === 'g' && !pendingGKey) {
        pendingGKey = true;
        clearTimeout(gKeyTimeout);
        gKeyTimeout = setTimeout(() => {
          pendingGKey = false;
        }, 1200);
        return;
      }

      if (pendingGKey) {
        pendingGKey = false;
        clearTimeout(gKeyTimeout);
        if (e.key.toLowerCase() === 'w') {
          e.preventDefault();
          handleTabChange('workspace');
          return;
        } else if (e.key.toLowerCase() === 'd') {
          e.preventDefault();
          handleTabChange('documents');
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(gKeyTimeout);
    };
  }, [handleTabChange]);

  // Lock body/html scroll ONLY on workspace route
  useEffect(() => {
    if (currentTab === 'workspace') {
      document.documentElement.classList.add('workspace-active');
      document.body.classList.add('workspace-active');
    } else {
      document.documentElement.classList.remove('workspace-active');
      document.body.classList.remove('workspace-active');
    }
    return () => {
      document.documentElement.classList.remove('workspace-active');
      document.body.classList.remove('workspace-active');
    };
  }, [currentTab]);

  const handleOpenDocumentInWorkspace = (docId: string) => {
    setWorkspaceInitialDocId(docId);
    setWorkspaceInitialCitation(null);
    setWorkspaceOpenDeskOnLoad(false);
    handleTabChange('workspace');
  };

  const handleOpenInReadingDesk = (docId: string) => {
    setWorkspaceInitialDocId(docId);
    setWorkspaceInitialCitation(null);
    setWorkspaceOpenDeskOnLoad(true);
    handleTabChange('workspace');
  };

  const handleOpenCitationInWorkspace = (docId: string, pageNumber: number) => {
    setWorkspaceInitialDocId(docId);
    setWorkspaceOpenDeskOnLoad(true);
    setWorkspaceInitialCitation({
      marker: 1,
      chunkId: '',
      documentId: docId,
      documentName: documents.find((d) => d.id === docId)?.name || 'Document',
      pageNumber,
      quote: '',
      verified: true,
      passageText: '',
      similarity: 1.0,
    });
    handleTabChange('workspace');
  };

  if (!isFirebaseConfigured && !user && !isGuest && !loading) {
    return <FirebaseConfigError onContinueAsGuest={continueAsGuest} />;
  }

  return (
    <RequireAuth
      currentTabName={currentTab}
      autoSignOutMinutes={settings?.autoSignOutMinutes ?? 30}
      onLoginSuccess={() => {
        if (currentTab === 'landing') {
          handleTabChange('workspace');
        }
      }}
    >
      <div className="h-full w-full flex flex-col bg-[var(--bg)] font-sans text-[var(--ink)] antialiased relative overflow-hidden selection:bg-[var(--pink)]/30 selection:text-[var(--ink)]">
          {/* Network Reliability Offline Banner */}
          <OfflineBanner />

        {/* Exact Fixed Floating Pill Navigation */}
        <Navbar
          currentTab={currentTab}
          onTabChange={handleTabChange}
          documents={documents}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        {/* Startup Storage Integrity Diagnostic Notice (Requirement 5) */}
        {integrityReport && integrityReport.hasIssues && (
          <div className="w-full bg-[var(--yellow)]/20 border-b border-[var(--yellow)]/50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--ink)] z-40 animate-in fade-in">
            <div className="flex items-center gap-2">
              <span className="font-bold">⚠️ Storage Integrity Diagnostic:</span>
              <span>
                Detected{' '}
                {[
                  integrityReport.orphanChunksCount > 0 && `${integrityReport.orphanChunksCount} orphan passages`,
                  integrityReport.emptyDocIds.length > 0 && `${integrityReport.emptyDocIds.length} empty documents`,
                  integrityReport.missingBlobDocIds.length > 0 && `${integrityReport.missingBlobDocIds.length} missing raw PDFs`,
                ].filter(Boolean).join(', ')}.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRepairIntegrity}
                disabled={isRepairingIntegrity}
                className="px-3 py-1 rounded-full bg-[var(--ink)] text-white hover:opacity-90 active:scale-95 transition-all font-bold cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isRepairingIntegrity ? 'Repairing...' : 'One-Click Repair'}
              </button>
              <button
                type="button"
                onClick={() => setIntegrityReport(null)}
                className="px-2 py-1 text-[var(--mute)] hover:text-[var(--ink)] cursor-pointer text-sm"
                title="Dismiss notice"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Main Content Area: Workspace vs Page Shell (.pg + .pg-inner) */}
        <main className="flex-1 w-full h-full relative overflow-hidden">
          {currentTab === 'workspace' ? (
            <ErrorBoundary pageName="Research Workspace">
              <Workspace
                key="workspace"
                documents={documents}
                collections={collections}
                initialDocumentId={workspaceInitialDocId}
                initialCitation={workspaceInitialCitation}
                openDeskOnLoad={workspaceOpenDeskOnLoad}
                onNavigateToNotebook={() => handleTabChange('notebook')}
              />
            </ErrorBoundary>
          ) : (
            <div className="pg" key={currentTab}>
              <div className="pg-inner">
                {currentTab === 'landing' && (
                  <ErrorBoundary pageName="Landing Page">
                    <Suspense fallback={<PageShimmer />}>
                      <LandingPage
                        onStartResearching={() => handleTabChange('workspace')}
                        onExploreFeatures={() => handleTabChange('documents')}
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}

                {currentTab === 'dashboard' && (
                  <ErrorBoundary pageName="Analytics Dashboard">
                    <Suspense fallback={<PageShimmer />}>
                      <Dashboard
                        documents={documents}
                        conversations={conversations}
                        onNavigate={(tab) => handleTabChange(tab as NavTab)}
                        onOpenDocument={handleOpenDocumentInWorkspace}
                        onRefresh={refreshData}
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}

                {currentTab === 'documents' && (
                  <ErrorBoundary pageName="Document Library">
                    <Suspense fallback={<PageShimmer />}>
                      <DocumentLibrary
                        documents={documents}
                        collections={collections}
                        onRefresh={refreshData}
                        onOpenDocumentInWorkspace={handleOpenDocumentInWorkspace}
                        onOpenInReadingDesk={handleOpenInReadingDesk}
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}

                {currentTab === 'notebook' && (
                  <ErrorBoundary pageName="Research Notebook">
                    <Suspense fallback={<PageShimmer />}>
                      <NotebookPage
                        onOpenCitation={handleOpenCitationInWorkspace}
                        onNavigateToWorkspace={() => handleTabChange('workspace')}
                      />
                    </Suspense>
                  </ErrorBoundary>
                )}

                {currentTab === 'evaluation' && (
                  <ErrorBoundary pageName="Quality Evaluation">
                    <Suspense fallback={<PageShimmer />}>
                      <EvaluationPage documents={documents} />
                    </Suspense>
                  </ErrorBoundary>
                )}

                {currentTab === 'settings' && (
                  <ErrorBoundary pageName="System Settings">
                    <Suspense fallback={<PageShimmer />}>
                      <SettingsPage onRefreshData={refreshData} />
                    </Suspense>
                  </ErrorBoundary>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Global Command Palette (Cmd+K) */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onNavigate={handleTabChange}
          onTriggerUpload={() => {
            handleTabChange('documents');
          }}
        />
      </div>
    </RequireAuth>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </AuthProvider>
  );
}
