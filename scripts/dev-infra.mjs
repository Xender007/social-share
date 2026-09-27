// Starts local development infrastructure, all data on D:
//   - PostgreSQL (embedded-postgres binaries from node_modules) on port 5433
//   - SeaweedFS S3 gateway (stand-in for Cloudflare R2) on port 8333
// Usage: pnpm infra        (Ctrl+C stops both)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_ROOT = process.env.SP_DATA_DIR ?? 'D:/dev/sp-data';
const WEED = process.env.SP_WEED_PATH ?? 'D:/dev/seaweedfs/weed.exe';

function readEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/\s+#.*$/, '').trim();
  }
  return out;
}

const apiEnvPath = join(root, 'apps/api/.env');
if (!existsSync(apiEnvPath)) {
  console.error('apps/api/.env is missing. Copy apps/api/.env.example and fill it in first.');
  process.exit(1);
}
const env = readEnv(apiEnvPath);
const dbUrl = new URL(env.DATABASE_URL);

async function startPostgres() {
  const databaseDir = join(DATA_ROOT, 'pg');
  mkdirSync(DATA_ROOT, { recursive: true });
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    port: Number(dbUrl.port || 5432),
    persistent: true,
    // Windows defaults to WIN1252, which cannot store emoji in captions. Always use UTF-8.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => {},
    onError: (message) => console.error('[postgres]', String(message).trim()),
  });
  if (!existsSync(join(databaseDir, 'PG_VERSION'))) {
    console.log('[postgres] initialising data directory', databaseDir);
    await pg.initialise();
  }
  await pg.start();
  const client = pg.getPgClient();
  await client.connect();
  for (const dbName of [dbUrl.pathname.replace(/^\//, ''), `${dbUrl.pathname.replace(/^\//, '')}_test`]) {
    const existing = await client.query('SELECT pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname = $1', [dbName]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`);
      console.log(`[postgres] created UTF-8 database ${dbName}`);
    } else if (existing.rows[0].enc !== 'UTF8') {
      console.error(`[postgres] WARNING: database ${dbName} uses ${existing.rows[0].enc}; recreate it as UTF-8 or emoji will fail.`);
    }
  }
  await client.end();
  console.log(`[postgres] ready on localhost:${dbUrl.port}`);
  return pg;
}

function startSeaweed() {
  const dir = join(DATA_ROOT, 's3');
  mkdirSync(dir, { recursive: true });
  const configPath = join(DATA_ROOT, 's3-identities.json');
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        identities: [
          {
            name: 'social-publisher',
            credentials: [{ accessKey: env.STORAGE_ACCESS_KEY_ID, secretKey: env.STORAGE_SECRET_ACCESS_KEY }],
            actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
          },
        ],
      },
      null,
      2,
    ),
  );
  const args = [
    'server',
    `-dir=${dir}`,
    '-ip=127.0.0.1',
    '-ip.bind=0.0.0.0',
    '-master.port=19333',
    '-volume.port=18080',
    '-filer.port=18888',
    '-s3',
    '-s3.port=8333',
    `-s3.config=${configPath}`,
    // Small volumes and plenty of slots: a dev machine never runs out of writable volumes.
    '-volume.max=100',
    '-master.volumeSizeLimitMB=1024',
    '-master.volumePreallocate=false',
  ];
  const child = spawn(WEED, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const log = (chunk) => {
    const text = String(chunk);
    if (/error|fatal|panic/i.test(text) && !/no such file/i.test(text)) process.stderr.write(`[seaweedfs] ${text}`);
  };
  child.stdout.on('data', log);
  child.stderr.on('data', log);
  child.on('exit', (code) => console.log(`[seaweedfs] exited with code ${code}`));
  console.log('[seaweedfs] S3 gateway starting on 0.0.0.0:8333');
  return child;
}

async function waitForS3() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch('http://127.0.0.1:8333/');
      if (res.status > 0) return console.log('[seaweedfs] ready');
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn('[seaweedfs] did not respond within 60s');
}

const pg = await startPostgres();
const weed = startSeaweed();
await waitForS3();
console.log('\nInfrastructure is running. Press Ctrl+C to stop.\n');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping...');
  weed.kill();
  await pg.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
