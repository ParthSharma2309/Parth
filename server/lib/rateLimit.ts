import type { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs?: number;
  max: number;
  key?: (req: Request) => string;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

// Global registry of all rate limit stores so the sweep sweeps them all
const activeStores: Map<string, ClientRecord>[] = [];

// Periodic sweep every 60s to remove expired records
const sweepInterval = setInterval(() => {
  const now = Date.now();
  for (const store of activeStores) {
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }
}, 60000);
sweepInterval.unref();

export function rateLimit(options: RateLimitOptions) {
  const windowMs = options.windowMs || 60000;
  const max = options.max;
  const keyFn =
    options.key ||
    ((req: Request) => {
      const user = (req as any).user;
      if (user?.kind === 'user' && user.uid) {
        return `uid:${user.uid}`;
      }
      return (
        (req.ip as string) ||
        (typeof req.headers['x-forwarded-for'] === 'string'
          ? req.headers['x-forwarded-for'].split(',')[0].trim()
          : undefined) ||
        req.socket?.remoteAddress ||
        'unknown'
      );
    });

  const store = new Map<string, ClientRecord>();
  activeStores.push(store);

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    const key = keyFn(req);
    const now = Date.now();
    const isGuest = Boolean((req as any).user?.isGuest);
    const effectiveMax = isGuest ? Math.min(max, 15) : max;

    let record = store.get(key);

    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, effectiveMax - record.count);
    const resetSeconds = Math.ceil(record.resetTime / 1000);
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));

    res.setHeader('RateLimit-Limit', effectiveMax);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (record.count > effectiveMax) {
      res.setHeader('Retry-After', retryAfterSeconds);
      const requestId =
        (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
      return res.status(429).json({
        error: `Rate limit exceeded. Maximum ${effectiveMax} requests per minute allowed for this ${isGuest ? 'guest session' : 'user account'}.`,
        code: 'RATE_LIMIT_EXCEEDED',
        requestId,
      });
    }

    next();
  };
}
