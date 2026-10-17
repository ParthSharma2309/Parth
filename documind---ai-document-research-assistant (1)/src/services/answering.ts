import {
  Citation,
  MessageRecord,
  MessageStatus,
  RetrievalScope,
  RetrievalScore,
  SettingsState,
} from '../types/index.ts';
import { ABSTENTION_MESSAGE } from '../config/models.ts';
import { getAllDocuments, getChunksByDocument } from './storage.ts';
import { embedQuery } from './embeddings.ts';
import { retrieveRelevantChunks, RetrievedChunk } from './retrieval.ts';
import { validateCitations } from './citations.ts';

export interface AnsweringPipelineInput {
  conversationId: string;
  userQuestion: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  scope: RetrievalScope;
  settings: SettingsState;
}

export interface AnsweringPipelineOutput {
  status: MessageStatus;
  answerText: string;
  citations: Citation[];
  errorMessage?: string;
  retrievalScores: RetrievalScore[];
  latencyMs: {
    retrieval: number;
    generation: number;
    total: number;
  };
  retrievedChunks: RetrievedChunk[];
  modelMarkersProduced: number;
  validMarkersCount: number;
  citationValidityRate: number;
}

/**
 * Runs the end-to-end question answering pipeline with grounded citation verification and abstention.
 */
