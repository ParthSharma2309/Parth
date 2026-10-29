import { ChunkRecord, RetrievalScope, RetrievalScore, IndexMismatchError } from '../types/index.ts';
import { MODEL_CONFIG } from '../config/models.ts';

export interface RetrievedChunk {
  chunk: ChunkRecord;
  score: number; // fused score
  semanticScore: number; // cosine similarity score
  bm25Score: number;
  context?: string; // context expansion: previous + current + next chunk
}

export interface RetrievalResult {
  topChunks: RetrievedChunk[];
  maxScore: number; // highest semantic cosine score for threshold evaluation
  scores: RetrievalScore[];
  isBroadQuery: boolean;
}

/**
 * 6 & 7. Computes dot product for unit-normalized vectors.
 * Throws on length mismatch instead of failing silently with 0.
 */
export function cosineSimilarity(
  vecA: Float32Array | number[],
  vecB: Float32Array | number[]
): number {
  if (!vecA || !vecB) return 0;
  if (vecA.length !== vecB.length) {
    throw new Error(
      `Embedding dimension mismatch in cosineSimilarity: expected ${vecA.length}, received ${vecB.length}`
    );
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = vecA[i];
    const b = vecB[i];
    dotProduct += a * b;
    normA += a * a;
    normB += b * b;
  }

  if (normA > 0 && normB > 0) {
    if (Math.abs(normA - 1) < 1e-3 && Math.abs(normB - 1) < 1e-3) {
      return dotProduct;
    }
    return dotProduct / Math.sqrt(normA * normB);
  }
  return dotProduct;
}

/**
 * Checks if a user question is a broad or comparative query
 */
export function isBroadOrComparativeQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  const broadPatterns = [
    /\bsummar(y|ize|ization|ise|isation)\b/,
    /\boverview\b/,
    /\bmain argument(s)?\b/,
    /\bkey (findings|points|themes|takeaways|conclusions)\b/,
    /\bcompare\b/,
    /\bcontrast\b/,
    /\bdifference(s)? between\b/,
    /\bwhat is this document about\b/,
    /\ball documents\b/,
    /\bhigh level\b/,
    /\btable of contents\b/,
    /\bexecutive summary\b/,
    /\b(explain|describe|detail|detailed|in-depth|elaborate|comprehensive|break down|analyze|architecture|workflow|figure|diagram|image)\b/,
  ];
  return broadPatterns.some((pattern) => pattern.test(q));
}

/**
 * Checks if a user query specifically requests a whole-document summary or overview
 */
export function isDocumentSummaryQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  const summaryPatterns = [
    /\bsummar(y|ize|ization|ise|isation|izing)\b/,
    /\boverview\b/,
    /\bsynopsis\b/,
    /\boutline\b/,
    /\bwhat (is|are) (this|the) (document|paper|report|pdf|file|text|article|unit|folio) about\b/,
    /\bwhat does (this|the) (document|paper|report|pdf|article|unit|file) (say|discuss|cover|contain|talk about|describe)\b/,
    /\bwhat is (in|inside) (this|the) (document|paper|report|pdf|article|file)\b/,
    /\btell me about (this|the) (document|paper|report|pdf|article)\b/,
    /\b(explain|describe|walk through) (this|the) (document|paper|report|pdf|article)\b/,
    /\bexecutive summary\b/,
    /\bkey (takeaways|findings|points|themes)\b/,
    /\bmain (idea|ideas|argument|arguments|points|themes|takeaways|takeaway|topics?)\b/,
    /\bcore (findings|concepts|arguments)\b/,
    /\babstract\b/,
    /\btable of contents\b/,
    /\bdocument summary\b/,
    /\bquick summary\b/,
  ];
  return summaryPatterns.some((pattern) => pattern.test(q));
}

/**
 * Selects representative structural chunks (introduction, conclusions, evenly distributed body)
 * across the document for comprehensive summarization.
 */
