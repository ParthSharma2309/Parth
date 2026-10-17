import React from 'react';
import {
  BookOpen,
  MessageSquare,
  FileText,
  LayoutDashboard,
  BarChart2,
  Settings,
  ArrowRight,
  Library,
} from 'lucide-react';
import { DocumentRecord } from '../../types/index.ts';

export type NavTab = 'workspace' | 'documents' | 'dashboard' | 'evaluation' | 'settings' | 'landing';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  documents: DocumentRecord[];
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  onTabChange,
  documents,
}) => {
  const readyCount = documents.filter((d) => d.status === 'Ready').length;

  // On the public landing page, show the dedicated technical header with anchor links
  if (currentTab === 'landing') {
    return (
      <header className="h-[56px] w-full max-w-full bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] px-3 sm:px-6 flex items-center justify-between gap-2 shrink-0 z-40 select-none">
        <div
          onClick={() => onTabChange('landing')}
          className="flex items-center gap-2 cursor-pointer group shrink-0"
        >
          <div className="font-syne font-extrabold text-base md:text-lg tracking-tight uppercase text-[#f2efeb]">
            Docu<span className="text-[#ff4d00]">Mind</span>{' '}
            <span className="text-xs font-mono font-normal opacity-50 ml-0.5 hidden xs:inline">[v2.4]</span>
          </div>
        </div>

        <nav className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-1 min-w-0 max-w-full">
          <a
            href="#architecture"
            className="chip hover:bg-[rgba(242,239,235,0.18)] hidden sm:inline-block"
          >
            Architecture
          </a>
          <a
            href="#protocol"
            className="chip hover:bg-[rgba(242,239,235,0.18)] hidden sm:inline-block"
          >
            Protocol
          </a>
          <button
            type="button"
            onClick={() => onTabChange('dashboard')}
            className="chip hover:bg-[rgba(242,239,235,0.18)] shrink-0"
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => onTabChange('workspace')}
            className="chip active flex items-center gap-1.5 font-bold shrink-0"
          >
            <span className="hidden sm:inline">Open </span>
            <span>Workspace</span>
            <ArrowRight size={12} />
          </button>
        </nav>
      </header>
    );
  }

  // App Shell navigation (when inside Workspace, Documents, Dashboard, Evaluation, Settings)
  const navItems: Array<{ id: NavTab; label: string }> = [
    { id: 'workspace', label: 'Workspace' },
    { id: 'documents', label: `Documents (${readyCount})` },
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'evaluation', label: 'Evaluation' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <header className="h-[56px] w-full max-w-full bg-[#0e0e0f] border-b border-[rgba(242,239,235,0.1)] px-3 sm:px-6 flex items-center justify-between gap-2 shrink-0 z-40 select-none">
      {/* Brand Logo matching Variation 2 */}
      <div
        onClick={() => onTabChange('landing')}
        className="flex items-center gap-2 cursor-pointer group shrink-0"
        title="Return to Technical Overview"
      >
        <div className="font-syne font-extrabold text-base md:text-lg tracking-tight uppercase text-[#f2efeb]">
          Docu<span className="text-[#ff4d00]">Mind</span>{' '}
          <span className="text-xs font-mono font-normal opacity-40 ml-0.5 hidden xs:inline">[v2.4]</span>
        </div>
      </div>

      {/* Nav Chips with min-w-0 and max-w-full so horizontal scroll is properly contained */}
      <nav className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-1 min-w-0 max-w-full">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`chip shrink-0 ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Right status badge chip */}
      <div className="hidden lg:flex items-center gap-2 shrink-0">
        <div
          className="chip"
          style={{ background: 'none', border: '1px solid rgba(242, 239, 235, 0.1)' }}
        >
          {readyCount} {readyCount === 1 ? 'Doc Indexed' : 'Docs Indexed'}
        </div>
      </div>
    </header>
  );
};
