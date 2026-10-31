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
// HEAD, directories, conditional GETs and atomic ETag preconditions.
const DAV_USER = 'tester';
const DAV_PASS = 'app-password';
const davFiles = new Map(); // path -> { body, etag }
const davCollections = new Set(['/dav/']);
const davRequests = [];
let etagCounter = 0;
let nextPutDelayMs = 0;
let nextPutDelayPath = '';
let delayedPutActive = false;
let davFault = null;

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
  const body = req.method === 'PUT' ? await readBody(req) : '';
  const record = {
    method: req.method, path: pathname, status: 0,
    requestBytes: Buffer.byteLength(body), responseBytes: 0,
    ifMatch: req.headers['if-match'] ?? '', ifNoneMatch: req.headers['if-none-match'] ?? '',
  };
  davRequests.push(record);
  const reply = (status, value = '', headers = {}) => {
    record.status = status;
    const payload = req.method === 'HEAD' || status === 304 ? '' : value;
    record.responseBytes = Buffer.byteLength(payload);
    res.writeHead(status, headers);
    res.end(payload);
  };
  if (!davAuthorized(req)) {
    reply(401, 'unauthorized', { 'www-authenticate': 'Basic realm="dav"' });
    return;
  }
  if (davFault && pathname.startsWith(davFault.prefix) &&
    (!davFault.method || req.method === davFault.method)) {
    const fault = davFault;
    if (fault.remaining > 0 && --fault.remaining === 0) davFault = null;
    reply(fault.status, fault.body, { 'content-type': 'application/json' });
    return;
  }

  const isCollection = pathname.endsWith('/');
  const existing = davFiles.get(pathname);

  switch (req.method) {
    case 'MKCOL': {
      if (davCollections.has(pathname)) {
        reply(405, 'exists');
        return;
      }
      const parent = pathname.replace(/[^/]+\/$/, '');
      if (!davCollections.has(parent)) { reply(409, 'parent missing'); return; }
      davCollections.add(pathname);
      reply(201);
      return;
    }
    case 'HEAD':
    case 'GET': {
      if (isCollection) {
        if (!davCollections.has(pathname)) {
          reply(404);
          return;
        }
        reply(200, 'collection', { 'content-type': 'text/plain' });
        return;
      }
      if (!existing) {
        reply(404);
        return;
      }
      if (req.headers['if-none-match'] === '*' || req.headers['if-none-match'] === existing.etag) {
        reply(304, '', { etag: existing.etag });
        return;
      }
      reply(200, existing.body, { 'content-type': 'application/json', etag: existing.etag });
      return;
    }
    case 'PUT': {
      // Read the complete request before exposing the delay as active. Tests
      // can then mutate IndexedDB while this PUT is stalled and know that its
      // payload is an immutable snapshot of the state from before the edit.
      const delayMs = !nextPutDelayPath || nextPutDelayPath === pathname ? nextPutDelayMs : 0;
      if (delayMs) { nextPutDelayMs = 0; nextPutDelayPath = ''; }
      if (delayMs > 0) {
        delayedPutActive = true;
        try {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } finally {
          delayedPutActive = false;
        }
      }
      // Evaluate against the value at commit time. A second client may have
      // committed while this PUT was held; the stale writer must receive 412.
      const current = davFiles.get(pathname);
      const ifMatch = req.headers['if-match'];
      const ifNoneMatch = req.headers['if-none-match'];
      if (current && (ifNoneMatch === '*' || ifNoneMatch === current.etag)) {
        reply(412, 'exists'); return;
      }
      if (ifMatch && (!current || (ifMatch !== '*' && ifMatch !== current.etag))) {
        reply(412, 'etag mismatch'); return;
      }
      const parent = pathname.slice(0, pathname.lastIndexOf('/') + 1);
      if (!davCollections.has(parent)) { reply(409, 'parent missing'); return; }
      const etag = `"v${++etagCounter}"`;
      davFiles.set(pathname, { body, etag });
      reply(current ? 204 : 201, '', { etag });
      return;
    }
    default: {
      reply(405);
    }
  }
}

