import { Router } from 'express';
import { env } from '../lib/env.js';
import { getAI, getVerifiedModelData } from '../lib/gemini.js';
import { logger } from '../lib/logger.js';

export const healthRouter = Router();

// Container probes (Kubernetes / Cloud Run)
healthRouter.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

healthRouter.get('/healthz', (_req, res) => {
  res.status(200).send('OK');
});

// Liveness probe (Requirement 9: {status, uptime})
healthRouter.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
  });
});

// 4. Expose the verified list at GET /api/models for Settings page (Requirement 4)
healthRouter.get('/api/models', (_req, res) => {
  res.status(200).json(getVerifiedModelData());
});

// Readiness probe with cached 60s model ping (Requirement 9)
let lastPingTime = 0;
let lastPingResult = false;
let lastPingError: string | null = null;

healthRouter.get('/api/ready', async (_req, res) => {
  if (!env.GEMINI_API_KEY) {
    return res.status(503).json({
      status: 'not_ready',
      error: 'GEMINI_API_KEY is not configured',
    });
  }

  const now = Date.now();
  // Check if cached ping is fresh (< 60s)
  if (now - lastPingTime < 60000) {
    if (lastPingResult) {
      return res.status(200).json({
        status: 'ready',
        uptime: process.uptime(),
        cached: true,
      });
    } else {
      return res.status(503).json({
        status: 'not_ready',
        uptime: process.uptime(),
        error: lastPingError || 'Gemini API ping failed',
        cached: true,
      });
    }
  }

  // Perform ping with 5s timeout
  try {
    const ai = getAI(5000);
    // Ping models list
    await ai.models.list({ config: { pageSize: 1 } });
    lastPingTime = now;
    lastPingResult = true;
    lastPingError = null;

    return res.status(200).json({
      status: 'ready',
      uptime: process.uptime(),
      cached: false,
    });
  } catch (err: unknown) {
    lastPingTime = now;
    lastPingResult = false;
    lastPingError = (err as Error)?.message || 'Failed to ping Gemini models API';
    logger.warn({ err: lastPingError }, 'Readiness probe failed Gemini API ping');

    return res.status(503).json({
      status: 'not_ready',
      uptime: process.uptime(),
      error: lastPingError,
      cached: false,
    });
  }
});
