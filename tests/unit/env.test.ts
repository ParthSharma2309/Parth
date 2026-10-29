import { describe, it, expect } from 'vitest';
import { EnvSchema } from '../../server/lib/env.js';

describe('Environment Configuration & In-Code Defaults', () => {
  it('succeeds with ONLY GEMINI_API_KEY provided, populating all optional defaults', () => {
    const parsed = EnvSchema.parse({
      GEMINI_API_KEY: 'AIzaSyTestKey123',
    });

    expect(parsed.GEMINI_API_KEY).toBe('AIzaSyTestKey123');
    // Verify all requested defaults in code
    expect(parsed.DEFAULT_GEN_MODEL).toBe('gemini-3.8-flash');
    expect(parsed.DEFAULT_EMBED_MODEL).toBe('gemini-embedding-2-preview');
    expect(parsed.TIMEOUT_REWRITE).toBe(15000);
    expect(parsed.TIMEOUT_EMBED).toBe(30000);
    expect(parsed.TIMEOUT_GENERATE).toBe(60000);
    expect(parsed.TIMEOUT_VISION).toBe(90000);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.PORT).toBe(3000);
    expect(parsed.HOST).toBe('0.0.0.0');
    expect(parsed.RATE_LIMIT_PER_MIN).toBe(60);
  });

  it('fails validation when GEMINI_API_KEY is missing or empty (the only required variable)', () => {
    const missingResult = EnvSchema.safeParse({});
    expect(missingResult.success).toBe(false);
    if (!missingResult.success) {
      const keyIssue = missingResult.error.issues.find((issue) => issue.path.includes('GEMINI_API_KEY'));
      expect(keyIssue).toBeDefined();
    }

    const emptyResult = EnvSchema.safeParse({ GEMINI_API_KEY: '' });
    expect(emptyResult.success).toBe(false);
  });

  it('allows overriding any optional variable when specified', () => {
    const parsed = EnvSchema.parse({
      GEMINI_API_KEY: 'AIzaSyTestKey123',
      DEFAULT_GEN_MODEL: 'gemini-3.1-pro-preview',
      DEFAULT_EMBED_MODEL: 'text-embedding-004',
      TIMEOUT_REWRITE: 20000,
      TIMEOUT_EMBED: 45000,
      TIMEOUT_GENERATE: 80000,
      TIMEOUT_VISION: 120000,
      LOG_LEVEL: 'debug',
    });

    expect(parsed.DEFAULT_GEN_MODEL).toBe('gemini-3.1-pro-preview');
    expect(parsed.DEFAULT_EMBED_MODEL).toBe('text-embedding-004');
    expect(parsed.TIMEOUT_REWRITE).toBe(20000);
    expect(parsed.TIMEOUT_EMBED).toBe(45000);
    expect(parsed.TIMEOUT_GENERATE).toBe(80000);
    expect(parsed.TIMEOUT_VISION).toBe(120000);
    expect(parsed.LOG_LEVEL).toBe('debug');
  });

  describe('Firebase Admin Configuration Validation', () => {
    it('accepts valid FIREBASE_PROJECT_ID and FIREBASE_SERVICE_ACCOUNT in raw JSON format', () => {
      const saJson = JSON.stringify({
        project_id: 'documind-test-proj',
        client_email: 'firebase-adminsdk@documind.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC...\n-----END PRIVATE KEY-----\n',
      });

      const parsed = EnvSchema.parse({
        GEMINI_API_KEY: 'test-key',
        FIREBASE_PROJECT_ID: 'documind-test-proj',
        FIREBASE_SERVICE_ACCOUNT: saJson,
      });

      expect(parsed.FIREBASE_PROJECT_ID).toBe('documind-test-proj');
      expect(parsed.FIREBASE_SERVICE_ACCOUNT).toBe(saJson);
    });

    it('accepts valid FIREBASE_SERVICE_ACCOUNT in base64-encoded format', () => {
      const saJson = JSON.stringify({
        project_id: 'documind-base64-proj',
        private_key: 'test-key',
      });
      const base64Sa = Buffer.from(saJson).toString('base64');

      const parsed = EnvSchema.parse({
        GEMINI_API_KEY: 'test-key',
        FIREBASE_SERVICE_ACCOUNT: base64Sa,
      });

      expect(parsed.FIREBASE_SERVICE_ACCOUNT).toBe(base64Sa);
    });

    it('accepts valid discrete FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY', () => {
      const parsed = EnvSchema.parse({
        GEMINI_API_KEY: 'test-key',
        FIREBASE_PROJECT_ID: 'documind-test-proj',
        FIREBASE_CLIENT_EMAIL: 'admin@documind-test-proj.iam.gserviceaccount.com',
        FIREBASE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
      });

      expect(parsed.FIREBASE_CLIENT_EMAIL).toBe('admin@documind-test-proj.iam.gserviceaccount.com');
      expect(parsed.FIREBASE_PRIVATE_KEY).toContain('BEGIN PRIVATE KEY');
    });

    it('fails validation when FIREBASE_SERVICE_ACCOUNT is malformed JSON without leaking raw secret in error message', () => {
      const malformedSecret = 'invalid-unparseable-json-content-xyz123';
      const result = EnvSchema.safeParse({
        GEMINI_API_KEY: 'test-key',
        FIREBASE_SERVICE_ACCOUNT: malformedSecret,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const issue = result.error.issues.find((i) => i.path.includes('FIREBASE_SERVICE_ACCOUNT'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('FIREBASE_SERVICE_ACCOUNT must be a valid JSON string');
        // Ensure error message does not echo the secret value
        expect(issue?.message).not.toContain(malformedSecret);
      }
    });
  });
});
