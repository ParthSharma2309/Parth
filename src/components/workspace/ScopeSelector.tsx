import React, { useState } from 'react';
import {
  Layers,
  Folder,
  FileText,
  ChevronDown,
  Check,
  CheckSquare,
  Square,
  Eye,
} from 'lucide-react';
import { DocumentRecord, CollectionRecord, RetrievalScope } from '../../types/index.ts';

interface ScopeSelectorProps {
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  scope: RetrievalScope;
  onChangeScope: (newScope: RetrievalScope) => void;
  onOpenDocumentInDesk?: (docId: string) => void;
}

export const ScopeSelector: React.FC<ScopeSelectorProps> = ({
  documents,
  collections,
  scope,
  onChangeScope,
  onOpenDocumentInDesk,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const readyDocs = documents.filter((d) => String(d.status).toLowerCase() === 'ready');

  const getScopeLabel = () => {
    if (scope.type === 'all') {
      return `All documents (${readyDocs.length})`;
    }
    if (scope.type === 'collection') {
      const col = collections.find((c) => c.id === scope.collectionId);
      const count = readyDocs.filter((d) => d.collectionId === scope.collectionId).length;
      return `Collection: ${col?.name || 'Unknown'} (${count})`;
    }
    if (scope.type === 'selected') {
      return `Custom selection (${scope.documentIds.length} of ${readyDocs.length})`;
    }
    return 'Research scope';
  };

  const handleToggleDoc = (docId: string) => {
    let currentSelected: string[] = [];
    if (scope.type === 'selected') {
      currentSelected = [...scope.documentIds];
      if (currentSelected.includes(docId)) {
        currentSelected = currentSelected.filter((id) => id !== docId);
      } else {
        currentSelected.push(docId);
      }
    } else {
      currentSelected = [docId];
    }

    if (currentSelected.length === 0) {
      onChangeScope({ type: 'selected', documentIds: [docId] });
    } else if (currentSelected.length === readyDocs.length) {
      onChangeScope({ type: 'all' });
    } else {
      onChangeScope({ type: 'selected', documentIds: currentSelected });
    }
  };

  const handleSelectAll = () => {
    onChangeScope({ type: 'all' });
  };

  return (
    <div className="relative w-full max-w-full min-w-0 font-sans">
      <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-1 px-1">
        <span className="font-serif italic">Inquiry scope</span>
        <span className="font-mono text-[11px] text-[var(--primary)] bg-[var(--primary-surface)] px-2 py-0.5 rounded-full border border-[var(--primary)]/20">
          {scope.type === 'all'
            ? 'Complete folio'
            : scope.type === 'collection'
            ? 'Shelf'
            : `${(scope as any).documentIds?.length || 0} texts`}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-xs font-medium text-[var(--ink)] bg-[var(--card)] hover:bg-[var(--card-subtle)] border border-[var(--line)] rounded-full shadow-xs transition-colors cursor-pointer min-w-0"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          {scope.type === 'all' && <Layers size={13} className="text-[var(--primary)] shrink-0" />}
          {scope.type === 'collection' && <Folder size={13} className="text-[var(--primary)] shrink-0" />}
          {scope.type === 'selected' && <FileText size={13} className="text-[var(--primary)] shrink-0" />}
          <span className="truncate">{getScopeLabel()}</span>
        </div>
        <ChevronDown size={13} className="text-[var(--muted)] shrink-0 ml-1" />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1.5 z-30 bg-[var(--card)] border border-[var(--line)] rounded-[0_12px_12px_12px] shadow-xl p-2.5 text-xs divide-y divide-[var(--line)] max-w-full">
          {/* Preset: All Ready Documents */}
          <div className="pb-2">
            <button
              type="button"
              onClick={() => {
                handleSelectAll();
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-full text-xs font-sans transition-colors cursor-pointer ${
                scope.type === 'all'
                  ? 'bg-[var(--primary)] text-white font-medium shadow-xs'
                  : 'text-[var(--ink)] hover:bg-[var(--card-subtle)]'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <Layers size={13} className={scope.type === 'all' ? 'text-white' : 'text-[var(--primary)]'} />
                <span className="truncate">All documents ({readyDocs.length})</span>
              </div>
              {scope.type === 'all' && <Check size={13} className="shrink-0" />}
            </button>
          </div>

          {/* Collections List */}
          {collections.length > 0 && (
            <div className="py-2 space-y-1">
              <span className="font-serif italic text-xs text-[var(--muted)] px-2.5 block">
                Collection shelves
              </span>
              {collections.map((col) => {
                const count = readyDocs.filter((d) => d.collectionId === col.id).length;
                const isSelected = scope.type === 'collection' && scope.collectionId === col.id;
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => {
                      onChangeScope({ type: 'collection', collectionId: col.id });
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-full text-xs font-sans transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--primary)] text-white font-medium shadow-xs'
                        : 'text-[var(--ink)] hover:bg-[var(--card-subtle)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder size={13} className={isSelected ? 'text-white' : 'text-[var(--primary)]'} />
                      <span className="truncate">{col.name}</span>
                      <span className="font-mono text-[10px] opacity-75">({count})</span>
                    </div>
                    {isSelected && <Check size={13} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Custom Document Selection */}
          <div className="pt-2 space-y-1">
            <div className="flex items-center justify-between px-2.5 mb-1">
              <span className="font-serif italic text-xs text-[var(--muted)]">
                Specific documents
              </span>
              {scope.type === 'selected' && (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-[11px] text-[var(--primary)] hover:underline"
                >
                  Reset to all
                </button>
              )}
            </div>

            <div className="max-h-40 overflow-y-auto space-y-0.5">
              {readyDocs.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs font-serif italic text-[var(--muted)]">
                  No ready documents in folio
                </div>
              ) : (
                readyDocs.map((doc) => {
                  const isChecked =
                    scope.type === 'all' ||
                    (scope.type === 'selected' && scope.documentIds.includes(doc.id));
                  return (
                    <div
                      key={doc.id}
                      className="group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-[var(--card-subtle)] text-[var(--ink)] transition-colors"
                    >
                      <div
                        onClick={() => handleToggleDoc(doc.id)}
                        className="flex items-center gap-2 truncate flex-1 cursor-pointer min-w-0"
                      >
                        {isChecked ? (
                          <CheckSquare size={13} className="text-[var(--primary)] shrink-0" />
                        ) : (
                          <Square size={13} className="text-[var(--muted)] shrink-0" />
                        )}
                        <span className="truncate text-xs">{doc.name}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onChangeScope({ type: 'selected', documentIds: [doc.id] });
                            setIsOpen(false);
                          }}
                          className="px-1.5 py-0.5 text-[10px] font-mono rounded text-[var(--muted)] hover:text-[var(--primary)] hover:bg-[var(--primary-surface)] transition-colors cursor-pointer opacity-70 group-hover:opacity-100"
                          title={`Select only ${doc.name}`}
                        >
                          Only
                        </button>
                        {onOpenDocumentInDesk && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDocumentInDesk(doc.id);
                              setIsOpen(false);
                            }}
                            className="p-1 rounded-md text-[var(--muted)] hover:text-[var(--blue)] hover:bg-[var(--line)]/50 transition-colors shrink-0 cursor-pointer opacity-70 group-hover:opacity-100"
                            title="Open in Reading Desk"
                            aria-label={`Open ${doc.name} in Reading Desk`}
                          >
                            <Eye size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
