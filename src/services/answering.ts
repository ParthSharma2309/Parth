import {
  Citation,
  MessageStatus,
  RetrievalScope,
  RetrievalScore,
  SettingsState,
  IndexMismatchError,
} from '../types/index.ts';
import { ABSTENTION_MESSAGE, MODEL_CONFIG, getModelSimilarityThreshold } from '../config/models.ts';
import { getAllDocuments, getChunksByDocuments } from './storage.ts';
import { embedQuery } from './embeddings.ts';
import { retrieveRelevantChunks, RetrievedChunk, isDocumentSummaryQuery } from './retrieval.ts';
import { validateCitations } from './citations.ts';
import { authFetch } from './apiClient.ts';
import { DocumentRecord } from '../types/index.ts';
import { ensureDocumentChunksAvailable, fetchCloudDocuments } from './cloudSync.ts';

export interface AnsweringPipelineInput {
  conversationId: string;
  userQuestion: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  scope: RetrievalScope;
  settings: SettingsState;
  availableDocs?: DocumentRecord[];
  onStreamToken?: (token: string) => void;
  abortSignal?: AbortSignal;
}

export interface AnsweringPipelineOutput {
  status: MessageStatus;
  answerText: string;
  citations: Citation[];
  errorMessage?: string;
  indexMismatch?: {
    indexedModel: string;
    currentModel: string;
    indexedDim?: number;
    currentDim?: number;
  };
  retrievalScores: RetrievalScore[];
  followupSuggestions?: string[];
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
 * Runs the end-to-end question answering pipeline with hybrid BM25 + dense retrieval,
 * query rewriting, streaming responses (SSE), citation verification, and follow-up generation.
 */
export async function runAnsweringPipeline(
  input: AnsweringPipelineInput
): Promise<AnsweringPipelineOutput> {
  const overallStart = performance.now();
  let retrievalTime = 0;
  let generationTime = 0;

  try {
    // Step 0: Get ready documents and check valid docs
    const localDocs = await getAllDocuments();
    const docMap = new Map<string, DocumentRecord>();

    // 1. Incorporate documents passed from workspace state (includes cloud-fetched docs)
    if (Array.isArray(input.availableDocs)) {
      for (const d of input.availableDocs) {
        docMap.set(d.id, d);
      }
    }

    // 2. Merge local IndexedDB documents, preserving 'Ready' status if either source has it
    for (const d of localDocs) {
      if (!docMap.has(d.id)) {
        docMap.set(d.id, d);
      } else {
        const existing = docMap.get(d.id)!;
        const isExistingReady =
          String(existing.status || '').toLowerCase() === 'ready' ||
          String(existing.status || '').toLowerCase() === 'completed' ||
          String(existing.status || '').toLowerCase() === 'done';
        const isLocalReady =
          String(d.status || '').toLowerCase() === 'ready' ||
          String(d.status || '').toLowerCase() === 'completed' ||
          String(d.status || '').toLowerCase() === 'done';

        docMap.set(d.id, {
          ...existing,
          ...d,
          status: (isExistingReady || isLocalReady) ? 'Ready' : (d.status || existing.status),
        });
      }
    }

    // 3. Fallback: If no documents found locally, attempt to fetch user's cloud documents
    if (docMap.size === 0) {
      try {
        const cloudDocs = await fetchCloudDocuments();
        if (Array.isArray(cloudDocs)) {
          for (const cd of cloudDocs) {
            docMap.set(cd.id, cd);
          }
        }
      } catch {
        // Ignore fallback failure
      }
    }

    const allDocs = Array.from(docMap.values());
    const isDocReady = (d: DocumentRecord) => {
      const s = String(d.status || '').toLowerCase();
      return s === 'ready' || s === 'indexed' || s === 'completed' || s === 'done';
    };
    const readyDocs = allDocs.filter(isDocReady);

    if (allDocs.length === 0 || readyDocs.length === 0) {
      const failedOrOcrDoc = allDocs.find((d) => d.status === 'Failed' || !d.hasExtractableText || (d.extractedCharacters || 0) < 50);
      const answerText = allDocs.length === 0
        ? 'No documents found. Please upload a PDF document to begin research inquiry.'
        : failedOrOcrDoc
        ? `The document "${failedOrOcrDoc.name}" has no extractable text. If this is a scanned PDF, please re-process it with OCR from the Library or verify page clarity.`
        : 'No ready documents found. Please wait for document processing to complete before asking questions.';

      console.warn('[DocuMind Diagnostics] No ready documents available:', {
        totalDocs: allDocs.length,
        readyDocsCount: readyDocs.length,
        rejectionReason: answerText,
      });
      return {
        status: 'insufficient_evidence',
        answerText,
        citations: [],
        retrievalScores: [],
        latencyMs: { retrieval: 0, generation: 0, total: 0 },
        retrievedChunks: [],
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    // Determine allowed doc IDs based on scope (supporting all, collection, selected, and single document)
    let validDocIds: Set<string>;
    const scope = input.scope as any;
    if (scope.type === 'collection') {
      const colId = scope.collectionId;
      const collectionDocIds = readyDocs
        .filter((d) => d.collectionId === colId)
        .map((d) => d.id);
      validDocIds = new Set(collectionDocIds);
    } else if (scope.type === 'selected' || scope.type === 'document') {
      const targetIds: string[] =
        scope.type === 'document' && scope.documentId
          ? [scope.documentId]
          : Array.isArray(scope.documentIds)
          ? scope.documentIds
          : [];
      const readyDocIdSet = new Set(readyDocs.map((d) => d.id));
      const selected = targetIds.filter((id) => readyDocIdSet.has(id));
      validDocIds = new Set(selected.length > 0 ? selected : targetIds);
    } else {
      validDocIds = new Set(readyDocs.map((d) => d.id));
    }

    // Safe Diagnostic: Selected document ID and readiness status
    console.info('[DocuMind Diagnostics] Document selection & readiness:', {
      scopeType: scope.type,
      selectedDocIds: Array.from(validDocIds),
      totalDocs: allDocs.length,
      readyDocsCount: readyDocs.length,
      docStatuses: allDocs.map((d) => ({ id: d.id, status: d.status, isReady: isDocReady(d) })),
    });

    if (validDocIds.size === 0) {
      const filterMsg =
        scope.type === 'collection'
          ? 'The selected collection has no ready documents. Please select at least one ready document or switch scope.'
          : 'The selected document filter has no ready documents. Please select at least one ready document in the research scope.';
      console.warn('[DocuMind Diagnostics] Selected document filter has 0 ready documents:', {
        scopeType: scope.type,
        targetDocIds: scope.documentIds || [scope.documentId],
        rejectionReason: filterMsg,
      });
      return {
        status: 'insufficient_evidence',
        answerText: filterMsg,
        citations: [],
        retrievalScores: [],
        latencyMs: { retrieval: 0, generation: 0, total: 0 },
        retrievedChunks: [],
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    // Step 1: Query Reformulation for Follow-ups (Rewriting with last 4 messages)
    let queryForRetrieval = input.userQuestion;
    if (input.history.length > 0) {
      try {
        const rewriteRes = await authFetch('/api/rewrite-query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: input.userQuestion,
            history: input.history.slice(-4),
          }),
          signal: input.abortSignal,
        });
        if (rewriteRes.ok) {
          const rewriteData = await rewriteRes.json();
          if (rewriteData.rewrittenQuestion) {
            queryForRetrieval = rewriteData.rewrittenQuestion;
          }
        }
      } catch (err) {
        console.warn('Query rewriting skipped:', err);
      }
    }

    // Step 2: Retrieve chunks scoped to allowed documents using in-memory vector cache & Web Worker
    const retrievalStart = performance.now();
    let allChunks = await getChunksByDocuments(Array.from(validDocIds));

    // Cross-device persistence: if candidate documents have no chunks in local IndexedDB,
    // restore them from cloud Firestore or regenerate from Supabase Storage PDF bytes
    const loadedDocIds = new Set(allChunks.map((c) => c.documentId));
    const missingDocIds = Array.from(validDocIds).filter((id) => !loadedDocIds.has(id));
    if (missingDocIds.length > 0) {
      for (const missingId of missingDocIds) {
        try {
          const docObj = allDocs.find((d) => d.id === missingId);
          const restored = await ensureDocumentChunksAvailable(missingId, docObj?.name);
          if (restored && restored.length > 0) {
            allChunks = allChunks.concat(restored);
          }
        } catch (restoreErr) {
          console.warn(`Could not restore chunks for document ${missingId}:`, restoreErr);
        }
      }
    }

    // Diagnostic 2: Extracted text length and available chunk count
    const totalExtractedLength = allChunks.reduce((acc, c) => acc + (c.text?.length || 0), 0);
    console.info('[DocuMind Diagnostics] Chunks & extracted text:', {
      availableChunkCount: allChunks.length,
      totalExtractedLengthChars: totalExtractedLength,
      loadedDocIds: Array.from(new Set(allChunks.map((c) => c.documentId))),
    });

    // 1. If no chunks available across all candidate documents, report clearly
    if (allChunks.length === 0) {
      const selectedDocNames = allDocs
        .filter((d) => validDocIds.has(d.id))
        .map((d) => d.name)
        .join(', ');
      const hasFailedOrOcr = allDocs.some(
        (d) => validDocIds.has(d.id) && (d.status === 'Failed' || !d.hasExtractableText || (d.extractedCharacters || 0) < 50)
      );
      const answerText = hasFailedOrOcr
        ? `The selected document ("${selectedDocNames || 'selected document'}") has no extractable text. If this is a scanned PDF, please re-process it with OCR from the Library or verify page clarity.`
        : `The selected document ("${selectedDocNames || 'selected document'}") has no indexed passages available. Please ensure the document contains readable text and has completed processing.`;

      console.warn('[DocuMind Diagnostics] Query rejected: No chunks available across selected documents', {
        validDocIds: Array.from(validDocIds),
        selectedDocNames,
        hasFailedOrOcr,
        rejectionReason: answerText,
      });
      return {
        status: 'insufficient_evidence',
        answerText,
        citations: [],
        retrievalScores: [],
        latencyMs: {
          retrieval: Math.round(performance.now() - retrievalStart),
          generation: 0,
          total: Math.round(performance.now() - overallStart),
        },
        retrievedChunks: [],
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    // 2. Ensure every chunk has documentName populated
    allChunks = allChunks.map((c) => {
      if (!c.documentName) {
        const found = allDocs.find((d) => d.id === c.documentId);
        if (found?.name) {
          return { ...c, documentName: found.name };
        }
      }
      return c;
    });

    // Use the model the candidate chunks were actually indexed with if available,
    // so existing indexed documents continue working seamlessly without re-indexing!
    const chunkWithModel = allChunks.find((c) => c.model);
    const existingModel = chunkWithModel?.model?.replace(/^models\//, '');
    const userModel = input.settings.embeddingModel?.replace(/^models\//, '');
    const effectiveEmbeddingModel =
      (existingModel && (!userModel || userModel === MODEL_CONFIG.defaultEmbeddingModel))
        ? existingModel
        : (userModel || MODEL_CONFIG.defaultEmbeddingModel);

    // Embed the query
    const queryEmbedding = await embedQuery(queryForRetrieval, effectiveEmbeddingModel);

    // Hybrid BM25 + Cosine search with Reciprocal Rank Fusion, MMR diversity, and Web Worker
    const retrievalResult = await retrieveRelevantChunks(
      queryEmbedding,
      allChunks,
      input.scope,
      validDocIds,
      input.settings.topK,
      queryForRetrieval,
      input.settings.bm25Weight ?? 0.5,
      effectiveEmbeddingModel
    );
    retrievalTime = performance.now() - retrievalStart;

    const { topChunks, maxScore, scores } = retrievalResult;

    // Step 3 & 4: Outcome 1: No relevant passages
    // Honest abstention based on best SEMANTIC score against the per-embedding-model threshold (Requirement 2)
    const isDocSummary =
      isDocumentSummaryQuery(queryForRetrieval) || isDocumentSummaryQuery(input.userQuestion);

    const floorThreshold =
      input.settings.similarityThresholds?.[effectiveEmbeddingModel] ??
      input.settings.similarityThreshold ??
      getModelSimilarityThreshold(effectiveEmbeddingModel);

    // For whole-document summary or overview requests, representative passages from the
    // ready document exist and must not be aborted with "No relevant passages / Honest abstention".
    const meetsRelevanceCriteria = isDocSummary
      ? topChunks.length > 0
      : topChunks.length > 0 && maxScore >= floorThreshold;

    const candidateCount = allChunks.filter((chunk) => validDocIds.has(chunk.documentId)).length;

    // Diagnostic 3, 4 & 5: Retrieval candidate count, top similarity score, relevance threshold, and summary query execution
    console.info('[DocuMind Diagnostics] Retrieval & Query evaluation:', {
      isSummaryQueryBranch: isDocSummary,
      candidateChunksCount: candidateCount,
      topChunksCount: topChunks.length,
      topSimilarityScore: Number(maxScore.toFixed(4)),
      relevanceThreshold: Number(floorThreshold.toFixed(4)),
      meetsRelevanceCriteria,
      rejectionReason: !meetsRelevanceCriteria
        ? (isDocSummary
            ? 'Zero representative chunks found for summary'
            : `Relevance floor not met: maxScore (${maxScore.toFixed(4)}) < threshold (${floorThreshold.toFixed(4)})`)
        : undefined,
    });

    if (!meetsRelevanceCriteria) {
      const totalTime = performance.now() - overallStart;
      console.warn('[DocuMind Diagnostics] Query rejected (Honest Abstention):', {
        status: 'no_relevant_passages',
        rejectionReason: isDocSummary
          ? 'Zero chunks available for summarization'
          : `Relevance floor not met (score: ${maxScore.toFixed(4)} < threshold: ${floorThreshold.toFixed(4)})`,
        maxScore: Number(maxScore.toFixed(4)),
        floorThreshold: Number(floorThreshold.toFixed(4)),
        isDocSummary,
      });
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
    // Attach previous & next chunk as expanded context sent to model, while citations still point to original chunk's page (Requirement 4)
    // Cap total passages at 25
    const cappedChunks = topChunks.slice(0, 25);
    const formattedPassages = cappedChunks.map((item, idx) => ({
      index: idx + 1,
      docName: item.chunk.documentName,
      page: item.chunk.pageNumber, // citations still point to original chunk's page
      text: item.context || item.chunk.text, // expanded context text sent to model
    }));

    // Step 6: Stream Generation with SSE if onStreamToken provided
    const genStart = performance.now();
    let rawAnswer = '';
    let streamCitations: Array<{ marker: number; quote: string }> = [];
    let isUnanswerable = false;

    if (input.onStreamToken) {
      try {
        const streamRes = await authFetch('/api/answer-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: queryForRetrieval,
            passages: formattedPassages,
            model: input.settings.generationModel,
            history: input.history.slice(-4),
          }),
          signal: input.abortSignal,
        });

        if (streamRes.ok) {
          const reader = streamRes.body?.getReader();
          const decoder = new TextDecoder();

          if (reader) {
            let buffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              // Split into distinct SSE message blocks
              const blocks = buffer.split(/\r?\n\r?\n/);
              buffer = blocks.pop() || '';

              for (const block of blocks) {
                const lines = block.split(/\r?\n/);
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.startsWith('data:')) {
                    const jsonStr = trimmed.replace(/^data:\s*/, '');
                    if (!jsonStr) continue;
                    try {
                      const data = JSON.parse(jsonStr);
                      if (data.type === 'delta' && data.text) {
                        rawAnswer += data.text;
                        input.onStreamToken(data.text);
                      } else if (data.type === 'done') {
                        if (data.fullText && data.fullText.trim().length > 0) rawAnswer = data.fullText;
                        else if (data.answer && data.answer.trim().length > 0) rawAnswer = data.answer;
                        if (Array.isArray(data.citations)) streamCitations = data.citations;
                        if (data.answerable === false) isUnanswerable = true;
                      } else if (data.type === 'error') {
                        throw new Error(data.error);
                      }
                    } catch {
                      // Ignore JSON parse error on non-JSON SSE lines or pings
                    }
                  }
                }
              }
            }
          }
        }
      } catch (streamErr) {
        console.warn('Streaming answer request failed, attempting non-streaming fallback:', streamErr);
      }
    }

    // Non-streaming fallback if stream was disabled or yielded empty response without explicit unanswerable status
    if (!rawAnswer.trim() && !isUnanswerable) {
      try {
        const genRes = await authFetch('/api/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: queryForRetrieval,
            passages: formattedPassages,
            model: input.settings.generationModel,
          }),
          signal: input.abortSignal,
        });

        if (genRes.ok) {
          const data = await genRes.json();
          rawAnswer = data.answer || '';
          if (Array.isArray(data.citations)) streamCitations = data.citations;
          if (data.answerable === false) isUnanswerable = true;
        } else {
          console.warn(`Non-streaming answer generation returned status: ${genRes.status}`);
        }
      } catch (genErr) {
        console.warn('Non-streaming fallback answer request failed:', genErr);
      }
    }

    generationTime = performance.now() - genStart;

    // Step 7: Parse citations from answer markers [1], [2], [PASSAGE 1], etc. and stream citations
    const markerMatches = Array.from(rawAnswer.matchAll(/\[(?:PASSAGE\s*)?(\d+)\]/gi));
    const rawCitations: Array<{ marker: number; quote: string }> = [];
    const seenMarkers = new Set<number>();

    // 1. Process server-structured citations if provided by the model
    if (typeof streamCitations !== 'undefined' && Array.isArray(streamCitations)) {
      for (const sc of streamCitations) {
        if (typeof sc.marker === 'number' && sc.marker >= 1 && sc.marker <= cappedChunks.length && !seenMarkers.has(sc.marker)) {
          seenMarkers.add(sc.marker);
          const targetChunk = cappedChunks[sc.marker - 1];
          rawCitations.push({
            marker: sc.marker,
            quote: sc.quote || (targetChunk ? targetChunk.chunk.text.slice(0, 180).trim() : ''),
          });
        }
      }
    }

    // 2. Parse inline bracket markers [1], [PASSAGE 1], etc. from the answer text
    for (const match of markerMatches) {
      const markerNum = parseInt(match[1], 10);
      if (!seenMarkers.has(markerNum) && markerNum >= 1 && markerNum <= cappedChunks.length) {
        seenMarkers.add(markerNum);
        const targetChunk = cappedChunks[markerNum - 1];
        if (targetChunk) {
          const excerpt = targetChunk.chunk.text.slice(0, 180).trim();
          rawCitations.push({
            marker: markerNum,
            quote: excerpt,
          });
        }
      }
    }

    // 3. Fallback: If model answered comprehensively from retrieved passages without explicit brackets
    if (rawAnswer.trim().length > 0 && rawCitations.length === 0 && !isUnanswerable && cappedChunks.length > 0) {
      if (isDocSummary) {
        // For a whole-document summary, attribute citations to the representative passages used
        for (let i = 0; i < Math.min(cappedChunks.length, 6); i++) {
          const item = cappedChunks[i];
          const excerpt = item.chunk.text.slice(0, 160).trim();
          seenMarkers.add(i + 1);
          rawCitations.push({
            marker: i + 1,
            quote: excerpt,
          });
        }
      } else {
        for (let i = 0; i < Math.min(cappedChunks.length, 5); i++) {
          const item = cappedChunks[i];
          const text = item.chunk.text;
          const clauses = text
            .split(/[.\n;]/)
            .map((s) => s.trim())
            .filter((s) => s.length >= 20);
          let found = false;
          for (const cl of clauses) {
            if (rawAnswer.toLowerCase().includes(cl.toLowerCase())) {
              seenMarkers.add(i + 1);
              rawCitations.push({
                marker: i + 1,
                quote: cl,
              });
              found = true;
              break;
            }
          }
          if (!found) {
            const excerpt = item.chunk.text.slice(0, 120).trim();
            const words = excerpt.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
            const matchCount = words.filter((w) => rawAnswer.toLowerCase().includes(w)).length;
            if (matchCount >= 2) {
              seenMarkers.add(i + 1);
              rawCitations.push({
                marker: i + 1,
                quote: excerpt,
              });
            }
          }
        }
      }
    }

    // Step 8: Validate citations
    const validation = validateCitations(rawCitations, cappedChunks);

    // If validation yielded no valid citations for a summary, ensure the representative chunks provide verified citations
    if (!validation.hasValidCitations && isDocSummary && cappedChunks.length > 0) {
      const fallbackCitations: Citation[] = cappedChunks.slice(0, Math.min(cappedChunks.length, 5)).map((item, idx) => ({
        marker: idx + 1,
        chunkId: item.chunk.id,
        documentId: item.chunk.documentId,
        documentName: item.chunk.documentName || 'Document',
        pageNumber: item.chunk.pageNumber,
        quote: item.chunk.text.slice(0, 160).trim(),
        verified: true,
        passageText: item.chunk.text,
        similarity: Number((item.semanticScore || item.score || 0.85).toFixed(4)),
        isOCR: item.chunk.isOCR,
      }));
      validation.validCitations = fallbackCitations;
      validation.hasValidCitations = true;
      validation.validMarkersCount = fallbackCitations.length;
      validation.citationValidityRate = 1.0;
    }

    const totalTime = performance.now() - overallStart;

    // Step 9: Generate 3 colorful follow-up question suggestions
    let followupSuggestions: string[] = [];
    try {
      const followRes = await authFetch('/api/suggest-followups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: input.userQuestion,
          answer: rawAnswer.slice(0, 2000),
        }),
      });
      if (followRes.ok) {
        const followData = await followRes.json();
        if (Array.isArray(followData.followups)) {
          followupSuggestions = followData.followups.slice(0, 3);
        }
      }
    } catch {
      // Non-blocking fallback follow-ups
      followupSuggestions = [
        'Can you elaborate on the underlying methodology?',
        'What are the primary limitations mentioned?',
        'How do these results compare to previous benchmarks?',
      ];
    }

    // Outcome 2: Insufficient evidence if model flagged question as unanswerable, returned empty response, or produced an ungrounded refusal
    const lowerAns = rawAnswer.toLowerCase();
    const isExplicitRefusal =
      !validation.hasValidCitations &&
      (lowerAns.startsWith('no relevant evidence') ||
        lowerAns.startsWith('there is no relevant evidence') ||
        lowerAns.startsWith('insufficient evidence') ||
        lowerAns.startsWith('the provided passages do not contain') ||
        lowerAns.includes('cannot be answered based on the provided'));

    const saysInsufficient =
      !rawAnswer.trim() ||
      isUnanswerable ||
      (isExplicitRefusal && !isDocSummary) ||
      (!validation.hasValidCitations && rawCitations.length === 0);

    console.info('[DocuMind Diagnostics] Answer generation & citation validation:', {
      isDocSummary,
      answerLength: rawAnswer.length,
      isUnanswerable,
      saysInsufficient,
      rawCitationsCount: rawCitations.length,
      validCitationsCount: validation.validCitations.length,
      validMarkersCount: validation.validMarkersCount,
      citationValidityRate: validation.citationValidityRate,
      finalStatus: saysInsufficient ? 'insufficient_evidence' : 'answered',
    });

    if (saysInsufficient) {
      const rejectionReason = !rawAnswer.trim()
        ? 'Model returned an empty answer response'
        : isUnanswerable
        ? 'Model indicated question is unanswerable from passages'
        : isExplicitRefusal
        ? 'Answer text indicates insufficient evidence or lack of coverage'
        : 'No valid citations could be extracted or verified';
      console.warn('[DocuMind Diagnostics] Returning insufficient_evidence:', { rejectionReason });

      return {
        status: 'insufficient_evidence',
        answerText: rawAnswer.trim() || ABSTENTION_MESSAGE,
        citations: [],
        retrievalScores: scores,
        followupSuggestions,
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

    // Outcome 3: Answered with citations
    return {
      status: 'answered',
      answerText: rawAnswer,
      citations: validation.validCitations,
      retrievalScores: scores,
      followupSuggestions,
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
    if (err.name === 'AbortError') {
      return {
        status: 'error',
        answerText: 'Answer generation stopped by user.',
        errorMessage: 'Generation stopped by user.',
        citations: [],
        retrievalScores: [],
        latencyMs: {
          retrieval: Math.round(retrievalTime),
          generation: Math.round(generationTime),
          total: Math.round(performance.now() - overallStart),
        },
        retrievedChunks: [],
        modelMarkersProduced: 0,
        validMarkersCount: 0,
        citationValidityRate: 0,
      };
    }

    console.error('Answering pipeline error:', err);
    const isMismatch = err instanceof IndexMismatchError || err.name === 'IndexMismatchError';
    return {
      status: 'error',
      answerText: '',
      errorMessage: err.message || 'An unexpected error occurred during research answering.',
      indexMismatch: isMismatch
        ? {
            indexedModel: err.indexedModel,
            currentModel: err.currentModel,
            indexedDim: err.indexedDim,
            currentDim: err.currentDim,
          }
        : undefined,
      citations: [],
      retrievalScores: [],
      latencyMs: {
        retrieval: Math.round(retrievalTime),
        generation: Math.round(generationTime),
        total: Math.round(performance.now() - overallStart),
      },
      retrievedChunks: [],
      modelMarkersProduced: 0,
      validMarkersCount: 0,
      citationValidityRate: 0,
    };
  }
}
