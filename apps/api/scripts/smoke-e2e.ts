// End-to-end smoke test against a running API in PROVIDER_MODE=fake.
// Usage: OWNER_EMAIL=... OWNER_PASSWORD=... pnpm --filter @sp/api smoke
import { readFileSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.env.SMOKE_API ?? 'http://localhost:3000';
const VIDEOS = process.env.SMOKE_VIDEOS ?? 'D:/dev/tmp/smoke';
let token = '';
let passed = 0;
let failed = 0;
const failures: string[] = [];

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function http(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Json; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: Json = text;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    /* html or empty */
  }
  return { status: res.status, body: parsed, headers: res.headers };
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function step(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    failed += 1;
    failures.push(`${name}: ${(error as Error).message}`);
    console.log(`  ✗ ${name}\n      ${(error as Error).message}`);
  }
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 90_000, intervalMs = 1500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value as T;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function connect(provider: 'google' | 'meta') {
  const start = await http('POST', `/v1/connections/${provider}/start`);
  expect(start.status === 200, `start ${provider} -> ${start.status} ${JSON.stringify(start.body)}`);
  const consent = await fetch(start.body.authorizationUrl);
  const html = await consent.text();
  const allow = html.match(/class="btn primary" href="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&');
  expect(allow, 'consent page has no Allow link');
  const callback = await fetch(allow, { redirect: 'manual' });
  const location = callback.headers.get('location') ?? '';
  expect(location.startsWith('socialpublisher://connections/result?status=success'), `callback redirect was ${location}`);
}

async function upload(file: string, mimeType = 'video/mp4'): Promise<string> {
  const size = statSync(file).size;
  const start = await http('POST', '/v1/media/uploads', { filename: file.split('/').pop(), mimeType, sizeBytes: size });
  expect(start.status === 201 || start.status === 200, `start upload -> ${start.status} ${JSON.stringify(start.body)}`);
  const data = readFileSync(file);
  const parts: Array<{ partNumber: number; etag: string }> = [];
  for (const part of start.body.parts as Array<{ partNumber: number; url: string }>) {
    const from = (part.partNumber - 1) * start.body.partSizeBytes;
    const chunk = data.subarray(from, Math.min(from + start.body.partSizeBytes, size));
    const put = await fetch(part.url, { method: 'PUT', body: chunk });
    expect(put.ok, `PUT part ${part.partNumber} -> ${put.status} ${await put.text()}`);
    parts.push({ partNumber: part.partNumber, etag: put.headers.get('etag')! });
  }
  const complete = await http('POST', `/v1/media/${start.body.mediaId}/complete`, { parts });
  expect(complete.status === 200, `complete -> ${complete.status} ${JSON.stringify(complete.body)}`);
  await waitFor('media READY', async () => {
    const m = await http('GET', `/v1/media/${start.body.mediaId}`);
    if (m.body.status === 'INVALID') throw new Error(`media invalid: ${m.body.invalidReason}`);
    return m.body.status === 'READY';
  }, 60_000);
  return start.body.mediaId;
}

async function waitForPost(postId: string, done: (p: Json) => boolean, timeoutMs = 90_000): Promise<Json> {
  return waitFor(`post ${postId}`, async () => {
    const p = await http('GET', `/v1/posts/${postId}`);
    return done(p.body) ? p.body : null;
  }, timeoutMs);
}

async function main() {
  const email = process.env.OWNER_EMAIL!;
  const password = process.env.OWNER_PASSWORD!;
  console.log(`Smoke test against ${BASE}\n`);
  const accounts: Record<string, string> = {};
  let verticalMedia = '';

  await step('health/ready reports database, storage and jobs', async () => {
    const r = await http('GET', '/health/ready');
    expect(r.status === 200 && r.body.checks.database && r.body.checks.storage && r.body.checks.jobs, JSON.stringify(r.body));
  });

  await step('login rejects a wrong password', async () => {
    const r = await http('POST', '/v1/auth/login', { email, password: 'definitely-wrong' });
    expect(r.status === 401 && r.body.error.code === 'AUTH_INVALID_CREDENTIALS', `${r.status} ${JSON.stringify(r.body)}`);
  });

  await step('protected routes require a token', async () => {
    const r = await http('GET', '/v1/me');
    expect(r.status === 401 && r.body.error.code === 'AUTH_REQUIRED', `${r.status}`);
  });

  await step('login succeeds and refresh rotates tokens', async () => {
    const r = await http('POST', '/v1/auth/login', { email, password, deviceName: 'smoke-test' });
    expect(r.status === 200 && r.body.accessToken, `${r.status} ${JSON.stringify(r.body)}`);
    const refreshed = await http('POST', '/v1/auth/refresh', { refreshToken: r.body.refreshToken });
    expect(refreshed.status === 200, `refresh ${refreshed.status}`);
    const reused = await http('POST', '/v1/auth/refresh', { refreshToken: r.body.refreshToken });
    expect(reused.status === 401 && reused.body.error.code === 'AUTH_REFRESH_REUSED', `reuse ${reused.status} ${JSON.stringify(reused.body)}`);
    const again = await http('POST', '/v1/auth/login', { email, password, deviceName: 'smoke-test' });
    token = again.body.accessToken;
  });

  await step('capabilities: platforms allowed, music off, share on', async () => {
    const r = await http('GET', '/v1/me/capabilities');
    expect(r.status === 200, `${r.status}`);
    const codes = r.body.platforms.map((p: Json) => p.code);
    expect(['youtube', 'instagram', 'facebook'].every((c) => codes.includes(c)), `platforms ${codes}`);
    expect(r.body.platforms.every((p: Json) => p.capabilities.publish && !p.capabilities.music && !p.capabilities.schedule), 'publish/music/schedule flags wrong');
    expect(r.body.global.android_share === true && r.body.global.ai_caption === false, 'global flags wrong');
    const etag = r.headers.get('etag');
    const cached = await http('GET', '/v1/me/capabilities', undefined, { 'If-None-Match': etag! });
    expect(cached.status === 304, `ETag revalidation returned ${cached.status}`);
  });

  await step('connect YouTube through the OAuth flow', () => connect('google'));
  await step('connect Instagram & Facebook through the OAuth flow', () => connect('meta'));

  await step('three destinations are active and shown in capabilities', async () => {
    const r = await http('GET', '/v1/social-accounts');
    for (const a of r.body) if (a.status === 'ACTIVE') accounts[a.platform] = a.id;
    expect(accounts.youtube && accounts.instagram && accounts.facebook, `accounts ${JSON.stringify(r.body)}`);
    const caps = await http('GET', '/v1/me/capabilities');
    expect(caps.body.platforms.every((p: Json) => p.connection.status === 'CONNECTED'), 'connection status not CONNECTED');
  });

  await step('multipart upload goes direct to storage and ffprobe marks it READY', async () => {
    verticalMedia = await upload(`${VIDEOS}/vertical.mp4`);
    const m = await http('GET', `/v1/media/${verticalMedia}`);
    expect(m.body.videoCodec === 'h264' && m.body.width === 1080 && m.body.height === 1920 && m.body.durationMs > 5000, JSON.stringify(m.body));
  });

  await step('publish one video to YouTube, Instagram and Facebook', async () => {
    const key = randomUUID();
    const body = {
      mediaId: verticalMedia,
      title: 'Smoke test sunset',
      caption: 'Golden hour #smoke',
      destinations: [
        { socialAccountId: accounts.youtube, options: { privacyStatus: 'private', madeForKids: false } },
        { socialAccountId: accounts.instagram, captionOverride: 'Golden hour 🌅 #reels' },
        { socialAccountId: accounts.facebook },
      ],
    };
    const created = await http('POST', '/v1/posts', body, { 'Idempotency-Key': key });
    expect(created.status === 201, `${created.status} ${JSON.stringify(created.body)}`);

    const replay = await http('POST', '/v1/posts', body, { 'Idempotency-Key': key });
    expect(replay.status === 200 && replay.body.id === created.body.id, `double tap created a second post (${replay.status})`);
    const conflict = await http('POST', '/v1/posts', { ...body, caption: 'different' }, { 'Idempotency-Key': key });
    expect(conflict.status === 409 && conflict.body.error.code === 'IDEMPOTENCY_KEY_REUSED', `key reuse -> ${conflict.status}`);

    const post = await waitForPost(created.body.id, (p) => p.status === 'PUBLISHED');
    expect(post.publications.length === 3 && post.publications.every((x: Json) => x.status === 'PUBLISHED' && x.externalUrl && x.actions.includes('OPEN')), JSON.stringify(post.publications));
  });

  await step('YouTube requires "made for kids" (validation error names the field)', async () => {
    const r = await http('POST', '/v1/posts', { mediaId: verticalMedia, title: 'x', destinations: [{ socialAccountId: accounts.youtube, options: {} }] }, { 'Idempotency-Key': randomUUID() });
    expect(r.status === 422 && JSON.stringify(r.body.error.details).includes('madeForKids'), `${r.status} ${JSON.stringify(r.body)}`);
  });

  await step('landscape video is rejected for Facebook Reels before publishing', async () => {
    const landscape = await upload(`${VIDEOS}/landscape.mp4`);
    const r = await http('POST', '/v1/posts', { mediaId: landscape, caption: 'wide', destinations: [{ socialAccountId: accounts.facebook }] }, { 'Idempotency-Key': randomUUID() });
    expect(r.status === 422 && r.body.error.code === 'MEDIA_INCOMPATIBLE', `${r.status} ${JSON.stringify(r.body)}`);
  });

  await step('HDR 10-bit HEVC is transcoded to H.264 SDR, then published to Instagram & Facebook', async () => {
    const hdr = await upload(`${VIDEOS}/hdr-hevc.mp4`);
    const m = await http('GET', `/v1/media/${hdr}`);
    expect(m.body.isHdr === true && m.body.videoCodec === 'hevc', `probe ${JSON.stringify(m.body)}`);
    const created = await http('POST', '/v1/posts', { mediaId: hdr, caption: 'HDR test', destinations: [{ socialAccountId: accounts.instagram }, { socialAccountId: accounts.facebook }] }, { 'Idempotency-Key': randomUUID() });
    expect(created.status === 201, `${created.status} ${JSON.stringify(created.body)}`);
    expect(created.body.publications.every((p: Json) => p.status === 'PENDING_MEDIA' || p.status === 'QUEUED' || p.status === 'IN_PROGRESS'), `initial ${JSON.stringify(created.body.publications.map((p: Json) => p.status))}`);
    const post = await waitForPost(created.body.id, (p) => ['PUBLISHED', 'FAILED', 'NEEDS_ATTENTION'].includes(p.status), 180_000);
    expect(post.status === 'PUBLISHED', `ended ${post.status} ${JSON.stringify(post.publications.map((p: Json) => p.error))}`);
  });

  await step('crash after the publish request is sent: reconciliation finds the post, no duplicate', async () => {
    const created = await http('POST', '/v1/posts', { mediaId: verticalMedia, caption: 'crash test', destinations: [{ socialAccountId: accounts.instagram, options: { fake: { crashAfterSendAt: 'PUBLISH', waitPolls: 0 } } }] }, { 'Idempotency-Key': randomUUID() });
    expect(created.status === 201, `${created.status} ${JSON.stringify(created.body)}`);
    // UNKNOWN_OUTCOME already rolls the post up to NEEDS_ATTENTION, so wait for the publication to settle.
    const post = await waitForPost(created.body.id, (p) => ['PUBLISHED', 'NEEDS_USER_ACTION', 'FAILED_FINAL'].includes(p.publications[0].status));
    const pub = post.publications[0];
    expect(post.status === 'PUBLISHED' && pub.externalId?.startsWith('fake_instagram_'), `ended ${post.status} ${JSON.stringify(pub)}`);
  });

  await step('rate limited step is retried automatically without consuming attempts', async () => {
    const created = await http('POST', '/v1/posts', { mediaId: verticalMedia, title: 'rate limit', destinations: [{ socialAccountId: accounts.youtube, options: { privacyStatus: 'private', madeForKids: false, fake: { failAt: 'PROCESSING', failWith: 'RATE_LIMITED', waitPolls: 0 } } }] }, { 'Idempotency-Key': randomUUID() });
    expect(created.status === 201, `${created.status}`);
    const post = await waitForPost(created.body.id, (p) => p.status === 'PUBLISHED' || p.status === 'FAILED', 120_000);
    expect(post.status === 'PUBLISHED' && post.publications[0].attemptCount === 0, `ended ${post.status} attempts=${post.publications[0].attemptCount}`);
  });

  await step('permanent failure -> FAILED_FINAL -> user retry publishes', async () => {
    const created = await http('POST', '/v1/posts', { mediaId: verticalMedia, caption: 'retry me', destinations: [{ socialAccountId: accounts.facebook, options: { fake: { failAt: 'UPLOAD', failWith: 'VALIDATION', waitPolls: 0 } } }] }, { 'Idempotency-Key': randomUUID() });
    const failedPost = await waitForPost(created.body.id, (p) => p.publications[0].status === 'FAILED_FINAL');
    expect(failedPost.status === 'FAILED' && failedPost.publications[0].actions.includes('RETRY'), JSON.stringify(failedPost.publications[0]));
    const retried = await http('POST', `/v1/publications/${failedPost.publications[0].id}/retry`);
    expect(retried.status === 200, `retry -> ${retried.status} ${JSON.stringify(retried.body)}`);
    const post = await waitForPost(created.body.id, (p) => p.status === 'PUBLISHED');
    expect(post.publications[0].status === 'PUBLISHED', 'not published after retry');
  });

  await step('expired connection -> Needs attention -> reconnect resumes the publication', async () => {
    const created = await http('POST', '/v1/posts', { mediaId: verticalMedia, caption: 'auth test', destinations: [{ socialAccountId: accounts.facebook, options: { fake: { failAt: 'UPLOAD', failWith: 'AUTH', waitPolls: 0 } } }] }, { 'Idempotency-Key': randomUUID() });
    const blocked = await waitForPost(created.body.id, (p) => p.publications[0].status === 'NEEDS_USER_ACTION');
    expect(blocked.publications[0].actions.includes('RECONNECT'), `actions ${blocked.publications[0].actions}`);
    const caps = await http('GET', '/v1/me/capabilities');
    const fb = caps.body.platforms.find((p: Json) => p.code === 'facebook');
    expect(fb.connection.accounts[0].status === 'REAUTH_REQUIRED', `account status ${fb.connection.accounts[0].status}`);
    await connect('meta');
    const post = await waitForPost(created.body.id, (p) => p.status === 'PUBLISHED');
    expect(post.publications[0].status === 'PUBLISHED', 'not resumed after reconnect');
  });

  await step('kill switch blocks Instagram publishing immediately and lifts cleanly', async () => {
    const ks = await http('POST', '/v1/admin/kill-switches', { platformCode: 'instagram', featureCode: 'publish', pauseQueuedJobs: true, reason: 'Smoke test outage drill' });
    expect(ks.status === 201 || ks.status === 200, `activate ${ks.status} ${JSON.stringify(ks.body)}`);
    try {
      const caps = await http('GET', '/v1/me/capabilities');
      const ig = caps.body.platforms.find((p: Json) => p.code === 'instagram');
      expect(ig.capabilities.publish === false && caps.body.notices.some((n: Json) => n.code === 'KILL_SWITCH'), 'capability/notice not updated');
      const denied = await http('POST', '/v1/posts', { mediaId: verticalMedia, caption: 'blocked', destinations: [{ socialAccountId: accounts.instagram }] }, { 'Idempotency-Key': randomUUID() });
      expect(denied.status === 403 && denied.body.error.details.reason === 'KILL_SWITCH', `post -> ${denied.status} ${JSON.stringify(denied.body)}`);
    } finally {
      const off = await http('POST', `/v1/admin/kill-switches/${ks.body.id}/deactivate`, { reason: 'drill over' });
      expect(off.status === 200, `deactivate ${off.status}`);
    }
    const caps = await http('GET', '/v1/me/capabilities');
    expect(caps.body.platforms.find((p: Json) => p.code === 'instagram').capabilities.publish === true, 'publish not restored');
  });

  await step('disabling a platform removes it from the app without a new APK', async () => {
    const platforms = await http('GET', '/v1/admin/platforms');
    const fb = platforms.body.find((p: Json) => p.code === 'facebook');
    await http('PATCH', `/v1/admin/platforms/${fb.id}`, { enabled: false, reason: 'smoke test' });
    try {
      const caps = await http('GET', '/v1/me/capabilities');
      expect(!caps.body.platforms.some((p: Json) => p.code === 'facebook'), 'facebook still present');
    } finally {
      await http('PATCH', `/v1/admin/platforms/${fb.id}`, { enabled: true, reason: 'smoke test done' });
    }
    const caps = await http('GET', '/v1/me/capabilities');
    expect(caps.body.platforms.some((p: Json) => p.code === 'facebook'), 'facebook not restored');
  });

  await step('analytics sync produces overview, audience growth and top posts', async () => {
    const sync = await http('POST', '/v1/analytics/sync');
    expect(sync.status === 200 && sync.body.accounts >= 3, `sync ${sync.status} ${JSON.stringify(sync.body)}`);
    const overview = await http('GET', '/v1/analytics/overview?range=30d');
    const audience = overview.body.cards.find((c: Json) => c.group === 'audience_total');
    expect(audience && audience.breakdown.length === 3 && audience.approximate === true, `overview ${JSON.stringify(overview.body.cards.map((c: Json) => c.group))}`);
    expect(overview.body.cards.some((c: Json) => c.group === 'views'), 'no views card');
    const series = await http('GET', '/v1/analytics/audience?range=30d');
    expect(series.body.series.some((s: Json) => s.isDerived) && series.body.series.length >= 4, `audience series ${series.body.series.length}`);
    const top = await http('GET', '/v1/analytics/posts?range=30d');
    expect(top.body.items.length > 0 && top.body.items[0].totals.views > 0, 'top posts empty');
  });

  await step('owner console: overview, audit log and capability explain', async () => {
    const overview = await http('GET', '/v1/admin/overview');
    expect(overview.status === 200 && overview.body.publicationsByStatus.PUBLISHED > 0, `overview ${overview.status}`);
    const audit = await http('GET', '/v1/admin/audit-logs');
    const actions = audit.body.map((a: Json) => a.action);
    expect(['kill_switch.activated', 'kill_switch.deactivated', 'platform.updated', 'connection.created', 'post.created'].every((x) => actions.includes(x)), `audit actions ${[...new Set(actions)]}`);
    const explain = await http('GET', '/v1/admin/capabilities/explain?capability=instagram.music');
    expect(explain.body.allowed === false && explain.body.reason === 'FEATURE_DISABLED', JSON.stringify(explain.body));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
