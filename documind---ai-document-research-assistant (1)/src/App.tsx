/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar, NavTab } from './components/ui/Navbar.tsx';
import { Workspace } from './components/workspace/Workspace.tsx';
import { DocumentLibrary } from './components/documents/DocumentLibrary.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import { EvaluationPage } from './components/evaluation/EvaluationPage.tsx';
import { SettingsPage } from './components/settings/SettingsPage.tsx';
import { LandingPage } from './components/landing/LandingPage.tsx';
import { DocumentRecord, CollectionRecord, ConversationRecord, Citation } from './types/index.ts';
import {
  getAllDocuments,
  getAllCollections,
  getAllConversations,
} from './services/storage.ts';

export default function App() {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);

  // Navigation parameters for opening a specific document or citation in workspace
  const [workspaceInitialDocId, setWorkspaceInitialDocId] = useState<string | undefined>(undefined);
  const [workspaceInitialCitation, setWorkspaceInitialCitation] = useState<Citation | null>(null);

  const refreshData = useCallback(async () => {
    try {
      const [docs, cols, convs] = await Promise.all([
        getAllDocuments(),
        getAllCollections(),
        getAllConversations(),
      ]);
      setDocuments(docs);
      setCollections(cols);
      setConversations(convs);
    } catch (err) {
      console.error('Error refreshing app data:', err);
    }
  }, []);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Periodic status refresh for background processing documents
  useEffect(() => {
    const hasProcessing = documents.some((d) => d.status === 'Processing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      refreshData();
    }, 2000);

    return () => clearInterval(interval);
  }, [documents, refreshData]);

  const handleOpenDocumentInWorkspace = (docId: string) => {
    setWorkspaceInitialDocId(docId);
    setWorkspaceInitialCitation(null);
    setCurrentTab('workspace');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#111113] font-sans text-[#f2efeb] antialiased">
      {/* Top Navigation */}
      <Navbar
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        documents={documents}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentTab === 'landing' && (
          <LandingPage
            onStartResearching={() => setCurrentTab('workspace')}
            onExploreFeatures={() => setCurrentTab('documents')}
          />
        )}

        {currentTab === 'dashboard' && (
          <Dashboard
            documents={documents}
            conversations={conversations}
            onNavigate={(tab) => setCurrentTab(tab)}
            onOpenDocument={handleOpenDocumentInWorkspace}
            onRefresh={refreshData}
          />
        )}

        {currentTab === 'workspace' && (
          <Workspace
            documents={documents}
            collections={collections}
            initialDocumentId={workspaceInitialDocId}
            initialCitation={workspaceInitialCitation}
          />
        )}

        {currentTab === 'documents' && (
          <DocumentLibrary
            documents={documents}
            collections={collections}
            onRefresh={refreshData}
            onOpenDocumentInWorkspace={handleOpenDocumentInWorkspace}
          />
        )}

        {currentTab === 'evaluation' && (
          <EvaluationPage documents={documents} />
        )}

        {currentTab === 'settings' && (
          <SettingsPage onRefreshData={refreshData} />
        )}
      </main>
    </div>
  );
}
