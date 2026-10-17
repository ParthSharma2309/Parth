import React, { useState } from 'react';
import {
  Layers,
  Folder,
  FileText,
  ChevronDown,
  Check,
  CheckSquare,
  Square,
} from 'lucide-react';
import { DocumentRecord, CollectionRecord, RetrievalScope } from '../../types/index.ts';

interface ScopeSelectorProps {
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  scope: RetrievalScope;
  onChangeScope: (newScope: RetrievalScope) => void;
}

export const ScopeSelector: React.FC<ScopeSelectorProps> = ({
  documents,
  collections,
  scope,
  onChangeScope,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const readyDocs = documents.filter((d) => d.status === 'Ready');

  const getScopeLabel = () => {
    if (scope.type === 'all') {
      return `All Ready Documents (${readyDocs.length})`;
    }
    if (scope.type === 'collection') {
      const col = collections.find((c) => c.id === scope.collectionId);
      const count = readyDocs.filter((d) => d.collectionId === scope.collectionId).length;
      return `Collection: ${col?.name || 'Unknown'} (${count})`;
    }
    if (scope.type === 'selected') {
      return `Selected Folio (${scope.documentIds.length} of ${readyDocs.length})`;
    }
    return 'Research Scope';
  };

  const handleToggleDoc = (docId: string) => {
    let currentSelected: string[] = [];
    if (scope.type === 'selected') {
      currentSelected = [...scope.documentIds];
    } else {
      currentSelected = readyDocs.map((d) => d.id);
    }

    if (currentSelected.includes(docId)) {
      currentSelected = currentSelected.filter((id) => id !== docId);
    } else {
      currentSelected.push(docId);
    }

    if (currentSelected.length === readyDocs.length) {
      onChangeScope({ type: 'all' });
    } else {
      onChangeScope({ type: 'selected', documentIds: currentSelected });
    }
  };

  const handleSelectAll = () => {
    onChangeScope({ type: 'all' });
  };

  return (
    <div className="relative w-full max-w-full min-w-0">
      <div className="flex items-center justify-between font-mono text-[10px] text-[#f2efeb]/50 uppercase tracking-wider mb-1.5 px-0.5">
        <span>Research Scope</span>
        <span className="text-[#ff4d00] bg-[#ff4d00]/15 px-1.5 py-0.2 rounded-[2px] border border-[#ff4d00]/30 font-semibold">
          {scope.type === 'all'
            ? 'Complete Folio'
            : scope.type === 'collection'
            ? 'Collection'
            : `${(scope as any).documentIds?.length || 0} docs`}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-mono font-medium text-[#f2efeb] bg-[#18181a] hover:bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] shadow-xs transition-colors cursor-pointer min-w-0"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2 truncate min-w-0">
          {scope.type === 'all' && <Layers size={13} className="text-[#ff4d00] shrink-0" />}
          {scope.type === 'collection' && <Folder size={13} className="text-[#ff4d00] shrink-0" />}
          {scope.type === 'selected' && <FileText size={13} className="text-[#ff4d00] shrink-0" />}
          <span className="truncate">{getScopeLabel()}</span>
        </div>
        <ChevronDown size={13} className="text-[#f2efeb]/50 shrink-0 ml-1" />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 mt-1 z-30 bg-[#18181a] border border-[rgba(242,239,235,0.15)] rounded-[4px] shadow-xl p-2 text-xs divide-y divide-[rgba(242,239,235,0.1)] max-w-full">
          {/* Preset: All Ready Documents */}
          <div className="pb-2">
            <button
              type="button"
              onClick={() => {
                handleSelectAll();
                setIsOpen(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[2px] font-mono text-xs transition-colors cursor-pointer ${
                scope.type === 'all'
                  ? 'bg-[#ff4d00] text-white font-semibold'
                  : 'text-[#f2efeb] hover:bg-[#222226]'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <Layers size={13} className={scope.type === 'all' ? 'text-white' : 'text-[#ff4d00]'} />
                <span className="truncate">All Ready Documents ({readyDocs.length})</span>
              </div>
              {scope.type === 'all' && <Check size={13} className="shrink-0" />}
            </button>
          </div>

          {/* Collections List */}
          {collections.length > 0 && (
            <div className="py-2 space-y-1">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[#f2efeb]/50 px-2 block">
                Collections
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
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-[2px] font-mono text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#ff4d00] text-white font-semibold'
                        : 'text-[#f2efeb] hover:bg-[#222226]'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate min-w-0">
                      <Folder size={13} className={isSelected ? 'text-white' : 'text-[#ff4d00]'} />
                      <span className="truncate">{col.name}</span>
                    </div>
                    <span className="font-mono text-[10px] opacity-80 shrink-0">({count})</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Granular Document Checklist */}
          <div className="pt-2 max-h-48 overflow-y-auto space-y-0.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#f2efeb]/50 px-2 block mb-1">
              Select Specific Documents
            </span>
            {readyDocs.length === 0 ? (
              <p className="px-2 py-1 text-xs text-[#f2efeb]/40 italic font-mono">No ready documents available.</p>
            ) : (
              readyDocs.map((doc) => {
                const isChecked =
                  scope.type === 'all' ||
                  (scope.type === 'selected' && scope.documentIds.includes(doc.id));
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => handleToggleDoc(doc.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs rounded-[2px] text-[#f2efeb] hover:bg-[#222226] cursor-pointer min-w-0"
                  >
                    {isChecked ? (
                      <CheckSquare size={13} className="text-[#ff4d00] shrink-0" />
                    ) : (
                      <Square size={13} className="text-[#f2efeb]/30 shrink-0" />
                    )}
                    <span className="truncate flex-1 font-sans">{doc.name}</span>
                    <span className="font-mono text-[10px] text-[#f2efeb]/40 shrink-0">{doc.pageCount}p</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
