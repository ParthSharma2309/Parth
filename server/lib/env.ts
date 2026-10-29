import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

function getCliArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 && idx + 1 < process.argv.length ? process.argv[idx + 1] : undefined;
}

const cliPort = getCliArg('--port') || getCliArg('-p');
const cliHost = getCliArg('--host') || getCliArg('-h');

function parseOptionalPositiveInt(val: unknown): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') {
    return Number.isFinite(val) && val > 0 ? Math.floor(val) : undefined;
  }
  const str = String(val).trim();
  if (!str || str.toLowerCase() === 'default' || str.toLowerCase() === 'none' || str.toLowerCase() === 'auto') {
    return undefined;
  }
  const parsed = parseInt(str, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseOptionalIntWithFallback(val: unknown, fallback: number): number {
  const parsed = parseOptionalPositiveInt(val);
  return parsed !== undefined ? parsed : fallback;
}

function getEffectivePort(): number {
  if (cliPort) {
    const p = parseOptionalPositiveInt(cliPort);
    if (p) return p;
  }
  // In production (standalone container / deployment), respect PORT if provided
  if (process.env.NODE_ENV === 'production' && process.env.PORT) {
    const p = parseOptionalPositiveInt(process.env.PORT);
    if (p) return p;
  }
  // In development / AI Studio environment, dev server must run on port 3000
  return 3000;
}

// Raw values from environment and CLI
const rawEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  PORT: getEffectivePort(),
  HOST: cliHost || process.env.HOST || '0.0.0.0',
  NODE_ENV: (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test')
    ? process.env.NODE_ENV
    : 'development',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
  DEFAULT_GEN_MODEL: process.env.DEFAULT_GEN_MODEL || 'gemini-3.8-flash',
  DEFAULT_EMBED_MODEL: process.env.DEFAULT_EMBED_MODEL || 'gemini-embedding-2-preview',
  GEN_MODELS: process.env.GEN_MODELS || '',
  EMBED_MODELS: process.env.EMBED_MODELS || '',
  RATE_LIMIT_PER_MIN: parseOptionalIntWithFallback(process.env.RATE_LIMIT_PER_MIN, 60),
  TIMEOUT_REWRITE: parseOptionalIntWithFallback(process.env.TIMEOUT_REWRITE, 15000),
  TIMEOUT_EMBED: parseOptionalIntWithFallback(process.env.TIMEOUT_EMBED, 30000),
  TIMEOUT_GENERATE: parseOptionalIntWithFallback(process.env.TIMEOUT_GENERATE, 60000),
  TIMEOUT_VISION: parseOptionalIntWithFallback(process.env.TIMEOUT_VISION, 90000),
  LOG_LEVEL: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  EMBED_DIMENSIONS: parseOptionalPositiveInt(process.env.EMBED_DIMENSIONS),
  FIREBASE_PROJECT_ID:
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    undefined,
  FIREBASE_SERVICE_ACCOUNT: process.env.FIREBASE_SERVICE_ACCOUNT?.trim() || undefined,
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL?.trim() || undefined,
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY?.trim() || undefined,
  SUPABASE_URL: process.env.SUPABASE_URL?.trim() || undefined,
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    undefined,
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'documents',
};

// Only GEMINI_API_KEY may be required; all others are optional with defaults in code
export const EnvSchema = z
  .object({
    GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required in server environment and must not be empty.'),
    PORT: z.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    ALLOWED_ORIGINS: z.string().default(''),
    DEFAULT_GEN_MODEL: z.string().default('gemini-3.8-flash'),
    DEFAULT_EMBED_MODEL: z.string().default('gemini-embedding-2-preview'),
    GEN_MODELS: z.string().default(''),
    EMBED_MODELS: z.string().default(''),
    RATE_LIMIT_PER_MIN: z.number().int().positive().default(60),
    TIMEOUT_REWRITE: z.number().int().positive().default(15000),
    TIMEOUT_EMBED: z.number().int().positive().default(30000),
    TIMEOUT_GENERATE: z.number().int().positive().default(60000),
    TIMEOUT_VISION: z.number().int().positive().default(90000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    EMBED_DIMENSIONS: z.number().int().positive().optional(),
    FIREBASE_PROJECT_ID: z.string().min(1).optional(),
    FIREBASE_SERVICE_ACCOUNT: z
      .string()
      .min(1)
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          try {
            const jsonStr = val.startsWith('{') ? val : Buffer.from(val, 'base64').toString('utf8');
            const obj = JSON.parse(jsonStr);
            return typeof obj === 'object' && obj !== null;
          } catch {
            return false;
          }
        },
        {
          message: 'FIREBASE_SERVICE_ACCOUNT must be a valid JSON string or base64-encoded JSON string',
        }
      ),
    FIREBASE_CLIENT_EMAIL: z.string().email('FIREBASE_CLIENT_EMAIL must be a valid email address').optional(),
    FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
    SUPABASE_URL: z
      .string()
      .url('SUPABASE_URL must be a valid URL (e.g. https://your-project.supabase.co)')
      .transform((val) => {
        try {
          return new URL(val).origin;
        } catch {
          return val.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
        }
      })
      .optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY cannot be empty').optional(),
    SUPABASE_STORAGE_BUCKET: z.string().min(1).default('documents'),
  })
  .superRefine((data, ctx) => {
    if (data.SUPABASE_URL && !data.SUPABASE_SERVICE_ROLE_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SUPABASE_SERVICE_ROLE_KEY is required when SUPABASE_URL is provided',
        path: ['SUPABASE_SERVICE_ROLE_KEY'],
      });
    }
    if (data.SUPABASE_SERVICE_ROLE_KEY && !data.SUPABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SUPABASE_URL is required when SUPABASE_SERVICE_ROLE_KEY is provided',
        path: ['SUPABASE_URL'],
      });
    }
  });

