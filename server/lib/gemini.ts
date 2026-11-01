import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import {
  env,
  CONFIGURED_GEN_MODELS,
  CONFIGURED_EMBED_MODELS,
  DEFAULT_GEN_MODEL,
  FALLBACK_GEN_MODELS,
  DEFAULT_EMBED_MODEL,
  FALLBACK_EMBED_MODELS,
} from './env.js';
import { parseRetryDelayMs, AppError } from './errors.js';
import { logger } from './logger.js';

import type { GeminiErrorLike } from './types.js';

export { parseRetryDelayMs };

export type ClassifiedErrorType =
  | 'quota'
  | 'unavailable'
  | 'timeout'
  | 'auth'
  | 'forbidden'
  | 'bad_request'
  | 'not_found'
  | 'unknown';

// 1. Single central classifyError(err) implementation (Requirement 1)
export function classifyError(err: unknown): ClassifiedErrorType {
  const errLike = err as GeminiErrorLike | undefined;
  const status = Number(errLike?.status || errLike?.statusCode || 0);
  const msg = (
    typeof err === 'string'
      ? err
      : errLike?.message || (err as Error)?.toString() || JSON.stringify(err) || ''
  ).toLowerCase();

  // 1. Auth: 401
  if (
    status === 401 ||
    msg.includes('401') ||
    msg.includes('api_key_invalid') ||
    msg.includes('unauthorized') ||
    msg.includes('unauthenticated')
  ) {
    return 'auth';
  }

  // 2. Forbidden: 403
  if (status === 403 || msg.includes('403') || msg.includes('permission_denied')) {
    return 'forbidden';
  }

  // 3. Not found: 404 (Model not found / bad model ID)
  if (
    status === 404 ||
    msg.includes('404') ||
    msg.includes('not_found') ||
    msg.includes('not found') ||
    msg.includes('is not available') ||
    msg.includes('could not be found')
  ) {
    return 'not_found';
  }

  // 4. Quota: 429
  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('quota')
  ) {
    return 'quota';
  }

  // 5. Unavailable: 503
  if (
    status === 503 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('spikes in demand')
  ) {
    return 'unavailable';
  }

  // 6. Timeout: 504 / Abort
  if (
    status === 504 ||
    msg.includes('504') ||
    msg.includes('deadline_exceeded') ||
    errLike?.name === 'AbortError' ||
    msg.includes('aborterror') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('etimedout')
  ) {
    return 'timeout';
  }

  // 7. Bad Request: 400
  if (
    status === 400 ||
    msg.includes('400') ||
    msg.includes('invalid_argument') ||
    msg.includes('bad request')
  ) {
    return 'bad_request';
  }

  return 'unknown';
}

// Only quota, unavailable, and timeout are retryable (Requirement 1)
export function isRetryableError(errType: ClassifiedErrorType): boolean {
  return errType === 'quota' || errType === 'unavailable' || errType === 'timeout';
}

// Model cooldown map (Requirement 2)
const modelCooldownMap = new Map<string, number>();

export function isModelInCooldown(model: string): boolean {
  const expiresAt = modelCooldownMap.get(model);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    modelCooldownMap.delete(model);
    return false;
  }
  return true;
}

export function setModelCooldown(model: string, durationMs = 60000) {
  modelCooldownMap.set(model, Date.now() + durationMs);
}

// 6. Circuit breaker per model: after 5 consecutive failures open for 60s (Requirement 6)
interface CircuitBreakerState {
  consecutiveFailures: number;
  openUntil: number;
}
const modelCircuitBreakers = new Map<string, CircuitBreakerState>();

export function isCircuitOpen(model: string): boolean {
  const cb = modelCircuitBreakers.get(model);
  if (!cb) return false;
  if (Date.now() < cb.openUntil) {
    return true;
  }
  return false;
}

export function recordModelSuccess(model: string) {
  modelCircuitBreakers.set(model, { consecutiveFailures: 0, openUntil: 0 });
}

export function recordModelFailure(model: string, requestId?: string) {
  const cb = modelCircuitBreakers.get(model) || { consecutiveFailures: 0, openUntil: 0 };
  cb.consecutiveFailures += 1;
  if (cb.consecutiveFailures >= 5) {
    cb.openUntil = Date.now() + 60000;
    logger.warn(
      {
        requestId,
        model,
        consecutiveFailures: cb.consecutiveFailures,
        openUntil: new Date(cb.openUntil).toISOString(),
      },
      `Circuit breaker OPENED for model "${model}" for 60s after 5 consecutive failures`
    );
  }
  modelCircuitBreakers.set(model, cb);
}

