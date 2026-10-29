import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  BookOpen,
  FolderOpen,
  LayoutDashboard,
  Bookmark,
  Award,
  Settings,
  Upload,
  ArrowRight,
  Sliders,
  Download,
  UploadCloud,
  FileText,
  X,
} from 'lucide-react';
import { NavTab } from './Navbar.tsx';

interface CommandItem {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  category: 'Navigate' | 'Actions' | 'Tools';
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
  onTriggerUpload: () => void;
  onOpenArchiveModal?: () => void;
  onFlipPDFPage?: (direction: 'next' | 'prev') => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onTriggerUpload,
  onOpenArchiveModal,
  onFlipPDFPage,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const items: CommandItem[] = [
    {
      id: 'nav-workspace',
      title: 'Open Reading Room Workspace',
      subtitle: 'Ask questions, stream answers, and view page-level citations',
      icon: <BookOpen size={16} className="text-[var(--a1)]" />,
      category: 'Navigate',
      shortcut: 'W',
      action: () => {
        onNavigate('workspace');
        onClose();
      },
    },
    {
      id: 'nav-documents',
      title: 'Browse Documents Library',
      subtitle: 'Inspect indexed folios, page counts, and extraction stages',
      icon: <FolderOpen size={16} className="text-[var(--tang)]" />,
      category: 'Navigate',
      shortcut: 'D',
      action: () => {
        onNavigate('documents');
        onClose();
      },
    },
    {
      id: 'nav-dashboard',
      title: 'View Research Dashboard',
      subtitle: 'Metrics, query counts, and verification rates',
      icon: <LayoutDashboard size={16} className="text-[var(--teal)]" />,
      category: 'Navigate',
      shortcut: 'L',
      action: () => {
        onNavigate('dashboard');
        onClose();
      },
    },
    {
      id: 'nav-notebook',
      title: 'Open Research Notebook',
      subtitle: 'Review pinned answers and export as Markdown or PDF',
      icon: <Bookmark size={16} className="text-[var(--a2)]" />,
      category: 'Navigate',
      shortcut: 'N',
      action: () => {
        onNavigate('notebook');
        onClose();
      },
    },
    {
      id: 'nav-evaluation',
      title: 'Open Evaluation Suite',
      subtitle: 'Execute golden benchmark sets and check RAG accuracy',
      icon: <Award size={16} className="text-[var(--sun)]" />,
      category: 'Navigate',
      shortcut: 'E',
      action: () => {
        onNavigate('evaluation');
        onClose();
      },
    },
    {
      id: 'nav-settings',
      title: 'Configure Studio Settings',
      subtitle: 'Adjust retrieval limits, BM25 weight, and appearance themes',
      icon: <Settings size={16} className="text-[var(--mute)]" />,
      category: 'Navigate',
      shortcut: 'S',
      action: () => {
        onNavigate('settings');
        onClose();
      },
    },
    {
      id: 'act-upload',
      title: 'Upload Document (PDF / Markdown / TXT)',
      subtitle: 'Process and index a new file into IndexedDB',
      icon: <Upload size={16} className="text-[var(--a1)]" />,
      category: 'Actions',
      shortcut: 'U',
      action: () => {
        onTriggerUpload();
        onClose();
      },
    },
    {
      id: 'act-archive',
      title: 'Search Past Answer Archive',
      subtitle: 'Locate and revisit earlier empirical syntheses',
      icon: <FileText size={16} className="text-[var(--a2)]" />,
      category: 'Actions',
      action: () => {
        onOpenArchiveModal?.();
        onClose();
      },
    },
  ];

  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(query.toLowerCase()) ||
      item.subtitle.toLowerCase().includes(query.toLowerCase()) ||
      item.category.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = filteredItems[selectedIndex];
      if (current) current.action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/45 backdrop-blur-[3px] animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        style={{
          borderRadius: '36px',
          boxShadow: 'var(--sh)',
        }}
        className="w-full max-w-xl bg-[var(--card)] text-[var(--ink)] border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] overflow-hidden flex flex-col max-h-[75vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-6 py-4.5 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)]">
          <Search size={18} className="text-[var(--mute)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search... (Esc to close)"
            className="flex-1 bg-transparent text-sm sm:text-base text-[var(--ink)] placeholder:text-[var(--mute)]/60 focus:outline-hidden"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-[var(--mute)] hover:text-[var(--ink)] hover:bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] transition-colors cursor-pointer"
            aria-label="Close command palette"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-[var(--mute)]">
              No matching commands or navigation targets found.
            </div>
          ) : (
            filteredItems.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between gap-3 px-4 py-3 rounded-full cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-[var(--a1)] text-white shadow-xs'
                      : 'hover:bg-[color-mix(in_srgb,var(--mute)_10%,transparent)] text-[var(--ink)]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-2 rounded-full shrink-0 ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-[color-mix(in_srgb,var(--mute)_12%,transparent)]'
                      }`}
                    >
                      {item.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate leading-snug">{item.title}</div>
                      <div
                        className={`text-xs truncate ${
                          isSelected ? 'text-white/80' : 'text-[var(--mute)]'
                        }`}
                      >
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  {item.shortcut && (
                    <kbd
                      className={`px-2 py-0.5 mono text-[11px] rounded-md shrink-0 border ${
                        isSelected
                          ? 'border-white/30 bg-white/20 text-white'
                          : 'border-[color-mix(in_srgb,var(--mute)_20%,transparent)] bg-[color-mix(in_srgb,var(--mute)_10%,transparent)] text-[var(--mute)]'
                      }`}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts hint */}
        <div className="px-6 py-3 bg-[color-mix(in_srgb,var(--card)_94%,var(--ink))] border-t border-[color-mix(in_srgb,var(--mute)_18%,transparent)] flex items-center justify-between mono text-[11px]">
          <div className="flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
            <span>Esc to exit</span>
          </div>
          <div className="hidden sm:inline-block">Cmd / Ctrl + K</div>
        </div>
      </div>
    </div>
  );
};
