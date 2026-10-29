import React, { useState, useEffect } from 'react';
import {
  Play,
  RotateCcw,
  Plus,
  Trash2,
  Clock,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Sparkles,
  FileCheck,
  Download,
  Info,
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
import {
  runEvaluationSuite,
  checkEvaluationThreshold,
  exportEvaluationRunAsJson,
  computeEvaluationMetrics,
  formatPercentage,
} from '../../services/evalRunner.ts';
import { useToast } from '../ui/Toast.tsx';

interface EvaluationPageProps {
  documents: DocumentRecord[];
}

// Ease-out counter from 0 to score
function useScoreCountUp(target: number, durationMs: number = 1100): number {
  const [val, setVal] = useState<number>(0);
  useEffect(() => {
    if (target === 0) {
      setVal(0);
      return;
    }
    let startTimestamp: number | null = null;
    let animId: number;
    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const elapsed = timestamp - startTimestamp;
      const progress = Math.min(elapsed / durationMs, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setVal(Math.round(easeOut * target));
      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [target, durationMs]);
  return val;
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

  const { showToast } = useToast();
  const readyDocs = documents.filter((d) => String(d.status).toLowerCase() === 'ready');

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
    } catch (err) {
      console.error('Failed to load evaluation items or runs:', err);
    }
  };

  const handleRunEvaluation = async () => {
    if (items.length === 0) {
      // Auto populate sample test items if none exist
      if (readyDocs.length === 0) {
        showToast({
          message: 'Please upload at least one ready PDF document first in the Documents tab.',
          type: 'error',
        });
        return;
      }
      await handleSeedSampleTests();
      return;
    }

    setIsRunning(true);
    setCurrentProgress({
      completed: 0,
      total: items.length,
      currentQuestion: items[0].question,
    });

    try {
      const settings = await getSettings();
      const newRun = await runEvaluationSuite(
        items,
        settings,
        (completed, total, latestResult) => {
          setCurrentProgress({
            completed,
            total,
            currentQuestion: latestResult?.question || '',
          });
        }
      );

      setRuns((prev) => [newRun, ...prev]);

      const thresholdCheck = checkEvaluationThreshold(newRun, 90);
      if (thresholdCheck.passed) {
        showToast({
          message: `Benchmark passed! Citation accuracy: ${thresholdCheck.citationAccuracy}% (>= 90%) 🎉`,
          type: 'success',
        });
      } else {
        showToast({
          message: `Regression detected: Citation accuracy ${thresholdCheck.citationAccuracy}% is below 90% threshold! Deployments blocked.`,
          type: 'error',
        });
      }
    } catch (err: any) {
      console.error('Evaluation run error:', err);
      showToast({ message: `Evaluation failed: ${err.message}`, type: 'error' });
    } finally {
      setIsRunning(false);
      setCurrentProgress(null);
    }
  };

  const handleExportRunJson = (runToExport: EvaluationRun) => {
    try {
      const { blob, fileName } = exportEvaluationRunAsJson(runToExport);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast({
        message: `Evaluation run exported as JSON (${(blob.size / 1024).toFixed(1)} KB)`,
        type: 'success',
      });
    } catch (err: any) {
      showToast({ message: `Export failed: ${err.message}`, type: 'error' });
    }
  };

  const handleSeedSampleTests = async () => {
    if (readyDocs.length === 0) return;
    const doc1 = readyDocs[0];
    const doc2 = readyDocs.length > 1 ? readyDocs[1] : doc1;

    const samples: EvaluationItem[] = [
      {
        id: `eval_sample_${Date.now()}_1`,
        question: `What are the core empirical findings or primary conclusions in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [1],
        isAnswerable: true,
      },
      {
        id: `eval_sample_${Date.now()}_2`,
        question: `What experimental frameworks, quantitative metrics, or equations are documented in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [1, 2],
        isAnswerable: true,
      },
      {
        id: `eval_sample_${Date.now()}_3`,
        question: `Summarize the analytical methodology and procedural steps in ${doc2.name}.`,
        expectedDocumentId: doc2.id,
        expectedDocumentName: doc2.name,
        expectedPages: [1],
        isAnswerable: true,
      },
      {
        id: `eval_sample_${Date.now()}_4`,
        question: `What unsubstantiated historical patents from 1820 are cited in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [],
        isAnswerable: false, // Honesty test case (should abstain)
      },
    ];

    for (const item of samples) {
      await saveEvaluationItem(item);
    }
    setItems(samples);
    showToast({ message: 'Loaded 4 standard benchmark test cases', type: 'info' });
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
    };

    await saveEvaluationItem(item);
    setItems((prev) => [...prev, item]);
    setShowAddModal(false);
    setNewItemQuestion('');
    setNewItemDocId('');
    setNewItemPages('');
    setNewItemAnswerable(true);
    showToast({ message: 'Test question added', type: 'success' });
  };

  const handleDeleteItem = async (itemId: string) => {
    await deleteEvaluationItem(itemId);
    setItems((prev) => prev.filter((i) => i.id !== itemId));
  };

  // Derive genuine metrics from the latest run, or state that no valid evaluation exists
  const latestRun = runs.length > 0 ? runs[0] : null;
  const hasValidRun = Boolean(latestRun && latestRun.itemCount > 0 && latestRun.itemResults.length > 0);

  // If latest run exists, compute or retrieve full metric counts
  const runMetrics = hasValidRun && latestRun
    ? latestRun.metrics.counts
      ? latestRun.metrics
      : computeEvaluationMetrics(latestRun.itemResults)
    : null;

  // Genuine scores (0-100 scale, NOT multiplied by 100 again)
  const rawScore1 = runMetrics ? runMetrics.citationValidity : 0;
  const rawScore2 = runMetrics ? runMetrics.recallAt5 : 0;
  const rawScore3 = runMetrics
    ? (runMetrics.faithfulnessAndAbstention ?? runMetrics.abstentionPrecision ?? 0)
    : 0;

  const animScore1 = useScoreCountUp(hasValidRun ? Math.round(rawScore1) : 0, 1100);
  const animScore2 = useScoreCountUp(hasValidRun ? Math.round(rawScore2) : 0, 1100);
  const animScore3 = useScoreCountUp(hasValidRun ? Math.round(rawScore3) : 0, 1100);

  const counts = runMetrics?.counts || {
    citationNumerator: 0,
    citationDenominator: 0,
    citationCasesCount: 0,
    recallNumerator: 0,
    recallDenominator: 0,
    faithfulnessNumerator: 0,
    faithfulnessDenominator: 0,
    trueAnswers: 0,
    trueAbstains: 0,
    falseAbstains: 0,
    falseAnswers: 0,
    ungroundedAnswers: 0,
  };

  const scoreCards = [
    {
      title: 'Citation Verifiability',
      subtitle: 'Passage Anchor Rate',
      score: animScore1,
      exactScore: rawScore1,
      color: 'var(--teal)',
      numerator: counts.citationNumerator,
      denominator: counts.citationDenominator,
      unit: 'citations verified',
      casesCount: counts.citationCasesCount,
      scopeLabel: `${counts.citationCasesCount} query cases with citations`,
      formula: 'Verified Citations / Total Generated Citations',
      description: 'Proportion of model citation markers [1], [2] verified verbatim in retrieved source passages.',
    },
    {
      title: 'Recall @ 5',
      subtitle: 'Top-5 Passage Retrieval',
      score: animScore2,
      exactScore: rawScore2,
      color: 'var(--a1)',
      numerator: counts.recallNumerator,
      denominator: counts.recallDenominator,
      unit: 'queries with target in top 5',
      casesCount: counts.recallDenominator,
      scopeLabel: `${counts.recallDenominator} queries with target passages`,
      formula: 'Queries with Target Passage in Top 5 / Relevant Target Queries',
      description: 'Proportion of relevant expected document passages retrieved within the top 5 ranking results.',
    },
    {
      title: 'Faithfulness & Abstention',
      subtitle: 'Hallucination Floor',
      score: animScore3,
      exactScore: rawScore3,
      color: 'var(--a2)',
      numerator: counts.faithfulnessNumerator,
      denominator: counts.faithfulnessDenominator,
      unit: 'correct decisions',
      casesCount: counts.faithfulnessDenominator,
      scopeLabel: `${counts.trueAnswers} grounded answers + ${counts.trueAbstains} valid abstentions`,
      formula: '(True Answers + True Abstentions) / Total Evaluated Test Cases',
      description: 'Evaluates whether the system answered when evidence was present and honestly abstained when evidence was missing.',
    },
  ];

  const thresholdCheck = latestRun ? checkEvaluationThreshold(latestRun, 90) : null;

  return (
    <div className="w-full text-[var(--ink)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 pb-5 border-b border-[color-mix(in_srgb,var(--mute)_18%,transparent)] reveal">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1.5 rounded-full bg-[var(--teal)]/15 text-[var(--teal)]">
              <FileCheck size={15} />
            </span>
            <span className="mono">
              Empirical Retrieval &amp; Faithfulness Benchmark
            </span>
          </div>
          <h2>
            Quality <span className="ser">report</span>
          </h2>
          <p className="text-xs sm:text-sm text-[var(--mute)] mt-1">
            Objective evaluation of citation verifiability, top-k recall, and honest abstention.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="btn outline sm"
          >
            <Plus size={14} className="text-[var(--a1)]" />
            <span>Add Test Case</span>
          </button>

          {hasValidRun && latestRun && (
            <button
              type="button"
              onClick={() => handleExportRunJson(latestRun)}
              className="btn outline sm flex items-center gap-1.5"
              title="Export complete evaluation run with probe scores and citations as JSON"
            >
              <Download size={14} className="text-[var(--a1)]" />
              <span>Export JSON</span>
            </button>
          )}

          {/* "Run Suite" button with live progress */}
          <button
            type="button"
            onClick={handleRunEvaluation}
            disabled={isRunning}
            className="btn sm flex items-center gap-2 cursor-pointer"
          >
            {isRunning ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Running Suite ({currentProgress ? `${currentProgress.completed}/${currentProgress.total}` : '...'})</span>
              </>
            ) : (
              <>
                <RotateCcw size={14} />
                <span>{hasValidRun ? 'Run again' : 'Run Evaluation'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Deployment Gate Banner */}
      {!isRunning && (
        <div className="mb-6">
          {!hasValidRun ? (
            <div className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] border-[color-mix(in_srgb,var(--mute)_22%,transparent)] text-[var(--mute)]">
              <div className="flex items-start sm:items-center gap-3">
                <Clock size={20} className="shrink-0 mt-0.5 sm:mt-0 text-[var(--a1)]" />
                <div>
                  <p className="text-sm font-bold tracking-tight text-[var(--ink)]">
                    Deployment Gate: Awaiting Evaluation
                  </p>
                  <p className="text-xs opacity-85 mt-0.5">
                    No benchmark evaluation has been run yet. Click "Run Evaluation" to test citation accuracy against the 90.0% deployment threshold.
                  </p>
                </div>
              </div>
            </div>
          ) : thresholdCheck?.passed ? (
            <div className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all bg-[var(--teal)]/10 border-[var(--teal)]/30 text-[var(--teal)]">
              <div className="flex items-start sm:items-center gap-3">
                <CheckCircle2 size={20} className="shrink-0 mt-0.5 sm:mt-0" />
                <div>
                  <p className="text-sm font-bold tracking-tight">
                    Deployment Gate: PASSED (Citation Accuracy: {formatPercentage(thresholdCheck.citationAccuracy)} ≥ {thresholdCheck.threshold}%)
                  </p>
                  <p className="text-xs opacity-85 mt-0.5">
                    Citation verification benchmark passed with {formatPercentage(thresholdCheck.citationAccuracy)} empirical validity across {latestRun?.itemCount} test cases. Production quality targets satisfied.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => latestRun && handleExportRunJson(latestRun)}
                className="btn outline sm text-xs shrink-0 self-start sm:self-auto flex items-center gap-1.5"
              >
                <Download size={13} />
                <span>Download JSON</span>
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400">
              <div className="flex items-start sm:items-center gap-3">
                <AlertTriangle size={20} className="shrink-0 mt-0.5 sm:mt-0 text-rose-500" />
                <div>
                  <p className="text-sm font-bold tracking-tight">
                    Deployment Gate: FAILED — Regression Detected (Citation Accuracy: {formatPercentage(thresholdCheck?.citationAccuracy)} &lt; {thresholdCheck?.threshold}%)
                  </p>
                  <p className="text-xs opacity-85 mt-0.5">
                    Automated quality threshold not met: citation accuracy is {formatPercentage(thresholdCheck?.citationAccuracy)}, below the required 90.0% deployment threshold.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => latestRun && handleExportRunJson(latestRun)}
                className="btn outline sm text-xs shrink-0 self-start sm:self-auto flex items-center gap-1.5"
              >
                <Download size={13} />
                <span>Download JSON</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Live Progress Banner when running */}
      {isRunning && currentProgress && (
        <div
          style={{
            borderRadius: '24px',
            background: 'var(--card)',
            boxShadow: 'var(--sh)',
          }}
          className="p-4 mb-8 border border-[var(--a1)] animate-in fade-in"
        >
          <div className="flex items-center justify-between text-xs font-bold mb-2">
            <span className="flex items-center gap-2 text-[var(--a1)]">
              <Loader2 size={13} className="animate-spin" />
              <span>Evaluating item {currentProgress.completed + 1} of {currentProgress.total}...</span>
            </span>
            <span className="mono">{Math.round((currentProgress.completed / currentProgress.total) * 100)}%</span>
          </div>
          <div className="w-full bg-[color-mix(in_srgb,var(--mute)_15%,transparent)] h-2 rounded-full overflow-hidden">
            <div
              className="bg-gradient-to-r from-[var(--a1)] to-[var(--a2)] h-full transition-all duration-300"
              style={{ width: `${(currentProgress.completed / currentProgress.total) * 100}%` }}
            />
          </div>
          <p className="mono text-[11px] text-[var(--mute)] mt-2 truncate">
            Query: "{currentProgress.currentQuestion}"
          </p>
        </div>
      )}

      {/* THREE SCORE CARDS with conic-gradient ring and explicit numerator / denominator */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10 reveal">
        {scoreCards.map((card, idx) => (
          <div
            key={idx}
            style={{
              borderRadius: '36px',
              background: 'var(--card)',
              boxShadow: 'var(--sh)',
              padding: '28px 24px',
            }}
            className="spot flex flex-col items-center text-center border border-[color-mix(in_srgb,var(--mute)_18%,transparent)] relative"
          >
            <span className="mono text-[11px] font-bold text-[var(--mute)] uppercase tracking-wider mb-1">
              {card.subtitle}
            </span>
            <h3 className="text-base font-bold text-[var(--ink)] mb-1">
              {card.title}
            </h3>

            {/* Conic-gradient ring (handles dark theme properly with color-mix unreached track) */}
            <div
              style={{
                width: '110px',
                height: '110px',
                borderRadius: '50%',
                background: hasValidRun
                  ? `conic-gradient(${card.color} ${card.score}%, color-mix(in srgb, var(--mute) 16%, transparent) 0%)`
                  : 'color-mix(in srgb, var(--mute) 14%, transparent)',
                padding: '4px',
              }}
              className="relative flex items-center justify-center shrink-0 my-4 shadow-xs transition-all duration-500"
            >
              <div
                style={{
                  width: '84px',
                  height: '84px',
                  borderRadius: '50%',
                  background: 'var(--card)',
                  color: 'var(--ink)',
                }}
                className="flex items-center justify-center font-extrabold text-2xl font-mono shadow-inner"
              >
                {hasValidRun ? `${card.score}%` : '—'}
              </div>
            </div>

            {/* Numerator / Denominator & Evaluated Cases Breakdown */}
            <div className="w-full bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] border border-[color-mix(in_srgb,var(--mute)_14%,transparent)] rounded-2xl p-2.5 my-2 text-left space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--mute)] font-medium">Metric Score:</span>
                <span className="mono font-bold text-[var(--ink)]">
                  {hasValidRun ? formatPercentage(card.exactScore) : 'No data'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--mute)] font-medium">Ratio:</span>
                <span className="mono font-bold text-[var(--ink)]">
                  {hasValidRun ? `${card.numerator} / ${card.denominator}` : '0 / 0'}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[color-mix(in_srgb,var(--mute)_12%,transparent)]">
                <span className="text-[var(--mute)]">Evaluated:</span>
                <span className="mono text-[var(--mute)] font-medium">
                  {hasValidRun ? card.scopeLabel : '0 test cases'}
                </span>
              </div>
            </div>

            <p className="text-xs text-[var(--mute)] leading-relaxed mt-2 max-w-[240px]">
              {card.description}
            </p>
          </div>
        ))}
      </div>

      {/* Test Questions & Verification Checks List */}
      <div className="space-y-3 mb-10 reveal">
        <div className="flex items-center justify-between px-2 mb-2">
          <div>
            <h3 className="text-base font-bold text-[var(--ink)]">
              Empirical Test Questions &amp; Verification Checks
            </h3>
            <p className="text-xs text-[var(--mute)] mt-0.5">
              {hasValidRun
                ? `Showing actual evaluated outputs from run ${latestRun?.id}`
                : 'Pending evaluation run against active document corpus'}
            </p>
          </div>
          <span className="mono text-xs text-[var(--mute)]">
            {hasValidRun ? `${latestRun?.itemResults.length} evaluated` : `${items.length} queued`}
          </span>
        </div>

        {!hasValidRun ? (
          items.length === 0 ? (
            <div
              style={{
                borderRadius: '36px',
                background: 'var(--card)',
                boxShadow: 'var(--sh)',
              }}
              className="text-center py-12 p-6 border border-[color-mix(in_srgb,var(--mute)_18%,transparent)]"
            >
              <p className="text-xs text-[var(--mute)] mb-3">
                No evaluation test items loaded yet.
              </p>
              <button
                type="button"
                onClick={handleSeedSampleTests}
                className="btn sm cursor-pointer"
              >
                <span>Seed Sample Test Suite</span>
              </button>
            </div>
          ) : (
            items.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  borderRadius: '99px',
                  background: 'var(--card)',
                  boxShadow: 'var(--sh)',
                }}
                className="spot flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5 border border-[color-mix(in_srgb,var(--mute)_15%,transparent)] opacity-80"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="mono text-[11px] font-bold text-[var(--mute)] shrink-0">
                    #{idx + 1}
                  </span>
                  <p className="text-xs sm:text-[13px] font-medium text-[var(--ink)] truncate">
                    {item.question}
                  </p>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="mono text-[11px] text-[var(--mute)] hidden md:inline truncate max-w-[160px]">
                    {item.expectedDocumentName || 'Indexed Folio'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[11px] font-medium rounded-full bg-[color-mix(in_srgb,var(--mute)_12%,transparent)] text-[var(--mute)] border border-[color-mix(in_srgb,var(--mute)_20%,transparent)]">
                    Pending Run
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteItem(item.id)}
                    className="p-1 rounded-full text-[var(--mute)] hover:text-[var(--err)] transition-colors cursor-pointer"
                    title="Remove test item"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )
        ) : (
          latestRun?.itemResults.map((q, idx) => {
            // Determine explicit faithfulness status
            let badgeText = '';
            let badgeBg = '';
            let badgeColor = '';
            let badgeBorder = '';

            if (q.isAnswerable) {
              if (q.actualAnswerable) {
                if (q.validMarkersCount > 0 || q.citationValidityRate > 0) {
                  badgeText = `✓ Grounded (${q.validMarkersCount}/${q.modelMarkersProduced} citations)`;
                  badgeBg = 'rgba(12, 143, 122, 0.15)';
                  badgeColor = '#0c8f7a';
                  badgeBorder = 'rgba(12, 143, 122, 0.35)';
                } else {
                  badgeText = '✕ Ungrounded (0 valid citations)';
                  badgeBg = 'rgba(229, 72, 77, 0.15)';
                  badgeColor = 'var(--err)';
                  badgeBorder = 'rgba(229, 72, 77, 0.35)';
                }
              } else {
                badgeText = '✕ False Abstention';
                badgeBg = 'rgba(245, 158, 11, 0.15)';
                badgeColor = '#d97706';
                badgeBorder = 'rgba(245, 158, 11, 0.35)';
              }
            } else {
              if (!q.actualAnswerable) {
                badgeText = '✓ Valid Abstention';
                badgeBg = 'rgba(12, 143, 122, 0.15)';
                badgeColor = '#0c8f7a';
                badgeBorder = 'rgba(12, 143, 122, 0.35)';
              } else {
                badgeText = '✕ False Answer (Hallucination)';
                badgeBg = 'rgba(229, 72, 77, 0.15)';
                badgeColor = 'var(--err)';
                badgeBorder = 'rgba(229, 72, 77, 0.35)';
              }
            }

            return (
              <div
                key={q.itemId || idx}
                style={{
                  borderRadius: '99px',
                  background: 'var(--card)',
                  boxShadow: 'var(--sh)',
                }}
                className="spot flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5 border border-[color-mix(in_srgb,var(--mute)_15%,transparent)] transition-transform hover:translate-x-1 duration-200"
              >
                {/* Question Text */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="mono text-[11px] font-bold text-[var(--mute)] shrink-0">
                    #{idx + 1}
                  </span>
                  <p className="text-xs sm:text-[13px] font-medium text-[var(--ink)] truncate">
                    {q.question}
                  </p>
                </div>

                {/* Document / Page tag & Latency */}
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="mono text-[10px] text-[var(--mute)] hidden lg:inline">
                    {q.retrievalLatencyMs}ms ret / {q.totalLatencyMs}ms tot
                  </span>
                  <span className="mono text-[11px] text-[var(--mute)] hidden md:inline truncate max-w-[140px]">
                    {q.expectedDocumentName}
                  </span>

                  {/* Status chip */}
                  <span
                    style={{
                      background: badgeBg,
                      color: badgeColor,
                      border: `1px solid ${badgeBorder}`,
                      borderRadius: '99px',
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[11px] font-bold shadow-2xs"
                  >
                    <span>{badgeText}</span>
                  </span>

                  {/* Delete option if it matches an item in current list */}
                  {items.some((i) => i.id === q.itemId) && (
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(q.itemId)}
                      className="p-1 rounded-full text-[var(--mute)] hover:text-[var(--err)] transition-colors cursor-pointer"
                      title="Remove test item"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add Test Case Modal */}
      {showAddModal && (
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
            className="bg-[var(--card)] p-6 sm:p-7 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] max-w-md w-full space-y-4 shadow-xl text-[var(--ink)] animate-in fade-in zoom-in-95"
          >
            <h3 className="text-lg font-bold text-[var(--ink)]">Add Evaluation Test Case</h3>
            <form onSubmit={handleAddItem} className="space-y-3.5">
              <div>
                <label className="mono text-xs font-bold block mb-1">Question to test</label>
                <input
                  type="text"
                  value={newItemQuestion}
                  onChange={(e) => setNewItemQuestion(e.target.value)}
                  placeholder="e.g. What is the reported yield in Table 2?"
                  style={{ borderRadius: '99px' }}
                  className="w-full px-4 py-2 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)]"
                  required
                />
              </div>

              <div>
                <label className="mono text-xs font-bold block mb-1">Target Document (optional)</label>
                <select
                  value={newItemDocId}
                  onChange={(e) => setNewItemDocId(e.target.value)}
                  style={{ borderRadius: '99px' }}
                  className="w-full px-4 py-2 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)]"
                >
                  <option value="">Any indexed document</option>
                  {readyDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.pageCount} pages)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mono text-xs font-bold block mb-1">Expected Pages (e.g. 1, 2)</label>
                <input
                  type="text"
                  value={newItemPages}
                  onChange={(e) => setNewItemPages(e.target.value)}
                  placeholder="1, 2"
                  style={{ borderRadius: '99px' }}
                  className="w-full px-4 py-2 border border-[color-mix(in_srgb,var(--mute)_22%,transparent)] bg-[color-mix(in_srgb,var(--mute)_8%,transparent)] text-xs text-[var(--ink)] focus:outline-hidden focus:border-[var(--a1)]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="answerable"
                  checked={newItemAnswerable}
                  onChange={(e) => setNewItemAnswerable(e.target.checked)}
                  className="rounded text-[var(--a1)]"
                />
                <label htmlFor="answerable" className="text-xs font-medium cursor-pointer">
                  Expect positive answer (uncheck to test honest abstention)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[color-mix(in_srgb,var(--mute)_15%,transparent)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn outline sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn sm"
                >
                  Save Test Question
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