// Client factory with configurable timeout
export function getAI(timeoutMs = 120000) {
  if (!env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: {
      timeout: timeoutMs,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// 3. Request cancellation & timeout helper (Requirement 3 & 5)
export function createRequestAbortController(req: Request, res: Response, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  let finished = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('TIMEOUT'));
  }, timeoutMs);
  timer.unref();

  res.on('finish', () => {
    finished = true;
    clearTimeout(timer);
  });

  const handleClientClose = () => {
    clearTimeout(timer);
    if (!finished && !res.writableEnded) {
      // Abort only if the client connection has actually ended/destroyed prematurely
      if (req.socket?.destroyed || !req.socket?.writable || res.destroyed) {
        controller.abort(new Error('CLIENT_CLOSED'));
      }
    }
  };

  req.on('close', handleClientClose);
  res.on('close', handleClientClose);

  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    cleanup: () => clearTimeout(timer),
  };
}

// 2. generateWithFallback implementation (Requirement 2)
export interface GenerateWithFallbackOptions<T> {
  models: string[];
  build: (model: string, attemptSignal?: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
  requestId?: string;
  maxRetriesPerModel?: number;
  perModelTimeoutMs?: number;
}

export interface GenerateWithFallbackResult<T> {
  response: T;
  usedModel: string;
  attempts: number;
}

export async function generateWithFallback<T>(
  options: GenerateWithFallbackOptions<T>
): Promise<GenerateWithFallbackResult<T>> {
  const { models, build, signal, requestId, maxRetriesPerModel = 2, perModelTimeoutMs = 25000 } = options;
  if (!models || models.length === 0) {
    throw new AppError(500, 'No models provided to generateWithFallback', 'NO_MODELS');
  }

  // De-duplicate models preserving original precedence
  const uniqueModels = Array.from(new Set(models));

  // Tries non-cooldown models first, skips circuit-open models until then
  const availableModels = uniqueModels.filter((m) => !isCircuitOpen(m) && !isModelInCooldown(m));
  const cooldownModels = uniqueModels.filter((m) => !isCircuitOpen(m) && isModelInCooldown(m));
  const circuitOpenModels = uniqueModels.filter((m) => isCircuitOpen(m));

  const candidateModels = [
    ...availableModels,
    ...cooldownModels,
    ...(availableModels.length === 0 && cooldownModels.length === 0 ? circuitOpenModels : []),
  ];

  if (candidateModels.length === 0) {
    candidateModels.push(...uniqueModels);
  }

  let totalAttempts = 0;
  let lastError: unknown = null;

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const currentModel = candidateModels[mIdx];
    const isLastModel = mIdx === candidateModels.length - 1;

    for (let modelAttempt = 1; modelAttempt <= maxRetriesPerModel; modelAttempt++) {
      if (signal?.aborted) {
        throw new AppError(504, 'Gateway timeout (504): The request took longer than expected to process. Please retry.', 'timeout');
      }

      totalAttempts++;
      // Log each attempt with the requestId (Requirement 2)
      logger.info(
        {
          requestId,
          model: currentModel,
          modelAttempt,
          totalAttempts,
          candidateIndex: mIdx + 1,
          totalCandidates: candidateModels.length,
        },
        `Attempting generation with model ${currentModel}`
      );

      // Create per-attempt abort controller so that an attempt timeout does not prematurely abort the parent request
      const attemptController = new AbortController();
      let attemptTimedOut = false;
      const attemptTimer = setTimeout(() => {
        attemptTimedOut = true;
        attemptController.abort(new Error('ETIMEDOUT: Model call exceeded attempt timeout'));
      }, perModelTimeoutMs);
      attemptTimer.unref();

      const onParentAbort = () => {
        attemptController.abort(signal?.reason || new Error('CLIENT_CLOSED'));
      };
      if (signal) {
        signal.addEventListener('abort', onParentAbort, { once: true });
      }

      try {
        const buildPromise = build(currentModel, attemptController.signal);
        const timeoutPromise = new Promise<never>((_, reject) => {
          attemptController.signal.addEventListener(
            'abort',
            () => {
              if (attemptTimedOut) {
                reject(new Error('ETIMEDOUT: Model call exceeded attempt timeout'));
              }
            },
            { once: true }
          );
        });

        const response = await Promise.race([buildPromise, timeoutPromise]);
        clearTimeout(attemptTimer);
        if (signal) {
          signal.removeEventListener('abort', onParentAbort);
        }

        recordModelSuccess(currentModel);
        logger.info(
          { requestId, model: currentModel, attempts: totalAttempts },
          `Successfully completed generation with model ${currentModel}`
        );
        return {
          response,
          usedModel: currentModel,
          attempts: totalAttempts,
        };
      } catch (err: unknown) {
        clearTimeout(attemptTimer);
        if (signal) {
          signal.removeEventListener('abort', onParentAbort);
        }

        // If the client aborted the connection or global request timeout expired, throw immediately
        if (signal?.aborted) {
          throw new AppError(
            504,
            'Gateway timeout (504): The request took longer than expected to process. Please retry.',
            'timeout'
          );
        }

        lastError = err;
        const errType = classifyError(err);
        recordModelFailure(currentModel, requestId);

        // Requirement 1: 'not_found' (HTTP 404 / bad model name) must NOT be retried silently:
        // log an error with the model name and return a clear 500 "Model <id> is not available. Check GEN_MODELS"
        if (errType === 'not_found') {
          logger.error(
            { requestId, model: currentModel, err: (err as Error)?.message },
            `Model ${currentModel} is not available. Check GEN_MODELS`
          );
          throw new AppError(
            500,
            `Model ${currentModel} is not available. Check GEN_MODELS`,
            'MODEL_NOT_FOUND'
          );
        }

        // Only quota/unavailable/timeout are retryable or fall through to a fallback model
        if (!isRetryableError(errType)) {
          logger.error(
            { requestId, model: currentModel, errType, err: (err as Error)?.message || String(err) },
            `Non-retryable error on model ${currentModel}`
          );
          throw err;
        }

        // If quota exhausted, parse cooldown and set model cooldown
        if (errType === 'quota') {
          const delayMs = parseRetryDelayMs(err) || 60000;
          setModelCooldown(currentModel, delayMs);
          logger.info(
            { requestId, model: currentModel, cooldownMs: delayMs },
            `Quota limit reached for model ${currentModel}, cooldown set`
          );
        } else if (errType === 'unavailable' || errType === 'timeout') {
          // Set 60s cooldown for overloaded (503) or timed out (504) models so concurrent/subsequent requests route directly to fallback
          setModelCooldown(currentModel, 60000);
          logger.info(
            { requestId, model: currentModel, errType },
            `Model ${currentModel} is ${errType}, setting 60s cooldown`
          );
        }

        // For unavailable (503) or timeout (504), if healthy fallback models exist, immediately switch
        // to the fallback model instead of wasting remaining request time on an overloaded model
        if (!isLastModel && (errType === 'unavailable' || errType === 'timeout')) {
          logger.info(
            { requestId, failedModel: currentModel, errType, nextModel: candidateModels[mIdx + 1] },
            `Model ${currentModel} is ${errType}, immediately falling through to fallback model ${candidateModels[mIdx + 1]}`
          );
          break;
        }

        // Check if we should retry same model using exponential backoff with jitter
        if (modelAttempt < maxRetriesPerModel && !signal?.aborted) {
          const jitter = Math.floor(Math.random() * 250);
          const backoff = 800 * Math.pow(2, modelAttempt - 1) + jitter;
          logger.info(
            { requestId, model: currentModel, errType, backoffMs: backoff },
            `Retrying model ${currentModel} after backoff with jitter`
          );
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }

        // Fall through to next model if available
        if (!isLastModel) {
          logger.info(
            { requestId, failedModel: currentModel, errType, nextModel: candidateModels[mIdx + 1] },
            `Model ${currentModel} exhausted retries, falling through to fallback model`
          );
          break;
        }
      }
    }
  }

