// Tiny static server for fixture pages, plus a minimal in-memory WebDAV
// endpoint under /dav/ so sync can be exercised end to end (no dependencies).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8137);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// --- WebDAV mock -----------------------------------------------------------
// Supports exactly what the sync engine uses: Basic auth, MKCOL, GET, PUT,
// HEAD, ETags and If-Match / If-None-Match preconditions.
const DAV_USER = 'tester';
const DAV_PASS = 'app-password';
const davFiles = new Map(); // path -> { body, etag }
const davCollections = new Set(['/dav/']);
let etagCounter = 0;
let nextPutDelayMs = 0;
let delayedPutActive = false;

function davAuthorized(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const [user, pass] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  return user === DAV_USER && pass === DAV_PASS;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleDav(req, res, pathname) {
  if (!davAuthorized(req)) {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="dav"' });
    res.end('unauthorized');
    return;
  }

  const isCollection = pathname.endsWith('/');
  const existing = davFiles.get(pathname);

  switch (req.method) {
    case 'MKCOL': {
      if (davCollections.has(pathname)) {
        res.writeHead(405);
        res.end('exists');
        return;
      }
      davCollections.add(pathname);
      res.writeHead(201);
      res.end();
      return;
    }
    case 'HEAD':
    case 'GET': {
      if (isCollection) {
        if (!davCollections.has(pathname)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(req.method === 'HEAD' ? undefined : 'collection');
        return;
      }
      if (!existing) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json', etag: existing.etag });
      res.end(req.method === 'HEAD' ? undefined : existing.body);
      return;
    }
    case 'PUT': {
      const ifMatch = req.headers['if-match'];
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === '*' && existing) {
        res.writeHead(412);
        res.end('exists');
        return;
      }
      if (ifMatch && ifMatch !== '*' && existing && ifMatch !== existing.etag) {
        res.writeHead(412);
        res.end('etag mismatch');
        return;
      }
      if (ifMatch && !existing) {
        res.writeHead(412);
        res.end('missing');
        return;
      }
      // Read the complete request before exposing the delay as active. Tests
      // can then mutate IndexedDB while this PUT is stalled and know that its
      // payload is an immutable snapshot of the state from before the edit.
      const body = await readBody(req);
      const delayMs = nextPutDelayMs;
      nextPutDelayMs = 0;
      if (delayMs > 0) {
        delayedPutActive = true;
        try {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } finally {
          delayedPutActive = false;
        }
      }
      const etag = `"v${++etagCounter}"`;
      davFiles.set(pathname, { body, etag });
      res.writeHead(existing ? 204 : 201, { etag });
      res.end();
      return;
    }
    default: {
      res.writeHead(405);
      res.end();
    }
  }
}

// --- Server ----------------------------------------------------------------
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/dav/')) {
    try {
      await handleDav(req, res, pathname);
    } catch {
      res.writeHead(500);
      res.end('dav error');
    }
    return;
  }

  // Test hook: wipe the mock server between e2e cases.
  if (pathname === '/__dav-reset') {
    davFiles.clear();
    nextPutDelayMs = 0;
    delayedPutActive = false;
    res.writeHead(200);
    res.end('reset');
    return;
  }

  // Test hooks for deterministically exercising edits made while a sync is
  // inside its PUT. Only the next PUT is delayed; later queued syncs run at
  // normal speed.
  if (pathname === '/__dav-delay-next-put') {
    const delayMs = Number(url.searchParams.get('ms'));
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      res.writeHead(400);
      res.end('invalid delay');
      return;
    }
    nextPutDelayMs = delayMs;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ armed: true, delayMs }));
    return;
  }

  if (pathname === '/__dav-delay-status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ armed: nextPutDelayMs > 0, active: delayedPutActive }));
    return;
  }

  try {
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    const filePath = join(ROOT, relative);
    if (!filePath.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) throw new Error('forbidden');
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}).listen(PORT, () => {
  console.log(`fixture server on http://localhost:${PORT} (WebDAV mock at /dav/)`);
});