// --- LLM mock --------------------------------------------------------------
// Every test owns a unique route token. Only synthetic fixture material is
// recorded, and Authorization values are deliberately not retained.
const llmRequests = new Map();
const llmHeld = new Map();

async function handleLlm(req, res, pathname) {
  const match = /^\/__llm\/([\w-]+)\/(requests|release|(?:success|error|unauthorized|hold|verbose)\/chat\/completions)$/.exec(pathname);
  if (!match) { res.writeHead(404); res.end(); return; }
  const [, token, action] = match;
  const json = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(value));
  };
  if (action === 'requests' && req.method === 'GET') {
    json(200, { requests: llmRequests.get(token) ?? [], pending: llmHeld.get(token)?.size ?? 0 });
    return;
  }
  if (action === 'release' && req.method === 'POST') {
    for (const release of [...(llmHeld.get(token) ?? [])]) release();
    json(200, { released: true });
    return;
  }
  if (req.method !== 'POST') { json(405, { error: 'POST required' }); return; }
  let body;
  try { body = JSON.parse(await readBody(req)); }
  catch { json(400, { error: 'invalid JSON' }); return; }
  const requests = llmRequests.get(token) ?? [];
  requests.push({ body, authorizationPresent: Boolean(req.headers.authorization), path: pathname });
  llmRequests.set(token, requests);
  if (action.startsWith('unauthorized/')) {
    // Echo a synthetic test credential only in the rejected response to prove
    // that provider messages never reach the user-facing status display.
    json(401, { error: `PRIVATE_PROVIDER_DETAIL ${req.headers.authorization ?? ''}` });
    return;
  }
  if (action.startsWith('error/')) {
    json(500, { error: 'PRIVATE_PROVIDER_DETAIL' });
    return;
  }
  const reply = () => json(200, {
    choices: [{ message: { content: action.startsWith('verbose/') ? '这是冗长的模拟回复。'.repeat(100) : '主要内容' }, finish_reason: 'stop' }],
  });
  if (!action.startsWith('hold/')) { reply(); return; }
  const held = llmHeld.get(token) ?? new Set();
  llmHeld.set(token, held);
  const release = () => {
    clearTimeout(timer);
    if (held.delete(release) && !res.destroyed) reply();
  };
  const timer = setTimeout(release, 8000);
  held.add(release);
  res.once('close', () => { clearTimeout(timer); held.delete(release); });
}

// --- Server ----------------------------------------------------------------
createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/__llm/')) {
    try { await handleLlm(req, res, pathname); }
    catch { res.writeHead(500); res.end('mock error'); }
    return;
  }

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
    davCollections.clear();
    davCollections.add('/dav/');
    davRequests.length = 0;
    davFault = null;
    etagCounter = 0;
    nextPutDelayMs = 0;
    nextPutDelayPath = '';
    delayedPutActive = false;
    res.writeHead(200);
    res.end('reset');
    return;
  }

  if (pathname === '/__dav-stats-reset') {
    davRequests.length = 0;
    res.writeHead(200); res.end('reset'); return;
  }
  if (pathname === '/__dav-state') {
    const prefix = url.searchParams.get('prefix') ?? '/dav/';
    const requests = davRequests.filter((entry) => entry.path.startsWith(prefix));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      requests,
      uploadBytes: requests.reduce((sum, entry) => sum + entry.requestBytes, 0),
      downloadBytes: requests.reduce((sum, entry) => sum + entry.responseBytes, 0),
      files: [...davFiles].filter(([path]) => path.startsWith(prefix))
        .map(([path, file]) => ({ path, etag: file.etag, bytes: Buffer.byteLength(file.body) })),
      collections: [...davCollections].filter((path) => path.startsWith(prefix)),
    }));
    return;
  }
  if (pathname === '/__dav-fault' && req.method === 'POST') {
    const value = JSON.parse(await readBody(req));
    davFault = value ? {
      prefix: value.prefix ?? '/dav/', method: value.method ?? '',
      status: value.status ?? 503, body: value.body ?? 'fixture failure',
      remaining: value.count ?? 1,
    } : null;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ armed: davFault !== null }));
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
    nextPutDelayPath = url.searchParams.get('path') ?? '';
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
