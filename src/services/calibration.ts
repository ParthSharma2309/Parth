import { EvaluationItem, DocumentRecord } from '../types/index.ts';
import { getEvaluationItems, getAllDocuments, getChunksByDocuments } from './storage.ts';
import { embedQuery } from './embeddings.ts';
import { cosineSimilarity } from './retrieval.ts';
import { getModelSimilarityThreshold, MODEL_CONFIG } from '../config/models.ts';

export interface CalibrationResult {
  suggestedThreshold: number;
  f1Score: number;
  itemsEvaluated: number;
  model: string;
}

/**
 * Runs the Evaluation set to calibrate the optimal honest abstention similarity threshold
 * for a specific embedding model (Requirement 2).
 */
export async function calibrateThresholdForModel(
  modelId: string,
  onProgress?: (current: number, total: number) => void
): Promise<CalibrationResult> {
  const cleanModel = modelId.replace(/^models\//, '');
  let items = await getEvaluationItems();
  const allDocs = await getAllDocuments();
  const readyDocs = allDocs.filter((d) => String(d.status).toLowerCase() === 'ready');

  // If no evaluation items exist yet, synthesize quick evaluation probes from ready documents
  if (items.length === 0 && readyDocs.length > 0) {
    const doc1 = readyDocs[0];
    const doc2 = readyDocs.length > 1 ? readyDocs[1] : doc1;

    items = [
      {
        id: `calib_probe_1`,
        question: `What are the primary findings and core topics discussed in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [1],
        isAnswerable: true,
      },
      {
        id: `calib_probe_2`,
        question: `What specific quantitative metrics, figures, or results are detailed in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [1],
        isAnswerable: true,
      },
      {
        id: `calib_probe_3`,
        question: `Summarize the main background and introductory section of ${doc2.name}.`,
        expectedDocumentId: doc2.id,
        expectedDocumentName: doc2.name,
        expectedPages: [1],
        isAnswerable: true,
      },
      {
        id: `calib_probe_4`,
        question: `What nonexistent 17th-century French culinary recipes are described in ${doc1.name}?`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [],
        isAnswerable: false, // Honesty test probe
      },
      {
        id: `calib_probe_5`,
        question: `Details on extraterrestrial quantum propulsion systems in ${doc1.name}`,
        expectedDocumentId: doc1.id,
        expectedDocumentName: doc1.name,
        expectedPages: [],
        isAnswerable: false, // Honesty test probe
      },
    ];
  }

  if (items.length === 0 || readyDocs.length === 0) {
    const fallbackTh = getModelSimilarityThreshold(cleanModel);
    return {
      suggestedThreshold: fallbackTh,
      f1Score: 1.0,
      itemsEvaluated: 0,
      model: cleanModel,
    };
  }

  // Load all in-scope chunks
  const chunks = await getChunksByDocuments(readyDocs.map((d) => d.id));
  if (chunks.length === 0) {
    const fallbackTh = getModelSimilarityThreshold(cleanModel);
    return {
      suggestedThreshold: fallbackTh,
      f1Score: 1.0,
      itemsEvaluated: 0,
      model: cleanModel,
    };
  }

  // Compute maximum semantic cosine scores for each item
  const evaluationPairs: Array<{ maxScore: number; isAnswerable: boolean }> = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i + 1, items.length);

    try {
      const qEmbedding = await embedQuery(item.question, cleanModel);
      let maxScore = 0;

      for (const chunk of chunks) {
        if (item.expectedDocumentId && chunk.documentId !== item.expectedDocumentId) {
          // If the item specifies a target document, only score that document
          continue;
        }
        const sim = cosineSimilarity(qEmbedding, chunk.embedding);
        if (sim > maxScore) {
          maxScore = sim;
        }
      }

      evaluationPairs.push({ maxScore, isAnswerable: item.isAnswerable });
    } catch (err) {
      console.warn(`Calibration probe failed for "${item.question}":`, err);
    }
  }

  if (evaluationPairs.length === 0) {
    const fallbackTh = getModelSimilarityThreshold(cleanModel);
    return {
      suggestedThreshold: fallbackTh,
      f1Score: 1.0,
      itemsEvaluated: 0,
      model: cleanModel,
    };
  }

  // Scan candidate thresholds from 0.25 to 0.65 in 0.01 increments
  let bestThreshold = getModelSimilarityThreshold(cleanModel);
  let bestF1 = -1;

  for (let th = 0.25; th <= 0.65; th += 0.01) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const pair of evaluationPairs) {
      const predictedAnswerable = pair.maxScore >= th;
      if (pair.isAnswerable) {
        if (predictedAnswerable) tp++;
        else fn++;
      } else {
        if (predictedAnswerable) fp++;
        else tn++;
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    if (f1 > bestF1) {
      bestF1 = f1;
      bestThreshold = Math.round(th * 100) / 100;
    }
  }

  return {
    suggestedThreshold: bestThreshold,
    f1Score: Math.round(bestF1 * 100) / 100,
    itemsEvaluated: evaluationPairs.length,
    model: cleanModel,
  };
}