export async function runAnsweringPipeline(
  input: AnsweringPipelineInput
): Promise<AnsweringPipelineOutput> {
  const overallStart = performance.now();
  let retrievalTime = 0;
  let generationTime = 0;

  try {
    // Step 0: Get ready documents and check valid docs
    const allDocs = await getAllDocuments();
    const readyDocs = allDocs.filter((d) => d.status === 'Ready');

    if (readyDocs.length === 0) {
      return {
        status: 'no_relevant_passages',
        answerText:
          'No ready documents found. Please upload a PDF document and wait for it to process before asking questions.',
        citations: [],
        retrievalScores: [],
        latencyMs: { retrieval: 0, generation: 0, total: 0 },
        retrievedChunks: [],
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    // Determine allowed doc IDs based on scope
    let validDocIds: Set<string>;
    const scope = input.scope;
    if (scope.type === 'collection') {
      const colId = scope.collectionId;
      const collectionDocIds = readyDocs
        .filter((d) => d.collectionId === colId)
        .map((d) => d.id);
      validDocIds = new Set(collectionDocIds);
    } else if (scope.type === 'selected') {
      validDocIds = new Set(scope.documentIds);
    } else {
      validDocIds = new Set(readyDocs.map((d) => d.id));
    }

    if (validDocIds.size === 0) {
      return {
        status: 'no_relevant_passages',
        answerText:
          'The selected collection or document filter has no ready documents. Please select at least one ready document.',
        citations: [],
        retrievalScores: [],
        latencyMs: { retrieval: 0, generation: 0, total: 0 },
        retrievedChunks: [],
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    // Step 1: Query Reformulation for Follow-ups
    let queryForRetrieval = input.userQuestion;
    if (input.history.length > 0) {
      try {
        const rewriteRes = await fetch('/api/rewrite-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: input.userQuestion,
            history: input.history,
            model: input.settings.generationModel,
          }),
        });
        if (rewriteRes.ok) {
          const rewriteData = await rewriteRes.json();
          if (rewriteData.rewrittenQuery) {
            queryForRetrieval = rewriteData.rewrittenQuery;
          }
        }
      } catch (err) {
        console.warn('Query rewriting failed, proceeding with original query:', err);
      }
    }

    // Step 2: Retrieve chunks scoped to allowed documents
    const retrievalStart = performance.now();
    const docChunksLists = await Promise.all(
      Array.from(validDocIds).map((id) => getChunksByDocument(id))
    );
    const allChunks = docChunksLists.flat();

    // Embed the query
    const queryEmbedding = await embedQuery(queryForRetrieval, input.settings.embeddingModel);

    // Cosine similarity search over stored vectors
    const retrievalResult = retrieveRelevantChunks(
      queryEmbedding,
      allChunks,
      input.scope,
      validDocIds,
      input.settings.topK,
      input.userQuestion
    );
    retrievalTime = performance.now() - retrievalStart;

    const { topChunks, maxScore, scores } = retrievalResult;

    // Step 3 & 4: Outcome 1: No relevant passages
    // If top similarity score is below configurable threshold, skip LLM call!
    if (topChunks.length === 0 || maxScore < input.settings.similarityThreshold) {
      const totalTime = performance.now() - overallStart;
      return {
        status: 'no_relevant_passages',
        answerText: ABSTENTION_MESSAGE,
        citations: [],
        retrievalScores: scores,
        latencyMs: {
          retrieval: Math.round(retrievalTime),
          generation: 0,
          total: Math.round(totalTime),
        },
        retrievedChunks: topChunks,
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    // Step 5: Format passages for the model with strict [1]..[k] markers
    const formattedPassages = topChunks.map((item, idx) => ({
      index: idx + 1,
      docName: item.chunk.documentName,
      page: item.chunk.pageNumber,
      text: item.chunk.text,
    }));

    // Step 6: Call generation model with rewritten query
    const genStart = performance.now();
    const genRes = await fetch('/api/generate-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: queryForRetrieval,
        passages: formattedPassages,
        model: input.settings.generationModel,
      }),
    });
    generationTime = performance.now() - genStart;

    if (!genRes.ok) {
      let errText = `Generation failed (${genRes.status})`;
      try {
        const errJson = await genRes.json();
        if (errJson.error) errText = errJson.error;
      } catch {
        // fallback
      }
      const totalTime = performance.now() - overallStart;
      return {
        status: 'error',
        answerText: '',
        errorMessage: errText,
        citations: [],
        retrievalScores: scores,
        latencyMs: {
          retrieval: Math.round(retrievalTime),
          generation: Math.round(generationTime),
          total: Math.round(totalTime),
        },
        retrievedChunks: topChunks,
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    const genData = await genRes.json();
    const isAnswerable = !!genData.answerable;
    const rawAnswer = genData.answer || '';
    const rawCitations = Array.isArray(genData.citations) ? genData.citations : [];

    // Step 7: Validate citations in code
    const validation = validateCitations(rawCitations, topChunks);
    const totalTime = performance.now() - overallStart;

    // Outcome 2: Insufficient evidence
    // If the model itself said not answerable OR returned zero valid citations
    if (!isAnswerable || !validation.hasValidCitations) {
      return {
        status: 'insufficient_evidence',
        answerText: ABSTENTION_MESSAGE,
        citations: [],
        retrievalScores: scores,
        latencyMs: {
          retrieval: Math.round(retrievalTime),
          generation: Math.round(generationTime),
          total: Math.round(totalTime),
        },
        retrievedChunks: topChunks,
        modelMarkersProduced: validation.totalModelMarkers,
        validMarkersCount: validation.validMarkersCount,
        citationValidityRate: validation.citationValidityRate,
      };
    }

    // Outcome 3: Answered with valid citations present
    return {
      status: 'answered',
      answerText: rawAnswer,
      citations: validation.validCitations,
      retrievalScores: scores,
      latencyMs: {
        retrieval: Math.round(retrievalTime),
        generation: Math.round(generationTime),
        total: Math.round(totalTime),
      },
      retrievedChunks: topChunks,
      modelMarkersProduced: validation.totalModelMarkers,
      validMarkersCount: validation.validMarkersCount,
      citationValidityRate: validation.citationValidityRate,
    };
  } catch (err: any) {
    console.error('Answering pipeline error:', err);
    const totalTime = performance.now() - overallStart;
    return {
      status: 'error',
      answerText: '',
      errorMessage: err.message || 'An unexpected error occurred during research answering.',
      citations: [],
      retrievalScores: [],
      latencyMs: {
        retrieval: Math.round(retrievalTime),
        generation: Math.round(generationTime),
        total: Math.round(totalTime),
      },
      retrievedChunks: [],
      modelMarkersProduced: 0,
      validMarkersCount: 0,
      citationValidityRate: 0,
    };
  }
}
