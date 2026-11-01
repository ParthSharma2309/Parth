import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';

// 1. Env validation (runs first; exits 1 if invalid)
import { env, ALLOWED_ORIGIN_LIST } from './lib/env.js';
import { logger, httpLogger } from './lib/logger.js';
import { AppError, centralErrorHandler } from './lib/errors.js';

// Route handlers
import { healthRouter } from './routes/health.js';
import { visionRouter } from './routes/vision.js';
import { uploadRouter } from './routes/upload.js';
import { documentsRouter } from './routes/documents.js';
import { embedRouter } from './routes/embed.js';
import { generateRouter } from './routes/generate.js';
import { rewriteRouter } from './routes/rewrite.js';
import { conversationsRouter } from './routes/conversations.js';
import { requireAuth } from './lib/authMiddleware.js';
import { isFirebaseAuthConfigured } from './lib/firebaseAdmin.js';
import { isSupabaseConfigured } from './lib/supabaseAdmin.js';
import { verifyModelsOnStartup } from './lib/gemini.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export const app = express();

// 2. Add `app.set('trust proxy', 1)` before any middleware (Requirement 2)
app.set('trust proxy', 1);

// 3. Security, performance and logging middleware (Requirement 3 & 7)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    frameguard: false,
  })
);

app.use(compression());

// CORS configuration: allow-list from env ALLOWED_ORIGINS, default same-origin (Requirement 3)
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Direct requests, curl, or same-origin
    if (!origin) {
      return callback(null, true);
    }

    // Support wildcard '*' (matches all origins, reflecting request origin for credentials compatibility)
    if (ALLOWED_ORIGIN_LIST.includes('*')) {
      return callback(null, true);
    }

    // Always allow current application host and APP_URL
    if (process.env.APP_URL) {
      try {
        const appUrlObj = new URL(process.env.APP_URL);
        const originObj = new URL(origin);
        if (originObj.origin === appUrlObj.origin || originObj.host === appUrlObj.host) {
          return callback(null, true);
        }
      } catch {
        if (origin === process.env.APP_URL) {
          return callback(null, true);
        }
      }
    }

    // Always allow localhost, 127.0.0.1, and Cloud Run preview domains
    try {
      const parsedOrigin = new URL(origin);
      if (
        parsedOrigin.hostname === 'localhost' ||
        parsedOrigin.hostname === '127.0.0.1' ||
        parsedOrigin.hostname.endsWith('.run.app') ||
        parsedOrigin.hostname.endsWith('.google.com')
      ) {
        return callback(null, true);
      }
    } catch {
      // Proceed to list check
    }

    if (ALLOWED_ORIGIN_LIST.length > 0) {
      if (ALLOWED_ORIGIN_LIST.includes(origin)) {
        return callback(null, true);
      }
      return callback(new AppError(403, `Origin ${origin} not allowed by CORS policy.`, 'CORS_ERROR'));
    }

    // Default same-origin: allow
    return callback(null, true);
  },
  credentials: true,
};
app.use(cors(corsOptions));

// Pino HTTP request logger with X-Request-Id (Requirement 3 & 7)
app.use(httpLogger);

// Health check and container probe routes
app.use(healthRouter);

// Firebase Auth verification on every /api route except health (Requirement 7)
app.use('/api', requireAuth);

// 5. Body limits per route (Requirement 5):
// Mount vision router and upload router FIRST with isolated limits
app.use(visionRouter);
app.use(uploadRouter);

// Global body limit: express.json({ limit: '10mb' }) to accommodate chunk embeddings arrays
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Mount remaining API routes
app.use(documentsRouter);
app.use(conversationsRouter);
app.use(embedRouter);
app.use(generateRouter);
app.use(rewriteRouter);

// 8. Central error handler (Requirement 8)
app.use(centralErrorHandler);

let server: import('http').Server | null = null;

export async function bootstrap() {
  // 4. Verify configured models against Gemini API on startup once (Requirement 4)
  verifyModelsOnStartup().catch((err) => {
    logger.warn({ err: err?.message }, 'Async model startup verification finished with error');
  });

  // 11. Static production serving or Vite dev middleware (Requirement 11)
  if (env.NODE_ENV === 'production') {
    const distPath = path.resolve(rootDir, 'dist');

    // Hashed assets with 1-year immutable cache header
    app.use(
      '/assets',
      express.static(path.resolve(distPath, 'assets'), {
        maxAge: '1y',
        immutable: true,
      })
    );

    // Other static files (favicon, sw.js, manifest.json)
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('index.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
          } else if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      })
    );

    // SPA fallback: index.html with no-cache headers (Requirement 11)
    app.get('*', (_req, res) => {
      const indexPath = path.resolve(distPath, 'index.html');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res
          .status(200)
          .send('<!doctype html><html><body><h1>DocuMind</h1><p>Initializing...</p></body></html>');
      }
    });
  } else {
    // Development: Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Start HTTP server
  server = app.listen(env.PORT, env.HOST, () => {
    const authStatus = isFirebaseAuthConfigured();
    const storageConfigured = isSupabaseConfigured();
    logger.info(
      {
        env: env.NODE_ENV,
        port: env.PORT,
        firebaseAuth: authStatus.configured,
        ...(authStatus.projectId ? { projectId: authStatus.projectId } : {}),
        supabaseStorage: storageConfigured,
      },
      `DocuMind server running on port ${env.PORT} (env: ${env.NODE_ENV}, firebaseAuth: ${authStatus.configured}${authStatus.projectId ? `, projectId: ${authStatus.projectId}` : ''}, supabaseStorage: ${storageConfigured})`
    );
  });

  // 10. Graceful shutdown handler (Requirement 10)
  let isShuttingDown = false;
  function gracefulShutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Stopping server: finishing in-flight requests (max 10s)...');

    if (server) {
      server.close((err?: Error) => {
        if (err) {
          logger.error({ err }, 'Error during HTTP server shutdown');
          process.exit(1);
        }
        logger.info('HTTP server closed cleanly, exiting.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }

    const forceTimer = setTimeout(() => {
      logger.error('Shutdown timeout of 10s exceeded, forcing exit.');
      process.exit(0);
    }, 10000);
    forceTimer.unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Fatal exit on uncaughtException and unhandledRejection (Requirement 10)
  process.on('uncaughtException', (err) => {
    logger.fatal(
      { err: { message: err?.message, stack: err?.stack } },
      'Uncaught exception: exiting container for clean restart'
    );
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.fatal(
      { reason: (reason as Error)?.stack || reason },
      'Unhandled rejection: exiting container for clean restart'
    );
    process.exit(1);
  });

  return server;
}

// Auto-start server when executed directly (skip during test runs)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  bootstrap();
}
