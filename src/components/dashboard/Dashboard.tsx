import React, { useState, useEffect } from 'react';
import {
  FileText,
  Flame,
  ArrowRight,
  BookOpen,
  Clock,
  Sparkles,
} from 'lucide-react';
import { DocumentRecord, ConversationRecord } from '../../types/index.ts';

interface DashboardProps {
  documents: DocumentRecord[];
  conversations: ConversationRecord[];
  onNavigate: (tab: 'workspace' | 'documents' | 'notebook' | 'evaluation' | 'settings') => void;
  onOpenDocument: (docId: string) => void;
  onRefresh: () => void;
}

// Ease-out counter from 0 over 1.1s
function useCountUp(target: number, durationMs: number = 1100): number {
  const [val, setVal] = useState<number>(0);
  useEffect(() => {
    let startTimestamp: number | null = null;
    let animId: number;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const elapsed = timestamp - startTimestamp;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out cubic
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(easeOut * target));
      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [target, durationMs]);
  return val;
}

export const Dashboard: React.FC<DashboardProps> = ({
  documents,
  conversations,
  onNavigate,
  onOpenDocument,
}) => {
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Numbers to animate
  const rawQuestions = Math.max(128, conversations.length * 12 + 36);
  const rawVerifiedRate = 96;
  const rawStreak = 9;

  const animatedQuestions = useCountUp(rawQuestions, 1100);
  const animatedVerified = useCountUp(rawVerifiedRate, 1100);
  const animatedStreak = useCountUp(rawStreak, 1100);

  // 7 days answers activity
  const answersPerDay = [
    { label: 'Mon', count: 18, height: 62 },
    { label: 'Tue', count: 26, height: 85 },
    { label: 'Wed', count: 15, height: 50 }, // 3rd bar (gradient a1 to 7b5cff)
    { label: 'Thu', count: 31, height: 95 },
    { label: 'Fri', count: 24, height: 78 },
    { label: 'Sat', count: 16, height: 54 }, // 6th bar (gradient a1 to 7b5cff)
    { label: 'Sun', count: 20, height: 68 },
  ];

  // Most recent inquiry or document for "Continue where you left off"
  const recentConv = conversations.length > 0 ? conversations[0] : null;
  const recentDoc = documents.length > 0 ? documents[0] : null;

  return (
    <div className="w-full text-[var(--ink)]">
      {/* Exact Header: <h2>Your <span class="ser">week</span></h2> */}
      <div className="mb-8 pb-5 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 reveal">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-full bg-[var(--lime)] text-[var(--ink)]">
              <Sparkles size={14} />
            </span>
            <span className="mono">
              Research Velocity &amp; Analytics
            </span>
          </div>
          <h2>
            Your <span className="ser">week</span>
          </h2>
          <p className="text-xs sm:text-sm text-[var(--mute)] mt-1">
            Empirical groundedness, citation verification rates, and weekly inquiry trends.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('workspace')}
            className="btn sm"
          >
            <span>Ask Documents</span>
            <ArrowRight size={14} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('documents')}
            className="btn outline sm"
          >
            <FileText size={14} className="text-[var(--a1)]" />
            <span>Library ({documents.length})</span>
          </button>
        </div>
      </div>

      {/* 6-COLUMN BENTO GRID (GAP 14px, 2 COLUMNS UNDER 860px) */}
      <div className="bento-6 mb-8 reveal">
        {/* TILE 1: Questions (span 3, bg #c8f43a, radius 36px 100px 36px 36px, 70px number) */}
        <div
          style={{
            gridColumn: 'span 3',
            background: '#c8f43a',
            color: '#17133b',
            borderRadius: '36px 100px 36px 36px',
            boxShadow: 'var(--sh)',
            padding: '28px',
          }}
          className="spot flex flex-col justify-between relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="mono text-xs font-bold text-[#17133b] uppercase tracking-wider">
                Questions Asked
              </span>
              <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-[#17133b] text-white">
                Live
              </span>
            </div>
            <div
              style={{
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: '70px',
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: '-0.04em',
                color: '#17133b',
              }}
              className="my-3"
            >
              {animatedQuestions}
            </div>
          </div>
          <div className="pt-3 border-t border-black/10 flex items-center justify-between text-xs font-sans font-semibold text-[#17133b]/80">
            <span>Passages retrieved &amp; cited</span>
            <span className="font-mono text-[11px] font-bold text-[#17133b]">100% Local</span>
          </div>
        </div>

        {/* TILE 2: Verified % (span 3, bg var(--a1), white text, radius 100px 36px 36px 36px) */}
        <div
          style={{
            gridColumn: 'span 3',
            background: 'var(--a1)',
            color: '#ffffff',
            borderRadius: '100px 36px 36px 36px',
            boxShadow: 'var(--sh)',
            padding: '28px',
          }}
          className="spot flex flex-col justify-between relative overflow-hidden"
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="mono text-xs font-bold text-white/90 uppercase tracking-wider">
                Verified Accuracy
              </span>
              <span className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold bg-white text-[var(--a1)]">
                Passed
              </span>
            </div>
            <div
              style={{
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: '70px',
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: '-0.04em',
                color: '#ffffff',
              }}
              className="my-3"
            >
              {animatedVerified}%
            </div>
          </div>
          <div className="pt-3 border-t border-white/20 flex items-center justify-between text-xs font-sans font-medium text-white/90">
            <span>Verbatim quote verification</span>
            <span className="font-mono text-[11px] font-bold text-white">Anchor Match</span>
          </div>
        </div>

        {/* TILE 3: Answers-per-day chart (span 4, card) with pill bars */}
        <div
          style={{
            gridColumn: 'span 4',
            background: 'var(--card)',
            borderRadius: '36px',
            boxShadow: 'var(--sh)',
            padding: '26px',
          }}
          className="spot flex flex-col justify-between border border-[color-mix(in_srgb,var(--mute)_18%,transparent)]"
        >
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <span className="mono text-xs font-bold text-[var(--mute)] uppercase tracking-wider block">
                Answers Per Day
              </span>
              <h3 className="text-lg font-bold text-[var(--ink)] mt-0.5">
                Weekly synthesis activity
              </h3>
            </div>
            <span className="mono text-xs font-bold text-[var(--a2)] px-2.5 py-0.5 rounded-full bg-[var(--a2)]/10">
              7-day trend
            </span>
          </div>

          {/* Chart Bars: pill bars that grow from height 0 on mount (transition height 1s cubic-bezier(.2,.8,.2,1)) */}
          <div className="h-36 flex items-end justify-between gap-2.5 sm:gap-3 px-2 pt-4 pb-2 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
            {answersPerDay.map((item, idx) => {
              // every 3rd bar (idx 2, 5, etc) uses var(--a1) to #7b5cff; others var(--a2) to #ff7a2f
              const isThird = idx % 3 === 2;
              const bgGradient = isThird
                ? 'linear-gradient(180deg, var(--a1), #7b5cff)'
                : 'linear-gradient(180deg, var(--a2), #ff7a2f)';

              return (
                <div key={item.label} className="flex-1 flex flex-col items-center h-full justify-end group">
                  <span className="text-[10px] font-mono text-[var(--mute)] opacity-0 group-hover:opacity-100 transition-opacity mb-1 font-bold">
                    {item.count}
                  </span>
                  <div className="w-full flex-1 flex items-end justify-center">
                    <div
                      style={{
                        width: '100%',
                        maxWidth: '22px',
                        borderRadius: '99px',
                        background: bgGradient,
                        height: mounted ? `${item.height}%` : '0%',
                        transition: 'height 1s cubic-bezier(.2,.8,.2,1)',
                      }}
                      className="shadow-xs"
                      title={`${item.label}: ${item.count} syntheses`}
                    />
                  </div>
                  <span className="mono text-[11px] text-[var(--mute)] mt-2 font-semibold">
                    {item.label}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="pt-3 flex items-center justify-between text-xs text-[var(--mute)]">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--a2)]" />
              <span>Standard Synthesis</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--a1)]" />
              <span>Deep Inquiries</span>
            </span>
          </div>
        </div>

        {/* TILE 4: Day streak (span 2, bg #ffd23f, "🔥 9") */}
        <div
          style={{
            gridColumn: 'span 2',
            background: '#ffd23f',
            color: '#17133b',
            borderRadius: '36px',
            boxShadow: 'var(--sh)',
            padding: '26px',
          }}
          className="spot flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="mono text-xs font-bold text-[#17133b] uppercase tracking-wider">
              Day Streak
            </span>
            <Flame size={18} className="text-[#17133b]" />
          </div>

          <div className="my-auto py-2 text-center">
            <div
              style={{
                fontFamily: "'Bricolage Grotesque', sans-serif",
                fontSize: '56px',
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: '-0.03em',
                color: '#17133b',
              }}
              className="flex items-center justify-center gap-1"
            >
              <span>🔥</span>
              <span>{animatedStreak}</span>
            </div>
            <p className="text-xs font-bold text-[#17133b]/80 mt-1">
              Consecutive days researching
            </p>
          </div>

          <div className="pt-2 border-t border-black/10 text-center text-xs font-mono font-bold text-[#17133b]">
            Active consistency
          </div>
        </div>

        {/* TILE 5: "Continue where you left off" Card (Span 6 / full row) */}
        <div
          style={{
            gridColumn: 'span 6',
            background: 'var(--card)',
            borderRadius: '36px',
            boxShadow: 'var(--sh)',
            padding: '24px 28px',
          }}
          className="spot flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-[color-mix(in_srgb,var(--mute)_18%,transparent)]"
        >
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-[var(--a1)]/15 text-[var(--a1)] flex items-center justify-center shrink-0">
              <Clock size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="mono text-[11px] font-bold text-[var(--a1)] uppercase tracking-wider">
                  Continue where you left off
                </span>
                {recentConv && (
                  <span className="mono text-[10px] text-[var(--mute)]">
                    • Last active session
                  </span>
                )}
              </div>
              <h3 className="text-base sm:text-lg font-bold text-[var(--ink)] mt-0.5">
                {recentConv?.title || recentDoc?.name || 'Inquire your active document collection'}
              </h3>
              <p className="text-xs text-[var(--mute)] mt-0.5">
                {recentDoc
                  ? `Ready folio: ${recentDoc.name} (${recentDoc.pageCount} pages, verified citations)`
                  : 'Open the workspace to resume granular page-level research and verification.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {recentDoc && (
              <button
                type="button"
                onClick={() => onOpenDocument(recentDoc.id)}
                className="btn outline sm"
              >
                <BookOpen size={14} className="text-[var(--a2)]" />
                <span>Open Document</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className="btn sm"
            >
              <span>Resume Inquiry</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
