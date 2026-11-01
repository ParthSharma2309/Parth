import { describe, it, expect, vi } from 'vitest';
import {
  generateWithFallback,
  isModelInCooldown,
  setModelCooldown,
} from '../../server/lib/gemini.ts';

describe('generateWithFallback resilient routing & timeouts', () => {
  it('immediately falls through to fallback model on 503 unavailable without retrying overloaded model', async () => {
    const attempts: string[] = [];

    const result = await generateWithFallback<{ text: string }>({
      models: ['gemini-overloaded-503', 'gemini-fallback-fast'],
      requestId: 'req-test-503',
      build: async (model) => {
        attempts.push(model);
        if (model === 'gemini-overloaded-503') {
          const err = new Error('503: The model is currently experiencing high demand. Please try again later.');
          (err as any).status = 503;
          throw err;
        }
        return { text: 'Success from fallback' };
      },
    });

    expect(result.usedModel).toBe('gemini-fallback-fast');
    expect(result.response.text).toBe('Success from fallback');
    // Model 'gemini-overloaded-503' was only tried once, not retried wastefully
    expect(attempts).toEqual(['gemini-overloaded-503', 'gemini-fallback-fast']);
    // 'gemini-overloaded-503' is placed into cooldown
    expect(isModelInCooldown('gemini-overloaded-503')).toBe(true);
  });

  it('routes subsequent requests directly to non-cooldown model first', async () => {
    setModelCooldown('gemini-slow-cooldown', 60000);
    expect(isModelInCooldown('gemini-slow-cooldown')).toBe(true);

    const attempts: string[] = [];
    const result = await generateWithFallback<{ text: string }>({
      models: ['gemini-slow-cooldown', 'gemini-fallback-fast'],
      requestId: 'req-test-cooldown',
      build: async (model) => {
        attempts.push(model);
        return { text: `Success from ${model}` };
      },
    });

    expect(result.usedModel).toBe('gemini-fallback-fast');
    // It tried the non-cooldown fallback model first without touching the cooled-down model
    expect(attempts).toEqual(['gemini-fallback-fast']);
  });

  it('handles per-attempt timeout and falls through to next candidate model', async () => {
    const attempts: string[] = [];

    const result = await generateWithFallback<{ text: string }>({
      models: ['gemini-slow-timeout', 'gemini-fallback-fast'],
      requestId: 'req-test-timeout',
      perModelTimeoutMs: 50, // fast timeout for test
      build: async (model, attemptSignal) => {
        attempts.push(model);
        if (model === 'gemini-slow-timeout') {
          return new Promise<{ text: string }>((resolve, reject) => {
            attemptSignal?.addEventListener('abort', () => {
              const err = new Error('ETIMEDOUT');
              (err as any).name = 'AbortError';
              reject(err);
            });
          });
        }
        return { text: 'Success from fallback after timeout' };
      },
    });

    expect(result.usedModel).toBe('gemini-fallback-fast');
    expect(result.response.text).toBe('Success from fallback after timeout');
    expect(attempts).toEqual(['gemini-slow-timeout', 'gemini-fallback-fast']);
  });
});
