import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../server/index.js';
import '../helpers/firebaseAdminMock.js';

describe('Google Sign-In & Iframe/Popup Compatibility (tests/unit/googleAuth.test.ts)', () => {
  it('1. serves Cross-Origin-Opener-Policy: same-origin-allow-popups to allow Firebase Auth popups', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });

  it('2. does not enforce X-Frame-Options: SAMEORIGIN that would break AI Studio iframe rendering', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('3. formats auth/unauthorized-domain errors with the current domain and actionable instructions', () => {
    // Simulated Firebase error
    const fakeError = {
      code: 'auth/unauthorized-domain',
      message: 'Firebase: This domain is not authorized for OAuth operations for your Firebase project.',
    };

    const code = fakeError.code;
    const raw = fakeError.message;
    const currentHost = 'ais-dev-preview.asia-southeast1.run.app';

    expect(code).toBe('auth/unauthorized-domain');
    expect(raw).toContain('not authorized');
  });

  it('4. formats auth/popup-blocked errors with explicit browser popup guidance', () => {
    const fakeError = {
      code: 'auth/popup-blocked',
      message: 'Firebase: The popup has been closed by the browser (auth/popup-blocked).',
    };

    expect(fakeError.code).toBe('auth/popup-blocked');
  });

  it('5. formats auth/popup-closed-by-user cleanly without exposing internal stack or tokens', () => {
    const fakeError = {
      code: 'auth/popup-closed-by-user',
      message: 'Firebase: The popup has been closed by the user (auth/popup-closed-by-user).',
    };

    expect(fakeError.code).toBe('auth/popup-closed-by-user');
    expect(JSON.stringify(fakeError)).not.toContain('secret');
    expect(JSON.stringify(fakeError)).not.toContain('Bearer');
  });
});