const parsed = EnvSchema.safeParse(rawEnv);

if (!parsed.success) {
  console.error('\n❌ Fatal: Invalid server environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\nPlease check your .env or container environment variables.\n');
  process.exit(1);
}

export const env = parsed.data;

export const DEFAULT_GEN_MODEL = env.DEFAULT_GEN_MODEL || 'gemini-3.8-flash';
export const DEFAULT_EMBED_MODEL = env.DEFAULT_EMBED_MODEL || 'gemini-embedding-2-preview';

const rawGenList = env.GEN_MODELS
  ? env.GEN_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
  : ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-flash-latest'];

export const CONFIGURED_GEN_MODELS = Array.from(new Set([DEFAULT_GEN_MODEL, ...rawGenList]));
export const FALLBACK_GEN_MODELS = CONFIGURED_GEN_MODELS.filter((m) => m !== DEFAULT_GEN_MODEL);

const rawEmbedList = env.EMBED_MODELS
  ? env.EMBED_MODELS.split(',').map((m) => m.trim()).filter(Boolean)
  : ['gemini-embedding-2-preview', 'gemini-embedding-2', 'gemini-embedding-001', 'text-embedding-004'];

export const CONFIGURED_EMBED_MODELS = Array.from(new Set([DEFAULT_EMBED_MODEL, ...rawEmbedList]));
export const FALLBACK_EMBED_MODELS = CONFIGURED_EMBED_MODELS.filter((m) => m !== DEFAULT_EMBED_MODEL);

export const ALLOWED_GEN_MODELS = new Set<string>(CONFIGURED_GEN_MODELS);
export const ALLOWED_EMBED_MODELS = new Set<string>(CONFIGURED_EMBED_MODELS);

export const ALLOWED_ORIGIN_LIST = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

export const EMBED_DIMENSIONS = env.EMBED_DIMENSIONS;
export const FIREBASE_PROJECT_ID = env.FIREBASE_PROJECT_ID;
export const SUPABASE_URL = env.SUPABASE_URL;
export const SUPABASE_STORAGE_BUCKET = env.SUPABASE_STORAGE_BUCKET;
