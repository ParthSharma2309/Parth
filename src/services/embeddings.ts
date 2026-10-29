import { ChunkRecord } from '../types/index.ts';
import { MODEL_CONFIG } from '../config/models.ts';
import { authFetch } from './apiClient.ts';

export interface EmbedChunksOptions {
  model?: string;
  batchSize?: number;
  dimensions?: number;
  onProgress?: (completed: number, total: number, statusMsg?: string) => void;
}

// In-memory cache for chunk embeddings keyed by SHA-256 chunk hash
const chunkEmbeddingCache = new Map<string, Float32Array>();

/**
 * 6. Normalise vectors to unit length at index time and return as Float32Array
 */
export function normalizeVector(vector: number[] | Float32Array): Float32Array {
  const arr = new Float32Array(vector);
  let sumSq = 0;
  for (let i = 0; i < arr.length; i++) {
    sumSq += arr[i] * arr[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] /= norm;
    }
  }
  return arr;
}

/**
 * Computes a fast, unique SHA-256 hash for a chunk's text and embedding model/dims
 */
export async function computeChunkHash(
  text: string,
  model: string,
  dims?: number
): Promise<string> {
  const payload = `${model}:${dims || 'def'}:::${text}`;
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const msgBuffer = new TextEncoder().encode(payload);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {}
  // Fallback simple hash string
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return `h_${hash}`;
}

/**
 * Prefix the text that is EMBEDDED (not displayed) with "<document title> · page N" for better matching (Requirement 5)
 */
export function getEmbeddedTextForChunk(chunk: {
  documentName: string;
  pageNumber: number;
  text: string;
}): string {
  const prefix = `${chunk.documentName} · page ${chunk.pageNumber}`;
  return `${prefix}\n${chunk.text}`;
}

/**
 * 5. Fetches embeddings from backend API in parallel batches of 20 with fine-grained progress,
 * retry/cooldown handling, unit-normalization, and Float32Array storage.
 */
