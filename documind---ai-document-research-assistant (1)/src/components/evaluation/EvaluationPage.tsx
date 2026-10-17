import React, { useState, useEffect } from 'react';
import {
  BarChart2,
  Play,
  Plus,
  Trash2,
  Clock,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  Loader2,
  FileText,
} from 'lucide-react';
import {
  EvaluationItem,
  EvaluationRun,
  EvaluationItemResult,
  DocumentRecord,
} from '../../types/index.ts';
import {
  getEvaluationItems,
  saveEvaluationItem,
  deleteEvaluationItem,
  getEvaluationRuns,
  deleteEvaluationRun,
  getSettings,
} from '../../services/storage.ts';
import { runEvaluationSuite } from '../../services/evalRunner.ts';
import { Modal } from '../ui/Modal.tsx';

interface EvaluationPageProps {
  documents: DocumentRecord[];
}

export const EvaluationPage: React.FC<EvaluationPageProps> = ({ documents }) => {
  const [items, setItems] = useState<EvaluationItem[]>([]);
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentProgress, setCurrentProgress] = useState<{
    completed: number;
    total: number;
    currentQuestion: string;
  } | null>(null);

  // Add Item Modal
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newItemQuestion, setNewItemQuestion] = useState<string>('');
  const [newItemDocId, setNewItemDocId] = useState<string>('');
  const [newItemPages, setNewItemPages] = useState<string>('');
  const [newItemAnswerable, setNewItemAnswerable] = useState<boolean>(true);
  const [newItemNotes, setNewItemNotes] = useState<string>('');

  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const readyDocs = documents.filter((d) => d.status === 'Ready');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [allItems, allRuns] = await Promise.all([
        getEvaluationItems(),
        getEvaluationRuns(),
      ]);
      setItems(allItems);
      setRuns(allRuns);
      if (allRuns.length > 0 && !expandedRunId) {
        setExpandedRunId(allRuns[0].id);
      }
    } catch (err) {
      console.error('Failed to load evaluation items or runs:', err);
    }
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemQuestion.trim()) return;

    const parsedPages = newItemPages
      .split(',')
      .map((p) => parseInt(p.trim(), 10))
      .filter((n) => !isNaN(n) && n > 0);

    const doc = readyDocs.find((d) => d.id === newItemDocId);

    const item: EvaluationItem = {
      id: `eval_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      question: newItemQuestion.trim(),
      expectedDocumentId: newItemDocId || undefined,
      expectedDocumentName: doc?.name || undefined,
      expectedPages: parsedPages,
      isAnswerable: newItemAnswerable,
      notes: newItemNotes.trim() || undefined,
    };

    await saveEvaluationItem(item);
    setItems((prev) => [...prev, item]);
    setShowAddModal(false);

    // Reset fields
    setNewItemQuestion('');
    setNewItemDocId('');
    setNewItemPages('');
    setNewItemAnswerable(true);
    setNewItemNotes('');
  };

  const handleDeleteItem = async (itemId: string) => {
    await deleteEvaluationItem(itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  const handleLoadSampleTestCases = async () => {
    if (readyDocs.length === 0) {
      setNotification({
        type: 'error',
        message: 'Please upload and process at least one ready PDF document first in the Documents tab.',
      });
      return;
    }

    const doc1 = readyDocs[0];
    const doc2 = readyDocs.length > 1 ? readyDocs[1] : doc1;

    const samples: EvaluationItem[] = [
      {
        id: `eval_sample_${Date.now()}_1`,
        question: `What are the core findings or principles established in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [1],
        isAnswerable: true,
        notes: 'Verifies top-ranked recall on first page executive overview',
      },
      {
        id: `eval_sample_${Date.now()}_2`,
        question: `What specific methodologies or data sources are cited in ${doc2.name}?`,
        expectedDocumentId: doc2.id,
        expectedDocumentName: doc2.name,
        expectedPages: doc2.pageCount && doc2.pageCount > 1 ? [2] : [1],
        isAnswerable: true,
        notes: 'Verifies page-grounded retrieval for methodological passages',
      },
      {
        id: `eval_sample_${Date.now()}_3`,
        question: 'What are the quantum superconductivity temperature thresholds reported in this corpus?',
        expectedPages: [],
        isAnswerable: false,
        notes: 'Abstention test case: query is intentionally unsupported by the documents',
      },
      {
        id: `eval_sample_${Date.now()}_4`,
        question: 'What was the fiscal net profit margin for the fiscal year 1842?',
        expectedPages: [],
        isAnswerable: false,
        notes: 'Abstention test case: historical anachronism testing relevance floor',
      },
    ];

    for (const item of samples) {
      await saveEvaluationItem(item);
      setItems((prev) => [...prev, item]);
    }

    setNotification({
      type: 'success',
      message: 'Loaded sample test cases. You can now execute the benchmark.',
    });
  };

  const handleRunEvaluation = async () => {
    if (items.length === 0) {
      setNotification({
        type: 'error',
        message: 'No test cases in the suite. Click "Add Test Case" or "Load Sample Test Cases" first.',
      });
      return;
    }
    if (readyDocs.length === 0) {
      setNotification({
        type: 'error',
        message: 'No ready documents in local IndexedDB storage to evaluate against.',
      });
      return;
    }

    setIsRunning(true);
    setCurrentProgress({ completed: 0, total: items.length, currentQuestion: items[0].question });

    try {
      const settings = await getSettings();
      const runRecord = await runEvaluationSuite(
        items,
        settings,
        (completed: number, total: number, latestResult: EvaluationItemResult) => {
          setCurrentProgress({
            completed,
            total,
            currentQuestion: latestResult.question,
          });
        }
      );

      setRuns((prev) => [runRecord, ...prev]);
      setExpandedRunId(runRecord.id);
      setNotification({
        type: 'success',
        message: `Evaluation completed successfully. Recall@3: ${runRecord.metrics.recallAt3}%, Citation Validity: ${runRecord.metrics.citationValidity}%.`,
      });
    } catch (err: any) {
      console.error('Evaluation run failed:', err);
      setNotification({
        type: 'error',
        message: `Evaluation failed: ${err.message || 'Unknown error occurred'}`,
      });
    } finally {
      setIsRunning(false);
      setCurrentProgress(null);
    }
  };

  const handleDeleteRun = async (runId: string) => {
    await deleteEvaluationRun(runId);
    setRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const latestRun = runs[0];

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full bg-[#111113] text-[#f2efeb]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-[rgba(242,239,235,0.1)]">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-[#ff4d00] block mb-1 font-semibold">
            Empirical Benchmark
          </span>
          <h1 className="font-syne text-2xl md:text-3xl font-extrabold text-[#f2efeb] uppercase tracking-tight">
            Pipeline Evaluation & Benchmarking
          </h1>
          <p className="text-xs md:text-sm text-[#f2efeb]/60 mt-1 font-sans">
            Measure Recall@3, Recall@5, citation validity, and abstention precision against your real document set.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {items.length === 0 && (
            <button
              type="button"
              onClick={handleLoadSampleTestCases}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#18181a] hover:bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] font-syne font-bold text-xs uppercase text-[#f2efeb] shadow-xs transition-colors cursor-pointer"
            >
              <BookOpen size={14} className="text-[#ff4d00]" />
              <span>Load Sample Cases</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#18181a] hover:bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] font-syne font-bold text-xs uppercase text-[#f2efeb] shadow-xs transition-colors cursor-pointer"
          >
            <Plus size={14} />
            <span>Add Test Case</span>
          </button>

          <button
            type="button"
            onClick={handleRunEvaluation}
            disabled={isRunning || items.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#ff4d00] hover:bg-[#ff6622] disabled:bg-[#18181a] disabled:text-[#f2efeb]/30 text-white rounded-[2px] font-syne font-bold text-xs uppercase tracking-tight shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed"
          >
            {isRunning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Running Evaluation...</span>
              </>
            ) : (
              <>
                <Play size={14} />
                <span>Run Evaluation ({items.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* In-app Notification Banner */}
      {notification && (
        <div
          className={`mb-6 p-3.5 rounded-[4px] border flex items-center justify-between text-xs font-mono animate-in fade-in shadow-xs ${
            notification.type === 'error'
              ? 'bg-[#ef4444]/15 border-[#ef4444]/30 text-[#f87171]'
              : notification.type === 'success'
              ? 'bg-[#22c55e]/15 border-[#22c55e]/30 text-[#4ade80]'
              : 'bg-[#ff4d00]/15 border-[#ff4d00]/30 text-[#ff7733]'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'error' ? (
              <AlertTriangle size={15} className="shrink-0" />
            ) : (
              <CheckCircle2 size={15} className="shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs font-mono px-2 py-0.5 rounded bg-black/30 hover:bg-black/50 text-white cursor-pointer ml-3 shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Live running status banner */}
      {isRunning && currentProgress && (
        <div className="mb-6 p-4 bg-[#18181a] border border-[#ff4d00]/40 rounded-[4px] shadow-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-xs font-bold text-[#ff4d00] uppercase tracking-wider">
              Benchmarking Case {currentProgress.completed + 1} of {currentProgress.total}
            </span>
            <span className="text-xs font-mono font-bold text-[#ff4d00]">
              {Math.round(((currentProgress.completed) / currentProgress.total) * 100)}%
            </span>
          </div>
          <div className="w-full bg-[rgba(242,239,235,0.1)] rounded-[2px] h-1.5 mb-2 overflow-hidden">
            <div
              className="bg-[#ff4d00] h-1.5 rounded-[2px] transition-all duration-300"
              style={{ width: `${((currentProgress.completed) / currentProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-xs text-[#f2efeb] truncate font-mono">
            Evaluating: "{currentProgress.currentQuestion}"
          </p>
        </div>
      )}

      {/* Metrics Cards in JetBrains Mono */}
      {latestRun ? (
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-syne text-sm font-bold text-[#f2efeb] uppercase tracking-wider">
                Latest Benchmark Measurements
              </h2>
              <span className="font-mono text-xs text-[#f2efeb]/50">
                Run {new Date(latestRun.createdAt).toLocaleTimeString()} ({latestRun.itemCount} items)
              </span>
            </div>
            <span className="font-mono text-xs text-[#ff4d00] bg-[#ff4d00]/15 px-2 py-0.5 rounded-[2px] border border-[#ff4d00]/30 font-semibold self-start sm:self-auto shrink-0">
              Top-K: {latestRun.config.topK} · Floor: {latestRun.config.similarityThreshold}
            </span>
          </div>

          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
            {/* Recall@3 */}
            <div className="bg-[#18181a] p-4 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
              <span className="font-mono text-[11px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider block mb-1">
                Recall @ 3
              </span>
              <div className="text-2xl font-bold font-mono text-[#ff4d00]">
                {latestRun.metrics.recallAt3}%
              </div>
              <span className="font-mono text-[10px] text-[#f2efeb]/40">Target page in top 3</span>
            </div>

            {/* Recall@5 */}
            <div className="bg-[#18181a] p-4 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
              <span className="font-mono text-[11px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider block mb-1">
                Recall @ 5
              </span>
              <div className="text-2xl font-bold font-mono text-[#ff4d00]">
                {latestRun.metrics.recallAt5}%
              </div>
              <span className="font-mono text-[10px] text-[#f2efeb]/40">Target page in top 5</span>
            </div>

            {/* Citation Validity */}
            <div className="bg-[#18181a] p-4 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
              <span className="font-mono text-[11px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider block mb-1">
                Citation Valid
              </span>
              <div className="text-2xl font-bold font-mono text-[#4ade80]">
                {latestRun.metrics.citationValidity}%
              </div>
              <span className="font-mono text-[10px] text-[#f2efeb]/40">Pre-validation valid</span>
            </div>

            {/* Abstention Precision */}
            <div className="bg-[#18181a] p-4 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
              <span className="font-mono text-[11px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider block mb-1">
                Abstain Prec.
              </span>
              <div className="text-2xl font-bold font-mono text-[#f2efeb]">
                {latestRun.metrics.abstentionPrecision}%
              </div>
              <span className="font-mono text-[10px] text-[#f2efeb]/40">Abstains unanswerable</span>
            </div>

            {/* Abstention Recall */}
            <div className="bg-[#18181a] p-4 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
              <span className="font-mono text-[11px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider block mb-1">
                Abstain Recall
              </span>
              <div className="text-2xl font-bold font-mono text-[#f2efeb]">
                {latestRun.metrics.abstentionRecall}%
              </div>
              <span className="font-mono text-[10px] text-[#f2efeb]/40">Negative cases caught</span>
            </div>

            {/* False Abstain Rate */}
            <div className="bg-[#18181a] p-4 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs">
              <span className="font-mono text-[11px] font-semibold text-[#f2efeb]/50 uppercase tracking-wider block mb-1">
                False Abstain
              </span>
              <div className="text-2xl font-bold font-mono text-[#f87171]">
                {latestRun.metrics.falseAbstainRate}%
              </div>
              <span className="font-mono text-[10px] text-[#f2efeb]/40">Answerable rejected</span>
            </div>
          </div>

          {/* Latency Percentiles */}
          <div className="bg-[#18181a] p-3.5 rounded-[4px] border border-[rgba(242,239,235,0.1)] shadow-xs flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[#f2efeb]/50" />
              <span className="font-bold text-[#f2efeb]">Retrieval Latency:</span>
              <span className="text-[#f2efeb]/60">p50: {latestRun.metrics.p50RetrievalLatencyMs}ms</span>
              <span className="text-[#f2efeb]/30">·</span>
              <span className="text-[#f2efeb]/60">p95: {latestRun.metrics.p95RetrievalLatencyMs}ms</span>
            </div>

            <div className="flex items-center gap-2">
              <Clock size={14} className="text-[#ff4d00]" />
              <span className="font-bold text-[#f2efeb]">End-to-End Latency:</span>
              <span className="text-[#ff4d00] font-semibold">p50: {latestRun.metrics.p50EndToEndLatencyMs}ms</span>
              <span className="text-[#f2efeb]/30">·</span>
              <span className="text-[#ff4d00] font-semibold">p95: {latestRun.metrics.p95EndToEndLatencyMs}ms</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="mb-8 p-8 bg-[#18181a] border border-[rgba(242,239,235,0.1)] rounded-[4px] text-center shadow-xs">
          <BarChart2 size={28} className="text-[#f2efeb]/40 mx-auto mb-2" />
          <h3 className="font-syne text-base font-bold text-[#f2efeb] uppercase tracking-tight">No evaluation runs recorded yet</h3>
          <p className="text-xs font-mono text-[#f2efeb]/50 mt-1 max-w-md mx-auto">
            Configure test questions below and click "Run Evaluation" to calculate genuine pipeline metrics. We never fabricate benchmark figures.
          </p>
        </div>
      )}

      {/* Test Cases Table */}
      <div className="mb-8 bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.1)] p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-[rgba(242,239,235,0.1)]">
          <h2 className="font-syne text-sm font-bold text-[#f2efeb] uppercase tracking-wider">Evaluation Test Cases ({items.length})</h2>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="font-mono text-xs font-semibold text-[#ff4d00] hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Plus size={13} />
            <span>Add test case</span>
          </button>
        </div>

        {items.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-[#f2efeb]/40 italic">
            No test cases in the suite. Click "Add Test Case" or "Load Sample Cases" above.
          </div>
        ) : (
          <div className="overflow-x-auto max-w-full min-w-0">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#0e0e0f] text-[#f2efeb]/60 uppercase font-mono tracking-wider font-semibold border-y border-[rgba(242,239,235,0.1)]">
                <tr>
                  <th className="py-2.5 px-3">Question</th>
                  <th className="py-2.5 px-3">Target Document</th>
                  <th className="py-2.5 px-3">Expected Page(s)</th>
                  <th className="py-2.5 px-3">Answerable?</th>
                  <th className="py-2.5 px-3">Notes</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(242,239,235,0.08)]">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-[#222226]">
                    <td className="py-2.5 px-3 font-medium text-[#f2efeb] max-w-xs truncate">
                      {item.question}
                    </td>
                    <td className="py-2.5 px-3 text-[#f2efeb]/60 truncate max-w-[150px]">
                      {item.expectedDocumentName || 'Any'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[#ff4d00]">
                      {item.expectedPages.length > 0 ? item.expectedPages.join(', ') : 'None'}
                    </td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-[2px] text-[10px] font-mono font-medium ${
                          item.isAnswerable
                            ? 'bg-[#22c55e]/15 text-[#4ade80] border border-[#22c55e]/30'
                            : 'bg-[#ff4d00]/15 text-[#ff7733] border border-[#ff4d00]/30'
                        }`}
                      >
                        {item.isAnswerable ? 'Answerable' : 'Unanswerable (Abstain)'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-[#f2efeb]/50 italic truncate max-w-[140px]">
                      {item.notes || '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-[#f2efeb]/40 hover:text-[#ff6b6b] p-1 rounded-[2px] transition-colors cursor-pointer"
                        title="Delete test case"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Historical Runs Breakdown */}
      {runs.length > 0 && (
        <div className="bg-[#18181a] rounded-[4px] border border-[rgba(242,239,235,0.1)] p-5 shadow-xs">
          <h2 className="font-syne text-sm font-bold text-[#f2efeb] uppercase tracking-wider mb-3 pb-2 border-b border-[rgba(242,239,235,0.1)]">
            Historical Run Ledger ({runs.length})
          </h2>

          <div className="space-y-3">
            {runs.map((run) => {
              const isExpanded = expandedRunId === run.id;
              return (
                <div key={run.id} className="border border-[rgba(242,239,235,0.1)] rounded-[4px] overflow-hidden">
                  <div
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 bg-[#0e0e0f] hover:bg-[#222226] cursor-pointer transition-colors min-w-0 max-w-full"
                  >
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                      <span className="text-xs font-bold text-[#f2efeb] font-mono">
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                      <span className="text-xs text-[#f2efeb]/50 font-mono">
                        ({run.itemCount} cases)
                      </span>
                      <span className="text-xs text-[#ff4d00] font-semibold font-mono bg-[#ff4d00]/15 px-2 py-0.5 rounded-[2px] border border-[#ff4d00]/30 break-words">
                        R@3: {run.metrics.recallAt3}% · R@5: {run.metrics.recallAt5}% · Citation Valid: {run.metrics.citationValidity}%
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteRun(run.id);
                        }}
                        className="p-1 text-[#f2efeb]/40 hover:text-[#ff6b6b]"
                        title="Delete run record"
                      >
                        <Trash2 size={13} />
                      </button>
                      {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="p-4 overflow-x-auto max-w-full min-w-0 text-xs bg-[#18181a]">
                      <table className="w-full text-left">
                        <thead className="bg-[#0e0e0f] text-[#f2efeb]/60 uppercase font-mono tracking-wider font-semibold">
                          <tr>
                            <th className="py-2 px-2">Question</th>
                            <th className="py-2 px-2">Outcome</th>
                            <th className="py-2 px-2">Recall@3</th>
                            <th className="py-2 px-2">Recall@5</th>
                            <th className="py-2 px-2">Valid Citations</th>
                            <th className="py-2 px-2">Retrieval</th>
                            <th className="py-2 px-2">Total Latency</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[rgba(242,239,235,0.08)]">
                          {run.itemResults.map((res: EvaluationItemResult, rIdx: number) => (
                            <tr key={`res-${rIdx}-${res.itemId || ''}`} className="hover:bg-[#222226]">
                              <td className="py-2 px-2 font-medium text-[#f2efeb] max-w-xs truncate" title={res.question}>
                                {res.question}
                              </td>
                              <td className="py-2 px-2">
                                <span
                                  className={`inline-block px-1.5 py-0.5 rounded-[2px] font-mono text-[10px] ${
                                    res.outcome === 'answered'
                                      ? 'bg-[#22c55e]/15 text-[#4ade80] border border-[#22c55e]/30'
                                      : 'bg-[#ff4d00]/15 text-[#ff7733] border border-[#ff4d00]/30'
                                  }`}
                                >
                                  {res.outcome}
                                </span>
                              </td>
                              <td className="py-2 px-2">
                                {res.recallAt3 ? (
                                  <span className="text-[#4ade80] font-bold font-mono">✓ Hit</span>
                                ) : (
                                  <span className="text-[#f2efeb]/40 font-mono">Miss</span>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                {res.recallAt5 ? (
                                  <span className="text-[#4ade80] font-bold font-mono">✓ Hit</span>
                                ) : (
                                  <span className="text-[#f2efeb]/40 font-mono">Miss</span>
                                )}
                              </td>
                              <td className="py-2 px-2 font-mono text-[#f2efeb]">
                                {res.validMarkersCount} / {res.modelMarkersProduced}
                              </td>
                              <td className="py-2 px-2 font-mono text-[#f2efeb]/50">
                                {res.retrievalLatencyMs}ms
                              </td>
                              <td className="py-2 px-2 font-mono text-[#ff4d00] font-semibold">
                                {res.totalLatencyMs}ms
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Test Case Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Evaluation Test Case"
        description="Define an expected question, target page, and ground truth answerability"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-3.5 py-2 text-xs font-mono font-medium text-[#f2efeb] bg-[#222226] border border-[rgba(242,239,235,0.15)] rounded-[2px] hover:bg-[#2c2c30] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAddItem}
              disabled={!newItemQuestion.trim()}
              className="px-3.5 py-2 text-xs font-syne font-bold uppercase tracking-tight text-white bg-[#ff4d00] rounded-[2px] hover:bg-[#ff6622] disabled:opacity-50 cursor-pointer"
            >
              Save Test Case
            </button>
          </>
        }
      >
        <form onSubmit={handleAddItem} className="space-y-3">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1 font-semibold">
              User Question / Prompt *
            </label>
            <input
              type="text"
              value={newItemQuestion}
              onChange={(e) => setNewItemQuestion(e.target.value)}
              placeholder="e.g. What were the third-quarter revenue results?"
              autoFocus
              className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] placeholder-[#f2efeb]/40 focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1 font-semibold">
              Target Document (Optional)
            </label>
            <select
              value={newItemDocId}
              onChange={(e) => setNewItemDocId(e.target.value)}
              className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] focus:outline-hidden"
            >
              <option value="">Any / Not specific</option>
              {readyDocs.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.name} ({doc.pageCount} pages)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1 font-semibold">
              Expected Target Page Numbers (comma-separated, 1-based)
            </label>
            <input
              type="text"
              value={newItemPages}
              onChange={(e) => setNewItemPages(e.target.value)}
              placeholder="e.g. 1, 3, 5"
              className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs text-[#f2efeb] font-mono focus:outline-hidden"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer mt-2 select-none">
              <input
                type="checkbox"
                checked={newItemAnswerable}
                onChange={(e) => setNewItemAnswerable(e.target.checked)}
                className="rounded-[2px] accent-[#ff4d00]"
              />
              <span className="text-xs font-mono text-[#f2efeb]">
                Expected to be answerable (uncheck if this is an abstention test)
              </span>
            </label>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-[#f2efeb]/60 mb-1 font-semibold">
              Test Notes / Objective (Optional)
            </label>
            <input
              type="text"
              value={newItemNotes}
              onChange={(e) => setNewItemNotes(e.target.value)}
              placeholder="e.g. Verifies multi-hop synthesis"
              className="w-full px-3 py-2 bg-[#0e0e0f] border border-[rgba(242,239,235,0.15)] focus:border-[#ff4d00] rounded-[2px] text-xs font-mono text-[#f2efeb] placeholder-[#f2efeb]/40 focus:outline-hidden"
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
