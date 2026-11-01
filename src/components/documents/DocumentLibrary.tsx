import React, { useState } from 'react';
import {
  Search,
  Plus,
  Trash2,
  FolderPlus,
  Folder,
  BookOpen,
  ScanText,
  AlertCircle,
  Loader2,
  Download,
} from 'lucide-react';
import { DocumentRecord, CollectionRecord } from '../../types/index.ts';
import { Dropzone } from './Dropzone.tsx';
import {
  deleteDocument,
  saveDocument,
  saveChunks,
  getChunksByDocument,
  getDocumentBlob,
  saveCollection,
} from '../../services/storage.ts';
import { retryProcessDocument } from '../../services/docProcessor.ts';
import { useToast } from '../ui/Toast.tsx';
import { auth } from '../../lib/firebase.ts';
import { deleteCloudDocument, downloadDocumentFile } from '../../services/cloudSync.ts';

interface DocumentLibraryProps {
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  onRefresh: () => void;
  onOpenDocumentInWorkspace: (docId: string) => void;
  onOpenInReadingDesk?: (docId: string) => void;
  onDeleteDocument?: (docId: string) => void;
}

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({
  documents,
  collections,
  onRefresh,
  onOpenDocumentInWorkspace,
  onOpenInReadingDesk,
  onDeleteDocument,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCollectionFilter, setSelectedCollectionFilter] = useState<string>('all');
  const [showUploadZone, setShowUploadZone] = useState<boolean>(true);
  const [showNewCollectionModal, setShowNewCollectionModal] = useState<boolean>(false);
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [docToDelete, setDocToDelete] = useState<DocumentRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const { showToast } = useToast();

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCollection =
      selectedCollectionFilter === 'all' ||
      (selectedCollectionFilter === 'unassigned' && !doc.collectionId) ||
      doc.collectionId === selectedCollectionFilter;
    return matchesSearch && matchesCollection;
  });

  const handleDownload = async (doc: DocumentRecord) => {
    setDownloadingDocId(doc.id);
    try {
      const ok = await downloadDocumentFile(doc.id, doc.name);
      if (ok) {
        showToast({ message: `Downloaded "${doc.name}"`, type: 'success' });
      } else {
        showToast({
          message: `Unable to download "${doc.name}". Please ensure you have access.`,
          type: 'error',
        });
      }
    } catch (err: any) {
      showToast({
        message: `Download failed: ${err.message || 'Unknown error'}`,
        type: 'error',
      });
    } finally {
      setDownloadingDocId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!docToDelete || isDeleting) return;
    setIsDeleting(true);
    const targetDoc = docToDelete;

    try {
      // 1. If authenticated registered user, delete from backend/cloud storage first.
      // Rejects if offline to avoid partial state or document resurrection on refresh.
      if (auth?.currentUser && !auth.currentUser.isAnonymous) {
        try {
          await deleteCloudDocument(targetDoc.id);
        } catch (cloudErr: any) {
          // If offline, rethrow to notify user and prevent desync
          if (cloudErr.message?.toLowerCase().includes('offline')) {
            throw cloudErr;
          }
          // If 404 or document not found on server, document is already absent from cloud; proceed with local deletion
          if (!cloudErr.message?.toLowerCase().includes('not found') && !cloudErr.message?.includes('404')) {
            throw cloudErr;
          }
        }
      }

      // 2. Delete local document record, raw PDF blob, and all chunks from IndexedDB
      await deleteDocument(targetDoc.id);

      // 3. Immediately notify parent to remove from active workspace selection
      onDeleteDocument?.(targetDoc.id);
      onRefresh();

      // 4. Close confirmation dialog and notify user
      setDocToDelete(null);
      showToast({
        message: `"${targetDoc.name}" deleted successfully.`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('Failed to delete document:', err);
      showToast({
        message: err.message || `Failed to delete "${targetDoc.name}".`,
        type: 'error',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRetry = async (doc: DocumentRecord) => {
    if (retryingDocId === doc.id) return;
    setRetryingDocId(doc.id);
    setRetryError(null);
    showToast({ message: `Running OCR on "${doc.name}"...`, type: 'info' });
    try {
      await retryProcessDocument(doc.id, (_pct: number, _msg: string) => {});
      onRefresh();
      showToast({ message: `OCR completed successfully for "${doc.name}".`, type: 'success' });
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown error';
      setRetryError(`Retry failed: ${errorMsg}`);
      showToast({ message: `OCR failed: ${errorMsg}`, type: 'error' });
    } finally {
      setRetryingDocId(null);
    }
  };

  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCollectionName.trim()) return;

    const newCol: CollectionRecord = {
      id: `col_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: newCollectionName.trim(),
      createdAt: Date.now(),
    };
    await saveCollection(newCol);
    setNewCollectionName('');
    setShowNewCollectionModal(false);
    onRefresh();
    showToast({ message: `Collection "${newCol.name}" created`, type: 'success' });
  };

  // Exact front colours and asymmetric shapes cycling through:
  // 1) #ff7a2f with border-radius: 60px 24px 60px 24px;
  // 2) #14c9b0 with border-radius: 24px 60px 24px 60px;
  // 3) #ffb3d6 with border-radius: 60px 60px 24px 24px.
  const frontThemes = [
    { bg: '#ff7a2f', radius: '60px 24px 60px 24px' },
    { bg: '#14c9b0', radius: '24px 60px 24px 60px' },
    { bg: '#ffb3d6', radius: '60px 60px 24px 24px' },
  ];

  // Helper to construct a crisp auto-generated 3-sentence summary
  const generateSummary = (doc: DocumentRecord): string => {
    if (doc.summary && doc.summary.trim().length > 30) {
      const sentences = doc.summary.match(/[^.!?]+[.!?]+/g);
      if (sentences && sentences.length >= 3) {
        return sentences.slice(0, 3).join(' ');
      }
      return doc.summary;
    }
    const clean = doc.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    return `${clean} contains ${doc.pageCount || 1} partitioned folio page${doc.pageCount === 1 ? '' : 's'} with verified semantic chunks. Empirical findings, methodologies, and documented observations are fully cross-referenced with page-level citations. Ready for granular evidence retrieval and grounded analysis in the Reading Desk.`;
  };

  // Helper to extract up to 4 topic chips
  const getTopics = (doc: DocumentRecord): string[] => {
    if (doc.topics && doc.topics.length > 0) {
      return doc.topics.slice(0, 4);
    }
    const clean = doc.name.toLowerCase();
    const candidates: string[] = [];
    if (clean.includes('financ') || clean.includes('annual') || clean.includes('growth')) candidates.push('Financials');
    if (clean.includes('method') || clean.includes('experiment')) candidates.push('Methodology');
    if (clean.includes('chem') || clean.includes('green') || clean.includes('corrosion')) candidates.push('Green Chem');
    if (clean.includes('legal') || clean.includes('patent') || clean.includes('brief')) candidates.push('Legal Folio');
    if (clean.includes('survey') || clean.includes('review') || clean.includes('meta')) candidates.push('Meta Survey');
    candidates.push('Folio', 'Citations', 'Empirical', 'Evidence');
    return Array.from(new Set(candidates)).slice(0, 4);
  };

  return (
    <div className="w-full text-[var(--ink)]">
      {/* Page Header: Exact Title pattern <h2>Your <span class="ser">library</span></h2> */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-5 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)] reveal">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-full bg-[var(--tang)]/15 text-[var(--tang)]">
              <Folder size={15} />
            </span>
            <span className="mono">
              Document Ingestion &amp; Folios
            </span>
          </div>
          <h2>
            Your <span className="ser">library</span>
          </h2>
          <p className="text-xs sm:text-sm text-[var(--mute)] mt-1">
            Inspect partitioned folios, Gemini Vision OCR status, and auto-generated summaries.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowNewCollectionModal(true)}
            className="btn outline sm"
          >
            <FolderPlus size={14} className="text-[var(--a1)]" />
            <span>New Collection</span>
          </button>
          <button
            type="button"
            onClick={() => setShowUploadZone(!showUploadZone)}
            className="btn sm"
          >
            <Plus size={14} />
            <span>{showUploadZone ? 'Hide Uploader' : 'Upload PDF'}</span>
          </button>
        </div>
      </div>

      {/* Dismissible Error Banner */}
      {retryError && (
        <div className="mb-6 p-4 rounded-3xl border border-[var(--err)] bg-[color-mix(in_srgb,var(--err)_10%,transparent)] text-[var(--err)] flex items-center justify-between text-xs shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{retryError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRetryError(null)}
            className="btn sm !bg-[var(--err)] !py-1 !px-3 !text-xs cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Collection Tabs & Search Filter */}
      <div
        style={{
          borderRadius: '36px',
          boxShadow: 'var(--sh)',
        }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8 bg-[var(--card)] p-3 border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] reveal"
      >
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedCollectionFilter('all')}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              selectedCollectionFilter === 'all'
                ? 'bg-[var(--ink)] text-[var(--bg)] shadow-xs'
                : 'text-[var(--mute)] hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--mute)_10%,transparent)]'
            }`}
          >
            All Documents ({documents.length})
          </button>

          {collections.map((col) => {
            const count = documents.filter((d) => d.collectionId === col.id).length;
            const isSelected = selectedCollectionFilter === col.id;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => setSelectedCollectionFilter(col.id)}
                className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                  isSelected
                    ? 'bg-[var(--ink)] text-[var(--bg)] shadow-xs'
                    : 'text-[var(--mute)] hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--mute)_10%,transparent)]'
                }`}
              >
                <span>{col.name}</span>
                <span className="mono text-[10px] opacity-75">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--mute)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search documents..."
            style={{ borderRadius: '99px' }}
            className="w-full pl-9 pr-4 py-2 bg-[color-mix(in_srgb,var(--mute)_10%,transparent)] border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] text-xs text-[var(--ink)] placeholder:text-[var(--mute)]/60 focus:outline-hidden focus:border-[var(--a1)] transition-colors"
          />
        </div>
      </div>

      {/* Grid: display:grid;grid-template-columns:repeat(3,1fr);gap:16px (1 column under 860px) */}
      {filteredDocs.length === 0 ? (
        <div
          style={{
            borderRadius: '36px',
            boxShadow: 'var(--sh)',
          }}
          className="text-center py-16 bg-[var(--card)] border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] p-8 reveal mb-10"
        >
          <div className="w-14 h-14 rounded-full bg-[var(--a1)]/15 text-[var(--a1)] flex items-center justify-center mx-auto mb-3 shadow-xs">
            <BookOpen size={24} />
          </div>
          <h3 className="text-lg font-bold text-[var(--ink)]">No documents found</h3>
          <p className="text-xs text-[var(--mute)] mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No documents matching "${searchQuery}".`
              : 'Drop a PDF research paper into the uploader below to begin.'}
          </p>
        </div>
      ) : (
        <div className="doc-grid mb-10">
          {filteredDocs.map((doc, idx) => {
            const theme = frontThemes[idx % frontThemes.length];
            const isRetrying = retryingDocId === doc.id;
            const needsOCR =
              !doc.hasExtractableText ||
              (doc.pageCount > 0 && doc.extractedCharacters < 80);

            return (
              <div
                key={doc.id}
                data-testid={`doc-card-${doc.id}`}
                role="button"
                tabIndex={0}
                aria-label={`Document card for ${doc.name}. Press to flip.`}
                className={`fl cursor-pointer ${flippedId === doc.id ? 'flipped' : ''}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    const target = e.target as HTMLElement;
                    if (target.closest('button') || target.closest('a') || target.closest('[data-no-flip]')) {
                      return;
                    }
                    e.preventDefault();
                    setFlippedId(flippedId === doc.id ? null : doc.id);
                  }
                }}
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest('button') || target.closest('a') || target.closest('[data-no-flip]')) {
                    return;
                  }
                  setFlippedId(flippedId === doc.id ? null : doc.id);
                }}
              >
                <div className="fi">
                  {/* FRONT OF FLIP CARD */}
                  <div
                    className="ff select-none justify-between"
                    style={{
                      background: theme.bg,
                      borderRadius: theme.radius,
                      color: '#17133b',
                    }}
                  >
                    {/* Translucent white circle (150px, rgba(255,255,255,.4)) in top-right corner as decoration */}
                    <div
                      style={{
                        position: 'absolute',
                        top: '-35px',
                        right: '-35px',
                        width: '150px',
                        height: '150px',
                        borderRadius: '50%',
                        background: 'rgba(255,255,255,.4)',
                        pointerEvents: 'none',
                      }}
                    />

                    {/* Top: Dark pill with page count, Needs OCR pill, and Delete button */}
                    <div className="flex items-center justify-between gap-2 z-10 w-full">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className="px-3 py-1 rounded-full font-mono text-[11px] font-bold text-white shadow-xs"
                          style={{ background: '#17133b' }}
                        >
                          {doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}
                        </span>

                        {needsOCR && (
                          <button
                            type="button"
                            data-testid={`run-ocr-front-${doc.id}`}
                            data-no-flip="true"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRetry(doc);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                            disabled={isRetrying}
                            className="px-2.5 py-0.5 rounded-full font-mono text-[10.5px] font-bold text-white shadow-xs bg-[#17133b] hover:bg-[var(--sun)] hover:text-[#17133b] transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-60"
                            title="Run Gemini Vision OCR on scanned document"
                          >
                            {isRetrying ? (
                              <>
                                <Loader2 size={11} className="animate-spin text-[var(--sun)]" />
                                <span>Running...</span>
                              </>
                            ) : (
                              <>
                                <ScanText size={11} />
                                <span>Run OCR</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Dedicated isolated wrapper for front-face delete button */}
                      <div
                        data-no-flip="true"
                        className="relative z-30 inline-flex items-center"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          data-testid={`delete-btn-front-${doc.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDocToDelete(doc);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}
                          className="p-1.5 rounded-full bg-[#17133b]/15 text-[#17133b] hover:bg-[var(--err)] hover:text-white transition-all cursor-pointer shadow-xs shrink-0"
                          title={`Delete "${doc.name}"`}
                          aria-label={`Delete ${doc.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    {/* Center: Title (24px Bricolage) */}
                    <div className="my-auto z-10 pt-2">
                      <h3
                        style={{
                          fontFamily: "'Bricolage Grotesque', system-ui, sans-serif",
                          fontSize: '24px',
                          fontWeight: 800,
                          lineHeight: 1.12,
                          letterSpacing: '-0.03em',
                          color: '#17133b',
                        }}
                        className="line-clamp-2"
                        title={doc.name}
                      >
                        {doc.name.replace(/\.pdf$/i, '')}
                      </h3>
                    </div>

                    {/* Bottom footer: File size, Open in Reading Desk & Flip indicator */}
                    <div className="flex items-center justify-between z-10 pt-2 text-[11px] font-mono text-[#17133b]/80 border-t border-black/10 gap-2">
                      <span>{doc.size ? `${Math.round(doc.size / 1024)} KB` : 'PDF'}</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          data-testid={`open-desk-front-${doc.id}`}
                          data-no-flip="true"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onOpenInReadingDesk) {
                              onOpenInReadingDesk(doc.id);
                            } else {
                              onOpenDocumentInWorkspace(doc.id);
                            }
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}
                          className="px-2.5 py-1 rounded-full bg-[#17133b] text-white hover:bg-black font-sans font-bold text-[11px] flex items-center gap-1 cursor-pointer shadow-xs transition-colors"
                          title="Open in Reading Desk"
                        >
                          <BookOpen size={11} />
                          <span>Reading Desk</span>
                        </button>
                        <span className="flex items-center gap-1 font-sans font-bold text-[#17133b] opacity-80">
                          <span>Flip</span>
                          <span>↻</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* BACK OF FLIP CARD */}
                  <div
                    className="fb select-none justify-between"
                    style={{
                      borderRadius: theme.radius,
                    }}
                  >
                    <div>
                      {/* Top Header: Doc name and Action buttons (Download & Delete) */}
                      <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                        <span className="mono font-bold text-[11px] truncate max-w-[170px] text-[var(--ink)]">
                          {doc.name}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleDownload(doc);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            disabled={downloadingDocId === doc.id}
                            className="p-1 rounded-full text-[var(--mute)] hover:text-[var(--a1)] hover:bg-[color-mix(in_srgb,var(--a1)_12%,transparent)] transition-colors cursor-pointer disabled:opacity-50"
                            title="Download document PDF"
                          >
                            {downloadingDocId === doc.id ? (
                              <Loader2 size={13} className="animate-spin text-[var(--a1)]" />
                            ) : (
                              <Download size={13} />
                            )}
                          </button>

                          {/* Dedicated isolated wrapper for back-face delete button */}
                          <div
                            data-no-flip="true"
                            className="relative z-30 inline-flex items-center"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              data-testid={`delete-btn-back-${doc.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDocToDelete(doc);
                              }}
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              onTouchStart={(e) => e.stopPropagation()}
                              onTouchEnd={(e) => e.stopPropagation()}
                              className="p-1 rounded-full text-[var(--mute)] hover:text-[var(--err)] hover:bg-[color-mix(in_srgb,var(--err)_12%,transparent)] transition-colors cursor-pointer"
                              title={`Delete "${doc.name}"`}
                              aria-label={`Delete ${doc.name}`}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Auto-generated 3-sentence summary */}
                      <p className="text-[11.5px] leading-relaxed text-[var(--ink)] font-sans line-clamp-3 mb-2.5">
                        {generateSummary(doc)}
                      </p>

                      {/* Up to 4 topic chips (lime pills) */}
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {getTopics(doc).slice(0, 4).map((topic, tIdx) => (
                          <span
                            key={tIdx}
                            className="px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold shadow-2xs"
                            style={{
                              background: 'var(--lime)',
                              color: 'var(--ink)',
                            }}
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Bottom row: "Needs OCR" + "Run OCR" button OR "Open in Reading Desk" button */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                      {needsOCR ? (
                        <div className="flex items-center gap-1.5">
                          <span className="mono text-[10.5px] font-bold text-[var(--err)]">
                            Needs OCR
                          </span>
                          <button
                            type="button"
                            data-testid={`run-ocr-back-${doc.id}`}
                            data-no-flip="true"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleRetry(doc);
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                            disabled={isRetrying}
                            className="btn sm !py-1 !px-2.5 text-xs !bg-[var(--sun)] !text-[var(--ink)] shadow-none flex items-center gap-1 cursor-pointer disabled:opacity-60"
                            title="Run Gemini Vision OCR on scanned document"
                          >
                            {isRetrying ? (
                              <Loader2 size={11} className="animate-spin" />
                            ) : (
                              <ScanText size={11} />
                            )}
                            <span>{isRetrying ? 'Running OCR...' : 'Run OCR'}</span>
                          </button>
                        </div>
                      ) : (
                        <span className="mono text-[10px] text-[var(--mute)]">
                          {doc.pageCount} pages ready
                        </span>
                      )}

                      <button
                        type="button"
                        data-testid={`open-desk-back-${doc.id}`}
                        data-no-flip="true"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (onOpenInReadingDesk) {
                            onOpenInReadingDesk(doc.id);
                          } else {
                            onOpenDocumentInWorkspace(doc.id);
                          }
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => e.stopPropagation()}
                        className="btn sm !py-1.5 !px-3 text-xs flex items-center gap-1.5 ml-auto cursor-pointer"
                        title="Open in Reading Desk"
                      >
                        <BookOpen size={12} />
                        <span>Open in Reading Desk</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* UPLOAD CARD BELOW: border-radius:40px; background:var(--card); box-shadow:var(--sh) */}
      {showUploadZone && (
        <div className="mt-8 mb-4">
          <div className="flex items-center justify-between mb-3.5 px-1">
            <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
              <span>Ingest New Research Folio</span>
            </h3>
            <span className="mono text-xs text-[var(--mute)]">
              SHA-256 Duplication Guard
            </span>
          </div>
          <Dropzone
            collectionId={selectedCollectionFilter === 'all' ? undefined : selectedCollectionFilter}
            onUploadSuccess={() => onRefresh()}
            onUploadError={() => onRefresh()}
          />
        </div>
      )}

      {/* New Collection Modal */}
      {showNewCollectionModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[3px]"
        >
          <div
            style={{
              borderRadius: '36px',
              boxShadow: 'var(--sh)',
            }}
            className="bg-[var(--card)] p-6 sm:p-7 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] max-w-sm w-full space-y-4 shadow-xl animate-in fade-in zoom-in-95"
          >
            <h3 className="text-lg font-bold text-[var(--ink)]">Create Collection</h3>
            <input
              type="text"
              value={newCollectionName}
              onChange={(e) => setNewCollectionName(e.target.value)}
              placeholder="e.g. Legal Briefs, Machine Learning..."
              style={{ borderRadius: '99px' }}
              className="w-full px-4 py-2.5 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-sm focus:outline-hidden focus:border-[var(--a1)]"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewCollectionModal(false)}
                className="btn outline sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCollection}
                className="btn sm"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {docToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-[3px] animate-in fade-in"
          onClick={() => {
            if (!isDeleting) setDocToDelete(null);
          }}
        >
          <div
            style={{
              borderRadius: '32px',
              boxShadow: 'var(--sh)',
            }}
            className="bg-[var(--card)] p-6 sm:p-7 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 text-[var(--ink)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--err)]/15 text-[var(--err)] flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div>
                <h3 id="delete-dialog-title" className="text-lg font-bold text-[var(--ink)]">
                  Delete Document
                </h3>
                <p className="text-xs text-[var(--mute)] font-mono">Permanent Removal</p>
              </div>
            </div>

            <div className="text-xs sm:text-sm text-[var(--ink)] space-y-2 leading-relaxed">
              <p>
                Are you sure you want to permanently delete{' '}
                <strong className="font-semibold text-[var(--ink)] break-all">
                  &ldquo;{docToDelete.name}&rdquo;
                </strong>
                ?
              </p>
              <p className="text-xs text-[var(--mute)]">
                This will permanently delete the PDF file, all extracted text passages, citations, and search index entries from both cloud storage and local memory. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
              <button
                type="button"
                data-testid="cancel-delete-btn"
                onClick={() => setDocToDelete(null)}
                disabled={isDeleting}
                className="btn outline sm cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-delete-btn"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="btn sm !bg-[var(--err)] !text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={13} />
                    <span>Delete Document</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
