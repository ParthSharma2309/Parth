import { ChunkRecord, RetrievalScope, RetrievalScore } from '../types/index.ts';
import { MODEL_CONFIG } from '../config/models.ts';

export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Checks if a user question is a broad or comparative query
 */
export function isBroadOrComparativeQuery(query: string): boolean {
  const q = query.toLowerCase().trim();
  const broadPatterns = [
    /\bsummar(y|ize|ization)\b/,
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

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'this', 'but', 'they', 'have',
  'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how', 'or',
  'if', 'not', 'can', 'all', 'any', 'been', 'there', 'their'
]);

/**
 * Calculates lexical overlap score: proportion of distinct non-trivial query terms appearing in chunk.
 */
export function calculateLexicalScore(query: string, chunkText: string): number {
  if (!query || !chunkText) return 0;
  const queryTokens = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  if (queryTokens.length === 0) return 0;

  const distinctTokens = Array.from(new Set(queryTokens));
  const chunkLower = chunkText.toLowerCase();

  let matches = 0;
  for (const token of distinctTokens) {
    if (chunkLower.includes(token)) {
      matches++;
    }
  }

  return matches / distinctTokens.length;
}

export interface RetrievedChunk {
  chunk: ChunkRecord;
  score: number; // combined score
  semanticScore: number; // cosine similarity score
}

export interface RetrievalResult {
  topChunks: RetrievedChunk[];
  maxScore: number;
  scores: RetrievalScore[];
  isBroadQuery: boolean;
}

/**
 * Retrieves top-k chunks matching the query embedding, filtered by scope and balanced if broad query.
 * Uses hybrid ranking: combinedScore = 0.88 * semanticScore + 0.12 * lexicalScore
 */
export function retrieveRelevantChunks(
  queryEmbedding: number[],
  allChunks: ChunkRecord[],
  scope: RetrievalScope,
  validDocIds: Set<string>,
  topK: number = MODEL_CONFIG.defaultTopK,
  queryText: string = ''
): RetrievalResult {
  // 1. Filter chunks by scope
  let candidateChunks = allChunks.filter((chunk) => validDocIds.has(chunk.documentId));

  if (scope.type === 'selected') {
    const selectedSet = new Set(scope.documentIds);
    candidateChunks = candidateChunks.filter((chunk) => selectedSet.has(chunk.documentId));
  }

  if (candidateChunks.length === 0) {
    return {
      topChunks: [],
      maxScore: 0,
      scores: [],
      isBroadQuery: false,
    };
  }

  // 2. Score candidate chunks using hybrid scoring (semantic cosine + lexical keyword match)
  let maxSemanticScore = 0;
  const scoredChunks: RetrievedChunk[] = candidateChunks.map((chunk) => {
    const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    if (semanticScore > maxSemanticScore) {
      maxSemanticScore = semanticScore;
    }
    const lexicalScore = calculateLexicalScore(queryText, chunk.text);
    const combinedScore = 0.88 * semanticScore + 0.12 * lexicalScore;

    return {
      chunk,
      score: combinedScore,
      semanticScore,
    };
  });

  // Sort descending by combined score
  scoredChunks.sort((a, b) => b.score - a.score);

  const maxScore = maxSemanticScore;
  const isBroad = isBroadOrComparativeQuery(queryText);
  const targetK = isBroad ? Math.max(topK, MODEL_CONFIG.broadQueryTopK) : topK;

  let selectedChunks: RetrievedChunk[] = [];

  if (isBroad) {
    // Balanced retrieval across distinct documents
    const chunksByDoc = new Map<string, RetrievedChunk[]>();
    for (const item of scoredChunks) {
      const docId = item.chunk.documentId;
      if (!chunksByDoc.has(docId)) {
        chunksByDoc.set(docId, []);
      }
      chunksByDoc.get(docId)!.push(item);
    }

    const docIds = Array.from(chunksByDoc.keys());
    let round = 0;
    while (selectedChunks.length < targetK) {
      let addedInRound = 0;
      for (const docId of docIds) {
        const docChunks = chunksByDoc.get(docId)!;
        if (round < docChunks.length) {
          selectedChunks.push(docChunks[round]);
          addedInRound++;
          if (selectedChunks.length >= targetK) break;
        }
      }
      if (addedInRound === 0) break; // no more chunks available in any document
      round++;
    }
    // Re-sort selected chunks by score for consistent marker ordering
    selectedChunks.sort((a, b) => b.score - a.score);
  } else {
    selectedChunks = scoredChunks.slice(0, targetK);
  }

  const scores: RetrievalScore[] = selectedChunks.map((item) => ({
    chunkId: item.chunk.id,
    documentId: item.chunk.documentId,
    documentName: item.chunk.documentName,
    pageNumber: item.chunk.pageNumber,
    score: Number(item.score.toFixed(4)),
    preview: item.chunk.text.slice(0, 150) + (item.chunk.text.length > 150 ? '...' : ''),
  }));

  return {
    topChunks: selectedChunks,
    maxScore,
    scores,
    isBroadQuery: isBroad,
  };
}
