import React, { useState, useEffect } from 'react';
import {
  X,
  Search,
  BookOpen,
  MessageSquare,
  ExternalLink,
  Copy,
  Check,
  Download,
  AlertTriangle,
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
import { Button } from '../ui/Button.tsx';

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
      allConvs.forEach((c: ConversationRecord) => convMap.set(c.id, c));
      setConversations(allConvs);

      // Group into assistant answers paired with their preceding user query
      const pairedAnswers: AnswerEntry[] = [];
      const msgsByConv = new Map<string, MessageRecord[]>();

      allMsgs.forEach((m: MessageRecord) => {
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

    // Filter by search text
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const inUser = entry.userMessage?.content.toLowerCase().includes(q);
      const inAnswer = entry.assistantMessage.content.toLowerCase().includes(q);
      const inCitations = entry.assistantMessage.citations?.some(
        (c) =>
          c.documentName.toLowerCase().includes(q) ||
          c.quote.toLowerCase().includes(q)
      );
      return inUser || inAnswer || inCitations;
    }

    return true;
  });

  const selectedEntry = answers.find(
    (e) => e.assistantMessage.id === selectedAnswerId
  );

  const handleCopySelected = () => {
    if (!selectedEntry) return;
    navigator.clipboard.writeText(selectedEntry.assistantMessage.content);
    setCopyStatus(true);
    setTimeout(() => setCopyStatus(false), 2000);
  };

  const handleExportSelectedMD = () => {
    if (!selectedEntry) return;
    const msg = selectedEntry.assistantMessage;
    const userQ = selectedEntry.userMessage?.content || 'Inquiry';

    let md = `# Research inquiry: ${userQ}\n\n`;
    md += `*Generated: ${new Date(msg.createdAt).toLocaleString()}*\n\n`;
    md += `## Synthesis\n\n${msg.content}\n\n`;

    if (msg.citations && msg.citations.length > 0) {
      md += `## Citations\n\n`;
      msg.citations.forEach((c) => {
        md += `### [${c.marker}] ${c.documentName} (Page ${c.pageNumber})\n`;
        md += `> "${c.quote}"\n\n`;
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
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[3px] flex items-center justify-center p-2 sm:p-4 md:p-6 animate-in fade-in duration-200">
      <div className="bg-[var(--card)] border border-[var(--line)] rounded-[0_16px_16px_16px] shadow-2xl w-full max-w-5xl h-[92vh] md:h-[85vh] flex flex-col overflow-hidden text-[var(--ink)]">
        {/* Header */}
        <div className="px-5 py-4 bg-[var(--paper)] border-b border-[var(--line)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-full bg-[var(--primary)] text-white flex items-center justify-center shadow-xs shrink-0">
              <BookOpen size={16} />
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-xl font-semibold text-[var(--ink)] truncate">
                Previous inquiries archive
              </h2>
              <p className="text-xs text-[var(--muted)] hidden sm:block truncate font-sans">
                Review, examine citations, or reopen past document answers directly in the reading room.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--card-subtle)] transition-colors cursor-pointer shrink-0 ml-2"
            title="Close archive"
            aria-label="Close archive"
          >
            <X size={18} />
          </button>
        </div>

        {/* Filter and Search Bar */}
        <div className="p-3.5 bg-[var(--card)] border-b border-[var(--line)] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0 min-w-0 max-w-full">
          <div className="relative flex-1 min-w-0">
            <Search
              size={14}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search previous answers by query keywords, quotes, or document..."
              className="w-full pl-9 pr-4 py-2 bg-[var(--paper)] border border-[var(--line)] rounded-full text-xs text-[var(--ink)] placeholder-[var(--muted)]/60 focus:outline-hidden focus:border-[var(--primary)] transition-colors"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] shrink-0 font-sans">
              <Filter size={13} />
              <span>Inquiry:</span>
            </div>
            <select
              value={selectedConversationId}
              onChange={(e) => setSelectedConversationId(e.target.value)}
              className="px-3 py-2 bg-[var(--paper)] border border-[var(--line)] rounded-full text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--primary)] max-w-[200px] sm:max-w-[220px] truncate transition-colors"
            >
              <option value="all">All inquiries ({conversations.length})</option>
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
          <div className="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-[var(--line)] flex flex-col h-44 sm:h-56 md:h-full bg-[var(--paper)] shrink-0 overflow-hidden min-w-0">
            <div className="px-3.5 py-2.5 border-b border-[var(--line)] bg-[var(--card)] font-mono text-[11px] font-medium text-[var(--muted)] uppercase tracking-wider flex items-center justify-between shrink-0">
              <span>Answers ({filteredAnswers.length})</span>
              <span className="text-[11px] text-[var(--primary)]">newest first</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
              {loading ? (
                <div className="p-8 text-center text-xs font-serif italic text-[var(--muted)]">
                  Loading previous answers...
                </div>
              ) : filteredAnswers.length === 0 ? (
                <div className="p-8 text-center text-xs font-serif italic text-[var(--muted)]">
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
                      className={`p-3 rounded-[0_10px_10px_10px] border transition-all duration-180 cursor-pointer text-left ${
                        isSelected
                          ? 'bg-[var(--card)] border-[var(--primary)] shadow-xs ring-1 ring-[var(--primary)]'
                          : 'bg-[var(--card)] hover:bg-[var(--card-subtle)] border-[var(--line)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1.5">
                        <span className="text-[11px] text-[var(--muted)] flex items-center gap-1.5 truncate">
                          <MessageSquare size={12} className="shrink-0 text-[var(--primary)]" />
                          <span className="truncate max-w-[140px] font-medium">
                            {entry.conversation?.title || 'Research inquiry'}
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-[var(--muted)] shrink-0">
                          {new Date(
                            entry.assistantMessage.createdAt
                          ).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      <p className="text-xs font-serif italic text-[var(--ink)] line-clamp-2 mb-2">
                        "{entry.userMessage?.content || 'Inquiry question'}"
                      </p>

                      <div className="flex items-center gap-1.5 text-[10px]">
                        {entry.assistantMessage.citations &&
                        entry.assistantMessage.citations.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[var(--primary)] bg-[var(--primary-surface)] px-2 py-0.5 rounded-full font-mono font-medium">
                            {entry.assistantMessage.citations.length} Citations
                          </span>
                        ) : (
                          <span className="text-[var(--muted)] bg-[var(--paper)] px-2 py-0.5 rounded-full font-mono">
                            No citations
                          </span>
                        )}

                        {isCurrentConv && (
                          <span className="text-[var(--green)] bg-[var(--green-faint)] border border-[var(--green)]/30 px-2 py-0.5 rounded-full font-sans font-medium">
                            Active session
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
          <div className="flex-1 flex flex-col h-full bg-[var(--card)] overflow-hidden min-w-0 max-w-full">
            {selectedEntry ? (
              <>
                {/* Detail Header */}
                <div className="p-4 sm:p-5 border-b border-[var(--line)] bg-[var(--paper)] shrink-0 min-w-0 max-w-full">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)] min-w-0 font-sans">
                      <span className="font-medium text-[var(--primary)] truncate">
                        {selectedEntry.conversation?.title || 'Inquiry session'}
                      </span>
                      <span>•</span>
                      <span className="shrink-0 font-mono text-[11px]">
                        {new Date(
                          selectedEntry.assistantMessage.createdAt
                        ).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleCopySelected}
                        title="Copy answer text"
                        className="gap-1.5"
                      >
                        {copyStatus ? (
                          <>
                            <Check size={13} className="text-[var(--green)]" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy size={13} />
                            <span>Copy</span>
                          </>
                        )}
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleExportSelectedMD}
                        title="Export Markdown file"
                        className="gap-1.5"
                      >
                        <Download size={13} />
                        <span>Export MD</span>
                      </Button>

                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
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
                        title="Open this answer beside document in workspace"
                        className="gap-1.5"
                      >
                        <ExternalLink size={13} />
                        <span>Open beside folio</span>
                      </Button>
                    </div>
                  </div>

                  {/* Question Box */}
                  <div className="bg-[var(--card)] border border-[var(--line)] rounded-[0_10px_10px_10px] p-3.5 text-xs">
                    <span className="font-mono text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider block mb-1">
                      Inquiry question:
                    </span>
                    <p className="font-serif italic text-base text-[var(--ink)] leading-relaxed">
                      "{selectedEntry.userMessage?.content || 'No inquiry query text recorded.'}"
                    </p>
                  </div>
                </div>

                {/* Answer Content Scrollable Body */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 min-w-0 max-w-full">
                  {selectedEntry.assistantMessage.status ===
                  'no_relevant_passages' ? (
                    <div className="p-4 border border-[var(--stamp-red)] bg-[var(--stamp-red-faint)] rounded-[0_10px_10px_10px] text-[var(--stamp-red)]">
                      <div className="flex items-center gap-2 mb-1.5">
                        <AlertTriangle size={15} />
                        <span className="stamp-label">Relevance floor not met</span>
                      </div>
                      <p className="text-sm text-[var(--ink)] break-words font-sans">
                        {selectedEntry.assistantMessage.content}
                      </p>
                    </div>
                  ) : (
                    <div className="min-w-0 max-w-full overflow-hidden">
                      <span className="font-mono text-[10px] font-medium text-[var(--muted)] uppercase tracking-wider block mb-2">
                        Synthesized response:
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
                      <div className="mt-8 pt-5 border-t border-[var(--line)]">
                        <span className="font-mono text-xs font-medium text-[var(--muted)] uppercase tracking-wider block mb-3">
                          Anchored page citations ({selectedEntry.assistantMessage.citations.length})
                        </span>

                        <div className="space-y-2.5">
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
                                className="p-3.5 bg-[var(--paper)] hover:bg-[var(--card-subtle)] border border-[var(--line)] rounded-[0_10px_10px_10px] text-xs cursor-pointer transition-colors"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                                    <span className="citation-sup">
                                      {c.marker}
                                    </span>
                                    <span className="font-medium text-[var(--ink)] truncate">
                                      {c.documentName}
                                    </span>
                                    <span className="font-mono text-[11px] text-[var(--muted)] shrink-0">
                                      · Page {c.pageNumber}
                                    </span>
                                  </div>
                                  <span className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1 shrink-0 font-medium">
                                    View in folio <ChevronRight size={12} />
                                  </span>
                                </div>
                                <p className="font-sans italic text-[var(--ink)] border-l-2 border-[var(--highlighter)] pl-2.5 break-words highlighter-mark leading-relaxed">
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
              <div className="flex-1 flex items-center justify-center p-8 text-center text-sm font-serif italic text-[var(--muted)]">
                Select an answer from the left list to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
