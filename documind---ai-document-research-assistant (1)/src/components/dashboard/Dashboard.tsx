import React from 'react';
import {
  FileText,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  ArrowRight,
  BookOpen,
  Calendar,
  Layers,
} from 'lucide-react';
import { DocumentRecord, ConversationRecord } from '../../types/index.ts';
import { StatusBadge } from '../ui/Badge.tsx';
import { Dropzone } from '../documents/Dropzone.tsx';

interface DashboardProps {
  documents: DocumentRecord[];
  conversations: ConversationRecord[];
  onNavigate: (tab: 'workspace' | 'documents' | 'evaluation' | 'settings') => void;
  onOpenDocument: (docId: string) => void;
  onRefresh: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  documents,
  conversations,
  onNavigate,
  onOpenDocument,
  onRefresh,
}) => {
  const readyDocs = documents.filter((d) => d.status === 'Ready');
  const processingOrFailed = documents.filter(
    (d) => d.status === 'Processing' || d.status === 'Failed'
  );
  const totalPagesIndexed = readyDocs.reduce((acc, d) => acc + (d.pageCount || 0), 0);

  const recentDocs = [...documents].sort((a, b) => b.uploadedAt - a.uploadedAt).slice(0, 4);
  const recentConvs = [...conversations].slice(0, 4);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full bg-[#111113] text-[#f2efeb]">
      {/* TECHNICAL RESEARCH MASTHEAD */}
      <div className="mb-8 bg-[#0e0e0f] rounded-[4px] p-6 md:p-8 text-[#f2efeb] border border-[rgba(242,239,235,0.12)] shadow-xs">
        <div className="max-w-2xl">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 font-mono text-[10px] text-[#ff4d00] tracking-widest uppercase mb-2 font-semibold">
            <span>Technical Research Terminal</span>
            <span aria-hidden="true">·</span>
            <span>Local Archive Overview</span>
          </div>

          <h1 className="font-syne text-2xl md:text-3xl font-extrabold tracking-tight uppercase text-[#f2efeb] mb-3">
            Corpus & Research Ledger
          </h1>

          <div className="w-16 h-0.5 bg-[#ff4d00] mb-3" />

          <p className="text-xs md:text-sm text-[#f2efeb]/70 leading-relaxed mb-6 font-sans">
            Inspect real-time corpus status, monitor background vector embeddings, and resume evidence-anchored inquiries.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className="inline-flex items-center gap-2 bg-[#ff4d00] hover:bg-[#ff6622] text-white px-4 py-2.5 rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight shadow-xs transition-colors cursor-pointer"
            >
              <span>Launch Research Workspace</span>
              <ArrowRight size={14} />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('documents')}
              className="inline-flex items-center gap-2 bg-[#18181a] hover:bg-[#222226] text-[#f2efeb] px-4 py-2.5 rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight border border-[rgba(242,239,235,0.15)] transition-colors cursor-pointer"
            >
              <FileText size={14} className="text-[#ff4d00]" />
              <span>Corpus Folio ({documents.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Real Count Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <div className="bg-[#18181a] p-4 sm:p-5 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
          <div className="flex items-center justify-between text-[#f2efeb]/60 mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">Total Folio</span>
            <FileText size={16} className="text-[#ff4d00]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#f2efeb]">{documents.length}</div>
          <span className="text-[11px] font-mono text-[#f2efeb]/40 mt-1 block">In browser IndexedDB</span>
        </div>

        <div className="bg-[#18181a] p-4 sm:p-5 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
          <div className="flex items-center justify-between text-[#f2efeb]/60 mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">Indexed & Ready</span>
            <CheckCircle2 size={16} className="text-[#4ade80]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#4ade80]">{readyDocs.length}</div>
          <span className="text-[11px] font-mono text-[#f2efeb]/40 mt-1 block">
            {totalPagesIndexed} pages indexed
          </span>
        </div>

        <div className="bg-[#18181a] p-4 sm:p-5 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
          <div className="flex items-center justify-between text-[#f2efeb]/60 mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">Pending Action</span>
            <AlertCircle size={16} className={processingOrFailed.length > 0 ? 'text-[#ff7733]' : 'text-[#f2efeb]/40'} />
          </div>
          <div className={`text-2xl font-bold font-mono ${processingOrFailed.length > 0 ? 'text-[#ff7733]' : 'text-[#f2efeb]'}`}>
            {processingOrFailed.length}
          </div>
          <span className="text-[11px] font-mono text-[#f2efeb]/40 mt-1 block">
            {processingOrFailed.length > 0 ? 'Processing or failed' : 'All clear'}
          </span>
        </div>

        <div className="bg-[#18181a] p-4 sm:p-5 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
          <div className="flex items-center justify-between text-[#f2efeb]/60 mb-2">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">Research Chats</span>
            <MessageSquare size={16} className="text-[#ff4d00]" />
          </div>
          <div className="text-2xl font-bold font-mono text-[#f2efeb]">{conversations.length}</div>
          <span className="text-[11px] font-mono text-[#f2efeb]/40 mt-1 block">Stored with citations</span>
        </div>
      </div>

      {/* Quick Upload Dropzone */}
      <div className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5">
          <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">
            Quick Document Ingestion
          </h2>
          <span className="text-xs text-[#f2efeb]/40 font-mono">PDF.js extraction · Gemini vectorization</span>
        </div>
        <Dropzone onUploadSuccess={onRefresh} compact />
      </div>

      {/* Two Column Layout: Recent Documents & Recent Conversations */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent Documents */}
        <div className="bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.1)] p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-[rgba(242,239,235,0.1)]">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-[#ff4d00]" />
              <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">Recent Ingestions</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('documents')}
              className="font-mono text-xs text-[#ff4d00] hover:underline cursor-pointer"
            >
              View all ({documents.length})
            </button>
          </div>

          {recentDocs.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-[#f2efeb]/40 italic">
              No documents in local storage. Upload a PDF above to begin.
            </div>
          ) : (
            <div className="divide-y divide-[rgba(242,239,235,0.08)]">
              {recentDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="truncate flex-1">
                    <p className="font-medium text-[#f2efeb] truncate">{doc.name}</p>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-[#f2efeb]/50 mt-0.5">
                      <span>{doc.pageCount ? `${doc.pageCount} pages` : 'Calculating...'}</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(doc.uploadedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={doc.status} size="sm" />
                    {doc.status === 'Ready' && (
                      <button
                        type="button"
                        onClick={() => onOpenDocument(doc.id)}
                        className="text-[11px] font-mono font-medium text-[#ff4d00] hover:text-white bg-[#ff4d00]/10 hover:bg-[#ff4d00] px-2.5 py-1 rounded-[2px] border border-[#ff4d00]/30 transition-colors cursor-pointer"
                      >
                        Inspect
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Conversations */}
        <div className="bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.1)] p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-[rgba(242,239,235,0.1)]">
            <div className="flex items-center gap-2">
              <MessageSquare size={15} className="text-[#ff4d00]" />
              <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">Recent Research Inquiries</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('workspace')}
              className="font-mono text-xs text-[#ff4d00] hover:underline cursor-pointer"
            >
              Open workspace
            </button>
          </div>

          {recentConvs.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-[#f2efeb]/40 italic">
              No conversations recorded yet. Start your first research inquiry in Workspace.
            </div>
          ) : (
            <div className="divide-y divide-[rgba(242,239,235,0.08)]">
              {recentConvs.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => onNavigate('workspace')}
                  className="py-3 flex items-center justify-between gap-3 text-xs hover:bg-[#222226] px-2 -mx-2 rounded-[2px] transition-colors cursor-pointer"
                >
                  <div className="truncate flex-1">
                    <p className="font-medium text-[#f2efeb] truncate">{conv.title}</p>
                    <div className="flex items-center gap-2 text-[11px] text-[#f2efeb]/40 mt-0.5 font-mono">
                      <span>Research Session</span>
                      <span aria-hidden="true">·</span>
                      <span>{new Date(conv.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <ArrowRight size={13} className="text-[#f2efeb]/40 group-hover:text-[#ff4d00]" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
