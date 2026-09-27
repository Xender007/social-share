import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const encryptionKeys = z.string().transform((raw, ctx) => {
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const keys = new Map<number, Buffer>();
    for (const [version, b64] of Object.entries(parsed)) {
      const key = Buffer.from(b64, 'base64');
      if (key.length !== 32) {
        ctx.addIssue({ code: 'custom', message: `Token encryption key v${version} must be 32 bytes` });
        return z.NEVER;
      }
      keys.set(Number(version), key);
    }
    return keys;
  } catch {
    ctx.addIssue({ code: 'custom', message: 'TOKEN_ENCRYPTION_KEYS must be a JSON object of version -> base64 key' });
    return z.NEVER;
  }
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PROCESS_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['verbose', 'debug', 'log', 'warn', 'error']).default('log'),
  API_BASE_URL: z.url(),
  MOBILE_DEEP_LINK_SCHEME: z.string().default('socialpublisher'),
  PROVIDER_MODE: z.enum(['fake', 'live']).default('fake'),

  DATABASE_URL: z.string().min(1),
  PGBOSS_DATABASE_URL: optionalString,

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  TOKEN_ENCRYPTION_KEYS: encryptionKeys,
  TOKEN_ENCRYPTION_ACTIVE_VERSION: z.coerce.number().int().positive(),

  STORAGE_ENDPOINT: z.url(),
  STORAGE_PUBLIC_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().default('auto'),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_FORCE_PATH_STYLE: booleanString.default(true),

  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GOOGLE_REDIRECT_URI: optionalString,
  META_APP_ID: optionalString,
  META_APP_SECRET: optionalString,
  META_LOGIN_CONFIG_ID: optionalString,
  META_GRAPH_API_VERSION: z.string().default('v23.0'),
  META_REDIRECT_URI: optionalString,

  EXPO_ACCESS_TOKEN: optionalString,

  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  MEDIA_TMP_DIR: optionalString.transform((value) => value ?? join(tmpdir(), 'sp-media')),

  JOBS_ENABLED: booleanString.default(true),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const env = result.data;
  if (!env.TOKEN_ENCRYPTION_KEYS.has(env.TOKEN_ENCRYPTION_ACTIVE_VERSION)) {
    throw new Error('TOKEN_ENCRYPTION_ACTIVE_VERSION does not match any key in TOKEN_ENCRYPTION_KEYS');
  }
  if (env.PROVIDER_MODE === 'live' && env.NODE_ENV === 'production' && !env.EXPO_ACCESS_TOKEN) {
    // Push still works without an access token, but production should use one.
  }
  return env;
}
