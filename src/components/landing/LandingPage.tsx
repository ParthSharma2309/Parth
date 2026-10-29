import React from 'react';
import {
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Zap,
  Bookmark,
  CheckCircle2,
  FileText,
  ScanText,
} from 'lucide-react';

interface LandingPageProps {
  onStartResearching: () => void;
  onExploreFeatures: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartResearching,
  onExploreFeatures,
}) => {
  const marqueePhrases = [
    '✦ Streaming Answers with SSE',
    '✦ Page-Level Verifiable Citations',
    '✦ Hybrid BM25 & Dense RRF Search',
    '✦ Gemini Vision OCR Fallback',
    '✦ Honest Abstention Above 0.45 Floor',
    '✦ Local IndexedDB Persistence',
    '✦ Curated Research Notebook',
    '✦ 100% Client-Side Privacy',
  ];

  return (
    <div className="w-full text-[var(--ink)] select-none">
      {/* 1. MESH-GRADIENT HERO */}
      <section className="pt-2 sm:pt-4 pb-12 w-full reveal">
        <div
          style={{
            borderRadius: '40px',
            boxShadow: 'var(--sh)',
          }}
          className="spot mesh-gradient-hero p-8 sm:p-12 lg:p-16 border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] relative overflow-hidden"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-8 items-center relative z-10">
            {/* Left Column: Headline and Actions */}
            <div className="lg:col-span-7 space-y-6 text-left">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--glass)] backdrop-blur-md border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] text-xs font-semibold text-[var(--a1)] shadow-2xs">
                <Sparkles size={14} className="text-[var(--a2)]" />
                <span>Next-Gen Scholarly Research Terminal</span>
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-[var(--ink)] leading-[1.05] tracking-tight">
                Research that holds documents <span className="ser">accountable</span>
              </h1>

              <p className="text-base sm:text-lg text-[var(--mute)] leading-relaxed max-w-xl">
                Stream rigorous analytical answers grounded in real PDF folios. Inspect exact page
                citations, verify source quotes with highlighter precision, and rely on honest
                abstention when evidence is insufficient.
              </p>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onStartResearching}
                  className="btn"
                >
                  <span>Open Reading Room</span>
                  <ArrowRight size={18} />
                </button>

                <button
                  type="button"
                  onClick={onExploreFeatures}
                  className="btn outline"
                >
                  <span>Explore Document Folio</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-3 text-xs text-[var(--mute)]">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-[var(--teal)]" />
                  <span>Sub-second Hybrid BM25</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-[var(--a2)]" />
                  <span>Real-time SSE Streaming</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-[var(--sun)]" />
                  <span>IndexedDB Local Privacy</span>
                </div>
              </div>
            </div>

            {/* Right Column: Floating Verified-Answer Card with Rotating Gradient Border */}
            <div className="lg:col-span-5 flex justify-center">
              <div
                style={{
                  borderRadius: '36px',
                  boxShadow: 'var(--sh)',
                }}
                className="spot rotating-border-card p-6 sm:p-7 w-full max-w-md space-y-4"
              >
                {/* Card Top Pill */}
                <div className="flex items-center justify-between pb-3 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="p-1 rounded-full bg-[var(--a1)]/15 text-[var(--a1)]">
                      <FileText size={14} />
                    </span>
                    <span className="text-xs font-bold text-[var(--ink)] truncate max-w-[140px]">
                      Quarterly_Report_Q3.pdf
                    </span>
                    <span className="mono text-[11px]">p. 24</span>
                  </div>

                  <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full bg-[var(--teal)]/15 text-[var(--teal)] text-xs font-bold">
                    <CheckCircle2 size={12} />
                    <span>Verified</span>
                  </span>
                </div>

                {/* Question */}
                <div className="space-y-1">
                  <span className="mono text-[11px] block">
                    Inquiry Query
                  </span>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    "What was the operating margin expansion reported in Q3?"
                  </p>
                </div>

                {/* Synthesized Answer with Yellow Highlighter & Pink Citation */}
                <div className="p-4 rounded-3xl bg-[var(--card)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] text-xs text-[var(--ink)] leading-relaxed space-y-2">
                  <p>
                    Consolidated operating margin expanded by{' '}
                    <mark className="bg-[var(--sun)]/35 text-[var(--ink)] px-1.5 py-0.5 rounded-full font-medium">
                      340 basis points year-over-year
                    </mark>{' '}
                    driven by automated processing efficiency{' '}
                    <span className="citation-pill">
                      [1]
                    </span>
                    .
                  </p>
                </div>

                {/* Evidence Quote Box */}
                <div className="p-3.5 rounded-2xl bg-[var(--glass)] border border-[color-mix(in_srgb,var(--mute)_16%,transparent)] text-[11px] text-[var(--mute)] space-y-1">
                  <div className="mono text-[10px] text-[var(--a2)] font-semibold">
                    SOURCE PASSAGE [1] • PAGE 24
                  </div>
                  <p className="italic">
                    "...operating margin reached 24.8%, representing a 340 bps expansion..."
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. TILTED INFINITE MARQUEE STRIP */}
      <div className="py-6 overflow-hidden -rotate-1 bg-gradient-to-r from-[var(--a1)] via-[var(--a2)] to-[var(--tang)] text-white shadow-md my-4">
        <div className="marquee-strip font-bold text-sm tracking-wide flex items-center gap-8">
          {[...marqueePhrases, ...marqueePhrases, ...marqueePhrases].map((phrase, i) => (
            <span key={i} className="shrink-0 flex items-center gap-2">
              {phrase}
            </span>
          ))}
        </div>
      </div>

      {/* 3. 6-COLUMN BENTO GRID WITH ASYMMETRIC ORGANIC TILES */}
      <section className="py-16 px-4 sm:px-6 md:px-8 max-w-7xl mx-auto w-full reveal">
        <div className="text-center max-w-2xl mx-auto mb-12 space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--teal)]/15 text-[var(--teal)] text-xs font-semibold mono">
            Architecture Pillars
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-[var(--ink)] tracking-tight">
            Designed for <span className="ser">evidence</span>, not hallucinations
          </h2>
          <p className="text-sm sm:text-base text-[var(--mute)]">
            Four foundational systems engineered to give researchers trustworthy conclusions.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
          {/* Bento Tile 1: Tangerine - Hybrid BM25 & Dense RRF (Span 3) */}
          <div
            style={{
              borderRadius: '36px 100px 36px 36px',
              boxShadow: 'var(--sh)',
            }}
            className="spot md:col-span-3 p-8 sm:p-10 bg-[var(--card)] border-2 border-[var(--tang)]/30 hover:border-[var(--tang)] transition-all space-y-4"
          >
            <div className="w-12 h-12 rounded-full bg-[var(--tang)]/15 text-[var(--tang)] flex items-center justify-center">
              <Zap size={24} />
            </div>
            <h3 className="text-2xl font-bold text-[var(--ink)]">
              Hybrid BM25 & Dense RRF
            </h3>
            <p className="text-sm text-[var(--mute)] leading-relaxed">
              Combines sparse BM25 term weighting with Gemini vector embeddings using Reciprocal
              Rank Fusion. Catch exact numerical figures, acronyms, and high-level conceptual themes
              simultaneously.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs mono text-[var(--tang)]">
              <span>Reciprocal Rank Fusion</span>
              <span>•</span>
              <span>k = 60</span>
            </div>
          </div>

          {/* Bento Tile 2: Teal - Verifiable Citations (Span 3) */}
          <div
            style={{
              borderRadius: '100px 36px 36px 36px',
              boxShadow: 'var(--sh)',
            }}
            className="spot md:col-span-3 p-8 sm:p-10 bg-[var(--card)] border-2 border-[var(--teal)]/30 hover:border-[var(--teal)] transition-all space-y-4"
          >
            <div className="w-12 h-12 rounded-full bg-[var(--teal)]/15 text-[var(--teal)] flex items-center justify-center">
              <ShieldCheck size={24} />
            </div>
            <h3 className="text-2xl font-bold text-[var(--ink)]">
              Citation Verification Protocol
            </h3>
            <p className="text-sm text-[var(--mute)] leading-relaxed">
              Every synthesized claim is cross-checked against source passage text. If a quote
              deviates or cannot be grounded, it is clearly tagged as unverified. Zero unchecked
              extrapolations.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs mono text-[var(--teal)]">
              <span>Verbatim substring match</span>
              <span>•</span>
              <span>Page anchors</span>
            </div>
          </div>

          {/* Bento Tile 3: Pink - Vision OCR Fallback (Span 3) */}
          <div
            style={{
              borderRadius: '36px 36px 100px 36px',
              boxShadow: 'var(--sh)',
            }}
            className="spot md:col-span-3 p-8 sm:p-10 bg-[var(--card)] border-2 border-[var(--a2)]/30 hover:border-[var(--a2)] transition-all space-y-4"
          >
            <div className="w-12 h-12 rounded-full bg-[var(--a2)]/15 text-[var(--a2)] flex items-center justify-center">
              <ScanText size={24} />
            </div>
            <h3 className="text-2xl font-bold text-[var(--ink)]">
              Gemini Vision OCR Fallback
            </h3>
            <p className="text-sm text-[var(--mute)] leading-relaxed">
              When encountering scanned sheets, charts, or pages with fewer than 50 characters,
              DocuMind renders the page and extracts text via Gemini Vision, transparently tagging
              passages with an OCR badge.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs mono text-[var(--a2)]">
              <span>&lt;50 char auto-detect</span>
              <span>•</span>
              <span>Visual diagram parsing</span>
            </div>
          </div>

          {/* Bento Tile 4: Sun / Blue - Honest Abstention (Span 3) */}
          <div
            style={{
              borderRadius: '36px 36px 36px 100px',
              boxShadow: 'var(--sh)',
            }}
            className="spot md:col-span-3 p-8 sm:p-10 bg-[var(--card)] border-2 border-[var(--sun)]/40 hover:border-[var(--sun)] transition-all space-y-4"
          >
            <div className="w-12 h-12 rounded-full bg-[var(--sun)]/20 text-[var(--ink)] flex items-center justify-center">
              <Bookmark size={24} />
            </div>
            <h3 className="text-2xl font-bold text-[var(--ink)]">
              Configurable Abstention Gate
            </h3>
            <p className="text-sm text-[var(--mute)] leading-relaxed">
              If the top retrieval score falls below the 0.45 similarity threshold, DocuMind refrains
              from guessing. You get an honest notice, keeping false positives out of your research.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs mono text-[var(--a1)]">
              <span>0.45 Cosine threshold</span>
              <span>•</span>
              <span>Zero-hallucination bias</span>
            </div>
          </div>
        </div>

        {/* Bottom Call to Action */}
        <div className="mt-16 text-center">
          <button
            type="button"
            onClick={onStartResearching}
            className="btn"
          >
            <span>Launch Research Studio</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </section>
    </div>
  );
};
