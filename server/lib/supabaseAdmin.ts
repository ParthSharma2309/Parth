import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';
import { logger } from './logger.js';

export class StorageNotConfiguredError extends Error {
  constructor(message = 'Supabase Storage is not configured on this server.') {
    super(message);
    this.name = 'StorageNotConfiguredError';
    Object.setPrototypeOf(this, StorageNotConfiguredError.prototype);
  }
}

let cachedClient: SupabaseClient | null = null;

/**
 * Checks whether Supabase Storage credentials (URL and Service Role key) are configured.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Returns the configured private document storage bucket name.
 */
export function getSupabaseBucket(): string {
  return env.SUPABASE_STORAGE_BUCKET || 'documents';
}

/**
 * Initializes and returns a server-side Supabase client authenticated with the service role key.
 * Throws StorageNotConfiguredError if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is absent.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new StorageNotConfiguredError();
  }

  if (!cachedClient) {
    try {
      let supabaseUrl = env.SUPABASE_URL!;
      try {
        supabaseUrl = new URL(supabaseUrl).origin;
      } catch {
        supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
      }

      cachedClient = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      });
      logger.info(
        { bucket: getSupabaseBucket() },
        'Supabase Storage admin client initialized successfully'
      );
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        'Failed to initialize Supabase Storage admin client'
      );
      throw err;
    }
  }

  return cachedClient;
}

/**
 * Resets the cached Supabase client (primarily for testing and mock reset).
 */
export function resetSupabaseAdminClient(): void {
  cachedClient = null;
}
