import { describe, it, expect } from 'vitest';
import {
  retrieveRelevantChunks,
  cosineSimilarity,
  calculateBM25Scores,
} from '../../src/services/retrieval.ts';
import { ChunkRecord } from '../../src/types/index.ts';

function createMockChunk(
  id: string,
  docId: string,
  text: string,
  embeddingValues: number[]
): ChunkRecord {
  const embedding = new Float32Array(embeddingValues);
  // Unit normalize for test stability
  let norm = 0;
  for (let i = 0; i < embedding.length; i++) norm += embedding[i] * embedding[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) embedding[i] /= norm;
  }

  return {
    id,
    documentId: docId,
    documentName: `${docId}.pdf`,
    pageNumber: 1,
    chunkIndex: 0,
    text,
    embedding,
    dim: embedding.length,
    model: 'gemini-embedding-2-preview',
    charStart: 0,
    charEnd: text.length,
  };
}

describe('retrieveRelevantChunks & BM25 + RRF', () => {
  const chunkA = createMockChunk(
    'c1',
    'doc1',
    'Quantum algorithms demonstrate exponential speedup for integer factorization.',
    [1, 0, 0, 0]
  );
  const chunkB = createMockChunk(
    'c2',
    'doc1',
    'Database indexing using B-trees and hash indexes improves query performance.',
    [0, 1, 0, 0]
  );
  const chunkC = createMockChunk(
    'c3',
    'doc2',
    'Quantum mechanics and entanglement principles in physical systems.',
    [0.7, 0.7, 0, 0]
  );

  const allChunks = [chunkA, chunkB, chunkC];
  const queryEmbedding = new Float32Array([1, 0, 0, 0]);

  it('ranks higher when semantic similarity and BM25 keywords align', async () => {
    const validDocIds = new Set(['doc1', 'doc2']);
    const result = await retrieveRelevantChunks(
      queryEmbedding,
      allChunks,
      { type: 'all' },
      validDocIds,
      3,
      'quantum integer factorization algorithms'
    );

    expect(result.topChunks.length).toBeGreaterThan(0);
    // Chunk A matches both the semantic embedding [1,0,0,0] and the BM25 query terms
    expect(result.topChunks[0].chunk.id).toBe('c1');
    expect(result.maxScore).toBeCloseTo(1.0, 2);
  });

  it('filters chunks strictly according to retrieval scope', async () => {
    const validDocIds = new Set(['doc1', 'doc2']);

    // Selected scope only allowing doc2
    const result = await retrieveRelevantChunks(
      queryEmbedding,
      allChunks,
      { type: 'selected', documentIds: ['doc2'] },
      validDocIds,
      3,
      'quantum algorithms'
    );

    // Only chunkC belongs to doc2
    expect(result.topChunks.length).toBe(1);
    expect(result.topChunks[0].chunk.documentId).toBe('doc2');
  });

  it('provides highest semantic score for abstention threshold evaluation', async () => {
    // Orthogonal query embedding: [0, 0, 0, 1]
    const orthogonalEmbedding = new Float32Array([0, 0, 0, 1]);
    const validDocIds = new Set(['doc1', 'doc2']);

    const result = await retrieveRelevantChunks(
      orthogonalEmbedding,
      allChunks,
      { type: 'all' },
      validDocIds,
      3,
      'unrelated query terms xyz123'
    );

    // Max semantic score should be near 0
    expect(result.maxScore).toBeLessThan(0.3);
  });
});
