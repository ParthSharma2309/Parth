import crypto from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'token',
      'idToken',
      'serviceAccount',
      'apiKey',
      'SUPABASE_SERVICE_ROLE_KEY',
      'FIREBASE_SERVICE_ACCOUNT',
    ],
    censor: '[REDACTED]',
  },
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => {
      const url = req.url || '';
      // Only log API and health endpoints; ignore Vite internal module and static asset requests
      return !url.startsWith('/api') && url !== '/health' && url !== '/healthz';
    },
  },
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  genReqId: (req, res) => {
    const existing = req.headers['x-request-id'];
    const id = typeof existing === 'string' && existing.trim() ? existing.trim() : crypto.randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req) => {
    const user = (req as any).user;
    return {
      requestId: (req as import('express').Request).id ? String((req as import('express').Request).id) : undefined,
      userId: user?.uid,
      isGuest: user?.isGuest,
    };
  },
});
