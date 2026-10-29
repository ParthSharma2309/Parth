import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileText,
  AlertTriangle,
  Copy,
  Check,
  X,
  Search,
  PanelLeft,
  ArrowUp,
  ArrowDown,
  Loader2,
  Download,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import { Citation, DocumentRecord } from '../../types/index.ts';
import { StatusBadge } from '../ui/Badge.tsx';

// Configure PDF.js worker
if (typeof window !== 'undefined') {
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  } catch {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  }
}

interface PDFViewerProps {
  blob: Blob | null | undefined;
  documentName?: string;
  activeCitation?: Citation | null;
  onCloseCitation?: () => void;
  onCloseDesk: () => void;
  allDocuments?: DocumentRecord[];
  currentDocumentId?: string;
  onSelectDocument?: (docId: string) => void;
  initialPage?: number;
  onPageChange?: (docId: string, pageNumber: number) => void;
  onDownload?: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  blob,
  documentName = 'Document',
  activeCitation,
  onCloseCitation,
  onCloseDesk,
  allDocuments = [],
  currentDocumentId,
  onSelectDocument,
  initialPage = 1,
  onPageChange,
  onDownload,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const baseViewportWidth = useRef<number>(600);
  const cachedPdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [pageInput, setPageInput] = useState<string>(String(initialPage));
  const [totalPages, setTotalPages] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.15);
  const [loading, setLoading] = useState<boolean>(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Search & Thumbnails State
  const [showThumbnails, setShowThumbnails] = useState<boolean>(false);
  const [showSearchBar, setShowSearchBar] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchMatches, setSearchMatches] = useState<Array<{ pageNumber: number; count: number }>>([]);
  const [currentMatchIdx, setCurrentMatchIdx] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // When initialPage or document changes, jump to that page
  useEffect(() => {
    if (activeCitation && activeCitation.pageNumber) {
      setCurrentPage(activeCitation.pageNumber);
      setPageInput(String(activeCitation.pageNumber));
    } else if (initialPage) {
      setCurrentPage(initialPage);
      setPageInput(String(initialPage));
    }
  }, [activeCitation, initialPage, currentDocumentId]);

  // Keep page input synchronized with currentPage
  useEffect(() => {
    setPageInput(String(currentPage));
    if (currentDocumentId && onPageChange) {
      onPageChange(currentDocumentId, currentPage);
    }
  }, [currentPage, currentDocumentId, onPageChange]);

  // Load PDF Document & render page
  const renderCurrentPage = useCallback(async () => {
    if (!blob) return;

    setLoading(true);
    setRenderError(null);

    let pdfDoc = cachedPdfDocRef.current;
    try {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (!pdfDoc) {
        const arrayBuffer = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
          useWorkerFetch: false,
          useSystemFonts: true,
        });
        pdfDoc = await loadingTask.promise;
        cachedPdfDocRef.current = pdfDoc;
        setTotalPages(pdfDoc.numPages);
      }

      const safePage = Math.max(1, Math.min(currentPage, pdfDoc.numPages));
      const page = await pdfDoc.getPage(safePage);
      const viewport = page.getViewport({ scale });
      baseViewportWidth.current = page.getViewport({ scale: 1 }).width;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) return;

      context.fillStyle = '#FFFFFF';
      context.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: context,
        canvas: canvas as any,
        viewport,
      });
      await renderTask.promise;
    } catch (err: any) {
      console.error('Failed to render PDF page:', err);
      setRenderError(err.message || 'Failed to render PDF page');
    } finally {
      setLoading(false);
    }
  }, [blob, currentPage, scale]);

  // Re-cache document if blob changes
  useEffect(() => {
    cachedPdfDocRef.current = null;
    setSearchMatches([]);
    setSearchQuery('');
  }, [blob]);

  useEffect(() => {
    renderCurrentPage();
  }, [renderCurrentPage]);

  // Page Navigation Handlers
  const handlePrevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(1, prev - 1));
  }, []);

  const handleNextPage = useCallback(() => {
    setCurrentPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const handlePageInputSubmit = (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    const val = parseInt(pageInput, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setCurrentPage(val);
    } else {
      setPageInput(String(currentPage));
    }
  };

  // Zoom Controls
  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(Number((prev + 0.2).toFixed(2)), 2.6));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(Number((prev - 0.2).toFixed(2)), 0.6));
  }, []);

  const handleFitWidth = useCallback(() => {
    if (containerRef.current && baseViewportWidth.current > 0) {
      const containerWidth = containerRef.current.clientWidth - 56;
      const calculated = containerWidth / baseViewportWidth.current;
      setScale(Math.max(0.65, Math.min(2.5, Number(calculated.toFixed(2)))));
    } else {
      setScale(1.15);
    }
  }, []);

  // Keyboard Shortcuts: Left/Right flip, +/- zoom, Esc closes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if (e.key === 'Escape') {
        e.preventDefault();
        if (isInput) {
          target.blur();
        }
        onCloseDesk();
        return;
      }

      if (isInput) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrevPage();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNextPage();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        handleZoomOut();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePrevPage, handleNextPage, handleZoomIn, handleZoomOut, onCloseDesk]);

  // Copy Citation Quote
  const handleCopyQuote = async () => {
    if (!activeCitation?.quote) return;
    try {
      await navigator.clipboard.writeText(activeCitation.quote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // In-document Text Search
  const handleSearch = async (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q || !cachedPdfDocRef.current) {
      setSearchMatches([]);
      setCurrentMatchIdx(0);
      return;
    }
    setIsSearching(true);
    try {
      const pdf = cachedPdfDocRef.current;
      const matches: Array<{ pageNumber: number; count: number }> = [];

      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const fullText = textContent.items
          .map((item: any) => ('str' in item ? item.str : ''))
          .join(' ')
          .toLowerCase();

        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const count = (fullText.match(new RegExp(escaped, 'gi')) || []).length;
        if (count > 0) {
          matches.push({ pageNumber: p, count });
        }
      }

      setSearchMatches(matches);
      setCurrentMatchIdx(0);
      if (matches.length > 0) {
        setCurrentPage(matches[0].pageNumber);
      }
    } catch (err) {
      console.error('Search in PDF failed:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleNextSearchMatch = () => {
    if (searchMatches.length === 0) return;
    const next = (currentMatchIdx + 1) % searchMatches.length;
    setCurrentMatchIdx(next);
    setCurrentPage(searchMatches[next].pageNumber);
  };

  const handlePrevSearchMatch = () => {
    if (searchMatches.length === 0) return;
    const prev = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIdx(prev);
    setCurrentPage(searchMatches[prev].pageNumber);
  };

  return (
    <div className="desk select-none">
      {/* Top Reading Desk Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 z-20 pb-2 border-b border-white/20">
        {/* Left: Document Switcher Dropdown listing ALL uploaded PDFs */}
        <div className="flex items-center gap-1.5 min-w-0 max-w-[210px] sm:max-w-[260px]">
          <FileText size={15} className="text-white shrink-0" />
          {allDocuments.length > 0 && onSelectDocument ? (
            <select
              value={currentDocumentId || ''}
              onChange={(e) => onSelectDocument(e.target.value)}
              className="w-full text-xs font-semibold text-white bg-white/20 border-0 rounded-full px-3 py-1.5 truncate focus:outline-hidden cursor-pointer"
              title="Switch document without leaving page"
            >
              {allDocuments.map((d) => (
                <option key={d.id} value={d.id} className="text-[var(--ink)] bg-white">
                  {d.name}
                </option>
              ))}
            </select>
          ) : (
            <span
              className="text-xs font-semibold text-white truncate"
              title={documentName}
            >
              {documentName}
            </span>
          )}
        </div>

        {/* Center: Page Controls, Zoom Controls, Search & Thumbnails Toggle */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {/* Thumbnails strip toggle */}
          <button
            type="button"
            onClick={() => setShowThumbnails(!showThumbnails)}
            className={`w-8 h-8 rounded-full transition-colors cursor-pointer border-0 flex items-center justify-center ${
              showThumbnails
                ? 'bg-white text-[var(--a1)]'
                : 'bg-white/20 hover:bg-white/30 text-white'
            }`}
            title={showThumbnails ? 'Hide thumbnail strip' : 'Show thumbnail strip'}
            aria-label="Toggle thumbnails"
          >
            <PanelLeft size={14} />
          </button>

          {/* Search toggle (32px round) */}
          <button
            type="button"
            onClick={() => setShowSearchBar(!showSearchBar)}
            className={`w-8 h-8 rounded-full transition-colors cursor-pointer border-0 flex items-center justify-center ${
              showSearchBar || searchQuery
                ? 'bg-white text-[var(--a1)]'
                : 'bg-white/20 hover:bg-white/30 text-white'
            }`}
            title="Search in document"
            aria-label="Search in document"
          >
            <Search size={14} />
          </button>

          {/* Page navigation with input (32px round prev/next) */}
          <div className="flex items-center bg-white/20 rounded-full px-1 py-0.5">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage <= 1 || loading}
              className="w-8 h-8 rounded-full hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-30 transition-colors cursor-pointer border-0"
              title="Previous Page (←)"
              aria-label="Previous Page"
            >
              <ChevronLeft size={14} />
            </button>

            <form onSubmit={handlePageInputSubmit} className="inline-flex items-center">
              <input
                type="text"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={handlePageInputSubmit}
                className="w-8 text-center text-xs font-mono font-bold bg-transparent text-white focus:outline-hidden rounded py-0.5"
                title="Type page and press Enter"
              />
              <span className="text-xs font-mono text-white/80 pr-1.5 select-none">
                / {totalPages || 1}
              </span>
            </form>

            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage >= totalPages || loading}
              className="w-8 h-8 rounded-full hover:bg-white/30 text-white flex items-center justify-center disabled:opacity-30 transition-colors cursor-pointer border-0"
              title="Next Page (→)"
              aria-label="Next Page"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Zoom Controls & Fit Width (32px round) */}
          <div className="flex items-center bg-white/20 rounded-full px-1 py-0.5">
            <button
              type="button"
              onClick={handleZoomOut}
              className="w-8 h-8 rounded-full hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer border-0"
              title="Zoom Out (-)"
              aria-label="Zoom Out"
            >
              <ZoomOut size={13} />
            </button>
            <button
              type="button"
              onClick={handleFitWidth}
              className="px-1.5 text-xs font-mono text-white/90 hover:text-white transition-colors cursor-pointer"
              title="Fit to Width"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="w-8 h-8 rounded-full hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer border-0"
              title="Zoom In (+)"
              aria-label="Zoom In"
            >
              <ZoomIn size={13} />
            </button>
            <button
              type="button"
              onClick={handleFitWidth}
              className="w-8 h-8 rounded-full hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer border-0 ml-0.5"
              title="Fit Width"
              aria-label="Fit Width"
            >
              <Maximize2 size={12} />
            </button>
          </div>

          {/* Download PDF button (32px round) */}
          <button
            type="button"
            onClick={() => {
              if (onDownload) {
                onDownload();
              } else if (blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = documentName.endsWith('.pdf') ? documentName : `${documentName}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }
            }}
            disabled={!blob && !onDownload}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer border-0 ml-1 disabled:opacity-30"
            title="Download PDF"
            aria-label="Download PDF"
          >
            <Download size={14} />
          </button>

          {/* Prominent Close (X) button (32px round) */}
          <button
            type="button"
            onClick={onCloseDesk}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors cursor-pointer border-0 ml-1"
            title="Close Reading Desk (Esc)"
            aria-label="Close Reading Desk"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* In-Document Search Bar (Expandable) */}
      {showSearchBar && (
        <div className="px-3 py-2 bg-white/15 backdrop-blur-md border border-white/20 rounded-2xl flex items-center justify-between gap-2 text-xs shrink-0 animate-in fade-in slide-in-from-top-1 text-white">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <Search size={14} className="text-white shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                handleSearch(e.target.value);
              }}
              placeholder="Search text in this PDF..."
              className="w-full bg-white/20 border border-white/30 rounded-full px-3 py-1 text-xs text-white placeholder-white/70 focus:outline-hidden focus:bg-white/30"
              autoFocus
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isSearching ? (
              <span className="flex items-center gap-1 font-mono text-[11px] text-white/80">
                <Loader2 size={12} className="animate-spin text-white" />
                Searching...
              </span>
            ) : searchMatches.length > 0 ? (
              <span className="font-mono text-[11px] text-[var(--sun)] font-bold">
                Match {currentMatchIdx + 1} of {searchMatches.length} pages
              </span>
            ) : searchQuery.trim() ? (
              <span className="font-mono text-[11px] text-white/70">No matches</span>
            ) : null}

            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handlePrevSearchMatch}
                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer border-0"
                  title="Previous match"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={handleNextSearchMatch}
                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer border-0"
                  title="Next match"
                >
                  <ArrowDown size={13} />
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowSearchBar(false);
                setSearchQuery('');
                setSearchMatches([]);
              }}
              className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center cursor-pointer border-0 ml-1"
              title="Close search"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Supporting Excerpt Card with Soft Pulse Animation when Citation Active */}
      {activeCitation && (
        <div className="bg-[var(--sun)]/25 border-b-2 border-[var(--sun)] p-3.5 shrink-0 animate-soft-pulse transition-all">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[var(--sun)]/40 min-w-0 max-w-full">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="px-2 py-0.5 rounded-full bg-[var(--pink)] text-white font-mono font-bold text-xs shadow-2xs">
                [{activeCitation.marker}]
              </span>
              <span className="font-serif font-bold text-xs text-[var(--ink)]">
                Excerpt confirmed on page {activeCitation.pageNumber} (visual match)
              </span>
              <StatusBadge
                status={
                  activeCitation.sourceDeleted
                    ? 'Source Deleted'
                    : activeCitation.verified
                    ? 'Verified'
                    : 'Unverified'
                }
                size="sm"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopyQuote}
                className="flex items-center gap-1 text-[11px] font-sans font-medium text-[var(--ink)] bg-[var(--card)] hover:bg-[var(--line)]/30 px-3 py-1 rounded-full border border-[var(--line)] transition-colors cursor-pointer shadow-2xs"
                title="Copy verified quote"
              >
                {copied ? <Check size={11} className="text-[var(--teal)]" /> : <Copy size={11} />}
                <span>{copied ? 'Copied' : 'Copy excerpt'}</span>
              </button>

              {onCloseCitation && (
                <button
                  type="button"
                  onClick={onCloseCitation}
                  className="text-xs text-[var(--muted)] hover:text-[var(--ink)] p-1 rounded-full hover:bg-[var(--line)]/40 transition-colors cursor-pointer"
                  title="Dismiss excerpt banner"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Yellow Highlighted Evidence Quote */}
          <div className="text-xs text-[var(--ink)] leading-relaxed max-h-24 overflow-y-auto bg-white/70 p-2.5 rounded-xl border border-[var(--sun)] font-sans italic">
            "{activeCitation.quote || 'No verbatim excerpt available.'}"
          </div>

          {!activeCitation.verified && !activeCitation.sourceDeleted && (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--stamp-red)] font-sans">
              <AlertTriangle size={13} className="shrink-0" />
              <span>Quote could not be matched verbatim in this page partition.</span>
            </div>
          )}
        </div>
      )}

      {/* Main Workspace Body with Optional Thumbnail Strip and Independent Scroll */}
      <div className="flex-1 min-h-0 flex flex-row overflow-hidden bg-transparent">
        {/* Thumbnail Strip */}
        {showThumbnails && (
          <aside className="w-24 sm:w-28 shrink-0 bg-[var(--card-subtle)] border-r border-[var(--line)] overflow-y-auto overscroll-contain p-2 space-y-2 select-none z-10">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--muted)] px-1 mb-1 font-bold">
              Pages ({totalPages})
            </div>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pNum) => {
              const isSelected = currentPage === pNum;
              return (
                <button
                  key={pNum}
                  type="button"
                  onClick={() => setCurrentPage(pNum)}
                  className={`w-full p-2 rounded-xl text-center transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--blue)] text-white shadow-xs font-bold ring-2 ring-[var(--blue)]/40'
                      : 'bg-[var(--card)] hover:bg-[var(--line)]/50 text-[var(--ink)] border border-[var(--line)]'
                  }`}
                >
                  <div className="text-[10px] font-mono mb-1">p.{pNum}</div>
                  <div className="w-full h-10 rounded border border-dashed border-current/30 flex items-center justify-center text-[10px] opacity-70">
                    <FileText size={15} />
                  </div>
                </button>
              );
            })}
          </aside>
        )}

        {/* PDF Canvas Desk Area: flex:1; min-height:0; overflow-y:auto; render real page on white page card */}
        <div
          ref={containerRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-auto overscroll-contain p-4 sm:p-6 flex items-start justify-center select-none"
        >
          {loading || blob === null ? (
            <div className="flex flex-col items-center justify-center h-64 text-white/80 gap-3">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              <span className="font-mono text-xs">
                {blob === null ? 'Loading document from storage...' : `Rendering page ${currentPage}...`}
              </span>
            </div>
          ) : renderError ? (
            <div className="bg-black/30 border border-white/30 p-5 rounded-2xl text-center max-w-md my-8 text-white">
              <AlertTriangle size={22} className="mx-auto mb-2 text-[var(--sun)]" />
              <h4 className="font-bold text-sm mb-1">PDF Page Render Notice</h4>
              <p className="text-xs text-white/80">{renderError}</p>
            </div>
          ) : !blob ? (
            <div className="bg-black/30 border border-white/30 p-5 rounded-2xl text-center max-w-md my-8 text-white">
              <AlertTriangle size={22} className="mx-auto mb-2 text-[var(--sun)]" />
              <h4 className="font-bold text-sm mb-1">No Document Selected</h4>
              <p className="text-xs text-white/80">Select a document from your library or table of contents to read.</p>
            </div>
          ) : (
            <div
              className="relative bg-white transition-transform duration-200"
              style={{
                borderRadius: '16px 16px 4px 4px',
                transform: 'rotate(0.8deg)',
                boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.5)',
              }}
            >
              <canvas
                ref={canvasRef}
                role="img"
                aria-label={`${documentName}, page ${currentPage} of ${totalPages}`}
                className="block max-w-none"
                style={{ borderRadius: '16px 16px 4px 4px' }}
              />

              {/* When opened from a citation: highlight the excerpt in --sun with a 2-pulse animation */}
              {activeCitation && activeCitation.pageNumber === currentPage && activeCitation.quote && (
                <div
                  className="absolute inset-x-4 top-10 p-3 rounded-xl excerpt-two-pulse text-xs font-serif font-bold text-[var(--ink)] pointer-events-none"
                  style={{
                    border: '1px solid rgba(255, 210, 63, 0.9)',
                    boxShadow: '0 6px 18px rgba(255, 210, 63, 0.6)',
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1 font-mono text-[10px] uppercase tracking-wider text-[var(--ink)] font-bold">
                    <span className="px-1.5 py-0.5 rounded-full bg-[var(--a2)] text-white">[{activeCitation.marker}]</span>
                    <span>VERIFIED CITATION EXCERPT</span>
                  </div>
                  "{activeCitation.quote}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
