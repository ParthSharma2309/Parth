import React, { useState, useEffect, useCallback } from 'react';
import {
  Bookmark,
  Trash2,
  Download,
  Printer,
  Search,
  Copy,
  Check,
  Edit3,
  X,
  Plus,
  Save,
  Tag,
  GripVertical,
  BookOpen,
} from 'lucide-react';
import { NotebookItem } from '../../types/index.ts';
import { getNotebookItems, deleteNotebookItem, saveNotebookItem } from '../../services/storage.ts';
import { SafeMarkdown } from '../ui/SafeMarkdown.tsx';
import { useToast } from '../ui/Toast.tsx';

interface NotebookPageProps {
  onOpenCitation?: (docId: string, pageNumber: number) => void;
  onNavigateToWorkspace?: () => void;
}

export const NotebookPage: React.FC<NotebookPageProps> = ({
  onOpenCitation,
  onNavigateToWorkspace,
}) => {
  const [items, setItems] = useState<NotebookItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Editing state
  const [editingItem, setEditingItem] = useState<NotebookItem | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [editTagsInput, setEditTagsInput] = useState('');

  // Drag-to-reorder state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  const { showToast } = useToast();

  const loadItems = useCallback(async () => {
    try {
      const data = await getNotebookItems();
      setItems(data.sort((a: NotebookItem, b: NotebookItem) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Failed to load notebook items:', err);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleDelete = async (item: NotebookItem) => {
    try {
      await deleteNotebookItem(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));

      showToast({
        message: 'Sticky note deleted',
        type: 'info',
        duration: 4000,
        undoAction: async () => {
          await saveNotebookItem(item);
          loadItems();
        },
      });
    } catch (err) {
      showToast({ message: 'Failed to delete note', type: 'error' });
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    showToast({ message: 'Copied note text', type: 'success' });
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleStartEdit = (item: NotebookItem) => {
    setEditingItem(item);
    setEditTitle(item.title || item.question);
    setEditAnswer(item.answer);
    setEditTagsInput((item.tags || []).join(', '));
  };

  const handleSaveEdit = async () => {
    if (!editingItem) return;

    const parsedTags = editTagsInput
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const updated: NotebookItem = {
      ...editingItem,
      title: editTitle.trim() || editingItem.question,
      answer: editAnswer.trim(),
      tags: parsedTags,
    };

    await saveNotebookItem(updated);
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setEditingItem(null);
    showToast({ message: 'Note updated', type: 'success' });
  };

  // Drag and drop reordering handlers
  const handleDragStart = (idx: number) => {
    setDraggedIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === targetIdx) return;
    const reordered = [...items];
    const draggedItem = reordered[draggedIdx];
    reordered.splice(draggedIdx, 1);
    reordered.splice(targetIdx, 0, draggedItem);
    setDraggedIdx(targetIdx);
    setItems(reordered);
  };

  const handleDragEnd = async () => {
    setDraggedIdx(null);
    // Persist reordered notes
    for (const item of items) {
      await saveNotebookItem(item);
    }
  };

  // Export to Markdown
  const handleExportMarkdown = () => {
    if (items.length === 0) return;

    let md = `# DocuMind Research Notebook\n*Generated on ${new Date().toLocaleDateString()}*\n\n---\n\n`;

    items.forEach((item, idx) => {
      md += `## Note ${idx + 1}: ${item.title || item.question}\n\n`;
      if (item.documentName) {
        md += `**Source Document:** ${item.documentName}\n\n`;
      }
      md += `### Research Question\n> ${item.question}\n\n`;
      md += `### Verified Synthesis\n${item.answer}\n\n`;

      if (item.tags && item.tags.length > 0) {
        md += `**Tags:** ${item.tags.join(', ')}\n\n`;
      }

      if (item.citations && item.citations.length > 0) {
        md += `### Footnote Citations & Page References\n`;
        item.citations.forEach((c) => {
          md += `- **[${c.marker}]** Page ${c.pageNumber}${
            c.quote ? `: *"${c.quote}"*` : ''
          } (Status: ${c.verified ? 'Verified' : 'Unverified'})\n`;
        });
        md += '\n';
      }
      md += `---\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `DocuMind_Notebook_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast({ message: 'Notebook exported as Markdown (.md)', type: 'success' });
  };

  // Export to PDF via clean print stylesheet
  const handleExportPDF = () => {
    window.print();
  };

  // Collect all unique tags across items
  const allTags = Array.from(
    new Set(items.flatMap((i) => i.tags || []).filter(Boolean))
  );

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.title && item.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.documentName && item.documentName.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesTag = !selectedTag || (item.tags && item.tags.includes(selectedTag));
    return matchesSearch && matchesTag;
  });

  // Sticky notes: backgrounds #ffd23f, #ffc2dc, #c8f43a, #a9f0e4
  const noteColors = ['#ffd23f', '#ffc2dc', '#c8f43a', '#a9f0e4'];
  // Alternating rotate(-1.5deg / 1.2deg / -.8deg / 1.6deg)
  const rotations = ['-1.5deg', '1.2deg', '-0.8deg', '1.6deg'];

  return (
    <div className="w-full text-[var(--ink)]">
      {/* Exact Header: <h2>Your <span class="ser">notebook</span></h2> */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-5 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)] reveal">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-full bg-[var(--a2)]/15 text-[var(--a2)]">
              <Bookmark size={15} />
            </span>
            <span className="mono">
              Curated Syntheses &amp; Citations
            </span>
          </div>
          <h2>
            Your <span className="ser">notebook</span>
          </h2>
          <p className="text-xs sm:text-sm text-[var(--mute)] mt-1">
            Pinned research discoveries, evidence quotes, and verifiable page-level references.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleExportMarkdown}
            disabled={items.length === 0}
            className="btn outline sm"
            title="Download Markdown summary"
          >
            <Download size={14} className="text-[var(--a1)]" />
            <span>Export Markdown</span>
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={items.length === 0}
            className="btn sm"
            title="Export / Print PDF"
          >
            <Printer size={14} />
            <span>Export PDF</span>
          </button>
        </div>
      </div>

      {/* Search Bar & Tag Chips */}
      <div
        style={{
          borderRadius: '36px',
          boxShadow: 'var(--sh)',
        }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-8 bg-[var(--card)] p-3 border border-[color-mix(in_srgb,var(--mute)_20%,transparent)] reveal"
      >
        {/* Search */}
        <div className="relative w-full sm:w-80">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--mute)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pinned notes and citations..."
            style={{ borderRadius: '99px' }}
            className="w-full pl-9 pr-4 py-2 bg-[color-mix(in_srgb,var(--mute)_10%,transparent)] border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] text-xs text-[var(--ink)] placeholder:text-[var(--mute)]/60 focus:outline-hidden focus:border-[var(--a1)] transition-colors"
          />
        </div>

        {/* Tag Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              selectedTag === null
                ? 'bg-[var(--ink)] text-[var(--bg)] shadow-xs'
                : 'text-[var(--mute)] hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--mute)_10%,transparent)]'
            }`}
          >
            All Notes ({items.length})
          </button>

          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag(tag === selectedTag ? null : tag)}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                selectedTag === tag
                  ? 'bg-[var(--a2)] text-white shadow-xs'
                  : 'text-[var(--mute)] hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--mute)_10%,transparent)]'
              }`}
            >
              <Tag size={10} />
              <span>{tag}</span>
            </button>
          ))}
        </div>
      </div>

      {/* MASONRY: columns:3 240px; column-gap:16px */}
      {filteredItems.length === 0 ? (
        <div
          style={{
            borderRadius: '36px',
            boxShadow: 'var(--sh)',
          }}
          className="text-center py-16 bg-[var(--card)] border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] p-8 reveal"
        >
          <div className="w-14 h-14 rounded-full bg-[var(--a2)]/15 text-[var(--a2)] flex items-center justify-center mx-auto mb-3 shadow-xs">
            <Bookmark size={24} />
          </div>
          <h3 className="text-lg font-bold text-[var(--ink)]">No sticky notes found</h3>
          <p className="text-xs text-[var(--mute)] mt-1 max-w-sm mx-auto">
            {searchQuery || selectedTag
              ? 'No notes match your filter criteria.'
              : 'Pin answers in the Workspace to curate your research notebook.'}
          </p>
          {onNavigateToWorkspace && (
            <button
              type="button"
              onClick={onNavigateToWorkspace}
              className="btn sm mt-4"
            >
              <span>Go to Workspace</span>
            </button>
          )}
        </div>
      ) : (
        <div className="nb-masonry reveal">
          {filteredItems.map((item, idx) => {
            const bg = noteColors[idx % noteColors.length];
            const rot = rotations[idx % rotations.length];

            return (
              <div
                key={item.id}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
                style={{
                  background: bg,
                  color: '#17133b',
                  transform: `rotate(${rot})`,
                  cursor: 'grab',
                }}
                className="nb-note select-none group relative shadow-md"
              >
                {/* Drag Handle & Action Icons */}
                <div className="flex items-center justify-between gap-1 mb-2 pb-1.5 border-b border-black/10">
                  <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    <GripVertical size={13} className="text-[#17133b]" />
                    <span className="mono text-[10px] font-bold text-[#17133b] truncate max-w-[130px]">
                      {item.documentName || 'Research Synthesis'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(item)}
                      className="p-1 rounded-full hover:bg-black/10 text-[#17133b] transition-colors cursor-pointer"
                      title="Edit note & tags"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopy(item.id, `${item.question}\n\n${item.answer}`)}
                      className="p-1 rounded-full hover:bg-black/10 text-[#17133b] transition-colors cursor-pointer"
                      title="Copy text"
                    >
                      {copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(item)}
                      className="p-1 rounded-full hover:bg-black/10 text-[var(--err)] transition-colors cursor-pointer"
                      title="Delete note"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {/* Note Title / Question */}
                <h4
                  style={{
                    fontFamily: "'Bricolage Grotesque', sans-serif",
                    fontSize: '16px',
                    fontWeight: 800,
                    lineHeight: 1.25,
                    color: '#17133b',
                  }}
                  className="mb-2"
                >
                  {item.title || item.question}
                </h4>

                {/* Answer Excerpt with markdown */}
                <div className="text-xs leading-relaxed text-[#17133b] font-sans line-clamp-6 mb-3">
                  <SafeMarkdown content={item.answer} />
                </div>

                {/* Citations list if present */}
                {item.citations && item.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-black/10 mb-2">
                    {item.citations.slice(0, 3).map((c, cIdx) => (
                      <button
                        key={cIdx}
                        type="button"
                        onClick={() => {
                          const docId = c.documentId || item.documentId;
                          if (docId && onOpenCitation) {
                            onOpenCitation(docId, c.pageNumber);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold bg-[#17133b] text-white hover:opacity-90 cursor-pointer shadow-2xs"
                        title={`Page ${c.pageNumber} in ${c.documentName}`}
                      >
                        <BookOpen size={9} />
                        <span>p.{c.pageNumber}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {item.tags.map((t, tIdx) => (
                      <span
                        key={tIdx}
                        className="px-2 py-0.5 rounded-full font-mono text-[9.5px] font-bold bg-black/10 text-[#17133b]"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Note Edit Modal */}
      {editingItem && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-[3px]"
        >
          <div
            style={{
              borderRadius: '36px',
              boxShadow: 'var(--sh)',
            }}
            className="bg-[var(--card)] p-6 sm:p-7 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] max-w-lg w-full space-y-4 shadow-xl animate-in fade-in zoom-in-95 text-[var(--ink)]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
              <h3 className="text-lg font-bold text-[var(--ink)] flex items-center gap-2">
                <Edit3 size={16} className="text-[var(--a1)]" />
                <span>Edit Sticky Note</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="p-1 rounded-full hover:bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] text-[var(--mute)]"
              >
                <X size={16} />
              </button>
            </div>

            <div>
              <label className="mono text-xs font-bold block mb-1">Title / Question</label>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                style={{ borderRadius: '99px' }}
                className="w-full px-4 py-2 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)]"
              />
            </div>

            <div>
              <label className="mono text-xs font-bold block mb-1">Answer Synthesis</label>
              <textarea
                rows={5}
                value={editAnswer}
                onChange={(e) => setEditAnswer(e.target.value)}
                className="w-full p-3 rounded-2xl border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)] resize-none"
              />
            </div>

            <div>
              <label className="mono text-xs font-bold block mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={editTagsInput}
                onChange={(e) => setEditTagsInput(e.target.value)}
                placeholder="e.g. Empirical, Methodology, Chemistry"
                style={{ borderRadius: '99px' }}
                className="w-full px-4 py-2 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)]"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="btn outline sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="btn sm flex items-center gap-1.5"
              >
                <Save size={13} />
                <span>Save Note</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
