import {
  EvaluationItem,
  EvaluationItemResult,
  EvaluationRun,
  SettingsState,
} from '../types/index.ts';
import { runAnsweringPipeline } from './answering.ts';
import { saveEvaluationRun } from './storage.ts';

export function calculatePercentile(numbers: number[], percentile: number): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) return Math.round(sorted[lower]);
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

export interface EvaluationMetricsSummary {
  recallAt3: number;
  recallAt5: number;
  citationValidity: number;
  abstentionPrecision: number;
  abstentionRecall: number;
  falseAbstainRate: number;
  faithfulnessAndAbstention: number;
  p50RetrievalLatencyMs: number;
  p95RetrievalLatencyMs: number;
  p50EndToEndLatencyMs: number;
  p95EndToEndLatencyMs: number;
  counts: {
    citationNumerator: number;
    citationDenominator: number;
    citationCasesCount: number;
    recallNumerator: number;
    recallDenominator: number;
    faithfulnessNumerator: number;
    faithfulnessDenominator: number;
    trueAnswers: number;
    trueAbstains: number;
    falseAbstains: number;
    falseAnswers: number;
    ungroundedAnswers: number;
  };
}

/**
 * Calculates genuine evaluation metrics from actual probe test case results.
 * 
 * Formulas:
 * 1. Citation Verifiability:
 *    Proportion of evaluated citation markers that verify verbatim in retrieved source passages.
 *    Numerator: sum of validMarkersCount
 *    Denominator: sum of modelMarkersProduced
 *    If Denominator == 0: 0.0% (never 100%)
 * 
 * 2. Recall@5:
 *    Proportion of expected target passages retrieved within top 5 results.
 *    Denominator: number of queries where relevant passages were expected (isAnswerable || expectedPages > 0)
 *    Numerator: number of those queries where top 5 retrieved chunks included an expected passage
 *    If Denominator == 0: 0.0%
 * 
 * 3. Faithfulness & Abstention:
 *    Explicit scoring rule evaluating supported answers and appropriate abstentions.
 *    Correct action (+1) if:
 *      - Expected answerable AND answered with verified citations (True Answer)
 *      - Expected unanswerable AND appropriately abstained (True Abstention)
 *    Incorrect action (0) if:
 *      - Expected answerable but pipeline abstained (False Abstention)
 *      - Expected answerable but answered with 0 verified citations (Ungrounded Answer)
 *      - Expected unanswerable but pipeline answered (False Answer / Hallucination)
 *    Numerator: True Answers + True Abstentions
 *    Denominator: Total Evaluated Cases
 *    If Denominator == 0: 0.0%
 */
