import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import '../helpers/firebaseAdminMock.js';

// Mock @google/genai with constructible function
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(function (this: any) {
      return {
        models: {
          embedContent: vi.fn().mockResolvedValue({
            embeddings: [{ values: [0.1, 0.2, 0.3] }],
          }),
          generateContent: vi.fn().mockResolvedValue({
            text: 'Mock answer',
          }),
        },
      };
    }),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      ARRAY: 'ARRAY',
      BOOLEAN: 'BOOLEAN',
      INTEGER: 'INTEGER',
    },
  };
});

import { app } from '../../server/index.js';
import { requireAuth, requireUser } from '../../server/lib/authMiddleware.js';
import { rateLimit } from '../../server/lib/rateLimit.js';

describe('Authentication & Authorization Hardening (tests/integration/auth.test.ts)', () => {
  // 1. no Authorization header on /api/embed -> 401
  it('1. returns 401 when Authorization header is missing on /api/embed', async () => {
    const res = await request(app).post('/api/embed').send({ texts: ['sample query'] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.error).toContain('Authentication required');
  });

  // 2. 'test-token', 'test-user-token', 'dev', random string -> 401
  it('2. returns 401 for unauthorized bypass tokens and arbitrary strings', async () => {
    const forbiddenTokens = ['test-token', 'test-user-token', 'dev', 'random-bogus-token-12345'];
    for (const token of forbiddenTokens) {
      const res = await request(app)
        .post('/api/embed')
        .set('Authorization', `Bearer ${token}`)
        .send({ texts: ['sample query'] });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }
  });

  // 3. forged unsigned JWT (alg none, sub=victim) -> 401
  it('3. returns 401 for forged unsigned JWT (alg: none, sub: victim)', async () => {
    // Header: {"alg":"none","typ":"JWT"} -> eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0
    // Payload: {"sub":"victim","email":"victim@example.com"} -> eyJzdWIiOiJ2aWN0aW0iLCJlbWFpbCI6InZpY3RpbUBleGFtcGxlLmNvbSJ9
    const forgedToken = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ2aWN0aW0iLCJlbWFpbCI6InZpY3RpbUBleGFtcGxlLmNvbSJ9.';
    const res = await request(app)
      .post('/api/embed')
      .set('Authorization', `Bearer ${forgedToken}`)
      .send({ texts: ['sample query'] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  // 4. 'expired-token' -> 401
  it('4. returns 401 for expired token', async () => {
    const res = await request(app)
      .post('/api/embed')
      .set('Authorization', 'Bearer expired-token')
      .send({ texts: ['sample query'] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  // 5. 'valid-user-a' passes auth (not 401/403) and an isolated mini-app using requireAuth+requireUser sees req.user.uid==='valid-user-a'
  it('5. allows valid-user-a and attaches typed principal with uid to req.user', async () => {
    const miniApp = express();
    miniApp.use(express.json());
    miniApp.use(requireAuth);
    miniApp.get('/test-user-route', requireUser, (req, res) => {
      res.json({
        uid: req.user?.uid,
        isGuest: req.user?.isGuest,
        kind: req.user?.kind,
      });
    });

    const res = await request(miniApp)
      .get('/test-user-route')
      .set('Authorization', 'Bearer valid-user-a');

    expect(res.status).toBe(200);
    expect(res.body.uid).toBe('valid-user-a');
    expect(res.body.isGuest).toBe(false);
    expect(res.body.kind).toBe('user');
  });

  // 6. Bearer 'guest_abc' and X-Guest-Mode:true are allowed on an AI route, get 403 on /api/analyze-page-image, and 403 GUEST_NOT_ALLOWED via requireUser
  it('6. handles guest sessions via Bearer guest_* and X-Guest-Mode: true correctly', async () => {
    // 6a: Allowed on /api/embed
    const resBearer = await request(app)
      .post('/api/embed')
      .set('Authorization', 'Bearer guest_abc')
      .send({ texts: ['sample'] });
    expect(resBearer.status).toBe(200);

    const resHeader = await request(app)
      .post('/api/embed')
      .set('X-Guest-Mode', 'true')
      .send({ texts: ['sample'] });
    expect(resHeader.status).toBe(200);

    // 6b: 403 GUEST_ACCESS_DENIED on /api/analyze-page-image
    const resVisionBearer = await request(app)
      .post('/api/analyze-page-image')
      .set('Authorization', 'Bearer guest_abc')
      .send({
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      });
    expect(resVisionBearer.status).toBe(403);
    expect(resVisionBearer.body.code).toBe('GUEST_ACCESS_DENIED');

    const resVisionHeader = await request(app)
      .post('/api/analyze-page-image')
      .set('X-Guest-Mode', 'true')
      .send({
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      });
    expect(resVisionHeader.status).toBe(403);
    expect(resVisionHeader.body.code).toBe('GUEST_ACCESS_DENIED');

    // 6c: 403 GUEST_NOT_ALLOWED via requireUser
    const miniApp = express();
    miniApp.use(requireAuth);
    miniApp.get('/protected', requireUser, (_req, res) => res.json({ ok: true }));

    const resReqUserBearer = await request(miniApp)
      .get('/protected')
      .set('Authorization', 'Bearer guest_abc');
    expect(resReqUserBearer.status).toBe(403);
    expect(resReqUserBearer.body.code).toBe('GUEST_NOT_ALLOWED');

    const resReqUserHeader = await request(miniApp)
      .get('/protected')
      .set('X-Guest-Mode', 'true');
    expect(resReqUserHeader.status).toBe(403);
    expect(resReqUserHeader.body.code).toBe('GUEST_NOT_ALLOWED');
  });

  // 7. an invalid real token plus X-Guest-Mode:true -> 401, not guest
  it('7. returns 401 when an invalid real token is provided even if X-Guest-Mode: true is also set', async () => {
    const res = await request(app)
      .post('/api/embed')
      .set('Authorization', 'Bearer invalid-token-xyz')
      .set('X-Guest-Mode', 'true')
      .send({ texts: ['sample'] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  // 8. rotating guest ids from the same IP still hits 429 after the cap
  it('8. enforces per-IP rate limit for guests even if guest IDs are rotated', async () => {
    const miniApp = express();
    miniApp.set('trust proxy', 1);
    miniApp.use(requireAuth);
    miniApp.use(rateLimit({ windowMs: 60000, max: 15 }));
    miniApp.get('/guest-rate-test', (_req, res) => res.json({ success: true }));

    const clientIp = '198.51.100.77';
    let hit429 = false;

    for (let i = 1; i <= 17; i++) {
      const res = await request(miniApp)
        .get('/guest-rate-test')
        .set('X-Forwarded-For', clientIp)
        .set('Authorization', `Bearer guest_rotating_id_${i}`);

      if (res.status === 429) {
        hit429 = true;
        expect(res.body.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(res.headers['retry-after']).toBeDefined();
        break;
      }
    }

    expect(hit429).toBe(true);
  });

  // 9. with no project ID configured (use vi.resetModules): real token -> 503 AUTH_NOT_CONFIGURED, guest still allowed
  it('9. returns 503 AUTH_NOT_CONFIGURED when no project ID is configured, while guests still work', async () => {
    const origPid = process.env.FIREBASE_PROJECT_ID;
    const origVitePid = process.env.VITE_FIREBASE_PROJECT_ID;
    const origSa = process.env.FIREBASE_SERVICE_ACCOUNT;
    const origDisable = process.env.FIREBASE_DISABLE_APPLET_CONFIG;
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.VITE_FIREBASE_PROJECT_ID;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    process.env.FIREBASE_DISABLE_APPLET_CONFIG = 'true';

    vi.resetModules();
    const { setMockApps } = await import('../helpers/firebaseAdminMock.js');
    setMockApps([]);

    const { requireAuth: unconfiguredAuth } = await import('../../server/lib/authMiddleware.js');
    const isolatedApp = express();
    isolatedApp.use(unconfiguredAuth);
    isolatedApp.get('/test-route', (_req, res) => res.json({ ok: true }));

    // Real token -> 503
    const resReal = await request(isolatedApp)
      .get('/test-route')
      .set('Authorization', 'Bearer valid-user-a');
    expect(resReal.status).toBe(503);
    expect(resReal.body.code).toBe('AUTH_NOT_CONFIGURED');

    // Guest still works
    const resGuest = await request(isolatedApp)
      .get('/test-route')
      .set('Authorization', 'Bearer guest_test');
    expect(resGuest.status).toBe(200);
    expect(resGuest.body.ok).toBe(true);

    // Restore env and apps
    if (origPid) process.env.FIREBASE_PROJECT_ID = origPid;
    if (origVitePid) process.env.VITE_FIREBASE_PROJECT_ID = origVitePid;
    if (origSa) process.env.FIREBASE_SERVICE_ACCOUNT = origSa;
    if (origDisable !== undefined) {
      process.env.FIREBASE_DISABLE_APPLET_CONFIG = origDisable;
    } else {
      delete process.env.FIREBASE_DISABLE_APPLET_CONFIG;
    }
    setMockApps([
      {
        name: '[DEFAULT]',
        options: { projectId: 'test-project' },
      },
    ]);
    vi.resetModules();
  });

  // 10. /api/health works without auth; responses contain no token, no stack, and no X-User-Id header
  it('10. allows /api/health without auth, leaking no token, no stack, and no X-User-Id header', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-user-id']).toBeUndefined();
    expect(res.body.stack).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Bearer');
    expect(JSON.stringify(res.body)).not.toContain('valid-user');
  });
});
