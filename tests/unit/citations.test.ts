import { describe, it, expect } from 'vitest';
import {
  verifyQuoteInPassage,
  validateCitations,
  normalizeText,
} from '../../src/services/citations.ts';
import { RetrievedChunk } from '../../src/services/retrieval.ts';

describe('verifyQuoteInPassage', () => {
  const passage =
    'The neural architecture demonstrated a 42.8% reduction in latency compared to baseline models, with zero degradation in empirical accuracy across all evaluated benchmarks.';

  it('matches exact verbatim quotes', () => {
    const quote = '42.8% reduction in latency';
    expect(verifyQuoteInPassage(quote, passage)).toBe(true);
  });

  it('matches quotes with normalized whitespace, different newlines, or casing', () => {
    const quote = '  42.8%   reduction \n\t  in  LATENCY  ';
    expect(verifyQuoteInPassage(quote, passage)).toBe(true);
  });

  it('matches quotes with ellipsis (...) spanning across omitted tokens', () => {
    const quote = 'neural architecture ... reduction in latency ... zero degradation';
    expect(verifyQuoteInPassage(quote, passage)).toBe(true);
  });

  it('rejects hallucinated or non-existent quotes', () => {
    const quote = 'hallucinated statement claiming 99.9% quantum supremacy';
    expect(verifyQuoteInPassage(quote, passage)).toBe(false);
  });

  it('handles empty or blank quotes safely without throwing', () => {
    expect(verifyQuoteInPassage('', passage)).toBe(false);
    expect(verifyQuoteInPassage('   ', passage)).toBe(false);
  });
});

describe('validateCitations', () => {
  const mockRetrievedPassages: RetrievedChunk[] = [
    {
      chunk: {
        id: 'chunk-1',
        documentId: 'doc-alpha',
        documentName: 'Alpha.pdf',
        pageNumber: 3,
        chunkIndex: 0,
        text: 'The primary hypothesis was verified through double-blind controlled randomized trials.',
        embedding: new Float32Array(768),
        dim: 768,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 88,
      },
      score: 0.85,
      semanticScore: 0.82,
      bm25Score: 12.4,
    },
    {
      chunk: {
        id: 'chunk-2',
        documentId: 'doc-beta',
        documentName: 'Beta.pdf',
        pageNumber: 12,
        chunkIndex: 1,
        text: 'Secondary analysis revealed notable statistical significance with p-value < 0.001.',
        embedding: new Float32Array(768),
        dim: 768,
        model: 'gemini-embedding-2-preview',
        charStart: 0,
        charEnd: 82,
      },
      score: 0.72,
      semanticScore: 0.69,
      bm25Score: 8.5,
    },
  ];

  it('validates correct citations with exact quotes', () => {
    const modelCitations = [
      { marker: 1, quote: 'double-blind controlled randomized trials' },
      { marker: 2, quote: 'p-value < 0.001' },
    ];

    const result = validateCitations(modelCitations, mockRetrievedPassages);

    expect(result.validCitations.length).toBe(2);
    expect(result.validCitations[0].verified).toBe(true);
    expect(result.validCitations[1].verified).toBe(true);
    expect(result.droppedMarkersCount).toBe(0);
    expect(result.citationValidityRate).toBe(1.0);
    expect(result.hasValidCitations).toBe(true);
  });

  it('flags unverified on hallucinated quote while keeping marker within 1..k', () => {
    const modelCitations = [
      { marker: 1, quote: 'Completely made up quote that does not appear in text' },
    ];

    const result = validateCitations(modelCitations, mockRetrievedPassages);

    expect(result.validCitations.length).toBe(1);
    expect(result.validCitations[0].verified).toBe(false);
    expect(result.droppedMarkersCount).toBe(0);
  });

  it('drops out-of-bounds markers (e.g. marker > k or marker <= 0)', () => {
    const modelCitations = [
      { marker: 1, quote: 'double-blind controlled randomized trials' },
      { marker: 99, quote: 'out of range marker' },
      { marker: 0, quote: 'zero marker' },
      { marker: -1, quote: 'negative marker' },
    ];

    const result = validateCitations(modelCitations, mockRetrievedPassages);

    expect(result.validCitations.length).toBe(1);
    expect(result.droppedMarkersCount).toBe(3);
    expect(result.totalModelMarkers).toBe(4);
  });
});
