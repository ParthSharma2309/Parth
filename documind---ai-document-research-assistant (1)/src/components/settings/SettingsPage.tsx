import React, { useState, useEffect } from 'react';
import {
  Save,
  Trash2,
  Sliders,
  Shield,
  Layers,
  Info,
  Check,
  CheckCircle2,
  AlertTriangle,
  Cpu,
} from 'lucide-react';
import { SettingsState } from '../../types/index.ts';
import { MODEL_CONFIG } from '../../config/models.ts';
import { getSettings, saveSettings, clearAllData } from '../../services/storage.ts';
import { Modal } from '../ui/Modal.tsx';

interface SettingsPageProps {
  onRefreshData: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ onRefreshData }) => {
  const [settings, setSettings] = useState<SettingsState | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [showClearModal, setShowClearModal] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [clearStatus, setClearStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const s = await getSettings();
    setSettings(s);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    await saveSettings(settings);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    setClearStatus(null);
    try {
      await clearAllData();
      setShowClearModal(false);
      onRefreshData();
      await loadSettings();
      setClearStatus({
        type: 'success',
        message: 'All local documents, conversations, chunks, and embeddings have been cleared from IndexedDB.',
      });
    } catch (err: any) {
      setClearStatus({
        type: 'error',
        message: `Failed to clear data: ${err.message || 'Unknown error'}`,
      });
    } finally {
      setIsClearing(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-4xl mx-auto w-full bg-[#111113] text-[#f2efeb]">
      {/* Header */}
      <div className="mb-6 pb-4 border-b border-[rgba(242,239,235,0.1)]">
        <span className="font-mono text-xs uppercase tracking-wider text-[#ff4d00] block mb-1 font-semibold">
          System Configuration
        </span>
        <h1 className="font-syne text-2xl md:text-3xl font-extrabold text-[#f2efeb] uppercase tracking-tight">
          System Settings & Hyperparameters
        </h1>
        <p className="text-xs md:text-sm text-[#f2efeb]/60 mt-1 font-sans">
          Tune chunking sizes, similarity thresholds, retrieval Top-K, and model endpoints.
        </p>
      </div>

      {/* Clear Status Banner */}
      {clearStatus && (
        <div
          className={`mb-6 p-3.5 rounded-[4px] border flex items-center justify-between text-xs font-mono shadow-xs ${
            clearStatus.type === 'error'
              ? 'bg-[#ef4444]/15 border-[#ef4444]/30 text-[#f87171]'
              : 'bg-[#22c55e]/15 border-[#22c55e]/30 text-[#4ade80]'
          }`}
        >
          <div className="flex items-center gap-2">
            {clearStatus.type === 'error' ? (
              <AlertTriangle size={15} className="shrink-0" />
            ) : (
              <CheckCircle2 size={15} className="shrink-0" />
            )}
            <span>{clearStatus.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setClearStatus(null)}
            className="text-xs font-mono px-2 py-0.5 rounded bg-black/30 hover:bg-black/50 text-white cursor-pointer ml-3 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Retrieval & Grounding Section */}
        <div className="bg-[#18181a] p-6 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[rgba(242,239,235,0.1)]">
            <Sliders size={16} className="text-[#ff4d00]" />
            <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">Retrieval & Relevance Abstention</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top-K */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-mono font-medium text-[#f2efeb]">Top-K Retrieved Chunks</label>
                <span className="font-mono text-xs font-bold text-[#ff4d00]">{settings.topK}</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                value={settings.topK}
                onChange={(e) =>
                  setSettings({ ...settings, topK: parseInt(e.target.value, 10) })
                }
                className="w-full accent-[#ff4d00] cursor-pointer"
              />
              <p className="text-[11px] font-mono text-[#f2efeb]/50 mt-1">
                Number of highest similarity passages retrieved for standard queries (default: 6). Broad inquiries automatically expand to 14.
              </p>
            </div>

            {/* Relevance Threshold */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-mono font-medium text-[#f2efeb]">Relevance Floor Threshold</label>
                <span className="font-mono text-xs font-bold text-[#ff4d00]">
                  {settings.similarityThreshold}
                </span>
              </div>
              <input
                type="range"
                min="0.20"
                max="0.80"
                step="0.05"
                value={settings.similarityThreshold}
                onChange={(e) =>
                  setSettings({ ...settings, similarityThreshold: parseFloat(e.target.value) })
                }
                className="w-full accent-[#ff4d00] cursor-pointer"
              />
              <p className="text-[11px] font-mono text-[#f2efeb]/50 mt-1">
                Below this cosine threshold, the pipeline abstains immediately without generating synthetic claims (default: 0.45).
              </p>
            </div>
          </div>
        </div>

        {/* Chunking Section */}
        <div className="bg-[#18181a] p-6 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[rgba(242,239,235,0.1)]">
            <Layers size={16} className="text-[#ff4d00]" />
            <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">Document Chunking (Page-Bound)</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Chunk Size */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-mono font-medium text-[#f2efeb]">Chunk Target Size (characters)</label>
                <span className="font-mono text-xs font-bold text-[#ff4d00]">
                  {settings.chunkSize} chars
                </span>
              </div>
              <input
                type="range"
                min="300"
                max="1500"
                step="50"
                value={settings.chunkSize}
                onChange={(e) =>
                  setSettings({ ...settings, chunkSize: parseInt(e.target.value, 10) })
                }
                className="w-full accent-[#ff4d00] cursor-pointer"
              />
              <p className="text-[11px] font-mono text-[#f2efeb]/50 mt-1">
                Target text window size. Splitting strictly respects PDF page boundaries to maintain 100% citation accuracy.
              </p>
            </div>

            {/* Chunk Overlap */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-mono font-medium text-[#f2efeb]">Chunk Overlap (characters)</label>
                <span className="font-mono text-xs font-bold text-[#ff4d00]">
                  {settings.chunkOverlap} chars
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="400"
                step="25"
                value={settings.chunkOverlap}
                onChange={(e) =>
                  setSettings({ ...settings, chunkOverlap: parseInt(e.target.value, 10) })
                }
                className="w-full accent-[#ff4d00] cursor-pointer"
              />
              <p className="text-[11px] font-mono text-[#f2efeb]/50 mt-1">
                Sliding window character overlap for contextual continuity between adjacent chunks.
              </p>
            </div>
          </div>
        </div>

        {/* Model Selection */}
        <div className="bg-[#18181a] p-6 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-[rgba(242,239,235,0.1)]">
            <Cpu size={16} className="text-[#ff4d00]" />
            <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">Gemini Pipeline Models</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1 font-semibold">
                Embedding Model
              </label>
              <select
                value={settings.embeddingModel}
                onChange={(e) => setSettings({ ...settings, embeddingModel: e.target.value })}
                className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] focus:outline-hidden"
              >
                {MODEL_CONFIG.supportedEmbeddingModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] font-mono text-[#f2efeb]/50 mt-1">
                Used to vectorize text chunks upon ingestion and encode user queries.
              </p>
            </div>

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1 font-semibold">
                Answer Synthesis Model
              </label>
              <select
                value={settings.generationModel}
                onChange={(e) => setSettings({ ...settings, generationModel: e.target.value })}
                className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] focus:outline-hidden"
              >
                {MODEL_CONFIG.supportedGenerationModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] font-mono text-[#f2efeb]/50 mt-1">
                Generates grounded structured answers with citations via server proxy.
              </p>
            </div>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center justify-between">
          {savedSuccess ? (
            <span className="flex items-center gap-1.5 text-xs text-[#4ade80] font-semibold bg-[#22c55e]/15 px-3 py-1.5 rounded-[2px] border border-[#22c55e]/30 font-mono">
              <Check size={14} />
              <span>Configuration saved to IndexedDB</span>
            </span>
          ) : (
            <div />
          )}

          <button
            type="submit"
            className="inline-flex items-center gap-2 bg-[#ff4d00] hover:bg-[#ff6622] text-white px-5 py-2.5 rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight shadow-xs transition-colors cursor-pointer"
          >
            <Save size={14} />
            <span>Save Configuration</span>
          </button>
        </div>
      </form>

      {/* Architecture & Limitations Section */}
      <div className="mt-10 bg-[#18181a] p-6 rounded-[4px] border border-[rgba(242,239,235,0.1)] space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-[rgba(242,239,235,0.1)]">
          <Info size={16} className="text-[#ff4d00]" />
          <h2 className="font-syne text-sm font-bold uppercase tracking-tight text-[#f2efeb]">Architecture & Privacy Invariants</h2>
        </div>

        <div className="text-xs text-[#f2efeb]/70 space-y-2.5 leading-relaxed font-sans">
          <p>
            • <strong>Browser Persistence:</strong> All PDF source blobs, chunk records, and embeddings are stored locally within your browser via IndexedDB. Documents never get uploaded to external cloud databases.
          </p>
          <p>
            • <strong>Hybrid Retrieval:</strong> Retrieval ranks passages using 88% high-dimensional cosine similarity + 12% lexical token coverage, ensuring technical terminology and exact names are surfaced effectively.
          </p>
          <p>
            • <strong>Verbatim Quote Validation:</strong> Every citation marker <span className="font-mono text-[#ff4d00] font-bold">[n]</span> is checked against raw source passage text. If a quote cannot be verified verbatim, it is flagged as Unverified.
          </p>
        </div>
      </div>

      {/* Danger Zone: Clear all local data */}
      <div className="mt-6 bg-[#18181a] p-6 rounded-[4px] border border-[#ef4444]/30 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-[#ef4444]" />
          <h2 className="font-syne text-sm font-bold text-[#f87171] uppercase tracking-wider">Purge Local Storage</h2>
        </div>
        <p className="text-xs text-[#f2efeb]/60 leading-relaxed font-mono">
          Erase all stored PDF files, chunks, embeddings, conversation threads, and evaluation metrics from IndexedDB. This action is irreversible.
        </p>
        <button
          type="button"
          onClick={() => setShowClearModal(true)}
          className="inline-flex items-center gap-2 bg-[#ef4444]/15 hover:bg-[#ef4444]/25 text-[#f87171] border border-[#ef4444]/30 px-4 py-2 rounded-[2px] font-mono text-xs font-semibold transition-colors cursor-pointer"
        >
          <Trash2 size={14} />
          <span>Clear All Local Storage</span>
        </button>
      </div>

      {/* Clear Confirmation Modal */}
      <Modal
        isOpen={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Purge Entire Local Database"
        description="Irrevocably erase all documents, chunks, vectors, and chats"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowClearModal(false)}
              className="px-3.5 py-2 text-xs font-mono font-medium text-[#f2efeb] bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] hover:bg-[#2c2c30] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isClearing}
              className="px-3.5 py-2 text-xs font-mono font-semibold text-white bg-[#ef4444] rounded-[2px] hover:bg-[#dc2626] disabled:opacity-50 cursor-pointer"
            >
              {isClearing ? 'Purging...' : 'Confirm Purge'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[#f2efeb]">
          Are you sure you want to purge all local data?
        </p>
        <p className="text-xs text-[#f2efeb]/60 mt-2 font-mono">
          This operation will clear all IndexedDB object stores (documents, chunks, embeddings, conversations, collections, evaluations). You will need to re-upload PDFs to conduct research inquiries.
        </p>
      </Modal>
    </div>
  );
};
