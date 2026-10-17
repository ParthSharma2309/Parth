import {
  EvaluationItem,
  EvaluationItemResult,
  EvaluationRun,
  SettingsState,
} from '../types/index.ts';
import { runAnsweringPipeline } from './answering.ts';
import { saveEvaluationRun } from './storage.ts';

function calculatePercentile(numbers: number[], percentile: number): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const index = (percentile / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  if (lower === upper) return Math.round(sorted[lower]);
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
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

  let recallAt3Count = 0;
  let recallAt5Count = 0;
  let totalModelMarkersProduced = 0;
  let totalValidMarkersCount = 0;

  let trueAbstains = 0; // expected false, pipeline abstained
  let falseAbstains = 0; // expected true, pipeline abstained
  let trueAnswers = 0; // expected true, pipeline answered
  let falseAnswers = 0; // expected false, pipeline answered

  const totalExpectedUnanswerable = items.filter((i) => !i.isAnswerable).length;
  const totalExpectedAnswerable = items.filter((i) => i.isAnswerable).length;

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

    totalModelMarkersProduced += pipelineOutput.modelMarkersProduced;
    totalValidMarkersCount += pipelineOutput.validMarkersCount;

    // Check retrieved pages
    const retrievedPages = pipelineOutput.retrievedChunks.map((rc, idx) => ({
      documentId: rc.chunk.documentId,
      pageNumber: rc.chunk.pageNumber,
      score: rc.score,
      rank: idx + 1,
    }));

    // Check Recall@3 and Recall@5
    // Was at least one of the expected pages retrieved in the expected document?
    const expectedPagesSet = new Set(item.expectedPages);
    const isDocMatch = (docId: string) => !item.expectedDocumentId || docId === item.expectedDocumentId;

    const hitAt3 = retrievedPages
      .slice(0, 3)
      .some((rp) => isDocMatch(rp.documentId) && (expectedPagesSet.size === 0 || expectedPagesSet.has(rp.pageNumber)));

    const hitAt5 = retrievedPages
      .slice(0, 5)
      .some((rp) => isDocMatch(rp.documentId) && (expectedPagesSet.size === 0 || expectedPagesSet.has(rp.pageNumber)));

    if (hitAt3) recallAt3Count++;
    if (hitAt5) recallAt5Count++;

    const actualAnswerable = pipelineOutput.status === 'answered';

    if (!item.isAnswerable) {
      if (!actualAnswerable) {
        trueAbstains++;
      } else {
        falseAnswers++;
      }
    } else {
      if (actualAnswerable) {
        trueAnswers++;
      } else {
        falseAbstains++;
      }
    }

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

  const totalItems = items.length;
  const totalAbstains = trueAbstains + falseAbstains;

  // Compute metrics
  const recallAt3 = totalItems > 0 ? (recallAt3Count / totalItems) * 100 : 0;
  const recallAt5 = totalItems > 0 ? (recallAt5Count / totalItems) * 100 : 0;
  const citationValidity =
    totalModelMarkersProduced > 0
      ? (totalValidMarkersCount / totalModelMarkersProduced) * 100
      : 100;

  // Abstention Precision = trueAbstains / (trueAbstains + falseAbstains)
  const abstentionPrecision =
    totalAbstains > 0 ? (trueAbstains / totalAbstains) * 100 : 100;

  // Abstention Recall = trueAbstains / totalExpectedUnanswerable
  const abstentionRecall =
    totalExpectedUnanswerable > 0
      ? (trueAbstains / totalExpectedUnanswerable) * 100
      : 100;

  // False Abstain Rate = falseAbstains / totalExpectedAnswerable
  const falseAbstainRate =
    totalExpectedAnswerable > 0
      ? (falseAbstains / totalExpectedAnswerable) * 100
      : 0;

  const run: EvaluationRun = {
    id: `eval_run_${Date.now()}`,
    createdAt: Date.now(),
    config: { ...settings },
    itemCount: totalItems,
    itemResults,
    metrics: {
      recallAt3: Number(recallAt3.toFixed(1)),
      recallAt5: Number(recallAt5.toFixed(1)),
      citationValidity: Number(citationValidity.toFixed(1)),
      abstentionPrecision: Number(abstentionPrecision.toFixed(1)),
      abstentionRecall: Number(abstentionRecall.toFixed(1)),
      falseAbstainRate: Number(falseAbstainRate.toFixed(1)),
      p50RetrievalLatencyMs: calculatePercentile(retrievalLatencies, 50),
      p95RetrievalLatencyMs: calculatePercentile(retrievalLatencies, 95),
      p50EndToEndLatencyMs: calculatePercentile(totalLatencies, 50),
      p95EndToEndLatencyMs: calculatePercentile(totalLatencies, 95),
    },
  };

  await saveEvaluationRun(run);
  return run;
}
