import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvSchema } from '../../server/lib/env.js';
import {
  StorageNotConfiguredError,
  isSupabaseConfigured,
  getSupabaseBucket,
  getSupabaseAdminClient,
  resetSupabaseAdminClient,
} from '../../server/lib/supabaseAdmin.js';

describe('Supabase Configuration & Validation (tests/unit/supabaseConfig.test.ts)', () => {
  beforeEach(() => {
    resetSupabaseAdminClient();
  });

  describe('EnvSchema Validation for Supabase', () => {
    const baseValidEnv = {
      GEMINI_API_KEY: 'test-gemini-key',
    };

    it('allows omitting Supabase configuration completely (optional for local/unconfigured mode)', () => {
      const parsed = EnvSchema.safeParse(baseValidEnv);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.SUPABASE_URL).toBeUndefined();
        expect(parsed.data.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
        expect(parsed.data.SUPABASE_STORAGE_BUCKET).toBe('documents');
      }
    });

    it('accepts valid SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY', () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        SUPABASE_URL: 'https://test-project-123.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-service-role-secret',
        SUPABASE_STORAGE_BUCKET: 'custom-documents',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.SUPABASE_URL).toBe('https://test-project-123.supabase.co');
        expect(parsed.data.SUPABASE_SERVICE_ROLE_KEY).toBe(
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-service-role-secret'
        );
        expect(parsed.data.SUPABASE_STORAGE_BUCKET).toBe('custom-documents');
      }
    });

    it('normalizes SUPABASE_URL with trailing /rest/v1/ or slash to clean origin', () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        SUPABASE_URL: 'https://test-project-123.supabase.co/rest/v1/',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.SUPABASE_URL).toBe('https://test-project-123.supabase.co');
      }
    });

    it('fails validation when SUPABASE_URL is malformed (not a valid URL)', () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        SUPABASE_URL: 'not-a-valid-url',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key',
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const urlIssue = parsed.error.issues.find((issue) => issue.path.includes('SUPABASE_URL'));
        expect(urlIssue).toBeDefined();
        expect(urlIssue?.message).toContain('valid URL');
      }
    });

    it('fails validation when SUPABASE_URL is provided without SUPABASE_SERVICE_ROLE_KEY', () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        SUPABASE_URL: 'https://test-project.supabase.co',
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i) => i.path.includes('SUPABASE_SERVICE_ROLE_KEY'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('SUPABASE_SERVICE_ROLE_KEY is required');
      }
    });

    it('fails validation when SUPABASE_SERVICE_ROLE_KEY is provided without SUPABASE_URL', () => {
      const parsed = EnvSchema.safeParse({
        ...baseValidEnv,
        SUPABASE_SERVICE_ROLE_KEY: 'some-secret-key',
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i) => i.path.includes('SUPABASE_URL'));
        expect(issue).toBeDefined();
        expect(issue?.message).toContain('SUPABASE_URL is required');
      }
    });

    it('defaults SUPABASE_STORAGE_BUCKET to "documents"', () => {
      const parsed = EnvSchema.safeParse(baseValidEnv);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.SUPABASE_STORAGE_BUCKET).toBe('documents');
      }
    });
  });

  describe('server/lib/supabaseAdmin Runtime Helpers', () => {
    it('returns default bucket name "documents" from getSupabaseBucket', () => {
      expect(getSupabaseBucket()).toBe('documents');
    });

    it('throws StorageNotConfiguredError when getSupabaseAdminClient is called without credentials', () => {
      // In test environment, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are unset by default
      if (!isSupabaseConfigured()) {
        expect(() => getSupabaseAdminClient()).toThrow(StorageNotConfiguredError);
        expect(() => getSupabaseAdminClient()).toThrow(
          'Supabase Storage is not configured on this server.'
        );
      }
    });
  });
});
