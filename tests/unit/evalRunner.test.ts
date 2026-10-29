import { describe, it, expect } from 'vitest';
import {
  checkEvaluationThreshold,
  exportEvaluationRunAsJson,
  computeEvaluationMetrics,
  formatPercentage,
} from '../../src/services/evalRunner.ts';
import { EvaluationRun, EvaluationItemResult } from '../../src/types/index.ts';

describe('Evaluation Metrics, Benchmark Formulas & Regression Gate (evalRunner.test.ts)', () => {
  // Helpers to construct mock item results
  const makeItemResult = (overrides: Partial<EvaluationItemResult> = {}): EvaluationItemResult => ({
    itemId: 'item_1',
    question: 'Sample query?',
    expectedDocumentName: 'Folio A',
    expectedPages: [1],
    isAnswerable: true,
    actualAnswerable: true,
    retrievedPages: [{ documentId: 'doc_a', pageNumber: 1, score: 0.9, rank: 1 }],
    recallAt3: true,
    recallAt5: true,
    modelMarkersProduced: 2,
    validMarkersCount: 2,
    citationValidityRate: 1.0,
    outcome: 'answered',
    retrievalLatencyMs: 25,
    totalLatencyMs: 200,
    answerText: 'Answer with citations [1], [2].',
    citations: [],
    ...overrides,
  });

  describe('1. Perfect Scores (100%)', () => {
    it('calculates 100% for perfect citations, recall, and faithful answers + abstentions', () => {
      const items: EvaluationItemResult[] = [
        // 2 answerable questions correctly answered with verified citations
        makeItemResult({
          itemId: 'item_1',
          isAnswerable: true,
          actualAnswerable: true,
          recallAt5: true,
          modelMarkersProduced: 2,
          validMarkersCount: 2,
        }),
        makeItemResult({
          itemId: 'item_2',
          isAnswerable: true,
          actualAnswerable: true,
          recallAt5: true,
          modelMarkersProduced: 3,
          validMarkersCount: 3,
        }),
        // 1 unanswerable question correctly abstained
        makeItemResult({
          itemId: 'item_3',
          isAnswerable: false,
          actualAnswerable: false,
          expectedPages: [],
          recallAt5: false,
          modelMarkersProduced: 0,
          validMarkersCount: 0,
          outcome: 'no_relevant_passages',
        }),
      ];

      const metrics = computeEvaluationMetrics(items, [20, 30, 15], [200, 220, 100]);

      // Citation Verifiability: 5 valid / 5 produced = 100%
      expect(metrics.citationValidity).toBe(100.0);
      expect(metrics.counts.citationNumerator).toBe(5);
      expect(metrics.counts.citationDenominator).toBe(5);
      expect(metrics.counts.citationCasesCount).toBe(2);

      // Recall@5: 2 hits / 2 answerable queries = 100%
      expect(metrics.recallAt5).toBe(100.0);
      expect(metrics.counts.recallNumerator).toBe(2);
      expect(metrics.counts.recallDenominator).toBe(2);

      // Faithfulness & Abstention: (2 true answers + 1 true abstain) / 3 = 100%
      expect(metrics.faithfulnessAndAbstention).toBe(100.0);
      expect(metrics.counts.faithfulnessNumerator).toBe(3);
      expect(metrics.counts.faithfulnessDenominator).toBe(3);
      expect(metrics.counts.trueAnswers).toBe(2);
      expect(metrics.counts.trueAbstains).toBe(1);
      expect(metrics.counts.falseAbstains).toBe(0);
      expect(metrics.counts.falseAnswers).toBe(0);
    });
  });

  describe('2. Partial Scores & Defined Denominators', () => {
    it('accurately measures partial ratios with exact numerators and denominators', () => {
      const items: EvaluationItemResult[] = [
        // Case 1: Answerable, hit top-5, 2/2 citations verified
        makeItemResult({
          itemId: 'q1',
          isAnswerable: true,
          actualAnswerable: true,
          recallAt5: true,
          modelMarkersProduced: 2,
          validMarkersCount: 2,
        }),
        // Case 2: Answerable, missed top-5, 1/2 citations verified
        makeItemResult({
          itemId: 'q2',
          isAnswerable: true,
          actualAnswerable: true,
          recallAt5: false,
          modelMarkersProduced: 2,
          validMarkersCount: 1,
        }),
        // Case 3: Answerable, false abstention (failed to answer valid question)
        makeItemResult({
          itemId: 'q3',
          isAnswerable: true,
          actualAnswerable: false,
          recallAt5: false,
          modelMarkersProduced: 0,
          validMarkersCount: 0,
          outcome: 'insufficient_evidence',
        }),
        // Case 4: Unanswerable, valid abstention
        makeItemResult({
          itemId: 'q4',
          isAnswerable: false,
          actualAnswerable: false,
          expectedPages: [],
          recallAt5: false,
          modelMarkersProduced: 0,
          validMarkersCount: 0,
          outcome: 'no_relevant_passages',
        }),
      ];

      const metrics = computeEvaluationMetrics(items);

      // Citation Verifiability: (2 + 1) / (2 + 2) = 3/4 = 75.0%
      expect(metrics.citationValidity).toBe(75.0);
      expect(metrics.counts.citationNumerator).toBe(3);
      expect(metrics.counts.citationDenominator).toBe(4);
      expect(metrics.counts.citationCasesCount).toBe(2);

      // Recall@5: 1 hit out of 3 target answerable queries = 1/3 = 33.3%
      expect(metrics.recallAt5).toBe(33.3);
      expect(metrics.counts.recallNumerator).toBe(1);
      expect(metrics.counts.recallDenominator).toBe(3);

      // Faithfulness & Abstention:
      // True Answers = 2 (q1, q2)
      // True Abstains = 1 (q4)
      // False Abstains = 1 (q3)
      // Total Cases = 4
      // Score = (2 + 1) / 4 = 3/4 = 75.0%
      expect(metrics.faithfulnessAndAbstention).toBe(75.0);
      expect(metrics.counts.faithfulnessNumerator).toBe(3);
      expect(metrics.counts.faithfulnessDenominator).toBe(4);
      expect(metrics.counts.trueAnswers).toBe(2);
      expect(metrics.counts.trueAbstains).toBe(1);
      expect(metrics.counts.falseAbstains).toBe(1);
      expect(metrics.counts.falseAnswers).toBe(0);
    });
  });

  describe('3. Zero Scores & Failed Cases', () => {
    it('returns 0.0% when all citations fail verification, retrieval misses, or hallucinations occur', () => {
      const items: EvaluationItemResult[] = [
        // Case 1: Answerable, missed retrieval, 0 valid citations out of 4
        makeItemResult({
          itemId: 'q1',
          isAnswerable: true,
          actualAnswerable: true,
          recallAt5: false,
          modelMarkersProduced: 4,
          validMarkersCount: 0,
          citationValidityRate: 0,
        }),
        // Case 2: Unanswerable, but pipeline answered anyway (Hallucination / False Answer)
        makeItemResult({
          itemId: 'q2',
          isAnswerable: false,
          actualAnswerable: true,
          expectedPages: [],
          recallAt5: false,
          modelMarkersProduced: 2,
          validMarkersCount: 0,
          citationValidityRate: 0,
        }),
      ];

      const metrics = computeEvaluationMetrics(items);

      // Citation Verifiability: 0 / 6 = 0.0%
      expect(metrics.citationValidity).toBe(0.0);
      expect(metrics.counts.citationNumerator).toBe(0);
      expect(metrics.counts.citationDenominator).toBe(6);

      // Recall@5: 0 hits / 1 target query = 0.0%
      expect(metrics.recallAt5).toBe(0.0);
      expect(metrics.counts.recallNumerator).toBe(0);
      expect(metrics.counts.recallDenominator).toBe(1);

      // Faithfulness & Abstention: 0 correct decisions / 2 cases = 0.0%
      expect(metrics.faithfulnessAndAbstention).toBe(0.0);
      expect(metrics.counts.faithfulnessNumerator).toBe(0);
      expect(metrics.counts.faithfulnessDenominator).toBe(2);
      expect(metrics.counts.falseAnswers).toBe(1);
      expect(metrics.counts.ungroundedAnswers).toBe(1);
    });
  });

  describe('4. Empty Datasets & Missing Evaluations', () => {
    it('returns 0.0% and 0 counts for empty datasets, never defaulting to 100%', () => {
      const metrics = computeEvaluationMetrics([]);

      expect(metrics.citationValidity).toBe(0.0);
      expect(metrics.recallAt5).toBe(0.0);
      expect(metrics.recallAt3).toBe(0.0);
      expect(metrics.faithfulnessAndAbstention).toBe(0.0);
      expect(metrics.abstentionPrecision).toBe(0.0);
      expect(metrics.abstentionRecall).toBe(0.0);

      expect(metrics.counts.citationNumerator).toBe(0);
      expect(metrics.counts.citationDenominator).toBe(0);
      expect(metrics.counts.recallNumerator).toBe(0);
      expect(metrics.counts.recallDenominator).toBe(0);
      expect(metrics.counts.faithfulnessNumerator).toBe(0);
      expect(metrics.counts.faithfulnessDenominator).toBe(0);
    });

    it('returns 0.0% when test cases produced 0 citations, avoiding division by zero or 100% inflation', () => {
      const items: EvaluationItemResult[] = [
        makeItemResult({
          modelMarkersProduced: 0,
          validMarkersCount: 0,
        }),
      ];

      const metrics = computeEvaluationMetrics(items);
      expect(metrics.citationValidity).toBe(0.0);
      expect(metrics.counts.citationDenominator).toBe(0);
    });
  });

  describe('5. Deployment Gate Threshold Enforcement', () => {
    const baseRun: EvaluationRun = {
      id: 'eval_run_gate_test',
      createdAt: Date.now(),
      config: {
        chunkSize: 900,
        chunkOverlap: 180,
        similarityThreshold: 0.72,
        embeddingModel: 'gemini-embedding-2-preview',
        generationModel: 'gemini-3.8-flash',
        topK: 5,
        darkMode: 'system',
        maxFileSizeMB: 25,
        bm25Weight: 0.5,
      },
      itemCount: 4,
      itemResults: [makeItemResult()],
      metrics: {
        recallAt3: 100,
        recallAt5: 100,
        citationValidity: 95.0,
        abstentionPrecision: 100,
        abstentionRecall: 100,
        falseAbstainRate: 0,
        faithfulnessAndAbstention: 100,
        p50RetrievalLatencyMs: 35,
        p95RetrievalLatencyMs: 50,
        p50EndToEndLatencyMs: 400,
        p95EndToEndLatencyMs: 650,
      },
    };

    it('passes deployment gate when citation accuracy >= threshold', () => {
      const check = checkEvaluationThreshold(baseRun, 90);
      expect(check.passed).toBe(true);
      expect(check.citationAccuracy).toBe(95.0);
      expect(check.reason).toBeUndefined();
    });

    it('fails deployment gate when citation accuracy < threshold', () => {
      const failingRun: EvaluationRun = {
        ...baseRun,
        metrics: {
          ...baseRun.metrics,
          citationValidity: 87.5,
        },
      };

      const check = checkEvaluationThreshold(failingRun, 90);
      expect(check.passed).toBe(false);
      expect(check.citationAccuracy).toBe(87.5);
      expect(check.reason).toContain('87.5% is below required 90% threshold');
    });

    it('blocks deployment gate when run has 0 evaluated items', () => {
      const emptyRun: EvaluationRun = {
        ...baseRun,
        itemCount: 0,
        itemResults: [],
        metrics: {
          ...baseRun.metrics,
          citationValidity: 0,
        },
      };

      const check = checkEvaluationThreshold(emptyRun, 90);
      expect(check.passed).toBe(false);
      expect(check.reason).toContain('No evaluation test cases executed');
    });
  });

  describe('6. Percentage Formatting Fixes (Preventing 10000% Bugs)', () => {
    it('formats percentages properly without multiplying by 100 multiple times', () => {
      expect(formatPercentage(100)).toBe('100%');
      expect(formatPercentage(100.0)).toBe('100%');
      expect(formatPercentage(95.5)).toBe('95.5%');
      expect(formatPercentage(1.0)).toBe('1%');
      expect(formatPercentage(0)).toBe('0%');
      expect(formatPercentage(null)).toBe('0.0%');
      expect(formatPercentage(undefined)).toBe('0.0%');
      expect(formatPercentage(NaN)).toBe('0.0%');
    });
  });

  describe('7. JSON Export', () => {
    it('exports evaluation run as JSON Blob with matching identifiers', async () => {
      const mockRun: EvaluationRun = {
        id: 'eval_export_test_999',
        createdAt: Date.now(),
        config: {} as any,
        itemCount: 2,
        itemResults: [],
        metrics: {
          recallAt3: 80,
          recallAt5: 90,
          citationValidity: 92.0,
          abstentionPrecision: 100,
          abstentionRecall: 100,
          falseAbstainRate: 0,
          p50RetrievalLatencyMs: 30,
          p95RetrievalLatencyMs: 40,
          p50EndToEndLatencyMs: 300,
          p95EndToEndLatencyMs: 500,
        },
      };

      const { blob, fileName } = exportEvaluationRunAsJson(mockRun);
      expect(fileName).toContain('eval_export_test_999');
      expect(blob.type).toBe('application/json');

      const parsed = JSON.parse(await blob.text());
      expect(parsed.id).toBe('eval_export_test_999');
      expect(parsed.metrics.citationValidity).toBe(92.0);
    });
  });
});