  logger.error(
    { requestId, attempts: totalAttempts, lastError: (lastError as Error)?.message || String(lastError) },
    'All candidate models failed in generateWithFallback'
  );
  throw lastError;
}

// 4. Model startup verification & registry (Requirement 4)
interface VerifiedModelRegistry {
  availableRawNames: string[];
  verifiedGenModels: string[];
  verifiedEmbedModels: string[];
  hasChecked: boolean;
}

const registry: VerifiedModelRegistry = {
  availableRawNames: [],
  verifiedGenModels: [...CONFIGURED_GEN_MODELS],
  verifiedEmbedModels: [...CONFIGURED_EMBED_MODELS],
  hasChecked: false,
};

export async function verifyModelsOnStartup() {
  if (registry.hasChecked) return;
  try {
    const ai = getAI(10000);
    const modelListResponse = await ai.models.list();
    const availableSet = new Set<string>();

    for await (const m of modelListResponse) {
      if (m.name) {
        registry.availableRawNames.push(m.name);
        availableSet.add(m.name);
        // Also strip "models/" prefix for clean matching
        if (m.name.startsWith('models/')) {
          availableSet.add(m.name.slice(7));
        }
      }
    }

    registry.hasChecked = true;

    // Check CONFIGURED_GEN_MODELS
    const missingGenModels: string[] = [];
    const verifiedGen: string[] = [];
    for (const m of CONFIGURED_GEN_MODELS) {
      if (availableSet.has(m) || availableSet.has(`models/${m}`)) {
        verifiedGen.push(m);
      } else {
        missingGenModels.push(m);
      }
    }

    // Check CONFIGURED_EMBED_MODELS
    const missingEmbedModels: string[] = [];
    const verifiedEmbed: string[] = [];
    for (const m of CONFIGURED_EMBED_MODELS) {
      if (availableSet.has(m) || availableSet.has(`models/${m}`)) {
        verifiedEmbed.push(m);
      } else {
        missingEmbedModels.push(m);
      }
    }

    if (missingGenModels.length > 0) {
      const msg = `⚠️ WARNING: Configured generation model(s) not found in Gemini API: [${missingGenModels.join(', ')}]. Check GEN_MODELS.`;
      logger.warn({ missing: missingGenModels, availableCount: registry.availableRawNames.length }, msg);
      console.warn(`\n${msg}\n`);
    } else {
      logger.info({ verifiedCount: verifiedGen.length }, 'All configured generation models verified in Gemini API');
    }

    if (missingEmbedModels.length > 0) {
      const msg = `⚠️ WARNING: Configured embedding model(s) not found in Gemini API: [${missingEmbedModels.join(', ')}]. Check EMBED_MODELS.`;
      logger.warn({ missing: missingEmbedModels, availableCount: registry.availableRawNames.length }, msg);
      console.warn(`\n${msg}\n`);
    } else {
      logger.info({ verifiedCount: verifiedEmbed.length }, 'All configured embedding models verified in Gemini API');
    }

    if (verifiedGen.length > 0) {
      registry.verifiedGenModels = verifiedGen;
    }
    if (verifiedEmbed.length > 0) {
      registry.verifiedEmbedModels = verifiedEmbed;
    }
  } catch (err: unknown) {
    logger.warn({ err: (err as Error)?.message }, 'Failed to verify models with ai.models.list() on startup (using configured defaults)');
  }
}