export function computeEvaluationMetrics(
  itemResults: EvaluationItemResult[],
  retrievalLatencies: number[] = [],
  totalLatencies: number[] = []
): EvaluationMetricsSummary {
  const totalItems = itemResults.length;

  let totalModelMarkersProduced = 0;
  let totalValidMarkersCount = 0;
  let citationCasesCount = 0;

  let trueAbstains = 0;
  let falseAbstains = 0;
  let trueAnswers = 0;
  let falseAnswers = 0;
  let ungroundedAnswers = 0;

  // Filter items where relevant passages were expected (defined denominator for Recall@5)
  const relevantExpectedItems = itemResults.filter(
    (item) => item.isAnswerable || (item.expectedPages && item.expectedPages.length > 0)
  );

  const recallAt3Hits = relevantExpectedItems.filter((i) => i.recallAt3).length;
  const recallAt5Hits = relevantExpectedItems.filter((i) => i.recallAt5).length;
  const recallDenominator = relevantExpectedItems.length;

  for (const item of itemResults) {
    const markersProduced = item.modelMarkersProduced || 0;
    const validMarkers = item.validMarkersCount || 0;
    totalModelMarkersProduced += markersProduced;
    totalValidMarkersCount += validMarkers;

    if (markersProduced > 0) {
      citationCasesCount++;
    }

    const actualAnswered = item.actualAnswerable;

    if (!item.isAnswerable) {
      // Expected to abstain
      if (!actualAnswered) {
        trueAbstains++; // Correct honest abstention
      } else {
        falseAnswers++; // Hallucination on ungrounded query
      }
    } else {
      // Expected to answer
      if (actualAnswered) {
        const hasVerifiedCitations = validMarkers > 0 || (item.citationValidityRate || 0) > 0;
        if (hasVerifiedCitations) {
          trueAnswers++; // Grounded, supported answer
        } else {
          ungroundedAnswers++; // Answered without valid supporting citations
        }
      } else {
        falseAbstains++; // Abstained on valid answerable query
      }
    }
  }

  // 1. Citation Verifiability
  const citationValidity =
    totalModelMarkersProduced > 0
      ? (totalValidMarkersCount / totalModelMarkersProduced) * 100
      : 0;

  // 2. Recall@5 & Recall@3
  const recallAt5 =
    recallDenominator > 0 ? (recallAt5Hits / recallDenominator) * 100 : 0;
  const recallAt3 =
    recallDenominator > 0 ? (recallAt3Hits / recallDenominator) * 100 : 0;

  // 3. Faithfulness & Abstention
  const faithfulnessNumerator = trueAnswers + trueAbstains;
  const faithfulnessDenominator = totalItems;
  const faithfulnessAndAbstention =
    faithfulnessDenominator > 0
      ? (faithfulnessNumerator / faithfulnessDenominator) * 100
      : 0;

  // Diagnostic rates
  const totalAbstains = trueAbstains + falseAbstains;
  const totalExpectedUnanswerable = itemResults.filter((i) => !i.isAnswerable).length;
  const totalExpectedAnswerable = itemResults.filter((i) => i.isAnswerable).length;

  const abstentionPrecision =
    totalAbstains > 0 ? (trueAbstains / totalAbstains) * 100 : 0;
  const abstentionRecall =
    totalExpectedUnanswerable > 0
      ? (trueAbstains / totalExpectedUnanswerable) * 100
      : 0;
  const falseAbstainRate =
    totalExpectedAnswerable > 0
      ? (falseAbstains / totalExpectedAnswerable) * 100
      : 0;

  return {
    recallAt3: Number(recallAt3.toFixed(1)),
    recallAt5: Number(recallAt5.toFixed(1)),
    citationValidity: Number(citationValidity.toFixed(1)),
    abstentionPrecision: Number(abstentionPrecision.toFixed(1)),
    abstentionRecall: Number(abstentionRecall.toFixed(1)),
    falseAbstainRate: Number(falseAbstainRate.toFixed(1)),
    faithfulnessAndAbstention: Number(faithfulnessAndAbstention.toFixed(1)),
    p50RetrievalLatencyMs: calculatePercentile(retrievalLatencies, 50),
    p95RetrievalLatencyMs: calculatePercentile(retrievalLatencies, 95),
    p50EndToEndLatencyMs: calculatePercentile(totalLatencies, 50),
    p95EndToEndLatencyMs: calculatePercentile(totalLatencies, 95),
    counts: {
      citationNumerator: totalValidMarkersCount,
      citationDenominator: totalModelMarkersProduced,
      citationCasesCount,
      recallNumerator: recallAt5Hits,
      recallDenominator,
      faithfulnessNumerator,
      faithfulnessDenominator,
      trueAnswers,
      trueAbstains,
      falseAbstains,
      falseAnswers,
      ungroundedAnswers,
    },
  };
}

/**
 * Runs the evaluation suite against the real pipeline and calculates exact benchmark metrics.
 */
