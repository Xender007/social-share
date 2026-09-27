import { config } from 'dotenv';
import { join } from 'node:path';

// Integration tests use the local dev infrastructure (pnpm infra) with a separate database.
config({ path: join(__dirname, '..', '.env') });
const testDb = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL?.replace(/\/[^/?]+(\?|$)/, '/social_publisher_test$1');
process.env.DATABASE_URL = testDb;
process.env.DIRECT_DATABASE_URL = testDb;
process.env.PGBOSS_DATABASE_URL = testDb;
process.env.NODE_ENV = 'test';
process.env.PROVIDER_MODE = 'fake';
process.env.STORAGE_BUCKET = 'sp-media-test';
