import React, { useState } from 'react';
import {
  FileText,
  Search,
  Plus,
  Trash2,
  ExternalLink,
  FolderPlus,
  Folder,
  RotateCcw,
  Calendar,
  Layers,
  Check,
  Edit2,
  AlertCircle,
  FileQuestion,
  Filter,
} from 'lucide-react';
import { DocumentRecord, CollectionRecord } from '../../types/index.ts';
import { StatusBadge } from '../ui/Badge.tsx';
import { Dropzone } from './Dropzone.tsx';
import { Modal } from '../ui/Modal.tsx';
import {
  deleteDocument,
  saveCollection,
  deleteCollection,
  updateDocumentStatus,
} from '../../services/storage.ts';
import { retryProcessDocument } from '../../services/docProcessor.ts';

interface DocumentLibraryProps {
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  onRefresh: () => void;
  onOpenDocumentInWorkspace: (docId: string) => void;
}

export const DocumentLibrary: React.FC<DocumentLibraryProps> = ({
  documents,
  collections,
  onRefresh,
  onOpenDocumentInWorkspace,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCollectionFilter, setSelectedCollectionFilter] = useState<string>('all');
  const [showUploadZone, setShowUploadZone] = useState<boolean>(true);

  // Modal states
  const [docToDelete, setDocToDelete] = useState<DocumentRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const [showNewCollectionModal, setShowNewCollectionModal] = useState<boolean>(false);
  const [newCollectionName, setNewCollectionName] = useState<string>('');

  const [assigningDoc, setAssigningDoc] = useState<DocumentRecord | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');

  const [retryingDocId, setRetryingDocId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  // Filter documents
  const filteredDocs = documents.filter((doc) => {
    const matchesSearch = doc.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCollection =
      selectedCollectionFilter === 'all' ||
      (selectedCollectionFilter === 'unassigned' && !doc.collectionId) ||
      doc.collectionId === selectedCollectionFilter;
    return matchesSearch && matchesCollection;
  });

  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    setIsDeleting(true);
    try {
      await deleteDocument(docToDelete.id);
      setDocToDelete(null);
      onRefresh();
    } catch (err) {
      console.error('Failed to delete document:', err);
    } finally {
      setIsDeleting(false);
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
  };

  const handleDeleteCollection = async (colId: string) => {
    try {
      await deleteCollection(colId);
      if (selectedCollectionFilter === colId) {
        setSelectedCollectionFilter('all');
      }
      onRefresh();
    } catch (err) {
      console.error('Failed to delete collection:', err);
    }
  };

  const handleAssignCollection = async () => {
    if (!assigningDoc) return;
    try {
      await updateDocumentStatus(assigningDoc.id, {
        collectionId: selectedCollectionId || undefined,
      });
      setAssigningDoc(null);
      onRefresh();
    } catch (err) {
      console.error('Failed to assign collection:', err);
    }
  };

  const handleRetry = async (docId: string) => {
    setRetryingDocId(docId);
    setRetryError(null);
    try {
      await retryProcessDocument(docId);
      onRefresh();
    } catch (err: any) {
      setRetryError(`Retry failed: ${err.message || 'Unknown error'}`);
    } finally {
      setRetryingDocId(null);
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return 'Unknown size';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  };

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full bg-[#111113] text-[#f2efeb]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-[rgba(242,239,235,0.1)]">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-[#ff4d00] block mb-1 font-semibold">
            Corpus Ledger
          </span>
          <h1 className="font-syne text-2xl md:text-3xl font-extrabold text-[#f2efeb] uppercase tracking-tight">
            Document Folio & Collections
          </h1>
          <p className="text-xs md:text-sm text-[#f2efeb]/60 mt-1 font-sans">
            Manage your primary research PDFs, organise collections, and inspect page chunk indexing.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowNewCollectionModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#18181a] hover:bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] font-syne font-bold text-xs uppercase text-[#f2efeb] shadow-xs transition-colors cursor-pointer"
          >
            <FolderPlus size={14} className="text-[#ff4d00]" />
            <span>New Collection</span>
          </button>
          <button
            type="button"
            onClick={() => setShowUploadZone(!showUploadZone)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#ff4d00] hover:bg-[#ff6622] text-white rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight shadow-xs transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <span>{showUploadZone ? 'Hide Ingestion Box' : 'Upload PDF'}</span>
          </button>
        </div>
      </div>

      {/* Dismissible Retry Error Banner */}
      {retryError && (
        <div className="mb-6 p-3.5 rounded-[4px] border border-[#ef4444]/30 bg-[#ef4444]/15 text-[#f87171] flex items-center justify-between text-xs font-mono shadow-xs">
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{retryError}</span>
          </div>
          <button
            type="button"
            onClick={() => setRetryError(null)}
            className="text-xs font-mono px-2 py-0.5 rounded bg-black/30 hover:bg-black/50 text-white cursor-pointer ml-3 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Upload Zone */}
      {showUploadZone && (
        <div className="mb-8">
          <Dropzone
            onUploadSuccess={() => onRefresh()}
            onUploadError={() => onRefresh()}
          />
        </div>
      )}

      {/* Collection tabs & search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6 bg-[#0e0e0f] p-3 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs min-w-0 max-w-full">
        {/* Collections filter */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => setSelectedCollectionFilter('all')}
            className={`chip shrink-0 ${
              selectedCollectionFilter === 'all' ? 'active' : ''
            }`}
          >
            All Docs ({documents.length})
          </button>

          {collections.map((col) => {
            const count = documents.filter((d) => d.collectionId === col.id).length;
            const isSelected = selectedCollectionFilter === col.id;
            return (
              <div key={col.id} className="relative group shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedCollectionFilter(col.id)}
                  className={`chip flex items-center gap-1.5 shrink-0 ${
                    isSelected ? 'active' : ''
                  }`}
                >
                  <Folder size={12} className={isSelected ? 'text-white' : 'text-[#ff4d00]'} />
                  <span>{col.name}</span>
                  <span className="font-mono text-[10px] opacity-80">({count})</span>
                </button>
              </div>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="relative w-full md:w-auto md:min-w-[240px]">
          <Search size={14} className="absolute left-3 top-2.5 text-[#f2efeb]/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter folio by filename..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#18181a] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] placeholder-[#f2efeb]/40 focus:outline-hidden transition-all"
          />
        </div>
      </div>

      {/* Document Grid */}
      {filteredDocs.length === 0 ? (
        <div className="text-center py-16 bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.1)] p-8 shadow-xs">
          <div className="w-10 h-10 rounded-[2px] bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] flex items-center justify-center text-[#f2efeb]/40 mx-auto mb-3">
            <FileText size={20} />
          </div>
          <h3 className="font-syne text-base font-bold text-[#f2efeb] uppercase tracking-tight">No documents found</h3>
          <p className="text-xs font-mono text-[#f2efeb]/50 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No folio documents matching "${searchQuery}".`
              : 'Ingest your first PDF document to begin research.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDocs.map((doc) => {
            const collection = collections.find((c) => c.id === doc.collectionId);
            const isRetrying = retryingDocId === doc.id;

            return (
              <div
                key={doc.id}
                className="bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.1)] hover:border-[#ff4d00]/50 p-5 shadow-xs transition-all duration-150 flex flex-col justify-between"
              >
                <div>
                  {/* Top line: Status Badge & Collection */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <StatusBadge
                      status={
                        !doc.hasExtractableText
                          ? 'No Text'
                          : doc.status
                      }
                      size="sm"
                      customText={
                        doc.status === 'Processing' && doc.progress
                          ? `Processing ${doc.progress}%`
                          : undefined
                      }
                    />

                    {collection && (
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#ff4d00] bg-[#ff4d00]/10 px-2 py-0.5 rounded-[2px] border border-[#ff4d00]/30 truncate max-w-[140px]">
                        <Folder size={10} className="shrink-0" />
                        <span className="truncate">{collection.name}</span>
                      </span>
                    )}
                  </div>

                  {/* Title */}
                  <h3
                    className="font-sans text-sm font-semibold text-[#f2efeb] line-clamp-2 mb-2"
                    title={doc.name}
                  >
                    {doc.name}
                  </h3>

                  {/* Meta stats */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[#f2efeb]/50 mb-4 font-mono">
                    <span>{doc.pageCount} {doc.pageCount === 1 ? 'page' : 'pages'}</span>
                    <span>·</span>
                    <span>{formatSize(doc.size)}</span>
                    <span>·</span>
                    <span>{formatDate(doc.uploadedAt)}</span>
                  </div>

                  {/* Extraction / Error message info */}
                  {doc.status === 'Failed' && doc.statusMessage && (
                    <div className="mb-4 p-2.5 bg-[#ef4444]/15 border border-[#ef4444]/30 rounded-[2px] text-[11px] font-mono text-[#f87171]">
                      <p className="font-semibold mb-0.5">
                        {doc.statusMessage.toLowerCase().includes('quota') ||
                        doc.statusMessage.toLowerCase().includes('rate limit') ||
                        doc.statusMessage.includes('429')
                          ? 'Quota / Rate Limit Notice:'
                          : 'Processing Notice:'}
                      </p>
                      <p className="leading-relaxed font-sans">{doc.statusMessage}</p>
                    </div>
                  )}

                  {doc.status === 'Processing' && (
                    <div className="mb-4">
                      <div className="w-full bg-[rgba(242,239,235,0.1)] rounded-[2px] h-1 overflow-hidden mb-1">
                        <div
                          className="bg-[#ff4d00] h-1 rounded-[2px] transition-all duration-200"
                          style={{ width: `${doc.progress || 10}%` }}
                        />
                      </div>
                      <p className="font-mono text-[11px] text-[#f2efeb]/50 italic">
                        {doc.statusMessage || 'Processing...'}
                      </p>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-[rgba(242,239,235,0.08)] flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    {doc.status === 'Ready' && (
                      <button
                        type="button"
                        onClick={() => onOpenDocumentInWorkspace(doc.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ff4d00] hover:bg-[#ff6622] text-white rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight transition-colors cursor-pointer"
                      >
                        <ExternalLink size={12} />
                        <span>Research</span>
                      </button>
                    )}

                    {doc.status === 'Failed' && (
                      <button
                        type="button"
                        onClick={() => handleRetry(doc.id)}
                        disabled={isRetrying}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#ff4d00]/15 hover:bg-[#ff4d00]/25 text-[#ff7733] border border-[#ff4d00]/30 rounded-[2px] font-mono text-xs font-semibold transition-colors cursor-pointer"
                      >
                        <RotateCcw size={12} className={isRetrying ? 'animate-spin' : ''} />
                        <span>{isRetrying ? 'Retrying...' : 'Retry'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setAssigningDoc(doc);
                        setSelectedCollectionId(doc.collectionId || '');
                      }}
                      className="p-1.5 text-[#f2efeb]/60 hover:text-[#f2efeb] hover:bg-[#222226] rounded-[2px] transition-colors cursor-pointer"
                      title="Assign collection"
                    >
                      <Folder size={14} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDocToDelete(doc)}
                    className="p-1.5 text-[#f2efeb]/50 hover:text-[#ff6b6b] hover:bg-[#ef4444]/10 rounded-[2px] transition-colors cursor-pointer"
                    title="Delete document"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!docToDelete}
        onClose={() => setDocToDelete(null)}
        title="Delete Folio Document"
        description="Permanently remove this document and its IndexedDB embeddings"
        footer={
          <>
            <button
              type="button"
              onClick={() => setDocToDelete(null)}
              className="px-3.5 py-2 text-xs font-mono font-medium text-[#f2efeb] bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] hover:bg-[#2c2c30] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
              className="px-3.5 py-2 text-xs font-mono font-semibold text-white bg-[#ef4444] rounded-[2px] hover:bg-[#dc2626] disabled:opacity-50 cursor-pointer"
            >
              {isDeleting ? 'Deleting...' : 'Delete Document'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[#f2efeb]">
          Are you sure you want to delete{' '}
          <strong className="font-semibold text-white">{docToDelete?.name}</strong>?
        </p>
        <p className="text-xs text-[#f2efeb]/60 mt-2 font-mono">
          This will purge the stored PDF blob, text chunks, and embedding vectors from IndexedDB. Existing conversation citations that cite this document will be retained and flagged as <span className="font-semibold text-[#ff7733]">"Source Deleted"</span>.
        </p>
      </Modal>

      {/* New Collection Modal */}
      <Modal
        isOpen={showNewCollectionModal}
        onClose={() => setShowNewCollectionModal(false)}
        title="Create Collection"
        description="Organize folio documents into thematic archives"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowNewCollectionModal(false)}
              className="px-3.5 py-2 text-xs font-mono font-medium text-[#f2efeb] bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] hover:bg-[#2c2c30] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateCollection}
              disabled={!newCollectionName.trim()}
              className="px-3.5 py-2 text-xs font-syne font-bold uppercase tracking-tight text-white bg-[#ff4d00] rounded-[2px] hover:bg-[#ff6622] disabled:opacity-50 cursor-pointer"
            >
              Create Collection
            </button>
          </>
        }
      >
        <form onSubmit={handleCreateCollection}>
          <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1.5 font-semibold">
            Collection Name
          </label>
          <input
            type="text"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            placeholder="e.g. Legal Briefs, Financial Disclosures, Technical Papers"
            className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] placeholder-[#f2efeb]/40 focus:outline-hidden"
            autoFocus
          />
        </form>
      </Modal>

      {/* Assign Collection Modal */}
      <Modal
        isOpen={!!assigningDoc}
        onClose={() => setAssigningDoc(null)}
        title="Assign Folio Collection"
        description={`Set collection folder for "${assigningDoc?.name}"`}
        footer={
          <>
            <button
              type="button"
              onClick={() => setAssigningDoc(null)}
              className="px-3.5 py-2 text-xs font-mono font-medium text-[#f2efeb] bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] hover:bg-[#2c2c30] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAssignCollection}
              className="px-3.5 py-2 text-xs font-syne font-bold uppercase tracking-tight text-white bg-[#ff4d00] rounded-[2px] hover:bg-[#ff6622] cursor-pointer"
            >
              Save Assignment
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1.5 font-semibold">
            Select Target Collection
          </label>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <button
              type="button"
              onClick={() => setSelectedCollectionId('')}
              className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono rounded-[2px] transition-colors cursor-pointer ${
                !selectedCollectionId
                  ? 'bg-[#ff4d00] text-white font-semibold'
                  : 'bg-[#18181a] hover:bg-[#222226] text-[#f2efeb] border border-[rgba(242,239,235,0.15)]'
              }`}
            >
              <span>None (Unassigned)</span>
              {!selectedCollectionId && <Check size={14} />}
            </button>

            {collections.map((col) => {
              const isSelected = selectedCollectionId === col.id;
              return (
                <button
                  key={col.id}
                  type="button"
                  onClick={() => setSelectedCollectionId(col.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-mono rounded-[2px] transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[#ff4d00] text-white font-semibold'
                      : 'bg-[#18181a] hover:bg-[#222226] text-[#f2efeb] border border-[rgba(242,239,235,0.15)]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Folder size={14} className={isSelected ? 'text-white' : 'text-[#ff4d00]'} />
                    <span>{col.name}</span>
                  </div>
                  {isSelected && <Check size={14} />}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
};