export async function runEvaluationSuite(
  items: EvaluationItem[],
  settings: SettingsState,
  onItemCompleted?: (completed: number, total: number, latestResult: EvaluationItemResult) => void
): Promise<EvaluationRun> {
  const itemResults: EvaluationItemResult[] = [];
  const retrievalLatencies: number[] = [];
  const totalLatencies: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const dummyConversationId = `eval_${Date.now()}_${i}`;

    const pipelineOutput = await runAnsweringPipeline({
      conversationId: dummyConversationId,
      userQuestion: item.question,
      history: [],
      scope: { type: 'all' },
      settings,
    });

    retrievalLatencies.push(pipelineOutput.latencyMs.retrieval);
    totalLatencies.push(pipelineOutput.latencyMs.total);

    // Check retrieved pages
    const retrievedPages = pipelineOutput.retrievedChunks.map((rc, idx) => ({
      documentId: rc.chunk.documentId,
      pageNumber: rc.chunk.pageNumber,
      score: rc.score,
      rank: idx + 1,
    }));

    // Check Recall@3 and Recall@5 against target expected document and pages
    const hasExpectedPages = item.expectedPages && item.expectedPages.length > 0;
    const expectedPagesSet = new Set(item.expectedPages);
    const isDocMatch = (docId: string) => !item.expectedDocumentId || docId === item.expectedDocumentId;

    // A query only scores a recall hit if it has expected relevant targets
    const isTargetQuery = item.isAnswerable || hasExpectedPages;
    const hitAt3 =
      isTargetQuery &&
      retrievedPages
        .slice(0, 3)
        .some((rp) => isDocMatch(rp.documentId) && (!hasExpectedPages || expectedPagesSet.has(rp.pageNumber)));

    const hitAt5 =
      isTargetQuery &&
      retrievedPages
        .slice(0, 5)
        .some((rp) => isDocMatch(rp.documentId) && (!hasExpectedPages || expectedPagesSet.has(rp.pageNumber)));

    const actualAnswerable = pipelineOutput.status === 'answered';

    const itemResult: EvaluationItemResult = {
      itemId: item.id,
      question: item.question,
      expectedDocumentName: item.expectedDocumentName || 'Any',
      expectedPages: item.expectedPages,
      isAnswerable: item.isAnswerable,
      actualAnswerable,
      retrievedPages,
      recallAt3: hitAt3,
      recallAt5: hitAt5,
      modelMarkersProduced: pipelineOutput.modelMarkersProduced,
      validMarkersCount: pipelineOutput.validMarkersCount,
      citationValidityRate: pipelineOutput.citationValidityRate,
      outcome: pipelineOutput.status,
      retrievalLatencyMs: pipelineOutput.latencyMs.retrieval,
      totalLatencyMs: pipelineOutput.latencyMs.total,
      answerText: pipelineOutput.answerText,
      citations: pipelineOutput.citations,
    };

    itemResults.push(itemResult);
    onItemCompleted?.(i + 1, items.length, itemResult);
  }

  const metrics = computeEvaluationMetrics(itemResults, retrievalLatencies, totalLatencies);

  const run: EvaluationRun = {
    id: `eval_run_${Date.now()}`,
    createdAt: Date.now(),
    config: { ...settings },
    itemCount: items.length,
    itemResults,
    metrics,
  };

  await saveEvaluationRun(run);
  return run;
}

export interface EvaluationThresholdCheck {
  passed: boolean;
  citationAccuracy: number;
  threshold: number;
  reason?: string;
}

/**
 * Checks evaluation results against regression threshold (fails if citation accuracy < minCitationAccuracy or no items)
 */
export function checkEvaluationThreshold(
  run: EvaluationRun,
  minCitationAccuracy = 90
): EvaluationThresholdCheck {
  if (!run || run.itemCount === 0 || !run.itemResults || run.itemResults.length === 0) {
    return {
      passed: false,
      citationAccuracy: 0,
      threshold: minCitationAccuracy,
      reason: 'No evaluation test cases executed. Deployment gate requires a valid benchmark run.',
    };
  }

  const citationAccuracy = run.metrics.citationValidity;
  const passed = citationAccuracy >= minCitationAccuracy;
  return {
    passed,
    citationAccuracy,
    threshold: minCitationAccuracy,
    reason: passed
      ? undefined
      : `Citation accuracy ${citationAccuracy.toFixed(1)}% is below required ${minCitationAccuracy}% threshold. Deployment gate failed.`,
  };
}

/**
 * Standard percentage formatter ensuring values are consistently formatted without 10000% errors.
 */
export function formatPercentage(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '0.0%';
  return `${Number(value.toFixed(1))}%`;
}

/**
 * Exports an evaluation run and its detailed probe results as downloadable JSON
 */
export function exportEvaluationRunAsJson(run: EvaluationRun): {
  blob: Blob;
  fileName: string;
} {
  const data = JSON.stringify(run, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const fileName = `documind_eval_run_${run.id}_${new Date(run.createdAt).toISOString().slice(0, 10)}.json`;
  return { blob, fileName };
}
