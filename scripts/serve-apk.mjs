// Serves apps/mobile/builds/app-release.apk over the LAN so a phone can download and
// install it directly (no Play Store, no dev client). Built-in http module only.
//
// Usage: node scripts/serve-apk.mjs
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apkPath = join(root, 'apps/mobile/builds/app-release.apk');
const PORT = 8090;
const HOST = '0.0.0.0';

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${url} <- ${req.socket.remoteAddress}`);

  if (url === '/' || url === '/index.html') {
    const body = `<!doctype html><html><body><a href="/app-release.apk">Download SocialPublisher.apk</a></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }

  if (url === '/app-release.apk') {
    if (!existsSync(apkPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('APK not found on server.');
      return;
    }
    const stat = statSync(apkPath);
    const total = stat.size;
    const range = req.headers.range;

    const headers = {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="SocialPublisher.apk"',
      'Accept-Ranges': 'bytes',
    };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : total - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= total) {
          res.writeHead(416, { 'Content-Range': `bytes */${total}` });
          res.end();
          return;
        }
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Content-Length': end - start + 1,
        });
        createReadStream(apkPath, { start, end }).pipe(res);
        return;
      }
    }

    res.writeHead(200, { ...headers, 'Content-Length': total });
    createReadStream(apkPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${apkPath}`);
  console.log(`Listening on http://${HOST}:${PORT}/  (POST/GET requests are logged below)`);
});
