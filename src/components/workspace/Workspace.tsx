import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Send,
  Plus,
  Trash2,
  BookOpen,
  MessageSquare,
  Loader2,
  Archive,
  ArrowRight,
  ArrowDown,
  Square,
  Sparkles,
  X,
  Menu,
  ChevronLeft,
  Layers,
} from 'lucide-react';
import {
  DocumentRecord,
  CollectionRecord,
  ConversationRecord,
  MessageRecord,
  Citation,
  RetrievalScope,
  NotebookItem,
} from '../../types/index.ts';
import {
  getAllConversations,
  getConversation,
  saveConversation,
  deleteConversation,
  getMessagesByConversation,
  saveMessage,
  getDocumentBlob,
  getSettings,
  saveNotebookItem,
} from '../../services/storage.ts';
import { runAnsweringPipeline } from '../../services/answering.ts';
import { reindexChunksWithModel } from '../../services/docProcessor.ts';
import { MessageItem } from './MessageItem.tsx';
import { ScopeSelector } from './ScopeSelector.tsx';
import { PDFViewer } from '../pdf/PDFViewer.tsx';
import { PreviousAnswersArchiveModal } from './PreviousAnswersArchiveModal.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useAuth } from '../../auth/AuthProvider.tsx';
import {
  loadDocumentBlob,
  downloadDocumentFile,
  ensureDocumentChunksAvailable,
  fetchCloudConversations,
  fetchCloudMessages,
  saveCloudConversation,
  saveCloudMessage,
  deleteCloudConversation,
} from '../../services/cloudSync.ts';

interface WorkspaceProps {
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  initialDocumentId?: string;
  initialCitation?: Citation | null;
  openDeskOnLoad?: boolean;
  openDeskToken?: number;
  onNavigateToNotebook?: () => void;
}

