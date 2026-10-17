import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send,
  Plus,
  Trash2,
  BookOpen,
  MessageSquare,
  AlertTriangle,
  RotateCcw,
  Loader2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  History,
  Archive,
  ArrowRight,
  ArrowLeft,
  Eye,
  CheckCircle2,
  Layers,
  Sparkles,
} from 'lucide-react';
import {
  DocumentRecord,
  CollectionRecord,
  ConversationRecord,
  MessageRecord,
  Citation,
  RetrievalScope,
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
} from '../../services/storage.ts';
import { runAnsweringPipeline } from '../../services/answering.ts';
import { MessageItem } from './MessageItem.tsx';
import { ScopeSelector } from './ScopeSelector.tsx';
import { PDFViewer } from '../pdf/PDFViewer.tsx';
import { PreviousAnswersArchiveModal } from './PreviousAnswersArchiveModal.tsx';


interface WorkspaceProps {
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  initialDocumentId?: string;
  initialCitation?: Citation | null;
}

export const Workspace: React.FC<WorkspaceProps> = ({
  documents,
  collections,
  initialDocumentId,
  initialCitation,
}) => {
  // Mobile responsive view tabs
  const [mobileTab, setMobileTab] = useState<'sidebar' | 'chat' | 'viewer'>('chat');

  // Conversations state
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeConv, setActiveConv] = useState<ConversationRecord | null>(null);

  // Active chat messages & query input
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [inputQuery, setInputQuery] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Distinct Scroll Thread & Previous Answers state
  const [viewingExchangeIndex, setViewingExchangeIndex] = useState<number | null>(null);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState<boolean>(false);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState<boolean>(false);

  // Active Scope
  const [currentScope, setCurrentScope] = useState<RetrievalScope>({ type: 'all' });

  // PDF Viewer state
  const [activePdfBlob, setActivePdfBlob] = useState<Blob | undefined>(undefined);
  const [activePdfName, setActivePdfName] = useState<string>('Document');
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Load all conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // When initialDocumentId or initialCitation are passed from outside
  useEffect(() => {
    if (initialDocumentId) {
      loadDocForViewer(initialDocumentId);
      setMobileTab('viewer');
    }
  }, [initialDocumentId]);

  useEffect(() => {
    if (initialCitation) {
      setActiveCitation(initialCitation);
      if (initialCitation.documentId) {
        loadDocForViewer(initialCitation.documentId);
      }
      setMobileTab('viewer');
    }
  }, [initialCitation]);

  const loadDocForViewer = async (docId: string) => {
    const doc = documents.find((d) => d.id === docId);
    if (!doc) return;
    try {
      const blob = await getDocumentBlob(docId);
      if (blob) {
        setActivePdfBlob(blob);
        setActivePdfName(doc.name);
      }
    } catch (err) {
      console.error('Failed to load PDF blob for viewer:', err);
    }
  };

  const loadConversations = async () => {
    try {
      const list = await getAllConversations();
      setConversations(list);

      if (list.length > 0 && !activeConvId) {
        selectConversation(list[0].id);
      } else if (list.length === 0) {
        createNewConversation();
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
    }
  };

  const selectConversation = async (convId: string) => {
    try {
      const conv = await getConversation(convId);
      if (conv) {
        setActiveConvId(conv.id);
        setActiveConv(conv);
        setCurrentScope(conv.scope);
        setViewingExchangeIndex(null);
        const msgs = await getMessagesByConversation(conv.id);
        setMessages(msgs);
      }
    } catch (err) {
      console.error('Error selecting conversation:', err);
    }
  };

  const createNewConversation = async () => {
    const newConv: ConversationRecord = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: 'New Research Inquiry',
      scope: { type: 'all' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveConversation(newConv);
    setConversations((prev) => [newConv, ...prev]);
    setActiveConvId(newConv.id);
    setActiveConv(newConv);
    setMessages([]);
    setViewingExchangeIndex(null);
    setCurrentScope({ type: 'all' });
  };

  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteConversation(convId);
      const remaining = conversations.filter((c) => c.id !== convId);
      setConversations(remaining);

      if (activeConvId === convId) {
        if (remaining.length > 0) {
          selectConversation(remaining[0].id);
        } else {
          setActiveConvId(null);
          setActiveConv(null);
          setMessages([]);
          setViewingExchangeIndex(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleScopeChange = async (newScope: RetrievalScope) => {
    setCurrentScope(newScope);
    if (activeConv) {
      const updated: ConversationRecord = {
        ...activeConv,
        scope: newScope,
        updatedAt: Date.now(),
      };
      setActiveConv(updated);
      await saveConversation(updated);
    }
  };

  // Group messages into distinct question-answer exchanges
  const exchanges = useMemo(() => {
    const list: Array<{
      index: number;
      userMessage: MessageRecord;
      assistantMessage?: MessageRecord;
    }> = [];

    let pendingUser: MessageRecord | null = null;
    for (const m of messages) {
      if (m.role === 'user') {
        if (pendingUser) {
          list.push({
            index: list.length + 1,
            userMessage: pendingUser,
          });
        }
        pendingUser = m;
      } else if (m.role === 'assistant') {
        if (pendingUser) {
          list.push({
            index: list.length + 1,
            userMessage: pendingUser,
            assistantMessage: m,
          });
          pendingUser = null;
        } else {
          list.push({
            index: list.length + 1,
            userMessage: {
              id: `virtual_${m.id}`,
              conversationId: m.conversationId,
              role: 'user',
              content: 'Inquiry',
              createdAt: m.createdAt - 1,
              status: 'answered',
              citations: [],
              retrievalScope: m.retrievalScope,
            },
            assistantMessage: m,
          });
        }
      }
    }
    if (pendingUser) {
      list.push({
        index: list.length + 1,
        userMessage: pendingUser,
      });
    }
    return list;
  }, [messages]);

  const previousExchanges = exchanges.length > 1 ? exchanges.slice(0, -1) : [];
  const latestExchange = exchanges.length > 0 ? exchanges[exchanges.length - 1] : null;

  // Active exchange being rendered beside the document
  const activeExchange = viewingExchangeIndex !== null
    ? exchanges.find((e) => e.index === viewingExchangeIndex) || latestExchange
    : latestExchange;

  // Scroll to bottom of message list when viewing latest exchange
  useEffect(() => {
    if (viewingExchangeIndex === null) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSubmitting, viewingExchangeIndex]);

  const handleSelectAnswerFromArchive = async (
    conversationId: string,
    messageId: string,
    citation?: Citation
  ) => {
    if (conversationId !== activeConvId) {
      const conv = await getConversation(conversationId);
      if (conv) {
        setActiveConvId(conv.id);
        setActiveConv(conv);
        setCurrentScope(conv.scope);
        const msgs = await getMessagesByConversation(conv.id);
        setMessages(msgs);

        let turnCount = 0;
        let matchedTurn: number | null = null;
        for (const m of msgs) {
          if (m.role === 'assistant') {
            turnCount++;
            if (m.id === messageId) {
              matchedTurn = turnCount;
              break;
            }
          }
        }
        setViewingExchangeIndex(matchedTurn);
      }
    } else {
      let turnCount = 0;
      let matchedTurn: number | null = null;
      for (const m of messages) {
        if (m.role === 'assistant') {
          turnCount++;
          if (m.id === messageId) {
            matchedTurn = turnCount;
            break;
          }
        }
      }
      setViewingExchangeIndex(matchedTurn);
    }

    if (citation) {
      setActiveCitation(citation);
      if (citation.documentId) {
        await loadDocForViewer(citation.documentId);
      }
    }
    setMobileTab('chat');
  };


  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = inputQuery.trim();
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
      };
      await saveConversation(newConv);
      setConversations((prev) => [newConv, ...prev]);
      targetConvId = newConv.id;
      targetConv = newConv;
      setActiveConvId(newConv.id);
      setActiveConv(newConv);
    }

    // 1. Create and save user message
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
    await saveMessage(userMsg);
    setInputQuery('');
    setViewingExchangeIndex(null);
    setIsSubmitting(true);

    // Auto-update conversation title if first user message
    if (messages.length === 0) {
      const newTitle = query.slice(0, 36) + (query.length > 36 ? '...' : '');
      const updatedConv: ConversationRecord = {
        ...targetConv,
        title: newTitle,
        updatedAt: Date.now(),
      };
      setActiveConv(updatedConv);
      await saveConversation(updatedConv);
      setConversations((prev) =>
        prev.map((c) => (c.id === updatedConv.id ? updatedConv : c))
      );
    }

    try {
      const settings = await getSettings();

      // Format conversation history for pipeline
      const history = nextMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // 2. Call Grounded Answering Service Pipeline
      const pipelineOutput = await runAnsweringPipeline({
        conversationId: targetConvId,
        userQuestion: query,
        history,
        scope: currentScope,
        settings,
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
        retrievalScope: currentScope,
        retrievalScores: pipelineOutput.retrievalScores,
        latencyMs: pipelineOutput.latencyMs,
      };

      await saveMessage(assistantMsg);
      setMessages([...nextMessages, assistantMsg]);
    } catch (err: any) {
      console.error('Error generating answer:', err);
      const errorMsg: MessageRecord = {
        id: `msg_err_${Date.now()}`,
        conversationId: targetConvId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        citations: [],
        status: 'error',
        errorMessage: err.message || 'An unexpected pipeline error occurred.',
        retrievalScope: currentScope,
      };

      await saveMessage(errorMsg);
      setMessages([...nextMessages, errorMsg]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCitationClick = async (cit: Citation) => {
    setActiveCitation(cit);
    if (cit.documentId) {
      await loadDocForViewer(cit.documentId);
    }
    setMobileTab('viewer');
  };

  const samplePrompts = [
    'What are the primary findings and core empirical conclusions?',
    'Summarize the key financial metrics and annual growth rates.',
    'Compare the methodologies or analytical frameworks applied.',
    'What evidence or data is presented to substantiate the core claims?',
  ];

  return (
    <div className="flex-1 flex flex-col md:flex-row h-[calc(100vh-56px)] overflow-hidden bg-[#111113] text-[#f2efeb]">
      {/* Mobile & Tablet Tab Switcher (Visible on < 1024px to ensure 3-column layout never squeezes or overflows) */}
      <div className="lg:hidden flex border-b border-[rgba(242,239,235,0.1)] bg-[#0e0e0f] shrink-0 w-full max-w-full overflow-hidden">
        <button
          type="button"
          onClick={() => setMobileTab('sidebar')}
          className={`flex-1 py-2 text-[11px] sm:text-xs font-mono font-semibold text-center border-b-2 cursor-pointer transition-colors truncate px-1 ${
            mobileTab === 'sidebar'
              ? 'border-[#ff4d00] text-[#ff4d00] bg-[rgba(255,77,0,0.1)]'
              : 'border-transparent text-[#f2efeb]/60 hover:bg-[#18181a]'
          }`}
        >
          <span className="hidden sm:inline">Scope & </span>Sessions
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('chat')}
          className={`flex-1 py-2 text-[11px] sm:text-xs font-mono font-semibold text-center border-b-2 cursor-pointer transition-colors truncate px-1 ${
            mobileTab === 'chat'
              ? 'border-[#ff4d00] text-[#ff4d00] bg-[rgba(255,77,0,0.1)]'
              : 'border-transparent text-[#f2efeb]/60 hover:bg-[#18181a]'
          }`}
        >
          <span className="hidden sm:inline">Research </span>Inquiry
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('viewer')}
          className={`flex-1 py-2 text-[11px] sm:text-xs font-mono font-semibold text-center border-b-2 cursor-pointer transition-colors truncate px-1 ${
            mobileTab === 'viewer'
              ? 'border-[#ff4d00] text-[#ff4d00] bg-[rgba(255,77,0,0.1)]'
              : 'border-transparent text-[#f2efeb]/60 hover:bg-[#18181a]'
          }`}
        >
          <span className="hidden sm:inline">Folio </span>Viewer {activeCitation ? `[${activeCitation.marker}]` : ''}
        </button>
      </div>

      {/* LEFT COLUMN: Scope & History (Technical Research Interface) */}
      <aside
        className={`${
          mobileTab === 'sidebar' ? 'flex' : 'hidden'
        } lg:flex w-full lg:w-60 xl:w-64 flex-col bg-[#0e0e0f] border-r border-[rgba(242,239,235,0.1)] shrink-0 h-full overflow-hidden select-none`}
      >
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#f2efeb]/50 px-5 pt-5 pb-2 font-semibold">
          Active Commands
        </div>
        <div className="px-4 pb-2 flex flex-col gap-2">
          <button
            type="button"
            onClick={createNewConversation}
            className="w-full bg-[#f2efeb] hover:bg-white text-[#111113] font-syne font-extrabold py-2.5 px-3 rounded-[4px] text-xs uppercase tracking-tight text-center transition-all cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
          >
            <Plus size={14} className="stroke-[3]" />
            <span>+ New Research Inquiry</span>
          </button>
          <button
            type="button"
            onClick={() => setIsArchiveModalOpen(true)}
            className="w-full bg-[#18181a] hover:bg-[#222226] text-[#f2efeb] border border-[rgba(242,239,235,0.15)] font-syne font-bold py-2 px-3 rounded-[4px] text-xs uppercase tracking-tight text-center transition-all cursor-pointer flex items-center justify-center gap-1.5 hover:border-[#ff4d00]"
            title="Browse and inspect previous answers from any chat"
          >
            <History size={13} className="text-[#ff4d00]" />
            <span>Answers Archive</span>
          </button>
        </div>

        {/* Scope Selector Box */}
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#f2efeb]/50 px-5 pt-4 pb-1.5 font-semibold">
          Scope: Complete Folio
        </div>
        <div className="px-4 pb-2">
          <ScopeSelector
            documents={documents}
            collections={collections}
            scope={currentScope}
            onChangeScope={handleScopeChange}
          />
        </div>

        {/* Session History */}
        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#f2efeb]/50 px-5 pt-3 pb-1 font-semibold">
          Session History ({conversations.length})
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-1 space-y-1">
          {conversations.length === 0 ? (
            <p className="p-4 text-xs font-mono text-[#f2efeb]/40 italic text-center">
              No inquiries yet. Click above to begin.
            </p>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeConvId;
              return (
                <div
                  key={conv.id}
                  onClick={() => {
                    setActiveConvId(conv.id);
                    selectConversation(conv.id);
                    setMobileTab('chat');
                  }}
                  className={`group p-2.5 rounded-[4px] text-xs font-mono border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#18181a] border-[rgba(242,239,235,0.2)] text-[#f2efeb] shadow-xs'
                      : 'border-transparent text-[#f2efeb]/60 hover:text-[#f2efeb] hover:bg-[#18181a]/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-[#ff4d00] font-bold mb-1">
                    <span className="tracking-wider">TURN #01</span>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-[#f2efeb]/40 hover:text-[#ff6b6b] transition-opacity cursor-pointer"
                      title="Delete inquiry"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                  <div className="font-sans font-medium text-xs text-[#f2efeb] truncate">
                    {conv.title}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* CENTER COLUMN: Main Workspace & Exchange Stream */}
      <main
        className={`${
          mobileTab === 'chat' ? 'flex' : 'hidden'
        } lg:flex flex-1 min-w-0 max-w-full flex-col h-full overflow-hidden bg-[#111113] border-r border-[rgba(242,239,235,0.1)]`}
      >
        {/* Horizontal Turn Strip matching Variation 2 */}
        {exchanges.length > 0 && (
          <div className="archive-strip flex items-center gap-1.5 overflow-x-auto px-4 sm:px-5 py-2.5 bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] shrink-0 select-none min-w-0 max-w-full">
            {exchanges.map((ex) => {
              const isActive =
                viewingExchangeIndex === ex.index ||
                (viewingExchangeIndex === null && ex.index === latestExchange?.index);
              const preview = ex.userMessage.content.slice(0, 18);
              return (
                <button
                  key={`turn-tab-${ex.index}`}
                  type="button"
                  onClick={() => {
                    setViewingExchangeIndex(ex.index === exchanges.length ? null : ex.index);
                    const firstCit = ex.assistantMessage?.citations?.[0];
                    if (firstCit) handleCitationClick(firstCit);
                  }}
                  className={`turn-tab shrink-0 ${isActive ? 'active' : ''}`}
                  title={ex.userMessage.content}
                >
                  T{ex.index}: {preview}{ex.userMessage.content.length > 18 ? '…' : ''}
                </button>
              );
            })}
          </div>
        )}

        {/* Workspace Stream Header */}
        <div className="px-4 sm:px-5 py-2.5 bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] flex flex-wrap items-center justify-between gap-2 shrink-0 select-none min-w-0 max-w-full">
          <div className="flex items-center gap-2 truncate mr-2 min-w-0">
            <h2 className="font-syne text-xs font-bold uppercase tracking-tight text-[#f2efeb] truncate">
              {activeConv?.title || 'Research Inquiry'}
            </h2>
            <span className="font-mono text-[10px] bg-[#ff4d00]/15 text-[#ff4d00] border border-[#ff4d00]/30 px-2 py-0.5 rounded-[2px] shrink-0 font-semibold uppercase">
              {currentScope.type === 'all'
                ? 'All Ready Docs'
                : currentScope.type === 'collection'
                ? 'Collection'
                : 'Custom'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsArchiveModalOpen(true)}
              className="chip py-1 px-2.5 text-[10px] flex items-center gap-1.5 shrink-0"
              title="Browse all previous answers"
            >
              <Archive size={11} className="text-[#ff4d00]" />
              <span>Answers Archive</span>
            </button>
            <div className="font-mono text-[11px] text-[#f2efeb]/50 hidden xl:block">
              {documents.filter((d) => d.status === 'Ready').length} active sources
            </div>
          </div>
        </div>

        {/* 1. SEPARATE SCROLL THREAD FOR PREVIOUS CHATS: Older chats keep going up independently */}
        {previousExchanges.length > 0 && (
          <div className="bg-[#141416] border-b border-[rgba(242,239,235,0.1)] shrink-0 shadow-xs min-w-0 max-w-full">
            {/* Thread Header Bar */}
            <div className="px-4 sm:px-5 py-2 bg-[#18181a] border-b border-[rgba(242,239,235,0.1)] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <History size={13} className="text-[#ff4d00] shrink-0" />
                <span className="font-mono text-xs font-bold text-[#f2efeb] truncate">
                  Previous Exchanges ({previousExchanges.length})
                </span>
                <span className="font-mono text-[10px] text-[#f2efeb]/40 hidden md:inline">
                  · Older chats scroll up in this thread
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
                  className="flex items-center gap-1 text-[10px] font-mono text-[#f2efeb]/70 hover:text-[#f2efeb] px-2 py-0.5 rounded-[2px] bg-[#222226] border border-[rgba(242,239,235,0.15)] transition-colors cursor-pointer"
                  title={isHistoryCollapsed ? 'Expand previous chats' : 'Collapse previous chats'}
                >
                  <span>{isHistoryCollapsed ? 'Show History' : 'Collapse'}</span>
                  {isHistoryCollapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
                </button>
              </div>
            </div>

            {/* Dedicated independent scroll container with distinct scrollbar */}
            {!isHistoryCollapsed && (
              <div className="max-h-52 overflow-y-auto custom-scrollbar-history p-3 space-y-2 bg-[#141416]">
                {previousExchanges.map((ex) => {
                  const isViewingThis = viewingExchangeIndex === ex.index;
                  const citCount = ex.assistantMessage?.citations?.length || 0;
                  return (
                    <div
                      key={`prev-exchange-${ex.index}-${ex.userMessage.id}`}
                      onClick={() => {
                        setViewingExchangeIndex(ex.index);
                        const firstCit = ex.assistantMessage?.citations?.[0];
                        if (firstCit) handleCitationClick(firstCit);
                      }}
                      className={`p-2.5 rounded-[4px] border text-xs transition-all duration-150 cursor-pointer ${
                        isViewingThis
                          ? 'bg-[#18181a] border-[#ff4d00] shadow-xs ring-1 ring-[#ff4d00]/40'
                          : 'bg-[#18181a]/60 hover:bg-[#18181a] border-[rgba(242,239,235,0.1)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 font-mono text-[10px]">
                          <span className="font-bold text-[#ff4d00] bg-[#ff4d00]/15 px-1.5 py-0.5 rounded-[2px]">
                            Turn #{ex.index}
                          </span>
                          <span className="text-[#f2efeb]/40">
                            {new Date(ex.userMessage.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {citCount > 0 && (
                            <span className="font-mono text-[10px] text-[#ff4d00] bg-[#ff4d00]/15 px-1.5 py-0.5 rounded-[2px] font-semibold">
                              {citCount} {citCount === 1 ? 'citation' : 'citations'}
                            </span>
                          )}
                          <span
                            className={`inline-flex items-center gap-1 font-mono text-[10px] px-2 py-0.5 rounded-[2px] font-semibold ${
                              isViewingThis
                                ? 'bg-[#ff4d00] text-white'
                                : 'bg-[#18181a] text-[#ff4d00] border border-[#ff4d00]/40 hover:bg-[#ff4d00]/10'
                            }`}
                          >
                            <Eye size={10} />
                            {isViewingThis ? 'Viewing Beside Document' : 'View Answer'}
                          </span>
                        </div>
                      </div>

                      <p className="font-medium text-[#f2efeb] truncate mb-1">
                        {ex.userMessage.content}
                      </p>

                      {ex.assistantMessage && (
                        <p className="text-[11px] text-[#f2efeb]/60 line-clamp-1 italic font-sans">
                          {ex.assistantMessage.content ||
                            ex.assistantMessage.errorMessage ||
                            'No response generated.'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Mode Indicator & Navigation Strip */}
        {viewingExchangeIndex !== null ? (
          <div className="bg-[#ff4d00]/15 border-b border-[#ff4d00]/30 px-4 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0 select-none min-w-0 max-w-full">
            <div className="flex items-center gap-2 truncate mr-2 min-w-0 flex-1">
              <Eye size={13} className="text-[#ff4d00] shrink-0" />
              <span className="font-mono font-bold text-[#ff4d00] shrink-0">
                Turn #{activeExchange?.index}:
              </span>
              <span className="font-medium text-[#f2efeb] truncate">
                "{activeExchange?.userMessage.content}"
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {activeExchange && activeExchange.index > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    const prevIdx = activeExchange.index - 1;
                    setViewingExchangeIndex(prevIdx);
                    const cit = exchanges[prevIdx - 1]?.assistantMessage?.citations?.[0];
                    if (cit) handleCitationClick(cit);
                  }}
                  className="p-1 hover:bg-[#ff4d00]/20 rounded text-[#f2efeb] transition-colors cursor-pointer"
                  title="Previous turn answer"
                >
                  <ArrowLeft size={13} />
                </button>
              )}

              {activeExchange && activeExchange.index < exchanges.length && (
                <button
                  type="button"
                  onClick={() => {
                    const nextIdx = activeExchange.index + 1;
                    if (nextIdx === exchanges.length) {
                      setViewingExchangeIndex(null);
                    } else {
                      setViewingExchangeIndex(nextIdx);
                      const cit = exchanges[nextIdx - 1]?.assistantMessage?.citations?.[0];
                      if (cit) handleCitationClick(cit);
                    }
                  }}
                  className="p-1 hover:bg-[#ff4d00]/20 rounded text-[#f2efeb] transition-colors cursor-pointer"
                  title="Next turn answer"
                >
                  <ArrowRight size={13} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setViewingExchangeIndex(null)}
                className="ml-1 px-2.5 py-1 bg-[#ff4d00] hover:bg-[#ff6622] text-white rounded-[2px] font-mono font-bold text-xs uppercase shadow-xs transition-colors cursor-pointer"
              >
                Jump to Latest
              </button>
            </div>
          </div>
        ) : previousExchanges.length > 0 ? (
          <div className="bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] px-4 sm:px-5 py-1.5 flex flex-wrap items-center justify-between gap-1 text-xs font-mono text-[#f2efeb]/50 shrink-0 select-none min-w-0 max-w-full">
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-[#ff4d00] animate-pulse shrink-0" />
              <span className="font-semibold text-[#f2efeb] truncate">
                Latest Chat (Turn #{latestExchange?.index}) — Beside Document Folio
              </span>
            </div>
            <span className="text-[11px] hidden sm:inline">Active Stream</span>
          </div>
        ) : null}

        {/* 2. LATEST CHAT / FOCUSED ANSWER PANE: Stationed right beside the document generated */}
        <div className="exchange-stream flex-1 overflow-y-auto custom-scrollbar-latest p-4 md:p-6 lg:p-8 min-w-0 max-w-full">
          {messages.length === 0 ? (
            <div className="max-w-xl mx-auto my-8 text-center px-2">
              <div className="w-12 h-12 rounded-[4px] bg-[#ff4d00]/10 border border-[#ff4d00]/30 flex items-center justify-center text-[#ff4d00] mx-auto mb-4 shadow-xs">
                <BookOpen size={22} />
              </div>
              <h3 className="font-syne text-xl font-bold uppercase tracking-tight text-[#f2efeb] mb-2">
                Conduct an evidence-grounded inquiry
              </h3>
              <p className="text-xs text-[#f2efeb]/60 mb-6 leading-relaxed max-w-md mx-auto">
                Every claim will be anchored to verified page citations. When primary evidence is missing, DocuMind refrains from ungrounded answers.
              </p>

              {/* Sample Queries */}
              <div className="space-y-2 text-left">
                <span className="font-mono text-[10px] font-semibold text-[#f2efeb]/50 uppercase tracking-widest block mb-1">
                  Suggested Research Queries
                </span>
                {samplePrompts.map((prompt, idx) => (
                  <button
                    key={`prompt-${idx}`}
                    type="button"
                    onClick={() => {
                      setInputQuery(prompt);
                    }}
                    className="w-full text-left px-4 py-3 bg-[#18181a] hover:bg-[#222226] border border-[rgba(242,239,235,0.12)] hover:border-[#ff4d00]/50 rounded-[4px] text-xs text-[#f2efeb] transition-all flex items-center justify-between group cursor-pointer gap-2"
                  >
                    <span className="break-words flex-1">{prompt}</span>
                    <ChevronRight
                      size={13}
                      className="text-[#f2efeb]/40 group-hover:text-[#ff4d00] transition-colors shrink-0"
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-4 min-w-0 w-full">
              {/* Displaying selected previous exchange */}
              {viewingExchangeIndex !== null && activeExchange ? (
                <div className="space-y-4">
                  {/* User query matching Variation 2 */}
                  <div className="message user ml-auto max-w-[680px] w-full text-right mb-4">
                    <div className="content inline-block bg-[#18181a] px-4 sm:px-5 py-3 rounded-[4px] border border-[rgba(242,239,235,0.15)] font-medium text-sm text-[#f2efeb] break-words overflow-wrap-anywhere text-left max-w-full">
                      {activeExchange.userMessage.content}
                    </div>
                  </div>

                  {/* Previous Answer Item */}
                  {activeExchange.assistantMessage && (
                    <MessageItem
                      key={`view-prev-${activeExchange.assistantMessage.id}`}
                      message={activeExchange.assistantMessage}
                      onCitationClick={handleCitationClick}
                      activeCitationMarker={activeCitation?.marker}
                      onRetry={() => {
                        setInputQuery(activeExchange.userMessage.content);
                      }}
                    />
                  )}
                </div>
              ) : (
                /* Displaying latest exchange */
                latestExchange && (
                  <div className="space-y-4">
                    {/* User query matching Variation 2 */}
                    <div className="message user ml-auto max-w-[680px] w-full text-right mb-4">
                      <div className="content inline-block bg-[#18181a] px-4 sm:px-5 py-3 rounded-[4px] border border-[rgba(242,239,235,0.15)] font-medium text-sm text-[#f2efeb] break-words overflow-wrap-anywhere text-left max-w-full">
                        {latestExchange.userMessage.content}
                      </div>
                    </div>

                    {/* Assistant answer */}
                    {latestExchange.assistantMessage && (
                      <MessageItem
                        key={`latest-${latestExchange.assistantMessage.id}`}
                        message={latestExchange.assistantMessage}
                        onCitationClick={handleCitationClick}
                        activeCitationMarker={activeCitation?.marker}
                        onRetry={() => {
                          setInputQuery(latestExchange.userMessage.content);
                        }}
                      />
                    )}

                    {isSubmitting && (
                      <div className="flex justify-start mb-6 animate-in fade-in">
                        <div className="flex items-start gap-3 max-w-md w-full bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[4px] p-4 shadow-xs">
                          <Loader2
                            size={16}
                            className="animate-spin text-[#ff4d00] shrink-0 mt-0.5"
                          />
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-[#f2efeb] break-words">
                              Retrieving passages & synthesizing detailed grounded response...
                            </p>
                            <p className="font-mono text-[11px] text-[#f2efeb]/50 mt-0.5">
                              Dual-score cosine similarity (88%) + lexical coverage (12%)
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Tray matching Variation 2 */}
        <footer className="input-tray bg-[#0e0e0f] border-t border-[rgba(242,239,235,0.1)] p-3 sm:p-4 md:px-8 shrink-0 min-w-0 max-w-full">
          <form onSubmit={handleSubmit} className="search-container max-w-3xl mx-auto relative flex items-center w-full">
            <input
              type="text"
              value={inputQuery}
              onChange={(e) => setInputQuery(e.target.value)}
              placeholder="Ask an investigative question about your documents..."
              disabled={isSubmitting}
              className="w-full pl-4 pr-12 py-3 bg-[#18181a] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[4px] text-sm text-[#f2efeb] placeholder-[#f2efeb]/40 focus:outline-hidden transition-all duration-150 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputQuery.trim() || isSubmitting}
              className="absolute right-1.5 p-2 bg-[#ff4d00] hover:bg-[#ff6622] disabled:bg-[#18181a] disabled:text-[#f2efeb]/30 text-white rounded-[4px] shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
              title="Send inquiry"
              aria-label="Send inquiry"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
          <div className="input-meta text-center font-mono text-[9px] sm:text-[10px] text-[#f2efeb]/40 uppercase tracking-wider sm:tracking-widest mt-2 select-none break-words max-w-full px-2 leading-relaxed">
            ANSWERS ARE STRICTLY ANCHORED TO RETRIEVED DOCUMENT PASSAGES · SOURCE LINKING ACTIVE
          </div>
        </footer>
      </main>

      {/* RIGHT COLUMN: PDF Folio Viewer Pane */}
      <section
        className={`${
          mobileTab === 'viewer' ? 'flex' : 'hidden'
        } lg:flex w-full lg:w-[380px] xl:w-[430px] flex-col h-full shrink-0 border-l border-[rgba(242,239,235,0.1)] bg-[#18181a] overflow-hidden`}
      >
        <PDFViewer
          blob={activePdfBlob}
          documentName={activePdfName}
          activeCitation={activeCitation}
          onCloseCitation={() => setActiveCitation(null)}
        />
      </section>

      {/* Archive Modal for Viewing Previous Answers Across Any Chat */}
      <PreviousAnswersArchiveModal
        isOpen={isArchiveModalOpen}
        onClose={() => setIsArchiveModalOpen(false)}
        onSelectAnswer={handleSelectAnswerFromArchive}
        currentConversationId={activeConvId}
        documents={documents}
      />
    </div>
  );
};

