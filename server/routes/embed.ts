import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { env, ALLOWED_EMBED_MODELS, EMBED_DIMENSIONS } from '../lib/env.js';
import {
  getAI,
  createRequestAbortController,
  classifyError,
  isRetryableError,
  parseRetryDelayMs,
  setModelCooldown,
} from '../lib/gemini.js';
import { rateLimit } from '../lib/rateLimit.js';
import { formatZodError, AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const embedRouter = Router();

// Per-route rate limit: embed 60/min
const embedLimiter = rateLimit({ windowMs: 60000, max: 60 });

// 4. Server LRU cache (max 2,000 entries, key = sha256(model+purpose+dimensions+text)) (Requirement 4)
class LRUCache<K, V> {
  private capacity: number;
  private map = new Map<K, V>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const val = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, val);
    return val;
  }

  set(key: K, value: V) {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, value);
  }

  size(): number {
    return this.map.size;
  }
}

const embeddingLRUCache = new LRUCache<string, number[]>(2000);

export function computeServerCacheKey(
  model: string,
  purpose: string,
  dimensions: number | undefined,
  text: string
): string {
  const dimStr = dimensions ? String(dimensions) : '';
  return crypto
    .createHash('sha256')
    .update(`${model}${purpose}${dimStr}${text}`)
    .digest('hex');
}

// 2. Request schema with purpose and optional dimensions (Requirement 2 & 3)
const EmbedRequestSchema = z.object({
  texts: z
    .array(
      z
        .string()
        .min(1, 'Chunk text cannot be empty')
        .max(10000, 'Chunk text cannot exceed 10,000 characters')
    )
    .min(1, 'At least 1 text must be provided')
    .max(50, 'Maximum 50 texts allowed per batch'),
  model: z.string().optional().default('gemini-embedding-2-preview'),
  purpose: z.enum(['document', 'query']).optional().default('document'),
  dimensions: z.coerce.number().int().positive().optional(),
});

