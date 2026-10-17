import React, { useState } from 'react';
import {
  BookOpen,
  User,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
  Download,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { MessageRecord, Citation } from '../../types/index.ts';
import { SafeMarkdown } from '../ui/SafeMarkdown.tsx';
import { StatusBadge } from '../ui/Badge.tsx';

interface MessageItemProps {
  message: MessageRecord;
  onCitationClick: (citation: Citation) => void;
  activeCitationMarker?: number | null;
  onRetry?: () => void;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  onCitationClick,
  activeCitationMarker,
  onRetry,
}) => {
  const [showSourcesList, setShowSourcesList] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      // Fallback for non-secure / restricted contexts
      try {
        const textarea = document.createElement('textarea');
        textarea.value = message.content;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopyStatus('copied');
        setTimeout(() => setCopyStatus('idle'), 2500);
      } catch {
        setCopyStatus('error');
        setTimeout(() => setCopyStatus('idle'), 3000);
      }
    }
  };

  const handleExportMarkdown = () => {
    const dateStr = new Date(message.createdAt).toISOString().split('T')[0];
    const formattedDate = new Date(message.createdAt).toLocaleString();

    let md = `# DocuMind Research Answer\n\n`;
    md += `*Generated on: ${formattedDate}*\n\n`;
    md += `## Answer\n\n${message.content}\n\n`;

    if (message.citations && message.citations.length > 0) {
      md += `## Sources & Citations\n\n`;
      for (const cit of message.citations) {
        const status = cit.sourceDeleted
          ? 'Source Deleted'
          : cit.verified
          ? 'Verified Quote'
          : 'Unverified Quote';
        md += `### [${cit.marker}] ${cit.documentName} (Page ${cit.pageNumber})\n`;
        md += `- **Verification Status:** ${status}\n`;
        md += `- **Excerpt:**\n> "${cit.quote.replace(/\n/g, '\n> ')}"\n\n`;
      }
    }

    md += `---\n*Exported from DocuMind — AI Document Research Assistant*\n`;

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `documind-answer-${dateStr}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="message user flex justify-end mb-4 animate-in fade-in ml-auto max-w-[680px] w-full min-w-0">
        <div className="content bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[4px] px-4 sm:px-5 py-3 text-[#f2efeb] text-sm font-medium leading-relaxed break-words max-w-full">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant message rendering
  const isAbstain =
    message.status === 'no_relevant_passages' ||
    message.status === 'insufficient_evidence';
  const isError = message.status === 'error';

  return (
    <div className="message ai flex justify-start mb-6 animate-in fade-in max-w-3xl w-full">
      <div className="w-full bg-[#18181a] border border-[rgba(242,239,235,0.12)] rounded-[4px] p-5 md:p-6 text-[#f2efeb] shadow-xs">
        {/* Header Indicator */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-[rgba(242,239,235,0.1)] min-w-0 max-w-full">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full bg-[#ff4d00] shrink-0" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#f2efeb]/50 font-semibold truncate">
              Research Synthesis Engine
            </span>
          </div>
          {message.latencyMs && (
            <span className="font-mono text-[10px] text-[#f2efeb]/40 shrink-0">
              Retrieval: {message.latencyMs.retrieval}ms · Total: {message.latencyMs.total}ms
            </span>
          )}
        </div>

        {/* Answer content or Abstention Banner */}
        {isAbstain ? (
          <div className="bg-[rgba(255,77,0,0.08)] border border-[rgba(255,77,0,0.25)] rounded-[4px] p-4 text-[#f2efeb]">
            <div className="flex items-center gap-2 mb-2 font-mono text-xs uppercase tracking-wider text-[#ff4d00] font-bold">
              <AlertTriangle size={14} className="shrink-0 text-[#ff4d00]" />
              <span>
                {message.status === 'no_relevant_passages'
                  ? 'Relevance Floor Not Met'
                  : 'Insufficient Evidence Grounding'}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[#f2efeb] font-medium">
              {message.content}
            </p>
            <p className="text-xs text-[#f2efeb]/50 mt-2 font-mono">
              DocuMind refrains from synthesizing claims when verifiable primary evidence is missing from your active scope.
            </p>
          </div>
        ) : isError ? (
          <div className="pipeline-alert">
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '0.7rem', textTransform: 'uppercase', marginBottom: '10px', color: '#ff6b6b' }}>
              Pipeline_Critical_Error
            </div>
            <p className="text-sm text-[#f2efeb]/90 mb-3">
              {message.errorMessage || 'An error occurred while generating this answer.'}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="chip font-bold"
                style={{ background: '#ff4d00', color: 'white' }}
              >
                Retry Retrieval
              </button>
            )}
            {message.latencyMs && (
              <div style={{ marginTop: '15px', fontFamily: "'JetBrains Mono', monospace", fontSize: '0.6rem', opacity: 0.6 }}>
                Retrieval: {message.latencyMs.retrieval}ms · Total: {message.latencyMs.total}ms
              </div>
            )}
          </div>
        ) : (
          <div className="text-[#f2efeb] leading-[1.7] text-[15px]">
            <SafeMarkdown
              content={message.content}
              onCitationClick={(marker: number) => {
                const found = message.citations.find((c: Citation) => c.marker === marker);
                if (found) onCitationClick(found);
              }}
              activeMarker={activeCitationMarker}
            />
          </div>
        )}

        {/* Citations bar (if citations exist) */}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-5 pt-3.5 border-t border-[rgba(242,239,235,0.1)]">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold text-[#f2efeb]/50 uppercase tracking-widest">
                Sources & Citations ({message.citations.length})
              </span>
              <button
                type="button"
                onClick={() => setShowSourcesList(!showSourcesList)}
                className="flex items-center gap-1 font-mono text-[11px] text-[#ff4d00] hover:underline cursor-pointer"
              >
                <span>{showSourcesList ? 'Collapse list' : 'Inspect all excerpts'}</span>
                {showSourcesList ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {/* Inline Technical Citation Chips */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {message.citations.map((c: Citation, cIdx: number) => {
                const isActive = activeCitationMarker === c.marker;
                return (
                  <button
                    key={`cit-chip-${c.marker}-${c.chunkId || cIdx}`}
                    type="button"
                    onClick={() => onCitationClick(c)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[2px] text-xs transition-all duration-150 cursor-pointer font-mono ${
                      isActive
                        ? 'bg-[#ff4d00] text-white shadow-xs ring-2 ring-[#ff4d00]/40'
                        : 'bg-[#ff4d00]/15 text-[#ff4d00] hover:bg-[#ff4d00]/25 border border-[#ff4d00]/30'
                    }`}
                    title={`Jump to ${c.documentName} page ${c.pageNumber}`}
                  >
                    <span className="font-bold">[{c.marker}]</span>
                    <span className="truncate max-w-[130px] font-sans font-medium text-[#f2efeb]">
                      {c.documentName}
                    </span>
                    <span className="text-[10px] opacity-60">p.{c.pageNumber}</span>
                    {c.verified ? (
                      <ShieldCheck size={12} className={isActive ? 'text-white' : 'text-[#2F6B4F]'} />
                    ) : (
                      <AlertTriangle size={12} className={isActive ? 'text-white' : 'text-[#ff4d00]'} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Expanded Sources Drawer */}
            {showSourcesList && (
              <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-1">
                {message.citations.map((cit: Citation, citIdx: number) => (
                  <div
                    key={`cit-drawer-${cit.marker}-${cit.chunkId || citIdx}`}
                    onClick={() => onCitationClick(cit)}
                    className="p-3 bg-[#111113] hover:bg-[#141416] rounded-[2px] border border-[rgba(242,239,235,0.12)] text-xs transition-colors cursor-pointer"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="font-mono font-bold text-[#ff4d00] shrink-0">[{cit.marker}]</span>
                        <span className="font-medium text-[#f2efeb] truncate">{cit.documentName}</span>
                        <span className="font-mono text-[11px] text-[#f2efeb]/50 shrink-0">· Page {cit.pageNumber}</span>
                      </div>
                      <div className="shrink-0">
                        <StatusBadge
                          status={
                            cit.sourceDeleted
                              ? 'Source Deleted'
                              : cit.verified
                              ? 'Verified'
                              : 'Unverified'
                          }
                          size="sm"
                        />
                      </div>
                    </div>
                    <p className="text-[#f2efeb]/70 font-sans italic line-clamp-2 pl-2 border-l border-[#ff4d00]/40">
                      "{cit.quote}"
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer: Latency metadata & Research actions */}
        <div className="mt-4 pt-3 border-t border-[rgba(242,239,235,0.1)] flex flex-wrap items-center justify-between gap-2 text-xs text-[#f2efeb]/50">
          <div className="font-mono text-[10px] opacity-40">
            SECURE SOURCE LINKING
          </div>

          {/* Action buttons: Copy Answer & Export Markdown */}
          {!isAbstain && !isError && message.content && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopyAnswer}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-[2px] text-xs font-mono border transition-colors cursor-pointer ${
                  copyStatus === 'copied'
                    ? 'bg-[#2F6B4F]/20 border-[#2F6B4F]/40 text-[#2F6B4F]'
                    : copyStatus === 'error'
                    ? 'bg-[#9F1239]/20 border-[#9F1239]/40 text-[#ff6b6b]'
                    : 'bg-[#222226] hover:bg-[#2c2c30] border-[rgba(242,239,235,0.15)] text-[#f2efeb]'
                }`}
                title="Copy full answer text"
              >
                {copyStatus === 'copied' ? (
                  <>
                    <Check size={12} className="text-[#2F6B4F]" />
                    <span>Copied</span>
                  </>
                ) : copyStatus === 'error' ? (
                  <>
                    <AlertTriangle size={12} className="text-[#ff6b6b]" />
                    <span>Copy Failed</span>
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
                onClick={handleExportMarkdown}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[2px] text-xs font-mono bg-[#222226] hover:bg-[#2c2c30] border border-[rgba(242,239,235,0.15)] text-[#f2efeb] transition-colors cursor-pointer"
                title="Export answer as Markdown report"
              >
                <Download size={12} />
                <span>Export MD</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
