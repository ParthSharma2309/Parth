import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  BookOpen,
  Calendar,
  MessageSquare,
  ExternalLink,
  Copy,
  Check,
  Download,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Layers,
  ChevronRight,
  Filter,
} from 'lucide-react';
import {
  MessageRecord,
  ConversationRecord,
  Citation,
  DocumentRecord,
} from '../../types/index.ts';
import {
  getAllMessages,
  getAllConversations,
} from '../../services/storage.ts';
import { SafeMarkdown } from '../ui/SafeMarkdown.tsx';
import { StatusBadge } from '../ui/Badge.tsx';

interface PreviousAnswersArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectAnswer: (
    conversationId: string,
    messageId: string,
    citation?: Citation
  ) => void;
  currentConversationId?: string | null;
  documents: DocumentRecord[];
}

interface AnswerEntry {
  assistantMessage: MessageRecord;
  userMessage?: MessageRecord;
  conversation?: ConversationRecord;
}

export const PreviousAnswersArchiveModal: React.FC<
  PreviousAnswersArchiveModalProps
> = ({
  isOpen,
  onClose,
  onSelectAnswer,
  currentConversationId,
  documents,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [answers, setAnswers] = useState<AnswerEntry[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [selectedConversationId, setSelectedConversationId] =
    useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      loadArchiveData();
    }
  }, [isOpen]);

  const loadArchiveData = async () => {
    setLoading(true);
    try {
      const [allMsgs, allConvs] = await Promise.all([
        getAllMessages(),
        getAllConversations(),
      ]);

      const convMap = new Map<string, ConversationRecord>();
      allConvs.forEach((c) => convMap.set(c.id, c));
      setConversations(allConvs);

      // Group into assistant answers paired with their preceding user query
      const pairedAnswers: AnswerEntry[] = [];
      const msgsByConv = new Map<string, MessageRecord[]>();

      allMsgs.forEach((m) => {
        const arr = msgsByConv.get(m.conversationId) || [];
        arr.push(m);
        msgsByConv.set(m.conversationId, arr);
      });

      msgsByConv.forEach((convMsgs, convId) => {
        // Sort ascending by time to match pairs
        const sorted = [...convMsgs].sort((a, b) => a.createdAt - b.createdAt);
        let lastUserMsg: MessageRecord | undefined;

        for (const msg of sorted) {
          if (msg.role === 'user') {
            lastUserMsg = msg;
          } else if (msg.role === 'assistant') {
            pairedAnswers.push({
              assistantMessage: msg,
              userMessage: lastUserMsg,
              conversation: convMap.get(convId),
            });
          }
        }
      });

      // Sort newest answers first
      pairedAnswers.sort(
        (a, b) => b.assistantMessage.createdAt - a.assistantMessage.createdAt
      );

      setAnswers(pairedAnswers);
      if (pairedAnswers.length > 0 && !selectedAnswerId) {
        setSelectedAnswerId(pairedAnswers[0].assistantMessage.id);
      }
    } catch (err) {
      console.error('Failed to load archive data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  // Filter answers
  const filteredAnswers = answers.filter((entry) => {
    // Filter by conversation
    if (
      selectedConversationId !== 'all' &&
      entry.assistantMessage.conversationId !== selectedConversationId
    ) {
      return false;
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const questionMatch =
        entry.userMessage?.content.toLowerCase().includes(q) ?? false;
      const answerMatch =
        entry.assistantMessage.content.toLowerCase().includes(q);
      const convTitleMatch =
        entry.conversation?.title.toLowerCase().includes(q) ?? false;
      const docMatch =
        entry.assistantMessage.citations?.some((c) =>
          c.documentName.toLowerCase().includes(q)
        ) ?? false;

      return questionMatch || answerMatch || convTitleMatch || docMatch;
    }

    return true;
  });

  const selectedEntry =
    answers.find((a) => a.assistantMessage.id === selectedAnswerId) ||
    filteredAnswers[0];

  const handleCopySelected = async () => {
    if (!selectedEntry) return;
    try {
      await navigator.clipboard.writeText(
        selectedEntry.assistantMessage.content
      );
      setCopyStatus(true);
      setTimeout(() => setCopyStatus(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleExportSelectedMD = () => {
    if (!selectedEntry) return;
    const msg = selectedEntry.assistantMessage;
    const userMsg = selectedEntry.userMessage;
    const conv = selectedEntry.conversation;

    let md = `# DocuMind Grounded Research Answer\n\n`;
    if (conv) md += `**Inquiry Session:** ${conv.title}\n`;
    if (userMsg) md += `**Question:** ${userMsg.content}\n`;
    md += `**Generated:** ${new Date(msg.createdAt).toLocaleString()}\n\n`;
    md += `## Synthesized Answer\n\n${msg.content}\n\n`;

    if (msg.citations && msg.citations.length > 0) {
      md += `## Verified Citations & Page References\n\n`;
      msg.citations.forEach((c) => {
        md += `- **[${c.marker}] ${c.documentName}** (Page ${c.pageNumber}) — ${
          c.verified ? 'Verified Quote' : 'Unverified'
        }\n`;
        md += `  > "${c.quote.replace(/\n/g, ' ')}"\n\n`;
      });
    }

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `answer-${msg.id.slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-4 md:p-6 animate-in fade-in duration-150">
      <div className="bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[4px] shadow-2xl w-full max-w-5xl h-[92vh] md:h-[85vh] flex flex-col overflow-hidden text-[#f2efeb]">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-[2px] bg-[#ff4d00] text-white flex items-center justify-center shadow-xs shrink-0">
              <BookOpen size={15} />
            </div>
            <div className="min-w-0">
              <h2 className="font-syne text-base sm:text-lg font-bold text-[#f2efeb] uppercase tracking-tight truncate">
                Previous Answers Archive
              </h2>
              <p className="text-xs text-[#f2efeb]/50 font-mono hidden sm:block truncate">
                Inspect, review, and load previous research answers from any session directly beside the folio viewer
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-[2px] text-[#f2efeb]/60 hover:text-white hover:bg-[#222226] transition-colors cursor-pointer shrink-0 ml-2"
            title="Close archive"
            aria-label="Close archive"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-3 bg-[#111113] border-b border-[rgba(242,239,235,0.1)] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 min-w-0 max-w-full">
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#f2efeb]/40"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search previous answers by query keywords, text, or source..."
              className="w-full pl-9 pr-3 py-1.5 bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[2px] text-xs font-mono text-[#f2efeb] placeholder-[#f2efeb]/40 focus:outline-hidden focus:border-[#ff4d00]"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-[#f2efeb]/60 shrink-0 font-mono">
              <Filter size={12} />
              <span>Inquiry:</span>
            </div>
            <select
              value={selectedConversationId}
              onChange={(e) => setSelectedConversationId(e.target.value)}
              className="px-2.5 py-1.5 bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[2px] text-xs font-mono text-[#f2efeb] focus:outline-hidden focus:border-[#ff4d00] max-w-[200px] sm:max-w-[220px] truncate"
            >
              <option value="all">All Inquiries ({conversations.length})</option>
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Content Body: Two-panel master-detail */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-w-0 max-w-full">
          {/* Answers List Left Column */}
          <div className="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-[rgba(242,239,235,0.1)] flex flex-col h-44 sm:h-56 md:h-full bg-[#141416] shrink-0 overflow-hidden min-w-0">
            <div className="px-3 py-2 border-b border-[rgba(242,239,235,0.1)] bg-[#0e0e0f] font-mono text-[10px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider flex items-center justify-between shrink-0">
              <span>Answers ({filteredAnswers.length})</span>
              <span className="text-[10px] text-[#ff4d00]">newest first</span>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar-history p-2 space-y-1.5">
              {loading ? (
                <div className="p-8 text-center text-xs font-mono text-[#f2efeb]/40 italic">
                  Loading previous answers across chats...
                </div>
              ) : filteredAnswers.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-[#f2efeb]/40 italic">
                  No previous answers found matching your search.
                </div>
              ) : (
                filteredAnswers.map((entry) => {
                  const isSelected =
                    entry.assistantMessage.id ===
                    (selectedEntry?.assistantMessage.id || selectedAnswerId);
                  const isCurrentConv =
                    entry.assistantMessage.conversationId ===
                    currentConversationId;

                  return (
                    <div
                      key={entry.assistantMessage.id}
                      onClick={() =>
                        setSelectedAnswerId(entry.assistantMessage.id)
                      }
                      className={`p-2.5 rounded-[2px] border transition-all duration-150 cursor-pointer text-left ${
                        isSelected
                          ? 'bg-[#18181a] border-[#ff4d00] shadow-xs ring-1 ring-[#ff4d00]/30'
                          : 'bg-[#18181a]/50 hover:bg-[#18181a] border-[rgba(242,239,235,0.1)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-mono text-[10px] text-[#f2efeb]/50 flex items-center gap-1 truncate">
                          <MessageSquare size={10} className="shrink-0 text-[#ff4d00]" />
                          <span className="truncate max-w-[140px]">
                            {entry.conversation?.title || 'Research Inquiry'}
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-[#f2efeb]/40 shrink-0">
                          {new Date(
                            entry.assistantMessage.createdAt
                          ).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      <p className="text-xs font-medium text-[#f2efeb] line-clamp-2 mb-1.5 font-sans">
                        {entry.userMessage?.content || 'Inquiry Question'}
                      </p>

                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        {entry.assistantMessage.citations &&
                        entry.assistantMessage.citations.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[#ff4d00] bg-[#ff4d00]/15 px-1.5 py-0.5 rounded-[2px] font-bold">
                            <ShieldCheck size={10} />
                            {entry.assistantMessage.citations.length} Citations
                          </span>
                        ) : (
                          <span className="text-[#f2efeb]/40 bg-[rgba(242,239,235,0.06)] px-1.5 py-0.5 rounded-[2px]">
                            No Citations
                          </span>
                        )}

                        {isCurrentConv && (
                          <span className="text-[#4ade80] bg-[#4ade80]/10 px-1.5 py-0.5 rounded-[2px] font-semibold">
                            Active Chat
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Answer Preview & Actions Right Column */}
          <div className="flex-1 flex flex-col h-full bg-[#18181a] overflow-hidden min-w-0 max-w-full">
            {selectedEntry ? (
              <>
                {/* Detail Header */}
                <div className="p-3.5 sm:p-4 border-b border-[rgba(242,239,235,0.1)] bg-[#141416] shrink-0 min-w-0 max-w-full">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 font-mono text-xs text-[#f2efeb]/60 min-w-0">
                      <span className="font-bold text-[#ff4d00] truncate">
                        {selectedEntry.conversation?.title || 'Inquiry Session'}
                      </span>
                      <span>•</span>
                      <span className="shrink-0 text-[11px]">
                        {new Date(
                          selectedEntry.assistantMessage.createdAt
                        ).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={handleCopySelected}
                        className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 bg-[#222226] hover:bg-[#2c2c30] border border-[rgba(242,239,235,0.15)] rounded-[2px] text-[#f2efeb] transition-colors cursor-pointer"
                        title="Copy answer text"
                      >
                        {copyStatus ? (
                          <>
                            <Check size={12} className="text-[#4ade80]" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span>Copy</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleExportSelectedMD}
                        className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 bg-[#222226] hover:bg-[#2c2c30] border border-[rgba(242,239,235,0.15)] rounded-[2px] text-[#f2efeb] transition-colors cursor-pointer"
                        title="Export Markdown file"
                      >
                        <Download size={12} />
                        <span>Export MD</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const firstCit =
                            selectedEntry.assistantMessage.citations?.[0];
                          onSelectAnswer(
                            selectedEntry.assistantMessage.conversationId,
                            selectedEntry.assistantMessage.id,
                            firstCit
                          );
                          onClose();
                        }}
                        className="inline-flex items-center gap-1 text-xs font-mono font-bold px-3 py-1 bg-[#ff4d00] hover:bg-[#ff6622] text-white rounded-[2px] shadow-xs transition-colors cursor-pointer"
                        title="Open this answer beside document in workspace"
                      >
                        <ExternalLink size={12} />
                        <span>Open Beside Folio</span>
                      </button>
                    </div>
                  </div>

                  {/* Question Box */}
                  <div className="bg-[#0e0e0f] border border-[rgba(242,239,235,0.1)] rounded-[2px] p-3 text-xs break-words">
                    <span className="font-mono text-[10px] font-bold text-[#ff4d00] uppercase tracking-wider block mb-1">
                      User Question:
                    </span>
                    <p className="font-medium text-[#f2efeb] text-sm break-words">
                      {selectedEntry.userMessage?.content ||
                        'No inquiry query text recorded.'}
                    </p>
                  </div>
                </div>

                {/* Answer Content Scrollable Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar-latest p-4 sm:p-6 space-y-4 min-w-0 max-w-full">
                  {selectedEntry.assistantMessage.status ===
                  'no_relevant_passages' ? (
                    <div className="bg-[#ff4d00]/10 border border-[#ff4d00]/30 rounded-[4px] p-4 text-[#ff7733]">
                      <div className="flex items-center gap-2 mb-1.5 font-mono text-xs font-bold uppercase">
                        <AlertTriangle size={14} />
                        <span>Relevance Floor Not Met</span>
                      </div>
                      <p className="text-sm text-[#f2efeb] break-words">
                        {selectedEntry.assistantMessage.content}
                      </p>
                    </div>
                  ) : (
                    <div className="min-w-0 max-w-full overflow-hidden">
                      <span className="font-mono text-[10px] font-bold text-[#f2efeb]/50 uppercase tracking-wider block mb-2">
                        Grounded Synthesis:
                      </span>
                      <SafeMarkdown
                        content={selectedEntry.assistantMessage.content}
                        onCitationClick={(marker) => {
                          const cit =
                            selectedEntry.assistantMessage.citations?.find(
                              (c) => c.marker === marker
                            );
                          if (cit) {
                            onSelectAnswer(
                              selectedEntry.assistantMessage.conversationId,
                              selectedEntry.assistantMessage.id,
                              cit
                            );
                            onClose();
                          }
                        }}
                      />
                    </div>
                  )}

                  {/* Citations List */}
                  {selectedEntry.assistantMessage.citations &&
                    selectedEntry.assistantMessage.citations.length > 0 && (
                      <div className="mt-6 pt-4 border-t border-[rgba(242,239,235,0.1)]">
                        <span className="font-mono text-xs font-semibold text-[#f2efeb]/60 uppercase tracking-wider block mb-3">
                          Anchored Page Citations (
                          {selectedEntry.assistantMessage.citations.length})
                        </span>

                        <div className="space-y-2">
                          {selectedEntry.assistantMessage.citations.map(
                            (c, idx) => (
                              <div
                                key={`cit-${c.marker}-${idx}`}
                                onClick={() => {
                                  onSelectAnswer(
                                    selectedEntry.assistantMessage
                                      .conversationId,
                                    selectedEntry.assistantMessage.id,
                                    c
                                  );
                                  onClose();
                                }}
                                className="p-3 bg-[#111113] hover:bg-[#141416] border border-[rgba(242,239,235,0.12)] rounded-[2px] text-xs cursor-pointer transition-colors"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1 mb-1.5 min-w-0">
                                  <div className="flex items-center gap-2 font-mono min-w-0 flex-1 truncate">
                                    <span className="font-bold text-[#ff4d00] shrink-0">
                                      [{c.marker}]
                                    </span>
                                    <span className="font-sans font-medium text-[#f2efeb] truncate">
                                      {c.documentName}
                                    </span>
                                    <span className="text-[11px] text-[#f2efeb]/50 shrink-0">
                                      · Page {c.pageNumber}
                                    </span>
                                  </div>
                                  <span className="font-mono text-[10px] text-[#ff4d00] hover:underline flex items-center gap-1 shrink-0">
                                    View in folio <ChevronRight size={10} />
                                  </span>
                                </div>
                                <p className="font-sans italic text-[#f2efeb]/70 border-l border-[#ff4d00]/40 pl-2 break-words">
                                  "{c.quote}"
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 text-center text-xs font-mono text-[#f2efeb]/40 italic">
                Select an answer from the left list to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