export function selectRepresentativeSummaryChunks(
  candidateChunks: ChunkRecord[],
  targetK: number
): ChunkRecord[] {
  if (candidateChunks.length <= targetK) {
    return [...candidateChunks].sort(
      (a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex
    );
  }

  const ordered = [...candidateChunks].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex
  );

  const selectedSet = new Set<string>();
  const selected: ChunkRecord[] = [];

  const addChunk = (chunk: ChunkRecord) => {
    if (!selectedSet.has(chunk.id) && selected.length < targetK) {
      selectedSet.add(chunk.id);
      selected.push(chunk);
    }
  };

  // 1. Initial introductory chunks (title, abstract, intro)
  const headCount = Math.min(3, Math.max(1, Math.floor(targetK * 0.25)));
  for (let i = 0; i < headCount && i < ordered.length; i++) {
    addChunk(ordered[i]);
  }

  // 2. Concluding chunks (findings, summary)
  const tailCount = Math.min(2, Math.max(1, Math.floor(targetK * 0.15)));
  for (let i = Math.max(0, ordered.length - tailCount); i < ordered.length; i++) {
    addChunk(ordered[i]);
  }

  // 3. Evenly spaced passages across intermediate sections
  const remainingSlots = targetK - selected.length;
  if (remainingSlots > 0 && ordered.length > 0) {
    const step = ordered.length / (remainingSlots + 1);
    for (let i = 1; i <= remainingSlots; i++) {
      const idx = Math.min(ordered.length - 1, Math.round(i * step));
      addChunk(ordered[idx]);
    }
  }

  // 4. Fill any remaining slots
  for (let i = 0; i < ordered.length && selected.length < targetK; i++) {
    addChunk(ordered[i]);
  }

  return selected.sort(
    (a, b) => a.pageNumber - b.pageNumber || a.chunkIndex - b.chunkIndex
  );
}

// ----------------- REAL BM25 (k1=1.5, b=0.75) (Requirement 1) -----------------
const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could',
  'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
  'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m',
  'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t',
  'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t',
  'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t',
  'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why',
  'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours',
  'yourself', 'yourselves'
]);

/**
 * Light stemming: strip -s/-es/-ing/-ed
 */
export function lightStem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

/**
 * Tokenise with word boundaries (no substring matching), lowercase, drop stop-words, light stemming
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const words = text.toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
  const result: string[] = [];
  for (const w of words) {
    if (w.length > 1 && !STOP_WORDS.has(w)) {
      result.push(lightStem(w));
    }
  }
  return result;
}

// Cache per-chunk token lists
const chunkTokensCache = new Map<string, string[]>();

export function getCachedChunkTokens(chunkId: string, text: string): string[] {
  const cached = chunkTokensCache.get(chunkId);
  if (cached) return cached;
  const tokens = tokenizeText(text);
  chunkTokensCache.set(chunkId, tokens);
  return tokens;
}

/**
 * Computes BM25 scores for all candidate chunks against a query.
 * Standard parameters: k1 = 1.5, b = 0.75
 */
export function calculateBM25Scores(
  query: string,
  chunks: ChunkRecord[],
  k1 = 1.5,
  b = 0.75
): Map<string, number> {
  const queryTokens = tokenizeText(query);
  const scores = new Map<string, number>();

  if (queryTokens.length === 0 || chunks.length === 0) {
    chunks.forEach((c) => scores.set(c.id, 0));
    return scores;
  }

  const N = chunks.length;
  const docTokensMap = new Map<string, string[]>();
  const docTermFreqs = new Map<string, Map<string, number>>();
  const docFrequencies = new Map<string, number>();

  let totalDocLength = 0;

  for (const chunk of chunks) {
    const tokens = getCachedChunkTokens(chunk.id, chunk.text);
    docTokensMap.set(chunk.id, tokens);
    totalDocLength += tokens.length;

    const tf = new Map<string, number>();
    const seen = new Set<string>();

    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
      if (!seen.has(t)) {
        seen.add(t);
        docFrequencies.set(t, (docFrequencies.get(t) || 0) + 1);
      }
    }
    docTermFreqs.set(chunk.id, tf);
  }

  const avgDocLength = totalDocLength / Math.max(1, N);

  // Compute BM25 for each chunk
  for (const chunk of chunks) {
    const tfMap = docTermFreqs.get(chunk.id)!;
    const docLen = docTokensMap.get(chunk.id)!.length;
    let score = 0;

    for (const qTerm of queryTokens) {
      const tf = tfMap.get(qTerm) || 0;
      if (tf === 0) continue;

      const df = docFrequencies.get(qTerm) || 0;
      // Robertson-Spärck Jones IDF
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + (b * docLen) / Math.max(1, avgDocLength));

      score += idf * (numerator / denominator);
    }

    scores.set(chunk.id, score);
  }

  return scores;
}

