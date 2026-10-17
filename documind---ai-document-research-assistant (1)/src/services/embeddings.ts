import { ChunkRecord } from '../types/index.ts';
import { MODEL_CONFIG } from '../config/models.ts';

export interface EmbedChunksOptions {
  model?: string;
  batchSize?: number;
  onProgress?: (completed: number, total: number, statusMsg?: string) => void;
}

/**
 * Fetches embeddings from the backend API for a list of chunks in paced batches with retry and cooldown handling.
 */
export async function embedChunks(
  chunks: Omit<ChunkRecord, 'embedding'>[],
  options: EmbedChunksOptions = {}
): Promise<ChunkRecord[]> {
  const model = options.model || MODEL_CONFIG.defaultEmbeddingModel;
  // Use a sensible batch size of 6 to prevent exceeding Gemini free-tier RPM/TPM limits
  const batchSize = options.batchSize || 6;
  const total = chunks.length;

  if (total === 0) return [];

  const results: ChunkRecord[] = [];
  let completed = 0;

  for (let i = 0; i < total; i += batchSize) {
    const slice = chunks.slice(i, i + batchSize);
    const texts = slice.map((c) => c.text);

    let res: Response | null = null;
    let maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      res = await fetch('/api/embed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          texts,
          model,
        }),
      });

      if (res.status === 429 && attempt < maxRetries) {
        attempt++;
        let waitTime = 15000; // default 15s cooldown
        try {
          const errData = await res.clone().json();
          const match = (errData.error || '').match(/(\d+)\s*s/i);
          if (match) {
            waitTime = (parseInt(match[1], 10) + 2) * 1000;
          }
        } catch {
          // ignore
        }
        const waitSec = Math.round(waitTime / 1000);
        const cooldownMsg = `Rate limit cooldown: waiting ${waitSec}s for quota to refresh (${completed}/${total})...`;
        if (options.onProgress) {
          options.onProgress(completed, total, cooldownMsg);
        }
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
        // use default error message
      }
      throw new Error(errorMsg);
    }

    const data = await res.json();
    const embeddings: number[][] = data.embeddings;

    if (!embeddings || embeddings.length !== slice.length) {
      throw new Error(`Embedding count mismatch: expected ${slice.length}, got ${embeddings?.length || 0}`);
    }

    for (let j = 0; j < slice.length; j++) {
      results.push({
        ...slice[j],
        embedding: embeddings[j],
        model,
      });
    }

    completed += slice.length;
    if (options.onProgress) {
      options.onProgress(completed, total);
    }

    // Gentle pause between batches to protect API quota
    if (i + batchSize < total) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  return results;
}

/**
 * Generates an embedding for a single query string with retry on rate limit.
 */
export async function embedQuery(
  query: string,
  model: string = MODEL_CONFIG.defaultEmbeddingModel
): Promise<number[]> {
  let res: Response | null = null;
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts <= maxAttempts) {
    res = await fetch('/api/embed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        texts: [query],
        model,
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

  return data.embeddings[0];
}
