import { describe, it, expect, vi } from 'vitest';
import { rateLimit } from '../../server/lib/rateLimit.ts';
import type { Request, Response, NextFunction } from 'express';

describe('rateLimit middleware', () => {
  it('allows requests within the configured max limit', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 2, key: () => 'test-ip-1' });

    const headers: Record<string, string | number> = {};
    const req = {} as Request;
    const res = {
      setHeader: vi.fn((k: string, v: string | number) => {
        headers[k] = v;
      }),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      getHeader: vi.fn(),
    } as unknown as Response;

    const next1 = vi.fn() as unknown as NextFunction;
    limiter(req, res, next1);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(headers['RateLimit-Limit']).toBe(2);
    expect(headers['RateLimit-Remaining']).toBe(1);

    const next2 = vi.fn() as unknown as NextFunction;
    limiter(req, res, next2);
    expect(next2).toHaveBeenCalledTimes(1);
    expect(headers['RateLimit-Remaining']).toBe(0);
  });

  it('blocks requests exceeding the max limit with 429 and Retry-After', () => {
    const limiter = rateLimit({ windowMs: 60000, max: 1, key: () => 'test-ip-blocked' });

    const req = {} as Request;
    const headers: Record<string, string | number> = {};
    let statusCode: number | null = null;
    let jsonBody: any = null;

    const createRes = () =>
      ({
        setHeader: vi.fn((k: string, v: string | number) => {
          headers[k] = v;
        }),
        status: vi.fn((code: number) => {
          statusCode = code;
          return {
            json: vi.fn((body: any) => {
              jsonBody = body;
            }),
          };
        }),
        getHeader: vi.fn(),
      } as unknown as Response);

    const next1 = vi.fn() as unknown as NextFunction;
    limiter(req, createRes(), next1);
    expect(next1).toHaveBeenCalledTimes(1);

    const next2 = vi.fn() as unknown as NextFunction;
    limiter(req, createRes(), next2);

    expect(next2).not.toHaveBeenCalled();
    expect(statusCode).toBe(429);
    expect(headers['Retry-After']).toBeDefined();
    expect(Number(headers['Retry-After'])).toBeGreaterThanOrEqual(1);
    expect(jsonBody?.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
