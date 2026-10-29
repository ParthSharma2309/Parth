import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import type { GeminiErrorLike } from './types.js';
import { GeminiError } from './types.js';

export type { GeminiErrorLike };
export { GeminiError };

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code =
      code ||
      (status === 400
        ? 'BAD_REQUEST'
        : status === 429
        ? 'RATE_LIMIT_EXCEEDED'
        : 'INTERNAL_SERVER_ERROR');
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function parseRetryDelayMs(error: unknown): number | null {
  try {
    const errorStr =
      typeof error === 'string'
        ? error
        : error instanceof Error
        ? error.message
        : (error as GeminiErrorLike)?.message || JSON.stringify(error) || '';
    const hourMinMatch = errorStr.match(/retry in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
    if (hourMinMatch && (hourMinMatch[1] || hourMinMatch[2] || hourMinMatch[3])) {
      const hours = parseInt(hourMinMatch[1] || '0', 10);
      const mins = parseInt(hourMinMatch[2] || '0', 10);
      const secs = parseFloat(hourMinMatch[3] || '0');
      const totalMs = (hours * 3600 + mins * 60 + secs) * 1000;
      if (totalMs > 0) return Math.ceil(totalMs);
    }
  } catch {
    // ignore parsing failure
  }
  return null;
}

export function formatGeminiError(error: unknown): {
  status: number;
  message: string;
  code: string;
} {
  const errLike = error as GeminiErrorLike | undefined;
  const errMsg =
    errLike?.message ||
    (typeof error === 'string' ? error : (error as Error)?.toString() || '');
  const rawStatus = errLike?.status || (errLike?.statusCode ? Number(errLike.statusCode) : 500);
  const status = typeof rawStatus === 'number' && !isNaN(rawStatus) ? rawStatus : 500;
  const code = errLike?.code ? String(errLike.code) : undefined;

  if (code === 'MODEL_NOT_FOUND') {
    return {
      status: 500,
      code: 'MODEL_NOT_FOUND',
      message: errMsg || 'Model is not available. Check GEN_MODELS',
    };
  }

  const errType = typeof errLike?.errType === 'string'
    ? errLike.errType
    : typeof errLike?._classified === 'string'
    ? errLike._classified
    : null;

  if (
    errType === 'auth' ||
    status === 401 ||
    errMsg.includes('401') ||
    errMsg.includes('unauthorized') ||
    errMsg.includes('API_KEY_INVALID')
  ) {
    return {
      status: 401,
      code: 'UNAUTHORIZED',
      message:
        'Unauthorized (401): Invalid or missing Gemini API key. Please check your API key in Secrets.',
    };
  }

  if (
    errType === 'forbidden' ||
    status === 403 ||
    errMsg.includes('403') ||
    errMsg.includes('PERMISSION_DENIED')
  ) {
    return {
      status: 403,
      code: 'FORBIDDEN',
      message:
        'Forbidden (403): Permission denied. Please check your API key permissions in Secrets.',
    };
  }

  if (
    errType === 'not_found' ||
    status === 404 ||
    errMsg.includes('404') ||
    errMsg.includes('NOT_FOUND') ||
    errMsg.includes('not found') ||
    errMsg.includes('Check GEN_MODELS')
  ) {
    return {
      status: 500,
      code: 'MODEL_NOT_FOUND',
      message: errMsg.includes('Check GEN_MODELS')
        ? errMsg
        : 'Model is not available. Check GEN_MODELS',
    };
  }

  if (
    errType === 'quota' ||
    status === 429 ||
    errMsg.includes('429') ||
    errMsg.includes('RESOURCE_EXHAUSTED') ||
    errMsg.includes('Quota')
  ) {
    const delayMs = parseRetryDelayMs(error);
    const retryNote = delayMs ? ` Estimated cooldown: ~${Math.ceil(delayMs / 1000)}s.` : '';
    return {
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit reached (429): Quota exceeded.${retryNote} Please wait a moment for the quota window to reset.`,
    };
  }

  if (
    errType === 'unavailable' ||
    status === 503 ||
    errMsg.includes('503') ||
    errMsg.includes('UNAVAILABLE') ||
    errMsg.includes('high demand')
  ) {
    return {
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The model is currently experiencing high demand (503). Please try again shortly.',
    };
  }

  if (
    errType === 'timeout' ||
    code === 'timeout' ||
    status === 504 ||
    errMsg.includes('504') ||
    errLike?.name === 'AbortError' ||
    errMsg.includes('timeout') ||
    errMsg.includes('aborted')
  ) {
    return {
      status: 504,
      code: 'timeout',
      message:
        'Gateway timeout (504): The request took longer than expected to process. Please retry.',
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    code: status === 400 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
    message: status < 500 && errMsg ? errMsg : 'Failed to complete request with Gemini API',
  };
}

export function formatZodError(
  err: ZodError,
  req?: Request,
  res?: Response
): { error: string; code: string; requestId?: string } {
  const messages = err.issues.map(
    (i) => `${i.path.length ? i.path.join('.') + ': ' : ''}${i.message}`
  );
  const requestId =
    (res?.getHeader('X-Request-Id') as string | undefined) ||
    (req?.id ? String(req.id) : undefined);
  return {
    error: `Invalid request payload: ${messages.join('; ')}`,
    code: 'VALIDATION_ERROR',
    ...(requestId ? { requestId } : {}),
  };
}

// Central Express error handler (Requirement 8)
// Guarantees: Never leaks stack trace to client body
export function centralErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId =
    (res.getHeader('X-Request-Id') as string | undefined) ||
    (req.id ? String(req.id) : 'unknown');

  const errRecord = err as GeminiErrorLike | Error | undefined;

  // Log full error and stack trace server-side only
  logger.error(
    {
      err: {
        message: errRecord?.message,
        name: errRecord?.name,
        stack: errRecord?.stack,
        status: (errRecord as GeminiErrorLike)?.status || (errRecord as GeminiErrorLike)?.statusCode,
      },
      requestId,
      method: req.method,
      url: req.originalUrl,
    },
    'Central error handler caught an error'
  );

  if (res.headersSent) {
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const formatted = formatZodError(err, req, res);
    res.status(400).json({
      error: formatted.error,
      code: formatted.code,
      requestId,
    });
    return;
  }

  // Handle explicit AppError
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      requestId,
    });
    return;
  }

  // Handle explicit GeminiError
  if (err instanceof GeminiError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      requestId,
    });
    return;
  }

  // Handle payload too large from express.json limit
  if (
    (err as { type?: string })?.type === 'entity.too.large' ||
    (err as { status?: number })?.status === 413
  ) {
    res.status(413).json({
      error: 'Payload size exceeds the allowed route limit.',
      code: 'PAYLOAD_TOO_LARGE',
      requestId,
    });
    return;
  }

  // Format Gemini or unknown errors
  const formatted = formatGeminiError(err);
  res.status(formatted.status).json({
    error: formatted.message,
    code: formatted.code,
    requestId,
  });
}