export const calculateLexicalScore = calculateBM25Scores;

// ----------------- MAXIMAL MARGINAL RELEVANCE (MMR, lambda 0.7) (Requirement 3) -----------------
export function applyMMR(
  rankedChunks: RetrievedChunk[],
  targetK: number,
  lambda = 0.7
): RetrievedChunk[] {
  if (rankedChunks.length <= targetK || targetK <= 1) {
    return rankedChunks.slice(0, targetK);
  }

  const selected: RetrievedChunk[] = [];
  const remaining: RetrievedChunk[] = [...rankedChunks];

  const minScore = remaining[remaining.length - 1].score;
  const maxScore = remaining[0].score;
  const scoreRange = maxScore - minScore;

  const getNormScore = (c: RetrievedChunk) =>
    scoreRange > 1e-9 ? (c.score - minScore) / scoreRange : 1.0;

  // The first item selected is the top ranked item
  selected.push(remaining.shift()!);

  while (selected.length < targetK && remaining.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relScore = getNormScore(candidate);

      let maxSim = -1;
      for (const sel of selected) {
        const sim = cosineSimilarity(candidate.chunk.embedding, sel.chunk.embedding);
        if (sim > maxSim) {
          maxSim = sim;
        }
      }

      const mmr = lambda * relScore - (1 - lambda) * maxSim;
      if (mmr > bestMMR) {
        bestMMR = mmr;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining.splice(bestIdx, 1)[0]);
    } else {
      break;
    }
  }

  return selected;
}

// ----------------- CONTEXT EXPANSION (Requirement 4) -----------------
export function attachExpandedContext(
  selectedChunks: RetrievedChunk[],
  allChunks: ChunkRecord[],
  maxPassages = 25
): RetrievedChunk[] {
  const cappedChunks = selectedChunks.slice(0, maxPassages);
  const chunkMap = new Map<string, ChunkRecord>();

  for (const c of allChunks) {
    chunkMap.set(`${c.documentId}:${c.chunkIndex}`, c);
  }

  return cappedChunks.map((item) => {
    const docId = item.chunk.documentId;
    const idx = item.chunk.chunkIndex;

    const prevChunk = chunkMap.get(`${docId}:${idx - 1}`);
    const nextChunk = chunkMap.get(`${docId}:${idx + 1}`);

    const parts: string[] = [];
    if (prevChunk) {
      parts.push(`[Previous section · p.${prevChunk.pageNumber}]:\n${prevChunk.text}`);
    }
    parts.push(`[Passage · p.${item.chunk.pageNumber}]:\n${item.chunk.text}`);
    if (nextChunk) {
      parts.push(`[Next section · p.${nextChunk.pageNumber}]:\n${nextChunk.text}`);
    }

    return {
      ...item,
      context: parts.join('\n\n'),
    };
  });
}

