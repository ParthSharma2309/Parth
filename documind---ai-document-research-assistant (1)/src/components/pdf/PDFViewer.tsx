import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Copy,
  Check,
  FileText,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { Citation } from '../../types/index.ts';
import { StatusBadge } from '../ui/Badge.tsx';

interface PDFViewerProps {
  blob?: Blob;
  documentName?: string;
  initialPage?: number;
  activeCitation?: Citation | null;
  onCloseCitation?: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  blob,
  documentName = 'Document',
  initialPage = 1,
  activeCitation,
  onCloseCitation,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.1);
  const [loading, setLoading] = useState<boolean>(true);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [isImageDoc, setIsImageDoc] = useState<boolean>(false);

  const renderTaskRef = useRef<any>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);

  // Jump to citation page when active citation changes
  useEffect(() => {
    if (activeCitation?.pageNumber && pdfDoc) {
      const page = Math.min(Math.max(activeCitation.pageNumber, 1), pdfDoc.numPages);
      setCurrentPage(page);
    }
  }, [activeCitation, pdfDoc]);

  // Load PDF Document or Image when blob changes
  useEffect(() => {
    let isCancelled = false;
    let loadedDoc: pdfjsLib.PDFDocumentProxy | null = null;

    if (!blob) {
      setPdfDoc(null);
      setIsImageDoc(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setRenderError(null);

    const isImage =
      blob.type.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(documentName);

    if (isImage) {
      setIsImageDoc(true);
      setPdfDoc(null);
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      img.onload = () => {
        if (!isCancelled) {
          imageElementRef.current = img;
          setTotalPages(1);
          setCurrentPage(1);
          setLoading(false);
        }
      };
      img.onerror = () => {
        if (!isCancelled) {
          setRenderError('Failed to display image document.');
          setLoading(false);
        }
      };
      img.src = objectUrl;

      return () => {
        isCancelled = true;
        URL.revokeObjectURL(objectUrl);
      };
    }

    setIsImageDoc(false);
    const loadPDF = async () => {
      try {
        const buffer = await blob.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(buffer),
          useSystemFonts: true,
        });

        const doc = await loadingTask.promise;
        if (!isCancelled) {
          loadedDoc = doc;
          setPdfDoc(doc);
          setTotalPages(doc.numPages);
          const target = activeCitation?.pageNumber ?? initialPage;
          const validPage = target > 0 && target <= doc.numPages ? target : 1;
          setCurrentPage(validPage);
          setLoading(false);
        } else {
          (doc as any).destroy?.() || doc.cleanup?.();
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Error loading PDF document:', err);
          setRenderError(err.message || 'Failed to render PDF document');
          setLoading(false);
        }
      }
    };

    loadPDF();

    return () => {
      isCancelled = true;
      if (loadedDoc) {
        (loadedDoc as any).destroy?.() || loadedDoc.cleanup?.();
      }
    };
  }, [blob, documentName]);

  // Render current page or image to canvas
  const renderPage = useCallback(
    async (pageNum: number) => {
      if (!canvasRef.current) return;

      if (isImageDoc && imageElementRef.current) {
        const img = imageElementRef.current;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        const baseWidth = Math.min(img.naturalWidth || 800, 800);
        const aspect = (img.naturalHeight || 600) / (img.naturalWidth || 800);
        const width = baseWidth * scale;
        const height = width * aspect;
        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(width * outputScale);
        canvas.height = Math.floor(height * outputScale);
        canvas.style.width = `${Math.floor(width)}px`;
        canvas.style.height = `${Math.floor(height)}px`;

        context.save();
        context.scale(outputScale, outputScale);
        context.drawImage(img, 0, 0, width, height);
        context.restore();
        return;
      }

      if (!pdfDoc) return;

      // Cancel previous in-flight render task if any
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore cancel error
        }
        renderTaskRef.current = null;
      }

      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Retina display scaling
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

        const renderContext = {
          canvasContext: context,
          canvas: canvas as any,
          transform,
          viewport,
        };

        const task = page.render(renderContext);
        renderTaskRef.current = task;
        await task.promise;
        renderTaskRef.current = null;
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Page render error:', err);
        }
      }
    },
    [pdfDoc, isImageDoc, scale]
  );

  useEffect(() => {
    if ((pdfDoc && currentPage > 0) || (isImageDoc && imageElementRef.current)) {
      renderPage(currentPage);
    }
  }, [pdfDoc, isImageDoc, currentPage, scale, renderPage]);

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage((p) => p - 1);
  };

  const handleNextPage = () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) setCurrentPage((p) => p + 1);
  };

  const handleZoomIn = () => {
    setScale((s) => Math.min(s + 0.2, 2.5));
  };

  const handleZoomOut = () => {
    setScale((s) => Math.max(s - 0.2, 0.6));
  };

  const handleResetZoom = () => {
    setScale(1.1);
  };

  const handleCopyQuote = async () => {
    if (!activeCitation?.quote) return;
    try {
      await navigator.clipboard.writeText(activeCitation.quote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = activeCitation.quote;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!blob) {
    return (
      <div className="viewer-pane h-full flex flex-col items-center justify-center p-8 text-center bg-[#18181a] select-none">
        <div className="viewer-placeholder">
          <div style={{ opacity: 0.3, marginBottom: '20px' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
            </svg>
          </div>
          <h3 className="font-syne text-base font-bold text-[#f2efeb] mb-2 uppercase tracking-tight">PDF Folio Viewer</h3>
          <p className="font-sans text-xs text-[#f2efeb]/60 leading-relaxed">
            Select a document from your library or click any citation marker <span className="font-mono text-[#ff4d00] font-bold">[n]</span> to inspect the verbatim folio page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#18181a] select-none text-[#f2efeb]">
      {/* Top Toolbar */}
      <div className="px-3 sm:px-4 py-2 bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] flex flex-wrap items-center justify-between gap-2 shadow-xs shrink-0 min-w-0 max-w-full">
        <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
          <FileText size={15} className="text-[#ff4d00] shrink-0" />
          <span className="text-xs font-semibold text-[#f2efeb] truncate font-mono" title={documentName}>
            {documentName}
          </span>
        </div>

        {/* Page Nav & Zoom Controls */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <div className="flex items-center bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[4px] p-0.5">
            <button
              type="button"
              onClick={handlePrevPage}
              disabled={currentPage <= 1 || loading}
              className="p-1 text-[#f2efeb]/60 hover:text-[#f2efeb] disabled:opacity-30 rounded-[3px] transition-colors cursor-pointer"
              title="Previous Page"
              aria-label="Previous Page"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="text-xs font-medium text-[#f2efeb] px-1.5 sm:px-2 min-w-[55px] sm:min-w-[65px] text-center font-mono">
              {currentPage} / {totalPages || 1}
            </span>
            <button
              type="button"
              onClick={handleNextPage}
              disabled={currentPage >= totalPages || loading}
              className="p-1 text-[#f2efeb]/60 hover:text-[#f2efeb] disabled:opacity-30 rounded-[3px] transition-colors cursor-pointer"
              title="Next Page"
              aria-label="Next Page"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[4px] p-0.5">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 text-[#f2efeb]/60 hover:text-[#f2efeb] rounded-[3px] transition-colors cursor-pointer"
              title="Zoom Out"
              aria-label="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-1.5 text-[11px] font-mono text-[#f2efeb]/60 hover:text-[#f2efeb] rounded-[3px] transition-colors cursor-pointer"
              title="Reset Zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 text-[#f2efeb]/60 hover:text-[#f2efeb] rounded-[3px] transition-colors cursor-pointer"
              title="Zoom In"
              aria-label="Zoom In"
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Supporting Excerpt Card */}
      {activeCitation && (
        <div className="bg-[#141416] border-b border-[rgba(242,239,235,0.1)] p-3.5 shrink-0 animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[rgba(242,239,235,0.1)] min-w-0 max-w-full">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <span className="font-mono font-bold text-xs bg-[#ff4d00] text-white px-2 py-0.5 rounded-[2px] shadow-xs shrink-0">
                [{activeCitation.marker}]
              </span>
              <span className="font-mono text-xs font-semibold text-[#f2efeb]">
                Page {activeCitation.pageNumber}
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
                className="flex items-center gap-1 text-[11px] font-medium text-[#f2efeb]/70 hover:text-[#f2efeb] bg-[#18181a] hover:bg-[#222226] px-2 py-1 rounded-[4px] border border-[rgba(242,239,235,0.15)] transition-colors cursor-pointer font-mono"
                title="Copy excerpt quote"
              >
                {copied ? <Check size={12} className="text-[#2F6B4F]" /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              {onCloseCitation && (
                <button
                  type="button"
                  onClick={onCloseCitation}
                  className="text-xs text-[#f2efeb]/50 hover:text-[#f2efeb] px-1 py-0.5 rounded-[4px] transition-colors cursor-pointer"
                  title="Dismiss excerpt view"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="text-xs text-[#f2efeb] leading-[1.65] max-h-28 overflow-y-auto bg-[rgba(255,77,0,0.1)] p-2.5 rounded-none border-l-2 border-[#ff4d00] font-sans italic">
            "{activeCitation.quote}"
          </div>

          {!activeCitation.verified && !activeCitation.sourceDeleted && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#A16207] bg-[#A16207]/10 px-2 py-1 rounded-[4px] border border-[#A16207]/20 font-mono">
              <AlertTriangle size={12} className="shrink-0" />
              <span>
                Note: Quote was synthesized or could not be verified verbatim on this page.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Main Canvas Area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex items-start justify-center bg-[#111113]"
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-[#f2efeb]/50 gap-2">
            <div className="w-8 h-8 border-2 border-[rgba(242,239,235,0.1)] border-t-[#ff4d00] rounded-full animate-spin" />
            <span className="font-mono text-xs text-[#f2efeb]/60">Rendering page {currentPage}...</span>
          </div>
        ) : renderError ? (
          <div className="bg-[#9F1239]/10 border border-[#9F1239]/30 p-4 rounded-[4px] text-center max-w-md my-8">
            <AlertTriangle size={20} className="text-[#9F1239] mx-auto mb-2" />
            <h4 className="font-syne text-sm font-semibold text-[#9F1239] mb-1">Viewer Notice</h4>
            <p className="text-xs text-[#9F1239]">{renderError}</p>
          </div>
        ) : (
          <div className="relative shadow-md rounded-none overflow-hidden bg-white border border-[rgba(242,239,235,0.2)] transition-transform duration-100">
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`${documentName}, page ${currentPage} of ${totalPages}`}
              className="block max-w-none"
            />
          </div>
        )}
      </div>
    </div>
  );
};
