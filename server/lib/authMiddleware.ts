import type { Request, Response, NextFunction } from 'express';
import {
  verifyAuthToken,
  AuthPrincipal,
  AuthNotConfiguredError,
} from './firebaseAdmin.js';
import { logger } from './logger.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthPrincipal;
    }
  }
}

/**
 * Middleware requiring authentication on /api routes.
 * Bypasses /api/health, /health, and /healthz probes.
 * Validates real Firebase tokens via verifyIdToken.
 * Allows strictly formatted guest sessions (Bearer guest_* or X-Guest-Mode: true with no auth header).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const url = req.originalUrl || req.url || '';

  // Explicit bypass for container probes and health checks
  if (
    url === '/health' ||
    url === '/healthz' ||
    url === '/api/health' ||
    req.path === '/health' ||
    req.path === '/api/health'
  ) {
    return next();
  }

  const requestId =
    (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');

  const authHeader = req.headers.authorization;
  let bearerToken: string | undefined = undefined;

  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return res.status(401).json({
        error: 'Invalid Authorization header format. Expected "Bearer <token>".',
        code: 'UNAUTHORIZED',
        requestId,
      });
    }
    bearerToken = match[1];
    if (bearerToken.length > 4096) {
      return res.status(401).json({
        error: 'Authentication token exceeds maximum length of 4096 characters.',
        code: 'UNAUTHORIZED',
        requestId,
      });
    }
  }

  if (bearerToken) {
    if (bearerToken.startsWith('guest_')) {
      req.user = { kind: 'guest', isGuest: true };
    } else {
      try {
        const principal = await verifyAuthToken(bearerToken);
        req.user = principal;
      } catch (err: unknown) {
        if (
          err instanceof AuthNotConfiguredError ||
          (err as any)?.name === 'AuthNotConfiguredError'
        ) {
          return res.status(503).json({
            error: 'Firebase Auth is not configured on this server.',
            code: 'AUTH_NOT_CONFIGURED',
            requestId,
          });
        }
        logger.warn({ err: (err as Error)?.message, requestId }, 'ID token verification failed');
        return res.status(401).json({
          error: 'Invalid or expired authentication token. Please sign in again.',
          code: 'UNAUTHORIZED',
          requestId,
        });
      }
    }
  } else if (req.headers['x-guest-mode'] === 'true') {
    req.user = { kind: 'guest', isGuest: true };
  } else {
    return res.status(401).json({
      error: 'Authentication required. Missing Bearer token in Authorization header.',
      code: 'UNAUTHORIZED',
      requestId,
    });
  }

  // Attach userId (only for kind:'user') and isGuest to request logger
  if ((req as any).log && typeof (req as any).log.child === 'function') {
    (req as any).log = (req as any).log.child({
      ...(req.user.kind === 'user' ? { userId: req.user.uid } : {}),
      isGuest: req.user.isGuest,
    });
  }

  // Vision OCR page image analysis is restricted to registered users
  if (url.includes('/analyze-page-image') && req.user.isGuest) {
    return res.status(403).json({
      error:
        'Vision OCR page image analysis is only available to registered users. Please sign in or upgrade your account.',
      code: 'GUEST_ACCESS_DENIED',
      requestId,
    });
  }

  return next();
}

/**
 * Route guard requiring a registered user account (rejects guest sessions with 403 GUEST_NOT_ALLOWED).
 */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const requestId =
    (res.getHeader('X-Request-Id') as string) || (req.id ? String(req.id) : '');
  if (!req.user || req.user.isGuest || req.user.kind !== 'user') {
    return res.status(403).json({
      error: 'Guest access not allowed for this operation. A registered user account is required.',
      code: 'GUEST_NOT_ALLOWED',
      requestId,
    });
  }
  next();
}