export function getVerifiedModelData() {
  return {
    defaultGenerationModel: DEFAULT_GEN_MODEL,
    defaultEmbeddingModel: DEFAULT_EMBED_MODEL,
    generationModels: CONFIGURED_GEN_MODELS,
    embeddingModels: CONFIGURED_EMBED_MODELS,
    verifiedGenerationModels: registry.verifiedGenModels,
    verifiedEmbeddingModels: registry.verifiedEmbedModels,
    fallbackGenerationModels: FALLBACK_GEN_MODELS,
    fallbackEmbeddingModels: FALLBACK_EMBED_MODELS,
    supportedGenerationModels: CONFIGURED_GEN_MODELS.map((id) => ({
      id,
      name: id === DEFAULT_GEN_MODEL ? `${id} (Default)` : id,
    })),
    supportedEmbeddingModels: CONFIGURED_EMBED_MODELS.map((id) => ({
      id,
      name: id === DEFAULT_EMBED_MODEL ? `${id} (Default)` : id,
    })),
    availableModels: registry.availableRawNames,
  };
}

// Helpers for routes to retrieve ordered candidate lists
export function getGenerationModelCandidates(requestedModel?: string): string[] {
  const primary = requestedModel && CONFIGURED_GEN_MODELS.includes(requestedModel)
    ? requestedModel
    : DEFAULT_GEN_MODEL;
  const fallbacks = CONFIGURED_GEN_MODELS.filter((m) => m !== primary);
  return [primary, ...fallbacks];
}

export function getVisionModelCandidates(): string[] {
  // Vision model candidates from configured generation models
  const candidates = CONFIGURED_GEN_MODELS.filter(
    (m) => m.includes('flash') || m.includes('vision') || m.includes('pro')
  );
  if (candidates.length === 0) {
    return [DEFAULT_GEN_MODEL, ...FALLBACK_GEN_MODELS];
  }
  return candidates;
}
