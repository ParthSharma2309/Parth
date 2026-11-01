/**
 * DocuMind Retrieval Web Worker
 * Offloads BM25 tokenization, IDF, Cosine similarity, RRF, MMR, and Context Expansion
 * to a dedicated background thread so the UI never freezes during intensive search queries.
 */

import { ChunkRecord, RetrievalScore } from '../types/index.ts';

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

function lightStem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

const workerTokenCache = new Map<string, string[]>();

function tokenizeText(text: string): string[] {
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

function getChunkTokens(chunkId: string, text: string): string[] {
  const cached = workerTokenCache.get(chunkId);
  if (cached) return cached;
  const tokens = tokenizeText(text);
  workerTokenCache.set(chunkId, tokens);
  return tokens;
}

function calculateBM25ScoresWorker(
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
    const tokens = getChunkTokens(chunk.id, chunk.text);
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

function cosineSimilarityWorker(
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

interface WorkerRetrievedChunk {
  chunk: ChunkRecord;
  score: number;
  semanticScore: number;
  bm25Score: number;
  context?: string;
}

function applyMMRWorker(
  rankedChunks: WorkerRetrievedChunk[],
  targetK: number,
  lambda = 0.7
): WorkerRetrievedChunk[] {
  if (rankedChunks.length <= targetK || targetK <= 1) {
    return rankedChunks.slice(0, targetK);
  }

  const selected: WorkerRetrievedChunk[] = [];
  const remaining: WorkerRetrievedChunk[] = [...rankedChunks];

  const minScore = remaining[remaining.length - 1].score;
  const maxScore = remaining[0].score;
  const scoreRange = maxScore - minScore;

  const getNormScore = (c: WorkerRetrievedChunk) =>
    scoreRange > 1e-9 ? (c.score - minScore) / scoreRange : 1.0;

  selected.push(remaining.shift()!);

  while (selected.length < targetK && remaining.length > 0) {
    let bestIdx = -1;
    let bestMMR = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i];
      const relScore = getNormScore(candidate);

      let maxSim = -1;
      for (const sel of selected) {
        const sim = cosineSimilarityWorker(candidate.chunk.embedding, sel.chunk.embedding);
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

function attachExpandedContextWorker(
  selectedChunks: WorkerRetrievedChunk[],
  allChunks: ChunkRecord[],
  maxPassages = 25
): WorkerRetrievedChunk[] {
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

function isDocumentSummaryQueryWorker(query: string): boolean {
  const q = query.toLowerCase().trim();
  const summaryPatterns = [
    /\bsummar(y|ize|ization|ise|isation|izing)\b/,
    /\boverview\b/,
    /\bsynopsis\b/,
    /\boutline\b/,
    /\bwhat (is|are) (this|the) (document|paper|report|pdf|file|text|article|unit|folio|story|guide|book|manual) about\b/,
    /\bwhat does (this|the) (document|paper|report|pdf|article|unit|file|story|guide|book) (say|discuss|cover|contain|talk about|describe)\b/,
    /\bwhat is (in|inside) (this|the) (document|paper|report|pdf|article|file|story|guide|book)\b/,
    /\btell me (about|the story of) (this|the) (document|paper|report|pdf|article|story|guide|book)\b/,
    /\b(explain|describe|walk through) (this|the) (document|paper|report|pdf|article|story|guide|book)\b/,
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

function selectRepresentativeSummaryChunksWorker(
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

self.onmessage = (event: MessageEvent) => {
  const { id, type, payload } = event.data;

  if (type !== 'RETRIEVE') return;

  try {
    const {
      queryEmbedding,
      candidateChunks,
      allChunks,
      targetK,
      queryText,
      queryModel,
      isBroad,
    } = payload;

    // Detect mismatched model or dimension before retrieval
    const queryDim = queryEmbedding.length;
    for (const chunk of candidateChunks) {
      const chunkDim = chunk.dim || chunk.embedding?.length;
      const normChunkModel = chunk.model?.replace(/^models\//, '');
      const normQueryModel = queryModel?.replace(/^models\//, '');

      if (normChunkModel && normQueryModel && normChunkModel !== normQueryModel) {
        self.postMessage({
          id,
          success: false,
          errorType: 'IndexMismatchError',
          errorData: {
            indexedModel: normChunkModel,
            currentModel: normQueryModel,
            indexedDim: chunkDim,
            currentDim: queryDim,
          },
        });
        return;
      }
      if (chunkDim && chunkDim !== queryDim) {
        self.postMessage({
          id,
          success: false,
          errorType: 'IndexMismatchError',
          errorData: {
            indexedModel: normChunkModel || 'different model',
            currentModel: normQueryModel || 'current model',
            indexedDim: chunkDim,
            currentDim: queryDim,
          },
        });
        return;
      }
    }

    // For whole-document summary or overview requests,
    // select representative structural passages across the document with genuine scores
    if (isDocumentSummaryQueryWorker(queryText)) {
      const summaryChunks = selectRepresentativeSummaryChunksWorker(candidateChunks, targetK);
      const bm25Map = calculateBM25ScoresWorker(queryText, candidateChunks);

      const scoredChunks: WorkerRetrievedChunk[] = summaryChunks.map((chunk, idx) => {
        const rawCosine = cosineSimilarityWorker(queryEmbedding, chunk.embedding);
        const bm25Score = bm25Map.get(chunk.id) || 0;
        const rrfScore = 1 / (60 + (idx + 1)) + 0.05;
        return {
          chunk,
          score: rrfScore,
          semanticScore: rawCosine,
          bm25Score,
        };
      });

      const expandedChunks = attachExpandedContextWorker(scoredChunks, allChunks, 25);
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

      self.postMessage({
        id,
        success: true,
        result: {
          topChunks: expandedChunks,
          maxScore,
          scores,
          isBroadQuery: true,
        },
      });
      return;
    }

    // 1. Dense Cosine Similarity
    let maxSemanticScore = 0;
    const denseScored = candidateChunks.map((chunk: ChunkRecord) => {
      const semanticScore = cosineSimilarityWorker(queryEmbedding, chunk.embedding);
      if (semanticScore > maxSemanticScore) {
        maxSemanticScore = semanticScore;
      }
      return { chunk, semanticScore };
    });

    denseScored.sort((a: any, b: any) => b.semanticScore - a.semanticScore);
    const denseRankMap = new Map<string, number>();
    denseScored.forEach((item: any, idx: number) => denseRankMap.set(item.chunk.id, idx + 1));
    const denseScoreMap = new Map<string, number>();
    denseScored.forEach((item: any) => denseScoreMap.set(item.chunk.id, item.semanticScore));

    // 2. Real BM25 Keyword Scoring (k1=1.5, b=0.75)
    const bm25Map = calculateBM25ScoresWorker(queryText, candidateChunks);
    const bm25Sorted = [...candidateChunks].sort(
      (a: any, b: any) => (bm25Map.get(b.id) || 0) - (bm25Map.get(a.id) || 0)
    );
    const bm25RankMap = new Map<string, number>();
    bm25Sorted.forEach((chunk: any, idx: number) => bm25RankMap.set(chunk.id, idx + 1));

    // 3. Reciprocal Rank Fusion (k=60)
    const RRF_K = 60;
    const scoredChunks: WorkerRetrievedChunk[] = candidateChunks.map((chunk: ChunkRecord) => {
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
    const diverseChunks = applyMMRWorker(scoredChunks, targetK, 0.7);

    // 5. Context expansion (attach previous & next chunk from same doc, capped at 25 passages)
    const expandedChunks = attachExpandedContextWorker(diverseChunks, allChunks, 25);

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

    self.postMessage({
      id,
      success: true,
      result: {
        topChunks: expandedChunks,
        maxScore: maxSemanticScore,
        scores,
        isBroadQuery: isBroad,
      },
    });
  } catch (err: any) {
    self.postMessage({
      id,
      success: false,
      error: err.message,
    });
  }
};