embedRouter.post('/api/embed', embedLimiter, async (req, res, next) => {
  const requestId = (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
  // 30s timeout per use with client close cancellation (Requirement 3 & 5)
  const { signal } = createRequestAbortController(req, res, env.TIMEOUT_EMBED);

  try {
    const parseResult = EmbedRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      const formatted = formatZodError(parseResult.error, req, res);
      return res.status(400).json(formatted);
    }

    const { texts, model, purpose, dimensions } = parseResult.data;
    const targetDimensions = dimensions || EMBED_DIMENSIONS;

    if (!ALLOWED_EMBED_MODELS.has(model)) {
      return res.status(400).json({
        error: `Unsupported embedding model: ${model}`,
        code: 'INVALID_MODEL',
        requestId,
      });
    }

    const total = texts.length;
    const finalEmbeddings: number[][] = new Array(total);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Step 1: Check server LRU cache for each text
    for (let i = 0; i < total; i++) {
      const key = computeServerCacheKey(model, purpose, targetDimensions, texts[i]);
      const cached = embeddingLRUCache.get(key);
      if (cached) {
        finalEmbeddings[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // If all served from cache, return immediately
    if (uncachedTexts.length === 0) {
      const dim = finalEmbeddings[0]?.length || targetDimensions || 0;
      return res.json({ embeddings: finalEmbeddings, model, dim });
    }

    const ai = getAI(env.TIMEOUT_EMBED);
    const taskType = purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';

    // Helper to call Gemini embedContent with retry and taskType/dim fallback
    async function executeEmbed(
      textsToEmbed: string[],
      useTaskType = true,
      useDims = true
    ): Promise<number[][]> {
      let attempt = 0;
      while (true) {
        attempt++;
        if (signal.aborted) {
          throw new AppError(
            504,
            'Gateway timeout (504): The request took longer than expected to process. Please retry.',
            'timeout'
          );
        }

        try {
          interface EmbedConfig {
            abortSignal?: AbortSignal;
            taskType?: string;
            outputDimensionality?: number;
          }
          const config: EmbedConfig = {
            abortSignal: signal,
          };
          if (useTaskType) {
            config.taskType = taskType;
          }
          if (useDims && targetDimensions) {
            config.outputDimensionality = targetDimensions;
          }

          // Format contents: array of Content objects with parts
          const contents = textsToEmbed.map((t) => ({ parts: [{ text: t }] }));

          const response = await ai.models.embedContent({
            model,
            contents,
            config,
          });

          interface EmbeddingItem {
            values?: number[];
          }
          interface EmbedContentResponse {
            embeddings?: EmbeddingItem[];
            embedding?: EmbeddingItem;
          }

          const resp = response as unknown as EmbedContentResponse;
          if (resp.embeddings && Array.isArray(resp.embeddings) && resp.embeddings.length > 0) {
            const valuesList = resp.embeddings.map((e) => e.values);
            if (valuesList.length === textsToEmbed.length && valuesList.every((v): v is number[] => Array.isArray(v))) {
              return valuesList;
            }
          }

          // Single embedding fallback format
          if (textsToEmbed.length === 1 && resp.embedding?.values) {
            return [resp.embedding.values];
          }

          throw new Error('Incomplete embedding response from model');
        } catch (err: unknown) {
          const errType = classifyError(err);
          const errMsg = (err as Error)?.message || '';

          if (errType === 'not_found') {
            logger.error(
              { requestId, model, err: errMsg },
              `Model ${model} is not available. Check EMBED_MODELS`
            );
            throw new AppError(
              500,
              `Model ${model} is not available. Check EMBED_MODELS`,
              'MODEL_NOT_FOUND'
            );
          }

          // If taskType or outputDimensionality not supported by this model, retry without them
          if (
            useTaskType &&
            (errMsg.includes('taskType') || errMsg.includes('TaskType') || errMsg.includes('INVALID_ARGUMENT'))
          ) {
            logger.warn({ model }, 'Model does not support taskType, retrying without taskType');
            return await executeEmbed(textsToEmbed, false, useDims);
          }

          if (
            useDims &&
            (errMsg.includes('outputDimensionality') || errMsg.includes('dimension') || errMsg.includes('INVALID_ARGUMENT'))
          ) {
            logger.warn({ model }, 'Model does not support outputDimensionality, retrying with default dimension');
            return await executeEmbed(textsToEmbed, useTaskType, false);
          }

          if (errType === 'quota') {
            const delayMs = parseRetryDelayMs(err) || 60000;
            setModelCooldown(model, delayMs);
          }

          if (attempt >= 2 || !isRetryableError(errType) || signal.aborted) {
            throw err;
          }

          const jitter = Math.floor(Math.random() * 250);
          const delay = 800 * Math.pow(2, attempt - 1) + jitter;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    let newlyFetchedEmbeddings: number[][] = [];

    // 1. Try sending all uncached texts in ONE single batch request (Requirement 1)
    try {
      newlyFetchedEmbeddings = await executeEmbed(uncachedTexts, true, true);
    } catch (batchErr: unknown) {
      if ((batchErr as { code?: string })?.code === 'MODEL_NOT_FOUND' || signal.aborted) {
        throw batchErr;
      }

      logger.warn(
        { err: (batchErr as Error)?.message, uncachedCount: uncachedTexts.length },
        'Batch call failed or unsupported, chunking into groups of 20 with concurrency 4'
      );

      // Otherwise chunk into groups of 20 with concurrency 4 (Requirement 1)
      const groupSize = 20;
      const concurrency = 4;
      const chunksOfTexts: string[][] = [];

      for (let i = 0; i < uncachedTexts.length; i += groupSize) {
        chunksOfTexts.push(uncachedTexts.slice(i, i + groupSize));
      }

      newlyFetchedEmbeddings = new Array(uncachedTexts.length);

      for (let i = 0; i < chunksOfTexts.length; i += concurrency) {
        if (signal.aborted) {
          throw new AppError(504, 'Gateway timeout (504): The request took longer than expected to process.', 'timeout');
        }

        const chunkBatch = chunksOfTexts.slice(i, i + concurrency);
        const batchPromises = chunkBatch.map(async (textGroup, groupOffset) => {
          const groupResults = await executeEmbed(textGroup, true, true);
          const globalStartIdx = (i + groupOffset) * groupSize;
          for (let k = 0; k < groupResults.length; k++) {
            newlyFetchedEmbeddings[globalStartIdx + k] = groupResults[k];
          }
        });

        await Promise.all(batchPromises);
      }
    }

    // Step 3: Populate LRU cache and merge into finalEmbeddings preserving exact input order
    for (let k = 0; k < uncachedIndices.length; k++) {
      const origIdx = uncachedIndices[k];
      const vector = newlyFetchedEmbeddings[k];
      if (!vector) {
        throw new Error(`Missing embedding vector for text index ${origIdx}`);
      }

      const key = computeServerCacheKey(model, purpose, targetDimensions, texts[origIdx]);
      embeddingLRUCache.set(key, vector);
      finalEmbeddings[origIdx] = vector;
    }

    const dim = finalEmbeddings[0]?.length || targetDimensions || 0;
    return res.json({
      embeddings: finalEmbeddings,
      model,
      dim,
    });
  } catch (error) {
    next(error);
  }
});