// ----------------- SYNCHRONOUS RETRIEVAL FALLBACK -----------------
function runRetrievalLocally(
  queryEmbedding: Float32Array | number[],
  candidateChunks: ChunkRecord[],
  allChunks: ChunkRecord[],
  targetK: number,
  queryText: string,
  queryModel: string | undefined,
  isBroad: boolean
): RetrievalResult {
  const queryDim = queryEmbedding.length;
  for (const chunk of candidateChunks) {
    const chunkDim = chunk.dim || chunk.embedding?.length;
    const normChunkModel = chunk.model?.replace(/^models\//, '');
    const normQueryModel = queryModel?.replace(/^models\//, '');

    if (normChunkModel && normQueryModel && normChunkModel !== normQueryModel) {
      throw new IndexMismatchError(normChunkModel, normQueryModel, chunkDim, queryDim);
    }
    if (chunkDim && chunkDim !== queryDim) {
      throw new IndexMismatchError(
        normChunkModel || 'different model',
        normQueryModel || 'current model',
        chunkDim,
        queryDim
      );
    }
  }

  // For whole-document summary or overview requests,
  // select representative structural passages across the document with genuine scores
  if (isDocumentSummaryQuery(queryText)) {
    const summaryChunks = selectRepresentativeSummaryChunks(candidateChunks, targetK);
    const bm25Map = calculateBM25Scores(queryText, candidateChunks);

    const scoredChunks: RetrievedChunk[] = summaryChunks.map((chunk, idx) => {
      const rawCosine = cosineSimilarity(queryEmbedding, chunk.embedding);
      const bm25Score = bm25Map.get(chunk.id) || 0;
      const rrfScore = 1 / (60 + (idx + 1)) + 0.05;
      return {
        chunk,
        score: rrfScore,
        semanticScore: rawCosine,
        bm25Score,
      };
    });

    const expandedChunks = attachExpandedContext(scoredChunks, allChunks, 25);
    const scores: RetrievalScore[] = expandedChunks.map((item) => ({
      chunkId: item.chunk.id,
      documentId: item.chunk.documentId,
      documentName: item.chunk.documentName,
      pageNumber: item.chunk.pageNumber,
      score: Number(item.score.toFixed(4)),
      denseScore: Number(item.semanticScore.toFixed(4)),
      sparseScore: Number(item.bm25Score.toFixed(4)),
      preview: item.chunk.text.slice(0, 150) + (item.chunk.text.length > 150 ? '...' : ''),
      isOCR: item.chunk.isOCR,
    }));

    const maxScore = scoredChunks.length > 0
      ? Math.max(...scoredChunks.map((c) => c.semanticScore))
      : 0;

    return {
      topChunks: expandedChunks,
      maxScore,
      scores,
      isBroadQuery: true,
    };
  }

  // 1. Dense Cosine Similarity
  let maxSemanticScore = 0;
  const denseScored = candidateChunks.map((chunk) => {
    const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (semanticScore > maxSemanticScore) {
      maxSemanticScore = semanticScore;
    }
    return { chunk, semanticScore };
  });

  denseScored.sort((a, b) => b.semanticScore - a.semanticScore);
  const denseRankMap = new Map<string, number>();
  denseScored.forEach((item, idx) => denseRankMap.set(item.chunk.id, idx + 1));
  const denseScoreMap = new Map<string, number>();
  denseScored.forEach((item) => denseScoreMap.set(item.chunk.id, item.semanticScore));

  // 2. Real BM25 Keyword Scoring
  const bm25Map = calculateBM25Scores(queryText, candidateChunks);
  const bm25Sorted = [...candidateChunks].sort(
    (a, b) => (bm25Map.get(b.id) || 0) - (bm25Map.get(a.id) || 0)
  );
  const bm25RankMap = new Map<string, number>();
  bm25Sorted.forEach((chunk, idx) => bm25RankMap.set(chunk.id, idx + 1));

  // 3. Reciprocal Rank Fusion (k=60)
  const RRF_K = 60;
  const scoredChunks: RetrievedChunk[] = candidateChunks.map((chunk) => {
    const denseRank = denseRankMap.get(chunk.id) || candidateChunks.length;
    const bm25Rank = bm25RankMap.get(chunk.id) || candidateChunks.length;
    const semanticScore = denseScoreMap.get(chunk.id) || 0;
    const bm25Score = bm25Map.get(chunk.id) || 0;

    const rrfScore = 1 / (RRF_K + denseRank) + 1 / (RRF_K + bm25Rank);

    return {
      chunk,
      score: rrfScore,
      semanticScore,
      bm25Score,
    };
  });

  scoredChunks.sort((a, b) => b.score - a.score);

  // 4. Maximal Marginal Relevance (lambda 0.7) for diversity
  const diverseChunks = applyMMR(scoredChunks, targetK, 0.7);

  // 5. Context expansion (previous & next chunk from same doc, capped at 25 passages)
  const expandedChunks = attachExpandedContext(diverseChunks, allChunks, 25);

  const scores: RetrievalScore[] = expandedChunks.map((item) => ({
    chunkId: item.chunk.id,
    documentId: item.chunk.documentId,
    documentName: item.chunk.documentName,
    pageNumber: item.chunk.pageNumber,
    score: Number(item.score.toFixed(4)),
    denseScore: Number(item.semanticScore.toFixed(4)),
    sparseScore: Number(item.bm25Score.toFixed(4)),
    preview: item.chunk.text.slice(0, 150) + (item.chunk.text.length > 150 ? '...' : ''),
    isOCR: item.chunk.isOCR,
  }));

  return {
    topChunks: expandedChunks,
    maxScore: maxSemanticScore,
    scores,
    isBroadQuery: isBroad,
  };
}

// ----------------- WEB WORKER POOL / SINGLETON (Requirement 6) -----------------
let sharedWorker: Worker | null = null;
let workerFailed = false;

function getRetrievalWorker(): Worker | null {
  if (workerFailed || typeof Worker === 'undefined') return null;
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(
        new URL('./retrieval.worker.ts', import.meta.url),
        { type: 'module' }
      );
      sharedWorker.onerror = (e) => {
        console.warn('Retrieval worker encountered error, falling back to main thread:', e);
        workerFailed = true;
        sharedWorker?.terminate();
        sharedWorker = null;
      };
    } catch (err) {
      console.warn('Failed to construct retrieval worker, falling back to main thread:', err);
      workerFailed = true;
      return null;
    }
  }
  return sharedWorker;
}

