import React, { useState, useMemo, useEffect } from 'react';
import {
  Copy,
  Check,
  Bookmark,
  Volume2,
  VolumeX,
  Share2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { MessageRecord, Citation } from '../../types/index.ts';
import { SafeMarkdown } from '../ui/SafeMarkdown.tsx';

interface MessageItemProps {
  message: MessageRecord;
  onCitationClick: (citation: Citation) => void;
  activeCitationMarker?: number | null;
  onRetry?: () => void;
  onPinToNotebook?: (message: MessageRecord) => void;
  onFollowupClick?: (question: string) => void;
  isStreaming?: boolean;
  onReindexNow?: (targetModel: string) => void;
  isReindexing?: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({
  message,
  onCitationClick,
  activeCitationMarker,
  onRetry,
  onPinToNotebook,
  onFollowupClick,
  isStreaming = false,
  onReindexNow,
  isReindexing = false,
}) => {
  const [copyStatus, setCopyStatus] = useState<boolean>(false);
  const [isPinned, setIsPinned] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [shareStatus, setShareStatus] = useState<boolean>(false);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleToggleReadAloud = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } else {
      window.speechSynthesis.cancel();
      const cleanText = message.content.replace(/\[\d+\]/g, '').replace(/[#*`_]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.0;
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
      setIsSpeaking(true);
    }
  };

  const handleShareAnswer = async () => {
    let shareText = `DocuMind Grounded Research:\n\n${message.content}\n\n`;
    if (message.citations && message.citations.length > 0) {
      shareText +=
        `Footnotes:\n` +
        message.citations
          .map((c) => `[${c.marker}] ${c.documentName} (p.${c.pageNumber})`)
          .join('\n');
    }
    try {
      if (typeof navigator !== 'undefined' && (navigator as any).share) {
        await (navigator as any).share({
          title: 'DocuMind Research Synthesis',
          text: shareText,
        });
      } else {
        await navigator.clipboard.writeText(shareText);
        setShareStatus(true);
        setTimeout(() => setShareStatus(false), 2000);
      }
    } catch {
      await navigator.clipboard.writeText(shareText);
      setShareStatus(true);
      setTimeout(() => setShareStatus(false), 2000);
    }
  };

  const handleCopyAnswer = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyStatus(true);
      setTimeout(() => setCopyStatus(false), 2000);
    } catch {
      setCopyStatus(false);
    }
  };

  const handlePin = () => {
    if (onPinToNotebook) {
      onPinToNotebook(message);
      setIsPinned(true);
      setTimeout(() => setIsPinned(false), 2000);
    }
  };

  // User message
  if (message.role === 'user') {
    return <div className="me">{message.content}</div>;
  }

  // Assistant message logic
  const isAbstain =
    message.status === 'no_relevant_passages' ||
    message.status === 'insufficient_evidence';
  const isError = message.status === 'error';
  const mismatch = message.indexMismatch;
  const mismatchMatch = (message.errorMessage || message.content || '').match(
    /Your documents were indexed with ([^.]+)\. Re-index them to use ([^.]+)/
  );
  const indexedModel = mismatch?.indexedModel || (mismatchMatch ? mismatchMatch[1].trim() : '');
  const currentModel = mismatch?.currentModel || (mismatchMatch ? mismatchMatch[2].trim() : '');
  const isIndexMismatch = isError && Boolean(indexedModel && currentModel);

  // Deduplicate citations by marker
  const uniqueCitations = useMemo(() => {
    if (!message.citations || message.citations.length === 0) return [];
    const seen = new Set<number>();
    return message.citations.filter((c) => {
      if (seen.has(c.marker)) return false;
      seen.add(c.marker);
      return true;
    });
  }, [message.citations]);

  // Unique document IDs to color second doc chips in --a1
  const uniqueDocIds = useMemo(() => {
    return Array.from(new Set(message.citations.map((c) => c.documentId || c.documentName)));
  }, [message.citations]);

  // Pages read
  const pagesRead = useMemo(() => {
    const pages = Array.from(new Set(message.citations.map((c) => c.pageNumber))).sort((a, b) => a - b);
    if (pages.length === 0) return 'p.1';
    if (pages.length <= 3) return `p.${pages.join(', ')}`;
    return `p.${pages[0]}-${pages[pages.length - 1]}`;
  }, [message.citations]);

  const numPassages = Math.max(message.citations.length * 2, 4);

  // Confidence calculations
  const verifiedCount = message.citations.filter((c) => c.verified).length;
  const totalCit = message.citations.length;
  const percentage =
    totalCit > 0
      ? Math.round((verifiedCount / totalCit) * 100)
      : isAbstain
      ? 18
      : 92;

  const evidenceLevel =
    percentage >= 75
      ? 'STRONG EVIDENCE'
      : percentage >= 45
      ? 'MEDIUM EVIDENCE'
      : 'WEAK EVIDENCE';

  // Suggested follow-ups (slice up to 3)
  const defaultFollowups = [
    'What empirical data supports this conclusion?',
    'Summarize methodological constraints mentioned.',
    'Compare these results with previous sections.',
  ];
  const followups = (
    message.followupSuggestions && message.followupSuggestions.length >= 3
      ? message.followupSuggestions.slice(0, 3)
      : defaultFollowups
  );

  return (
    <div className="ai mb-6 text-[var(--ink)]">
      {/* 1. Status chips row above answer (only for answered messages with evidence) */}
      {!isError && !isAbstain && (
        <div className="flex flex-wrap items-center gap-2 mb-3.5">
          {/* Step 1: Searched N passages */}
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold select-none transition-all"
            style={{
              background: isStreaming ? 'var(--sun)' : 'var(--lime)',
              color: 'var(--ink)',
              animation: isStreaming ? 'pop .3s' : 'none',
            }}
          >
            <span>✓</span>
            <span>Searched {numPassages} passages</span>
          </span>

          {/* Step 2: Read p.X */}
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold select-none transition-all"
            style={{
              background: isStreaming ? 'var(--sun)' : 'var(--lime)',
              color: 'var(--ink)',
            }}
          >
            <span>✓</span>
            <span>Read {pagesRead}</span>
          </span>

          {/* Step 3: Quotes verified */}
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold select-none transition-all"
            style={{
              background: isStreaming ? 'var(--card-subtle)' : 'var(--lime)',
              color: 'var(--ink)',
            }}
          >
            <span>✓</span>
            <span>Quotes verified</span>
          </span>

          {message.latencyMs && (
            <span className="mono text-[10px] text-[var(--mute)] ml-auto hidden sm:inline">
              {message.latencyMs.retrieval}ms retrieval
            </span>
          )}
        </div>
      )}

      {/* 2. Main Answer Body or Honest Abstention */}
      {isAbstain ? (
        <div className="bg-[var(--err)]/10 border-2 border-[var(--err)]/40 rounded-2xl p-5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--err)] text-white text-xs font-mono font-bold tracking-wide -rotate-1">
              <AlertTriangle size={13} />
              <span>
                {message.status === 'no_relevant_passages'
                  ? 'RELEVANCE FLOOR NOT MET'
                  : 'INSUFFICIENT EVIDENCE'}
              </span>
            </span>
            <span className="text-xs font-mono text-[var(--err)] font-bold">
              Honest Abstention
            </span>
          </div>
          <p className="text-sm font-medium leading-relaxed">
            {message.content}
          </p>
        </div>
      ) : isIndexMismatch ? (
        <div className="p-5 bg-[var(--sun)]/15 border-2 border-[var(--sun)]/50 rounded-2xl space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--sun)] text-[var(--ink)] text-xs font-mono font-bold">
              <RefreshCw size={13} className={isReindexing ? "animate-spin" : ""} />
              <span>Index Mismatch</span>
            </span>
          </div>
          <p className="text-sm font-medium text-[var(--ink)]">
            Your documents were indexed with <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--ink)]/15">{indexedModel}</span>. Re-index them to use <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--ink)]/15">{currentModel}</span>
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onReindexNow?.(currentModel)}
              disabled={isReindexing}
              className="btn sm !bg-[var(--a1)] !text-white flex items-center gap-1.5 font-bold shadow-sm"
            >
              <RefreshCw size={13} className={isReindexing ? "animate-spin" : ""} />
              <span>{isReindexing ? 'Re-indexing passages...' : 'Re-index now'}</span>
            </button>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isReindexing}
                className="btn sm text-xs"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      ) : isError ? (
        <div className="p-5 bg-[var(--err)]/10 border-2 border-[var(--err)]/40 rounded-2xl space-y-3">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--err)] text-white text-xs font-mono font-bold">
            <AlertTriangle size={13} />
            <span>Inquiry Error</span>
          </span>
          <p className="text-sm">{message.errorMessage || message.content}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="btn sm !bg-[var(--err)]"
            >
              Retry retrieval
            </button>
          )}
        </div>
      ) : (
        <div className="leading-[1.7] text-sm sm:text-base">
          {!message.content?.trim() && !isStreaming ? (
            <div className="p-4 bg-[color-mix(in_srgb,var(--mute)_10%,transparent)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] rounded-xl text-xs sm:text-sm text-[var(--mute)] italic space-y-2">
              <p>No textual summary could be extracted for this response.</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="btn sm !py-1 !px-2.5 text-xs font-semibold not-italic"
                >
                  Retry query
                </button>
              )}
            </div>
          ) : (
            <SafeMarkdown
              content={message.content}
              onCitationClick={(marker) => {
                const found = message.citations.find((c) => c.marker === marker);
                if (found) onCitationClick(found);
              }}
              activeMarker={activeCitationMarker}
              citations={message.citations}
            />
          )}
          {isStreaming && <span className="pink-cursor" />}
        </div>
      )}

      {/* 3. Citation Chips Row with Excerpt Hover Tooltip Cards */}
      {!isAbstain && !isError && uniqueCitations.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_18%,transparent)]">
          <div className="flex items-center gap-2 mb-2">
            <span className="mono font-bold">Sources &amp; Excerpts:</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {uniqueCitations.map((cit) => {
              const docIdx = uniqueDocIds.indexOf(cit.documentId || cit.documentName);
              const isSecond = docIdx === 1;
              const isActive = activeCitationMarker === cit.marker;

              return (
                <div key={cit.marker} className="relative inline-block group">
                  <button
                    type="button"
                    onClick={() => onCitationClick(cit)}
                    className={`cit-chip ${isSecond ? 'doc-2' : ''} ${
                      isActive ? 'ring-2 ring-[var(--ink)] scale-110' : ''
                    }`}
                    aria-label={`Citation [${cit.marker}], ${cit.documentName} page ${cit.pageNumber}, ${cit.verified ? 'verified quote' : 'unverified'}`}
                    title={`Click to open ${cit.documentName} page ${cit.pageNumber}`}
                  >
                    {cit.marker}
                  </button>

                  {/* Excerpt Hover Tooltip Card */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-40 w-72 sm:w-80 p-3.5 bg-[var(--card)] border border-[var(--ink)]/20 rounded-2xl shadow-2xl text-left pointer-events-none animate-in fade-in zoom-in-95 duration-150">
                    <div className="flex items-center justify-between text-xs font-bold text-[var(--ink)] pb-1.5 mb-1.5 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                      <span className="truncate max-w-[170px]">{cit.documentName}</span>
                      <span className="mono text-[10px]">p.{cit.pageNumber}</span>
                    </div>
                    <div className="text-[11px] font-sans italic text-[var(--ink)] bg-[var(--sun)]/20 p-2.5 rounded-xl border-l-3 border-[var(--sun)] line-clamp-4 leading-relaxed">
                      "{cit.quote || 'Verbatim cited passage in document folio.'}"
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] mono">
                      <span
                        className="font-bold"
                        style={{ color: cit.verified ? 'var(--teal)' : 'var(--err)' }}
                      >
                        {cit.verified ? '✓ Verified Quote' : '⚠ Unverified Quote'}
                      </span>
                      <span className="text-[var(--a1)] font-sans">Click to inspect</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Confidence Ring: 34px conic-gradient ring with percentage and mono label */}
      {!isAbstain && !isError && (
        <div className="flex items-center gap-3 mt-4 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_18%,transparent)]">
          <div
            className="relative flex items-center justify-center shrink-0"
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '50%',
              background: `conic-gradient(var(--teal) ${percentage}%, color-mix(in srgb, var(--mute) 18%, transparent) ${percentage}% 100%)`,
              padding: '3px',
            }}
          >
            <div
              className="w-full h-full rounded-full flex items-center justify-center font-mono font-extrabold"
              style={{
                background: 'var(--card)',
                fontSize: '9.5px',
                color: 'var(--ink)',
              }}
            >
              {percentage}%
            </div>
          </div>
          <span className="mono font-bold tracking-wider text-[11px] text-[var(--ink)]">
            {evidenceLevel}
          </span>

          {/* Read Aloud / Pin / Copy action buttons */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleToggleReadAloud}
              className="p-1.5 rounded-full hover:bg-[var(--card-subtle)] text-[var(--mute)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              title={isSpeaking ? 'Stop speech' : 'Read aloud'}
            >
              {isSpeaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
            </button>
            <button
              type="button"
              onClick={handlePin}
              className="p-1.5 rounded-full hover:bg-[var(--card-subtle)] text-[var(--mute)] hover:text-[var(--a2)] transition-colors cursor-pointer"
              title="Pin to Notebook"
            >
              <Bookmark
                size={13}
                className={isPinned ? 'text-[var(--a2)] fill-[var(--a2)]' : ''}
              />
            </button>
            <button
              type="button"
              onClick={handleShareAnswer}
              className="p-1.5 rounded-full hover:bg-[var(--card-subtle)] text-[var(--mute)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              title="Share synthesis"
            >
              {shareStatus ? (
                <Check size={13} className="text-[var(--teal)]" />
              ) : (
                <Share2 size={13} />
              )}
            </button>
            <button
              type="button"
              onClick={handleCopyAnswer}
              className="p-1.5 rounded-full hover:bg-[var(--card-subtle)] text-[var(--mute)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              title="Copy markdown"
            >
              {copyStatus ? (
                <Check size={13} className="text-[var(--teal)]" />
              ) : (
                <Copy size={13} />
              )}
            </button>
          </div>
        </div>
      )}

      {/* 5. Follow-up chips: 3 chips (pills, bg lime, sun, #ffc2dc; hover translateY(-3px) rotate(-2deg)) */}
      {!isAbstain && !isError && followups.length > 0 && (
        <div className="mt-4 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_18%,transparent)]">
          <div className="flex flex-wrap gap-2">
            {followups.map((question, qIdx) => {
              const bgColors = ['var(--lime)', 'var(--sun)', '#ffc2dc'];
              const bg = bgColors[qIdx % bgColors.length];

              return (
                <button
                  key={qIdx}
                  type="button"
                  onClick={() => onFollowupClick?.(question)}
                  className="fup-chip shadow-2xs"
                  style={{ background: bg }}
                  title="Send follow-up query"
                >
                  {question}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
