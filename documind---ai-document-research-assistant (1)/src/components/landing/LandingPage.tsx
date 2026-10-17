import React from 'react';
import {
  FileText,
  ShieldCheck,
  Search,
  BookOpen,
  ArrowRight,
  Layers,
  Lock,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Library,
  ExternalLink,
} from 'lucide-react';

interface LandingPageProps {
  onStartResearching: () => void;
  onExploreFeatures: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onStartResearching,
  onExploreFeatures,
}) => {
  return (
    <div className="flex-1 overflow-y-auto bg-[#111113] text-[#f2efeb]">
      {/* HERO SECTION */}
      <section id="hero" className="relative pt-16 pb-16 px-4 md:px-8 max-w-5xl mx-auto text-center w-full">
        {/* Archival Kicker */}
        <div className="flex flex-wrap items-center justify-center gap-2 font-mono text-[11px] text-[#f2efeb]/60 tracking-widest uppercase mb-5">
          <span>Technical Research Terminal</span>
          <span aria-hidden="true">·</span>
          <span>Local Browser Storage</span>
          <span aria-hidden="true">·</span>
          <span className="text-[#ff4d00]">Page-Level Provenance</span>
        </div>

        {/* Hero Title */}
        <h1 className="font-syne text-3xl sm:text-5xl md:text-6xl font-extrabold text-[#f2efeb] tracking-[-0.03em] uppercase leading-[1.05] mb-6 max-w-3xl mx-auto break-words">
          A technical research interface for documents that demand proof.
        </h1>

        {/* Subtitle */}
        <p className="font-sans text-base sm:text-lg text-[#f2efeb]/70 max-w-2xl mx-auto mb-8 leading-relaxed">
          Upload primary source PDFs, pose investigative questions, and inspect evidence with interactive page-anchored citations. When a fact cannot be proven, DocuMind abstains.
        </p>

        {/* Rectilinear CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-14">
          <button
            type="button"
            onClick={onStartResearching}
            className="inline-flex items-center gap-2 bg-[#ff4d00] hover:bg-[#ff6622] text-white px-6 py-3 rounded-[2px] font-syne font-bold text-sm uppercase tracking-tight shadow-xs transition-colors cursor-pointer"
          >
            <span>Start Researching</span>
            <ArrowRight size={15} />
          </button>
          <button
            type="button"
            onClick={onExploreFeatures}
            className="inline-flex items-center gap-2 bg-[#18181a] hover:bg-[#222226] text-[#f2efeb] px-6 py-3 rounded-[2px] font-syne font-bold text-sm uppercase tracking-tight border border-[rgba(242,239,235,0.15)] shadow-xs transition-colors cursor-pointer"
          >
            <span>Inspect Corpus Library</span>
          </button>
        </div>

        {/* TECHNICAL WORKSPACE EXCERPT */}
        <div className="bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.15)] shadow-xl overflow-hidden text-left max-w-4xl mx-auto w-full">
          {/* Header */}
          <div className="px-5 py-3 bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-mono text-[#f2efeb]/60 min-w-0">
              <BookOpen size={14} className="text-[#ff4d00] shrink-0" />
              <span className="font-semibold text-[#f2efeb] shrink-0">EXCERPT FOLIO #0418</span>
              <span className="hidden sm:inline truncate">· 10-K_Annual_Report_2024.pdf (Page 14)</span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-[#4ade80] shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[#4ade80]" />
              <span>VERIFIED VERBATIM</span>
            </div>
          </div>

          {/* Typeset Workspace Content */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[rgba(242,239,235,0.1)]">
            {/* Left: Query & Synthesis */}
            <div className="p-6 space-y-4 bg-[#18181a]">
              <div className="text-xs font-mono uppercase tracking-wider text-[#f2efeb]/50 font-semibold">
                Investigative Prompt
              </div>
              <div className="p-3 bg-[#0e0e0f] border border-[rgba(242,239,235,0.12)] rounded-[2px] text-xs font-medium text-[#f2efeb] break-words">
                “What was the consolidated net revenue growth reported in the fiscal filings?”
              </div>

              <div className="space-y-2 pt-1">
                <div className="text-xs font-mono uppercase tracking-wider text-[#f2efeb]/50 font-semibold">
                  Synthesized Answer & Citation Ledger
                </div>
                <div className="text-xs text-[#f2efeb] leading-relaxed p-3.5 bg-[#141416] border border-[rgba(242,239,235,0.1)] rounded-[2px] break-words">
                  <p className="mb-2">
                    Consolidated net revenue expanded to <strong>$4.82 billion</strong>, representing a 14.3% annual increase over prior operating benchmarks{' '}
                    <span className="inline-flex items-center font-mono font-bold text-xs text-[#ff4d00] bg-[#ff4d00]/15 px-1 py-0.2 rounded-[2px] border border-[#ff4d00]/30 cursor-pointer">
                      [1]
                    </span>
                    . Continued revenue velocity was anchored by international enterprise subscriptions{' '}
                    <span className="inline-flex items-center font-mono font-bold text-xs text-[#ff4d00] bg-[#ff4d00]/15 px-1 py-0.2 rounded-[2px] border border-[#ff4d00]/30 cursor-pointer">
                      [2]
                    </span>
                    .
                  </p>
                  <div className="flex items-center gap-2 pt-2 border-t border-[rgba(242,239,235,0.08)] font-mono text-[11px] text-[#f2efeb]/50">
                    <span className="text-[#ff4d00] font-bold">[1]</span>
                    <span className="truncate">10-K_Annual_Report_2024.pdf</span>
                    <span className="text-[#4ade80] ml-auto">p.14</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Original Source Text */}
            <div className="p-6 bg-[#141416] flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between text-xs font-mono text-[#f2efeb]/50 mb-2 uppercase tracking-wider">
                  <span>Primary Source Text</span>
                  <span className="text-[#ff4d00]">Page 14 · ¶ 3</span>
                </div>
                <div className="p-4 bg-[#18181a] border border-[rgba(242,239,235,0.1)] rounded-[2px] text-xs font-sans text-[#f2efeb]/80 leading-[1.7] select-none break-words">
                  <p className="text-[#f2efeb]/60">
                    Operating results across our enterprise divisions reflected sustained global demand throughout the four fiscal quarters. Specifically,{' '}
                    <mark className="bg-[rgba(255,77,0,0.2)] text-[#ff7733] border border-[#ff4d00]/40 px-1 py-0.5 font-medium not-italic rounded-[2px]">
                      total consolidated revenue expanded to $4,821 million, an increase of 14.3% compared to the prior fiscal year
                    </mark>
                    , supported by consistent renewals in high-tier commercial cloud software.
                  </p>
                </div>
              </div>

              <div className="p-2.5 bg-[#0e0e0f] border border-[rgba(242,239,235,0.1)] rounded-[2px] flex items-center justify-between text-[11px] font-mono text-[#f2efeb]/60">
                <span>TOKEN MATCH: 100%</span>
                <span className="text-[#4ade80]">VERIFIED IN CODE</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ASYMMETRIC EDITORIAL LAYOUT */}
      <section id="architecture" className="py-14 px-4 md:px-8 max-w-5xl mx-auto border-t border-[rgba(242,239,235,0.1)] w-full">
        <div className="mb-10 text-left">
          <span className="font-mono text-xs uppercase tracking-wider text-[#ff4d00] block mb-1 font-semibold">
            Archival Architecture
          </span>
          <h2 className="font-syne text-2xl sm:text-3xl font-extrabold uppercase text-[#f2efeb]">
            Engineered for strict epistemic integrity
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* TALL CASE STUDY (7 columns) */}
          <div className="lg:col-span-7 bg-[#18181a] p-7 rounded-[4px] border border-[rgba(242,239,235,0.1)] flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-[#f2efeb]/60 mb-3 uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-[#ff4d00]" />
                <span>Case Study · The Abstention Threshold</span>
              </div>
              <h3 className="font-syne text-xl font-bold uppercase text-[#f2efeb] mb-3">
                When proof does not exist, silence is the only honest answer.
              </h3>
              <p className="text-xs text-[#f2efeb]/70 leading-relaxed mb-4 font-sans">
                Conventional AI assistants guess or fill gaps with synthetic plausibility. DocuMind executes an epistemic safety invariant: before submitting any text to synthesis, retrieved vector passages must exceed an empirical relevance gate (cosine similarity ≥ 0.45).
              </p>

              {/* Sample Abstention Card */}
              <div className="p-4 bg-[#0e0e0f] border border-[rgba(242,239,235,0.1)] rounded-[2px] space-y-2 mb-4">
                <div className="flex items-center justify-between text-xs font-mono text-[#ff7733]">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle size={13} />
                    <span className="font-semibold uppercase tracking-wider">Insufficient Evidence</span>
                  </div>
                  <span>Max Score: 0.31</span>
                </div>
                <p className="text-xs text-[#f2efeb]/80 italic font-mono break-words">
                  “The provided documents do not contain evidence regarding quantum encryption patents in FY24. DocuMind refrains from generating an ungrounded response.”
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-[rgba(242,239,235,0.08)] flex items-center justify-between text-xs font-mono text-[#f2efeb]/50">
              <span>EPISTEMIC DISCIPLINE</span>
              <span className="text-[#ff4d00] font-semibold">Zero Hallucinations</span>
            </div>
          </div>

          {/* TWO SHORT RULES (5 columns) */}
          <div className="lg:col-span-5 flex flex-col gap-6">
            {/* Rule 01 */}
            <div className="flex-1 bg-[#18181a] p-6 rounded-[4px] border border-[rgba(242,239,235,0.1)] flex flex-col justify-between">
              <div>
                <div className="font-mono text-xs font-bold text-[#ff4d00] mb-2 uppercase tracking-wider">
                  01 · Code-Level Quote Matching
                </div>
                <h4 className="font-syne text-base font-bold text-[#f2efeb] uppercase mb-2">
                  Never take the model's word for it.
                </h4>
                <p className="text-xs text-[#f2efeb]/70 leading-relaxed font-sans">
                  Every citation returned by Gemini is re-checked by client code against the raw extracted PDF page text. If a quote cannot be verified verbatim, it is marked as an unverified quote.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[rgba(242,239,235,0.08)] font-mono text-[11px] text-[#4ade80]">
                <span>✓ Algorithmic Verification</span>
              </div>
            </div>

            {/* Rule 02 */}
            <div className="flex-1 bg-[#18181a] p-6 rounded-[4px] border border-[rgba(242,239,235,0.1)] flex flex-col justify-between">
              <div>
                <div className="font-mono text-xs font-bold text-[#ff4d00] mb-2 uppercase tracking-wider">
                  02 · Browser-First Persistence
                </div>
                <h4 className="font-syne text-base font-bold text-[#f2efeb] uppercase mb-2">
                  Local storage in your browser's IndexedDB.
                </h4>
                <p className="text-xs text-[#f2efeb]/70 leading-relaxed font-sans">
                  PDF documents, page chunks, text vectors, and conversation histories are stored safely inside your browser using IndexedDB. Reloading or navigating preserves your entire corpus.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[rgba(242,239,235,0.08)] font-mono text-[11px] text-[#f2efeb]/50">
                <span>✓ Local IndexedDB Engine</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PROTOCOL BAND */}
      <section id="protocol" className="bg-[#0e0e0f] text-[#f2efeb] py-14 px-4 md:px-8 border-y border-[rgba(242,239,235,0.1)] w-full">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 pb-6 border-b border-[rgba(242,239,235,0.1)] gap-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-wider text-[#ff4d00] block mb-1 font-semibold">
                The 4-Stage Protocol
              </span>
              <h2 className="font-syne text-2xl sm:text-3xl font-extrabold uppercase text-[#f2efeb]">
                How DocuMind guarantees provenance
              </h2>
            </div>
            <button
              type="button"
              onClick={onStartResearching}
              className="inline-flex items-center gap-2 bg-[#ff4d00] hover:bg-[#ff6622] text-white px-4 py-2 rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight transition-colors cursor-pointer self-start md:self-auto"
            >
              <span>Launch Terminal</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-4 bg-[#18181a] border border-[rgba(242,239,235,0.1)] rounded-[4px]">
              <span className="font-mono text-xs text-[#ff4d00] block mb-2 font-bold">Stage 01</span>
              <h4 className="font-syne text-sm font-bold text-[#f2efeb] uppercase mb-1.5">Page-Level Partition</h4>
              <p className="text-xs text-[#f2efeb]/70 leading-relaxed font-sans">
                PDF.js extracts text page-by-page. Text chunks (~800 characters) never cross page boundaries, guaranteeing 100% page pointer fidelity.
              </p>
            </div>

            <div className="p-4 bg-[#18181a] border border-[rgba(242,239,235,0.1)] rounded-[4px]">
              <span className="font-mono text-xs text-[#ff4d00] block mb-2 font-bold">Stage 02</span>
              <h4 className="font-syne text-sm font-bold text-[#f2efeb] uppercase mb-1.5">Hybrid Retrieval</h4>
              <p className="text-xs text-[#f2efeb]/70 leading-relaxed font-sans">
                Queries are matched using 88% high-dimensional vector similarity plus 12% lexical token coverage to capture technical terms and names.
              </p>
            </div>

            <div className="p-4 bg-[#18181a] border border-[rgba(242,239,235,0.1)] rounded-[4px]">
              <span className="font-mono text-xs text-[#ff4d00] block mb-2 font-bold">Stage 03</span>
              <h4 className="font-syne text-sm font-bold text-[#f2efeb] uppercase mb-1.5">Relevance Gating</h4>
              <p className="text-xs text-[#f2efeb]/70 leading-relaxed font-sans">
                If the maximum semantic score is beneath 0.45, DocuMind refrains from speculation and generates an explicit, reasoned abstention.
              </p>
            </div>

            <div className="p-4 bg-[#18181a] border border-[rgba(242,239,235,0.1)] rounded-[4px]">
              <span className="font-mono text-xs text-[#ff4d00] block mb-2 font-bold">Stage 04</span>
              <h4 className="font-syne text-sm font-bold text-[#f2efeb] uppercase mb-1.5">Verbatim Validation</h4>
              <p className="text-xs text-[#f2efeb]/70 leading-relaxed font-sans">
                Every extracted quote in the response is checked against raw source passage text. Citations jump to the exact page in the viewer.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER WITH COMPREHENSIVE LINKS */}
      <footer id="footer" className="py-10 px-4 md:px-8 border-t border-[rgba(242,239,235,0.1)] bg-[#0e0e0f] text-xs text-[#f2efeb]/60 w-full">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 pb-6 border-b border-[rgba(242,239,235,0.08)]">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-[2px] bg-[#ff4d00] flex items-center justify-center text-white shrink-0">
                <BookOpen size={13} />
              </div>
              <span className="font-syne font-extrabold text-base text-[#f2efeb] uppercase">
                Docu<span className="text-[#ff4d00]">Mind</span>
              </span>
              <span className="font-mono text-[11px] text-[#f2efeb]/40">· Technical Research Interface</span>
            </div>

            {/* In-Page Anchor Links */}
            <div className="flex flex-wrap items-center gap-4 font-mono text-[11px]">
              <a href="#hero" className="text-[#f2efeb]/70 hover:text-[#ff4d00] transition-colors">
                # Overview
              </a>
              <a href="#architecture" className="text-[#f2efeb]/70 hover:text-[#ff4d00] transition-colors">
                # Architecture
              </a>
              <a href="#protocol" className="text-[#f2efeb]/70 hover:text-[#ff4d00] transition-colors">
                # Protocol
              </a>
              <a
                href="mailto:research@documind.local"
                className="text-[#f2efeb]/70 hover:text-[#ff4d00] transition-colors"
              >
                Inquiries
              </a>
            </div>
          </div>

          {/* External Reference Documentation Links */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 font-mono text-[11px] text-[#f2efeb]/50">
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-[#f2efeb]/30">TECHNICAL REFERENCES:</span>
              <a
                href="https://ai.google.dev/gemini-api/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#ff4d00] transition-colors inline-flex items-center gap-1 underline underline-offset-2"
              >
                <span>Gemini API Docs</span>
                <ExternalLink size={10} />
              </a>
              <a
                href="https://github.com/mozilla/pdf.js"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#ff4d00] transition-colors inline-flex items-center gap-1 underline underline-offset-2"
              >
                <span>Mozilla PDF.js</span>
                <ExternalLink size={10} />
              </a>
              <a
                href="https://www.w3.org/TR/IndexedDB-3/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#ff4d00] transition-colors inline-flex items-center gap-1 underline underline-offset-2"
              >
                <span>W3C IndexedDB Spec</span>
                <ExternalLink size={10} />
              </a>
            </div>

            <div className="text-[#f2efeb]/40">
              Zero External Tracking · Pure Browser Storage
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