/**
 * Retrieves top-k chunks matching query with:
 * 1. Real BM25 (k1=1.5, b=0.75)
 * 2. Reciprocal Rank Fusion (k=60)
 * 3. Maximal Marginal Relevance (lambda 0.7) diversity
 * 4. Context expansion (prev/next chunk attached as context, cap 25)
 * 5. Offloaded to Web Worker so UI never freezes (Requirement 6)
 */
export async function retrieveRelevantChunks(
  queryEmbedding: Float32Array | number[],
  allChunks: ChunkRecord[],
  scope: RetrievalScope,
  validDocIds: Set<string>,
  topK: number = MODEL_CONFIG.defaultTopK,
  queryText: string = '',
  _bm25Weight: number = 0.5,
  queryModel?: string
): Promise<RetrievalResult> {
  // Filter candidate chunks by scope
  let candidateChunks = allChunks.filter((chunk) => validDocIds.has(chunk.documentId));

  if (scope.type === 'selected') {
    const selectedSet = new Set(scope.documentIds);
    candidateChunks = candidateChunks.filter((chunk) => selectedSet.has(chunk.documentId));
  } else if ((scope as any).type === 'document' && (scope as any).documentId) {
    candidateChunks = candidateChunks.filter((chunk) => chunk.documentId === (scope as any).documentId);
  }

  if (candidateChunks.length === 0) {
    return {
      topChunks: [],
      maxScore: 0,
      scores: [],
      isBroadQuery: false,
    };
  }

  const isBroad = isBroadOrComparativeQuery(queryText);
  const targetK = isBroad ? Math.max(topK, MODEL_CONFIG.broadQueryTopK) : topK;

  const worker = getRetrievalWorker();
  if (worker) {
    try {
      const result = await new Promise<RetrievalResult>((resolve, reject) => {
        const reqId = `${Date.now()}_${Math.random()}`;
        const timeout = setTimeout(() => {
          worker.removeEventListener('message', handleMsg);
          reject(new Error('Retrieval worker timeout (5000ms)'));
        }, 5000);

        function handleMsg(event: MessageEvent) {
          if (event.data?.id !== reqId) return;
          clearTimeout(timeout);
          worker?.removeEventListener('message', handleMsg);

          if (event.data.success) {
            resolve(event.data.result);
          } else if (event.data.errorType === 'IndexMismatchError' && event.data.errorData) {
            const { indexedModel, currentModel, indexedDim, currentDim } = event.data.errorData;
            reject(new IndexMismatchError(indexedModel, currentModel, indexedDim, currentDim));
          } else {
            reject(new Error(event.data.error || 'Retrieval worker failed'));
          }
        }

        worker.addEventListener('message', handleMsg);
        worker.postMessage({
          id: reqId,
          type: 'RETRIEVE',
          payload: {
            queryEmbedding,
            candidateChunks,
            allChunks,
            targetK,
            queryText,
            queryModel,
            isBroad,
          },
        });
      });

      return result;
    } catch (err: any) {
      if (err instanceof IndexMismatchError) {
        throw err;
      }
      console.warn('Worker retrieval failed or timed out, executing locally:', err);
    }
  }

  // Fallback to local thread execution
  return runRetrievalLocally(
    queryEmbedding,
    candidateChunks,
    allChunks,
    targetK,
    queryText,
    queryModel,
    isBroad
  );
}
