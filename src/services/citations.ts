import { Citation } from '../types/index.ts';
import { RetrievedChunk } from './retrieval.ts';

/**
 * Normalizes text for verbatim matching: collapses multiple whitespace, removes extraneous newlines, trims.
 */
export function normalizeText(str: string): string {
  return str
    .replace(/\s+/g, ' ')
    .replace(/["'""'']/g, '"')
    .trim()
    .toLowerCase();
}

/**
 * Verifies if a quote exists in the passage text with robust normalization,
 * ellipsis handling, and shingle matching for rich research quotes.
 */
export function verifyQuoteInPassage(quote: string, passageText: string): boolean {
  if (!quote || quote.trim().length === 0) return false;
  const normQuote = normalizeText(quote);
  const normPassage = normalizeText(passageText);

  // 1. Exact normalized substring match
  if (normPassage.includes(normQuote)) return true;

  // 2. Trim leading/trailing punctuation in case model enclosed or trimmed punctuation
  const cleanQuote = normQuote.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (cleanQuote.length > 5 && normPassage.includes(cleanQuote)) return true;

  // 3. Handle ellipsis inside quotes e.g. "figure shows ... resulting in 42%"
  if (normQuote.includes('...') || normQuote.includes('…')) {
    const segments = normQuote
      .split(/\.{3,}|…/)
      .map((s) => s.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim())
      .filter((s) => s.length > 4);
    if (segments.length > 0 && segments.every((seg) => normPassage.includes(seg))) {
      return true;
    }
  }

  // 4. Consecutive word shingle match for longer quotes from detailed answers or OCR
  const words = cleanQuote.split(/\s+/).filter((w) => w.length > 1);
  if (words.length >= 4) {
    const shingleSize = Math.min(words.length, 5);
    for (let i = 0; i <= words.length - shingleSize; i++) {
      const shingle = words.slice(i, i + shingleSize).join(' ');
      if (normPassage.includes(shingle)) return true;
    }
  }

  return false;
}

export interface CitationValidationResult {
  validCitations: Citation[];
  droppedMarkersCount: number;
  totalModelMarkers: number;
  validMarkersCount: number;
  citationValidityRate: number; // validMarkersCount / totalModelMarkers
  hasValidCitations: boolean;
}

/**
 * Strictly validates citations against retrieved passages according to the DocuMind citation protocol:
 * 1. Markers must strictly map to 1..k retrieved passages. Drop invalid markers.
 * 2. Check if quote matches passage text (normalized whitespace). If not, flag verified = false (unverified).
 * 3. Count valid markers vs total model-produced markers for evaluation metrics.
 */
export function validateCitations(
  modelCitations: Array<{ marker: number; quote: string }>,
  retrievedPassages: RetrievedChunk[],
  deletedDocIds: Set<string> = new Set()
): CitationValidationResult {
  const k = retrievedPassages.length;
  const totalModelMarkers = modelCitations.length;

  let droppedMarkersCount = 0;
  const validCitations: Citation[] = [];

  for (const raw of modelCitations) {
    const marker = raw.marker;
    // Rule: marker must be within 1..k
    if (typeof marker !== 'number' || marker < 1 || marker > k) {
      droppedMarkersCount++;
      continue;
    }

    const passageIndex = marker - 1;
    const item = retrievedPassages[passageIndex];
    if (!item) {
      droppedMarkersCount++;
      continue;
    }

    const passageText = item.chunk.text;
    const quote = (raw.quote || '').trim();
    const isVerified =
      verifyQuoteInPassage(quote, passageText) ||
      (item.context ? verifyQuoteInPassage(quote, item.context) : false);
    const isSourceDeleted = deletedDocIds.has(item.chunk.documentId);

    validCitations.push({
      marker,
      chunkId: item.chunk.id,
      documentId: item.chunk.documentId,
      documentName: item.chunk.documentName,
      pageNumber: item.chunk.pageNumber,
      quote,
      verified: isVerified,
      sourceDeleted: isSourceDeleted,
      passageText,
      similarity: Number(item.score.toFixed(4)),
    });
  }

  const verifiedCount = validCitations.filter((c) => c.verified).length;
  const citationValidityRate =
    totalModelMarkers > 0 ? Number((verifiedCount / totalModelMarkers).toFixed(4)) : 1.0;

  return {
    validCitations,
    droppedMarkersCount,
    totalModelMarkers,
    validMarkersCount: verifiedCount,
    citationValidityRate,
    hasValidCitations: validCitations.length > 0 && verifiedCount > 0,
  };
}