export async function embedChunks(
  chunks: Omit<ChunkRecord, 'embedding'>[],
  options: EmbedChunksOptions = {}
): Promise<ChunkRecord[]> {
  const model = options.model || MODEL_CONFIG.defaultEmbeddingModel;
  // 5. Raise batchSize to 20 (Requirement 5)
  const batchSize = options.batchSize || 20;
  const dimensions = options.dimensions;
  const total = chunks.length;

  if (total === 0) return [];

  // Step 1: Pre-compute hashes and check in-memory cache using prefixed text
  const chunkHashes = await Promise.all(
    chunks.map((c) => computeChunkHash(getEmbeddedTextForChunk(c), model, dimensions))
  );

  const results: ChunkRecord[] = new Array(total);
  const uncachedIndices: number[] = [];

  for (let i = 0; i < total; i++) {
    const hash = chunkHashes[i];
    const cachedVector = chunkEmbeddingCache.get(hash);
    if (cachedVector) {
      results[i] = {
        ...chunks[i],
        embedding: cachedVector,
        dim: cachedVector.length,
        model,
      };
    } else {
      uncachedIndices.push(i);
    }
  }

  // If all chunks were served from cache, report 100% and return immediately
  if (uncachedIndices.length === 0) {
    options.onProgress?.(total, total, 'Loaded 100% of chunk embeddings from cache');
    return results;
  }

  let completedUncached = 0;
  const uncachedTotal = uncachedIndices.length;
  // Initially report already-cached items count
  const alreadyCached = total - uncachedTotal;
  options.onProgress?.(alreadyCached, total, `Prepared ${alreadyCached}/${total} cached passages`);

  // Build batches of 20 uncached chunk indices
  const batchGroups: number[][] = [];
  for (let i = 0; i < uncachedTotal; i += batchSize) {
    batchGroups.push(uncachedIndices.slice(i, i + batchSize));
  }

  // Helper to fetch a single batch with retry & cooldown handling
  async function fetchBatch(batchIndices: number[]): Promise<void> {
    const texts = batchIndices.map((idx) => getEmbeddedTextForChunk(chunks[idx]));
    let res: Response | null = null;
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      res = await authFetch('/api/embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          texts,
          model,
          purpose: 'document', // 2. Pass purpose: 'document' (Requirement 2)
          dimensions,
        }),
      });

      if (res.status === 429 && attempt < maxRetries) {
        attempt++;
        let waitTime = 15000;
        try {
          const errData = await res.clone().json();
          const match = (errData.error || '').match(/(\d+)\s*s/i);
          if (match) {
            waitTime = (parseInt(match[1], 10) + 2) * 1000;
          }
        } catch {
          // ignore parsing failure
        }
        const waitSec = Math.round(waitTime / 1000);
        const cooldownMsg = `Rate limit cooldown: waiting ${waitSec}s for quota to refresh...`;
        options.onProgress?.(
          alreadyCached + completedUncached,
          total,
          cooldownMsg
        );
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }
      break;
    }

    if (!res || !res.ok) {
      let errorMsg = `Embedding request failed with status ${res?.status || 'unknown'}`;
      try {
        const errJson = await res?.json();
        if (errJson?.error) errorMsg = errJson.error;
      } catch {
        // fallback
      }
      throw new Error(errorMsg);
    }

    const data = await res.json();
    const rawEmbeddings: number[][] = data.embeddings;

    if (!rawEmbeddings || rawEmbeddings.length !== batchIndices.length) {
      throw new Error(
        `Embedding count mismatch: expected ${batchIndices.length}, got ${rawEmbeddings?.length || 0}`
      );
    }

    // 6. Normalise vectors to unit length and store as Float32Array (Requirement 6)
    for (let j = 0; j < batchIndices.length; j++) {
      const origIndex = batchIndices[j];
      const normalized = normalizeVector(rawEmbeddings[j]);
      const hash = chunkHashes[origIndex];

      chunkEmbeddingCache.set(hash, normalized);

      results[origIndex] = {
        ...chunks[origIndex],
        embedding: normalized,
        dim: normalized.length, // 3. Store the dimension on every chunk (chunk.dim)
        model: data.model || model, // 3. Store the model id (chunk.model)
      };
    }

    completedUncached += batchIndices.length;
    // 5. Fine-grained progress through existing progress callback (Requirement 5)
    options.onProgress?.(
      alreadyCached + completedUncached,
      total,
      `Embedded ${alreadyCached + completedUncached}/${total} passages`
    );
  }

  // 5. Run 2 batches in parallel (Requirement 5)
  const concurrency = 2;
  for (let i = 0; i < batchGroups.length; i += concurrency) {
    const currentBatches = batchGroups.slice(i, i + concurrency);
    await Promise.all(currentBatches.map((b) => fetchBatch(b)));

    // Small pause between concurrency waves if more remain
    if (i + concurrency < batchGroups.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return results;
}

/**
 * 2. Generates a normalized unit embedding for a question/query string (purpose = 'query')
 */
export async function embedQuery(
  query: string,
  model: string = MODEL_CONFIG.defaultEmbeddingModel,
  dimensions?: number
): Promise<Float32Array> {
  let res: Response | null = null;
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts <= maxAttempts) {
    res = await authFetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: [query],
        model,
        purpose: 'query', // 2. Pass purpose: 'query' (Requirement 2)
        dimensions,
      }),
    });

    if (res.status === 429 && attempts < maxAttempts) {
      attempts++;
      await new Promise((r) => setTimeout(r, 4000 * attempts));
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    let errorMsg = `Query embedding failed with status ${res?.status || 'unknown'}`;
    try {
      const errJson = await res?.json();
      if (errJson?.error) errorMsg = errJson.error;
    } catch {
      // fallback
    }
    throw new Error(errorMsg);
  }

  const data = await res.json();
  if (!data.embeddings || !data.embeddings[0]) {
    throw new Error('Failed to retrieve query vector from embedding service');
  }

  // 6. Normalise to unit length
  return normalizeVector(data.embeddings[0]);
}