export const Workspace: React.FC<WorkspaceProps> = ({
  documents,
  collections,
  initialDocumentId,
  initialCitation,
  openDeskOnLoad = false,
  openDeskToken,
  onNavigateToNotebook,
}) => {
  // Reading Desk Open State (Default false, hidden on first load)
  const [deskOpen, setDeskOpen] = useState<boolean>(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);

  // Conversations state
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<ConversationRecord | null>(null);

  // Active chat messages & query input
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>('');
  const [isReindexing, setIsReindexing] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Archive modal
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState<boolean>(false);

  // Active Scope
  const [currentScope, setCurrentScope] = useState<RetrievalScope>({ type: 'all' });

  // PDF Desk State
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [activePdfBlob, setActivePdfBlob] = useState<Blob | null | undefined>(undefined);
  const [activePdfName, setActivePdfName] = useState<string>('Document');
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  // Session-level memory: remember the last page per document
  const lastPagePerDoc = useRef<Record<string, number>>({});

  // Chat scroll management & Jump to latest pill
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isNearBottomRef = useRef<boolean>(true);
  const [showJumpToLatest, setShowJumpToLatest] = useState<boolean>(false);

  const { showToast } = useToast();
  const { user, isGuest } = useAuth();

  const loadConversations = useCallback(async () => {
    try {
      let convs: ConversationRecord[] = [];
      if (user && !isGuest) {
        const [cloudConvs, localConvs] = await Promise.all([
          fetchCloudConversations(),
          getAllConversations(),
        ]);
        const map = new Map<string, ConversationRecord>();
        if (Array.isArray(cloudConvs)) {
          for (const c of cloudConvs) map.set(c.id, { ...c, userId: user.uid });
          for (const l of localConvs) {
            if (!map.has(l.id)) {
              if (l.userId === user.uid) {
                // Deleted on another device
                deleteConversation(l.id).catch(() => {});
              } else if (!l.userId) {
                map.set(l.id, { ...l, userId: user.uid });
              }
            }
          }
        } else {
          for (const l of localConvs) {
            if (l.userId === user.uid || !l.userId) {
              map.set(l.id, { ...l, userId: user.uid });
            }
          }
        }
        convs = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
      } else {
        const local = await getAllConversations();
        convs = local.filter((c) => !c.userId || c.userId === 'guest');
      }

      setConversations(convs);
      if (convs.length > 0 && !activeConvId) {
        selectConversation(convs[0].id);
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [activeConvId, user, isGuest]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const loadDocForViewer = useCallback(
    async (docId: string, pageNumber?: number) => {
      try {
        const doc = documents.find((d) => d.id === docId);
        setActiveDocId(docId);
        if (doc) {
          setActivePdfName(doc.name);
        }
        // Set to null to indicate loading while checking local DB or cloud storage
        setActivePdfBlob(null);
        let blob = await getDocumentBlob(docId);
        if (!blob) {
          // If not in local indexedDB, fetch via signed URL from Supabase Storage
          blob = (await loadDocumentBlob(docId)) || undefined;
        }
        setActivePdfBlob(blob);
        if (pageNumber) {
          lastPagePerDoc.current[docId] = pageNumber;
        }
        // Pre-warm chunks and embeddings in local IndexedDB in background if needed (e.g. on Device 2)
        ensureDocumentChunksAvailable(docId, doc?.name).catch((err) => {
          console.warn('[Workspace] Background chunk warming warning:', err);
        });
      } catch (err) {
        console.error('Failed to load PDF blob for viewer:', err);
      }
    },
    [documents]
  );

  // Load initial document or citation if passed via props
  useEffect(() => {
    if (initialDocumentId) {
      loadDocForViewer(initialDocumentId, 1);
      setCurrentScope({ type: 'selected', documentIds: [initialDocumentId] });
      if (openDeskOnLoad) {
        setDeskOpen(true);
      }
    }
  }, [initialDocumentId, openDeskOnLoad, openDeskToken, loadDocForViewer]);

  useEffect(() => {
    if (initialCitation) {
      setActiveCitation(initialCitation);
      if (initialCitation.documentId) {
        loadDocForViewer(initialCitation.documentId, initialCitation.pageNumber);
      }
      setDeskOpen(true);
    }
  }, [initialCitation, loadDocForViewer]);

  // Handle Chat Scroll - Detect whether user is near bottom
  const handleChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    const threshold = 120;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNear = distanceFromBottom < threshold;
    isNearBottomRef.current = isNear;
    setShowJumpToLatest(!isNear);
  };

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  // Auto-scroll chat only when user is near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [messages, streamingText, scrollToBottom]);

  // Esc key global handler to close Reading Desk
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && deskOpen) {
        setDeskOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deskOpen]);

  // Body overflow hidden on this route
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Safely deselect and close Reading Desk if active document is removed from documents list
  useEffect(() => {
    if (activeDocId && !documents.some((d) => d.id === activeDocId)) {
      setActiveDocId(null);
      setActivePdfBlob(undefined);
      setActivePdfName('Document');
      setActiveCitation(null);
      setDeskOpen(false);
    }

    // Prune deleted documents from active selection scope
    setCurrentScope((prev) => {
      if (prev.type === 'selected') {
        const remaining = prev.documentIds.filter((id) => documents.some((d) => d.id === id));
        if (remaining.length === 0) {
          return { type: 'all' };
        }
        if (remaining.length !== prev.documentIds.length) {
          return { type: 'selected', documentIds: remaining };
        }
      }
      return prev;
    });
  }, [documents, activeDocId]);

  const selectConversation = async (convId: string) => {
    setActiveConvId(convId);
    try {
      const conv = await getConversation(convId);
      setActiveConv(conv || null);
      if (conv?.scope) {
        setCurrentScope(conv.scope);
      }
      const msgs = (await getMessagesByConversation(convId)) || [];
      setMessages(msgs);

      // If registered user, fetch latest cloud messages from Firestore
      if (user && !isGuest) {
        const cloudMsgs = await fetchCloudMessages(convId);
        if (Array.isArray(cloudMsgs)) {
          setMessages(cloudMsgs);
        }
      }
    } catch (err) {
      console.error('Failed to load conversation details:', err);
    }
    setMobileDrawerOpen(false);
  };

  const handleCreateNewThread = async () => {
    const newConv: ConversationRecord = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: 'New Research Inquiry',
      scope: currentScope,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      userId: user?.uid,
    };
    try {
      await saveCloudConversation(newConv);
    } catch (saveErr) {
      console.warn('Failed to persist new conversation to cloud:', saveErr);
    }
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setActiveConv(newConv);
    setMessages([]);
    setMobileDrawerOpen(false);
  };

  const handleDeleteConversation = async (e: React.MouseEvent, conv: ConversationRecord) => {
    e.stopPropagation();
    try {
      const msgs = await getMessagesByConversation(conv.id);
      await deleteCloudConversation(conv.id);
      setConversations((prev) => prev.filter((c) => c.id !== conv.id));

      if (activeConvId === conv.id) {
        const remaining = conversations.filter((c) => c.id !== conv.id);
        if (remaining.length > 0) {
          selectConversation(remaining[0].id);
        } else {
          setActiveConvId(null);
          setActiveConv(null);
          setMessages([]);
        }
      }

      showToast({
        message: 'Inquiry thread deleted',
        type: 'info',
        duration: 5000,
        undoAction: async () => {
          await saveConversation(conv);
          for (const m of msgs) {
            await saveMessage(m);
          }
          await loadConversations();
          selectConversation(conv.id);
          showToast({ message: 'Conversation restored', type: 'success' });
        },
      });
    } catch (err) {
      showToast({ message: 'Failed to delete conversation', type: 'error' });
    }
  };

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
      setIsSubmitting(false);
      showToast({ message: 'Generation stopped', type: 'info' });
    }
  };

  const handleSubmit = async (overrideQuery?: string) => {
    const query = (overrideQuery || inputQuery).trim();
    if (!query || isSubmitting) return;

    let targetConvId = activeConvId;
    let targetConv = activeConv;

    if (!targetConvId || !targetConv) {
      const newConv: ConversationRecord = {
        id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        title: query.slice(0, 36) + (query.length > 36 ? '...' : ''),
        scope: currentScope,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        userId: user?.uid,
      };
      await saveCloudConversation(newConv).catch((err) => {
        console.warn('Failed to persist conversation to cloud:', err);
      });
      setConversations((prev) => [newConv, ...prev]);
      targetConvId = newConv.id;
      targetConv = newConv;
      setActiveConvId(newConv.id);
      setActiveConv(newConv);
    }

    const userMsg: MessageRecord = {
      id: `msg_user_${Date.now()}`,
      conversationId: targetConvId,
      role: 'user',
      content: query,
      createdAt: Date.now(),
      status: 'answered',
      citations: [],
      retrievalScope: currentScope,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    await saveCloudMessage(targetConvId, userMsg).catch((err) => {
      console.warn('Failed to persist user message to cloud:', err);
      showToast({ message: 'Saved locally; cloud sync failed. Retrying in background...', type: 'info' });
    });
    setInputQuery('');
    setIsSubmitting(true);
    setIsStreaming(false);
    setStreamingText('');

    // Force scroll to user's question immediately
    setTimeout(() => scrollToBottom('smooth'), 50);

    if (messages.length === 0) {
      const newTitle = query.slice(0, 36) + (query.length > 36 ? '...' : '');
      const updatedConv: ConversationRecord = {
        ...targetConv,
        title: newTitle,
        updatedAt: Date.now(),
        userId: user?.uid,
      };
      setActiveConv(updatedConv);
      await saveCloudConversation(updatedConv).catch(() => {});
      setConversations((prev) =>
        prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
      );
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const settings = await getSettings();

      const history = nextMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const pipelineOutput = await runAnsweringPipeline({
        conversationId: targetConvId,
        userQuestion: query,
        history,
        scope: currentScope,
        settings,
        availableDocs: documents,
        abortSignal: abortController.signal,
        onStreamToken: (token) => {
          setIsStreaming(true);
          setStreamingText((prev) => prev + token);
        },
      });

      const assistantMsg: MessageRecord = {
        id: `msg_asst_${Date.now()}`,
        conversationId: targetConvId,
        role: 'assistant',
        content: pipelineOutput.answerText,
        createdAt: Date.now(),
        citations: pipelineOutput.citations,
        status: pipelineOutput.status,
        errorMessage: pipelineOutput.errorMessage,
        indexMismatch: pipelineOutput.indexMismatch,
        retrievalScope: currentScope,
        retrievalScores: pipelineOutput.retrievalScores,
        latencyMs: pipelineOutput.latencyMs,
        followupSuggestions: pipelineOutput.followupSuggestions,
      };

      await saveCloudMessage(targetConvId, assistantMsg).catch((err) => {
        console.warn('Failed to persist assistant message to cloud:', err);
      });
      setMessages([...nextMessages, assistantMsg]);
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        // Stop requested
      } else {
        console.error('Error generating answer:', err);
        const isMismatch = err?.name === 'IndexMismatchError';
        const errorMsg: MessageRecord = {
          id: `msg_err_${Date.now()}`,
          conversationId: targetConvId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          citations: [],
          status: 'error',
          errorMessage: err.message || 'An unexpected pipeline error occurred.',
          indexMismatch: isMismatch
            ? {
                indexedModel: err.indexedModel,
                currentModel: err.currentModel,
                indexedDim: err.indexedDim,
                currentDim: err.currentDim,
              }
            : undefined,
          retrievalScope: currentScope,
        };

        await saveCloudMessage(targetConvId, errorMsg).catch(() => {});
        setMessages([...nextMessages, errorMsg]);
      }
    } finally {
      setIsSubmitting(false);
      setIsStreaming(false);
      setStreamingText('');
      abortControllerRef.current = null;
    }
  };

  const handleReindexNow = async (targetModel: string) => {
    if (isReindexing) return;
    setIsReindexing(true);
    showToast({
      message: `Re-indexing passages with ${targetModel} using cached text (no PDF re-parse)...`,
      type: 'info',
    });

    try {
      const result = await reindexChunksWithModel(targetModel);
      showToast({
        message: `Successfully re-indexed ${result.reindexedCount} passages with ${targetModel}!`,
        type: 'success',
      });

      // Find the last user message to automatically re-try research
      const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUserMsg) {
        await handleSubmit(lastUserMsg.content);
      }
    } catch (err: any) {
      console.error('Re-indexing error:', err);
      showToast({
        message: err.message || 'Failed to re-index documents',
        type: 'error',
      });
    } finally {
      setIsReindexing(false);
    }
  };

  // Citation click handler: Open PDF at cited page & highlight excerpt.
  // Clicking the same citation again closes the desk.
  const handleCitationClick = async (cit: Citation) => {
    if (
      deskOpen &&
      activeCitation?.marker === cit.marker &&
      activeCitation?.pageNumber === cit.pageNumber &&
      (activeCitation?.documentId === cit.documentId || activePdfName === cit.documentName)
    ) {
      setDeskOpen(false);
      setActiveCitation(null);
      return;
    }

    setActiveCitation(cit);
    if (cit.documentId) {
      await loadDocForViewer(cit.documentId, cit.pageNumber);
    }
    setDeskOpen(true);
  };

  // Open Document from Scope Selector or document card
  const handleOpenDocumentInDesk = async (docId: string) => {
    setActiveCitation(null); // No citation highlight
    const rememberedPage = lastPagePerDoc.current[docId] || 1;
    await loadDocForViewer(docId, rememberedPage);
    setCurrentScope({ type: 'selected', documentIds: [docId] });
    setDeskOpen(true);
  };

  // Switch document within Desk document dropdown
  const handleSelectDocumentInDesk = async (docId: string) => {
    setActiveCitation(null); // No citation highlight
    const rememberedPage = lastPagePerDoc.current[docId] || 1;
    await loadDocForViewer(docId, rememberedPage);
    setCurrentScope({ type: 'selected', documentIds: [docId] });
    setDeskOpen(true);
  };

  const handleCloseDesk = () => {
    setDeskOpen(false);
    setActiveCitation(null);
  };

  const handlePinToNotebook = async (msg: MessageRecord) => {
    const parentUserMsg = [...messages]
      .reverse()
      .find((m) => m.role === 'user' && m.createdAt < msg.createdAt);

    const questionText = parentUserMsg?.content || activeConv?.title || 'Research Finding';
    const firstDocName = msg.citations[0]?.documentName || activePdfName;

    const noteItem: NotebookItem = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: questionText.slice(0, 60),
      question: questionText,
      answer: msg.content,
      citations: msg.citations,
      documentName: firstDocName,
      createdAt: Date.now(),
    };

    try {
      await saveNotebookItem(noteItem);
      showToast({
        message: 'Answer pinned to Notebook!',
        type: 'success',
        undoLabel: 'View',
        undoAction: () => {
          onNavigateToNotebook?.();
        },
      });
    } catch (err) {
      showToast({ message: 'Failed to pin note', type: 'error' });
    }
  };

  const samplePrompts = [
    'What are the primary findings and core empirical conclusions?',
    'Summarize key financial metrics and annual growth rates.',
    'Compare the analytical frameworks and methodology applied.',
    'What empirical data is presented to substantiate key claims?',
  ];

  return (
    <div className={`wsw ${deskOpen ? 'open' : ''}`}>
      {/* COLUMN 1: Conversation Threads & Scope Sidebar (.side) */}
      <aside className={`side flex flex-col shrink-0 select-none ${mobileDrawerOpen ? 'drawer-open' : ''}`}>
        <div className="pb-3 mb-2 border-b border-[color-mix(in_srgb,var(--mute)_20%,transparent)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-full bg-[var(--a1)]/15 text-[var(--a1)]">
              <MessageSquare size={15} />
            </span>
            <span className="mono font-bold text-xs text-[var(--ink)]">
              Inquiries ({conversations.length})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCreateNewThread}
              className="p-1.5 rounded-full bg-[var(--a1)] text-white hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
              title="Start new inquiry thread"
            >
              <Plus size={14} />
            </button>
            {mobileDrawerOpen && (
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 rounded-full bg-[var(--card)] hover:bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] text-[var(--ink)] cursor-pointer md:hidden"
                title="Close drawer"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Scope Selector Box */}
        <div className="mb-3 shrink-0">
          <ScopeSelector
            documents={documents}
            collections={collections}
            scope={currentScope}
            onChangeScope={(scope: RetrievalScope) => {
              setCurrentScope(scope);
              if (activeConv) {
                const updated = { ...activeConv, scope };
                saveCloudConversation(updated).catch(() => {});
                setActiveConv(updated);
              }
            }}
            onOpenDocumentInDesk={handleOpenDocumentInDesk}
          />
        </div>

        {/* Conversation List with Independent Scroll */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 space-y-1.5">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--mute)]">
              No inquiries yet. Click + to begin researching your documents.
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = activeConvId === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => {
                    selectConversation(c.id);
                    setMobileDrawerOpen(false);
                  }}
                  className={`group flex items-center justify-between gap-2 p-2.5 rounded-2xl cursor-pointer text-xs transition-all ${
                    isActive
                      ? 'bg-[var(--a1)] text-white shadow-xs font-semibold'
                      : 'hover:bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] text-[var(--ink)]'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <BookOpen size={13} className="shrink-0 opacity-70" />
                    <span className="truncate">{c.title || 'Untitled Inquiry'}</span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => handleDeleteConversation(e, c)}
                    className={`opacity-0 group-hover:opacity-100 p-1 rounded-full transition-opacity cursor-pointer ${
                      isActive ? 'hover:bg-white/20 text-white' : 'hover:bg-[color-mix(in_srgb,var(--mute)_20%,transparent)] text-[var(--err)]'
                    }`}
                    title="Delete thread"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Archive History Trigger */}
        <div className="pt-3 mt-2 border-t border-[color-mix(in_srgb,var(--mute)_20%,transparent)] shrink-0">
          <button
            type="button"
            onClick={() => setIsArchiveModalOpen(true)}
            className="btn outline sm w-full"
          >
            <Archive size={13} className="text-[var(--a1)]" />
            <span>Search Past Answers</span>
          </button>
        </div>
      </aside>

      {/* COLUMN 2: Chat Interface (.chatc) */}
      <div className="chatc relative">
        {/* Mobile Sub-Header under 900px */}
        <div className="md:hidden flex items-center justify-between pb-2 mb-1 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)] shrink-0">
          <button
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
            className="btn sm outline !py-1 !px-2.5 text-xs flex items-center gap-1.5"
          >
            <Menu size={13} />
            <span>Inquiries &amp; Scope</span>
          </button>

          <span className="mono text-xs truncate max-w-[150px]">
            {activeConv?.title || 'Inquiry'}
          </span>

          {documents.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (!activeDocId && documents.length > 0) {
                  const ready = documents.find((d) => String(d.status).toLowerCase() === 'ready') || documents[0];
                  loadDocForViewer(ready.id, 1);
                }
                setDeskOpen(!deskOpen);
              }}
              className="btn sm !py-1 !px-2.5 text-xs"
            >
              <BookOpen size={13} />
              <span>{deskOpen ? 'Close Desk' : 'Desk'}</span>
            </button>
          )}
        </div>

        {/* Messages Stream: Independent Scroll (.msgs) */}
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="msgs"
        >
          <div>
            {messages.length === 0 && !isStreaming && !isSubmitting ? (
              <div className="py-12 sm:py-16 text-center max-w-lg mx-auto space-y-4">
                <div className="w-14 h-14 rounded-3xl bg-gradient-to-tr from-[var(--a1)]/15 to-[var(--a2)]/15 text-[var(--a1)] flex items-center justify-center mx-auto shadow-xs">
                  <Sparkles size={26} />
                </div>
                <h2>
                  Ask your <span className="ser">documents</span>
                </h2>
                <p className="text-xs sm:text-sm text-[var(--mute)] leading-relaxed">
                  Inquire about evidence, financial metrics, methodology, or empirical findings.
                  Every claim is cross-checked against verified page citations.
                </p>

                {/* Sample Prompts */}
                <div className="pt-3 flex flex-col gap-2 text-left">
                  {samplePrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSubmit(prompt)}
                      className="p-3 bg-[var(--card)] hover:bg-[color-mix(in_srgb,var(--card)_90%,var(--ink))] rounded-2xl text-xs text-[var(--ink)] font-medium transition-all text-left flex items-center justify-between group shadow-xs cursor-pointer border border-[color-mix(in_srgb,var(--mute)_15%,transparent)]"
                    >
                      <span>{prompt}</span>
                      <ArrowRight size={13} className="text-[var(--a1)] opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <MessageItem
                    key={msg.id}
                    message={msg}
                    onCitationClick={handleCitationClick}
                    activeCitationMarker={activeCitation?.marker}
                    onRetry={() => handleSubmit(messages[messages.length - 2]?.content)}
                    onPinToNotebook={handlePinToNotebook}
                    onFollowupClick={(chip) => handleSubmit(chip)}
                    onReindexNow={handleReindexNow}
                    isReindexing={isReindexing}
                  />
                ))}

                {/* Skeleton shimmer bubble while retrieving */}
                {isSubmitting && !isStreaming && (
                  <div className="ai mb-6 animate-message-in">
                    <div className="flex items-center gap-2 mb-3">
                      <Loader2 size={14} className="text-[var(--a1)] animate-spin" />
                      <span className="mono font-bold text-[var(--a1)]">
                        Searching folio &amp; cross-verifying passages...
                      </span>
                    </div>
                    <div className="space-y-2.5">
                      <div className="h-3 bg-[color-mix(in_srgb,var(--mute)_18%,transparent)] rounded-full w-5/6 animate-pulse" />
                      <div className="h-3 bg-[color-mix(in_srgb,var(--mute)_18%,transparent)] rounded-full w-full animate-pulse" />
                      <div className="h-3 bg-[color-mix(in_srgb,var(--mute)_18%,transparent)] rounded-full w-3/4 animate-pulse" />
                    </div>
                  </div>
                )}

                {/* Real-time Streaming Answer Bubble with Blinking Cursor */}
                {isStreaming && (
                  <div
                    className="ai mb-6 animate-message-in"
                    role="status"
                    aria-live="polite"
                    aria-atomic="false"
                  >
                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                      <div className="flex items-center gap-2">
                        <Loader2 size={13} className="text-[var(--a1)] animate-spin" />
                        <span className="mono font-bold text-[var(--a1)]">
                          Streaming Synthesis...
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleStopStreaming}
                        className="btn sm !py-1 !px-2.5 !bg-[var(--err)] text-xs"
                        aria-label="Stop generating answer"
                        title="Stop generation"
                      >
                        <Square size={10} fill="currentColor" />
                        <span>Stop</span>
                      </button>
                    </div>

                    <div className="text-sm sm:text-base leading-relaxed text-[var(--ink)] whitespace-pre-wrap">
                      {streamingText || 'Synthesizing evidence passages...'}
                      <span className="pink-cursor" />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Floating "Jump to latest ↓" pill */}
        {showJumpToLatest && (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="btn sm absolute bottom-20 right-6 z-20 shadow-lg"
          >
            <span>Jump to latest ↓</span>
          </button>
        )}

        {/* Query Composer: Non-scrolling row below .msgs (.comp) */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
          className="comp"
        >
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder="Ask a question about your documents... (/ for search, Cmd+K for palette)"
            disabled={isSubmitting}
            className="flex-1 bg-transparent border-0 text-sm text-[var(--ink)] placeholder-[var(--mute)] focus:outline-hidden disabled:opacity-50"
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={handleStopStreaming}
              className="btn sm !bg-[var(--err)]"
              title="Stop generation"
            >
              <Square size={13} fill="currentColor" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputQuery.trim() || isSubmitting}
              className="btn sm disabled:opacity-40"
              title="Send query"
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              <span>Send</span>
            </button>
          )}
        </form>
      </div>

      {/* COLUMN 3: Reading Desk (.deskw) */}
      <div className="deskw">
        {deskOpen && (
          <PDFViewer
            blob={activePdfBlob}
            documentName={activePdfName}
            activeCitation={activeCitation}
            onCloseCitation={() => setActiveCitation(null)}
            onCloseDesk={handleCloseDesk}
            allDocuments={documents}
            currentDocumentId={activeDocId || undefined}
            onSelectDocument={handleSelectDocumentInDesk}
            initialPage={
              activeCitation?.pageNumber ||
              (activeDocId ? lastPagePerDoc.current[activeDocId] : 1)
            }
            onPageChange={(docId, p) => {
              lastPagePerDoc.current[docId] = p;
            }}
            onDownload={() => {
              if (activeDocId && activePdfName) {
                downloadDocumentFile(activeDocId, activePdfName);
              }
            }}
          />
        )}
      </div>

      {/* Archive Modal */}
      {isArchiveModalOpen && (
        <PreviousAnswersArchiveModal
          isOpen={isArchiveModalOpen}
          onClose={() => setIsArchiveModalOpen(false)}
          documents={documents}
          currentConversationId={activeConvId}
          onSelectAnswer={(_convId: string, _msgId: string, cit?: Citation) => {
            if (cit) handleCitationClick(cit);
            setIsArchiveModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
