import { basicAuthHeader, describeSyncError, type SyncConfig } from '@/domain/sync';

/** Thrown for HTTP failures so callers can branch on status (e.g. 412). */
export class WebDavError extends Error {
  constructor(
    readonly status: number,
    message?: string,
    readonly code: 'TrafficRateExhausted' | '' = '',
  ) {
    super(message ?? describeSyncError(status));
    this.name = 'WebDavError';
  }
}

export interface RemoteFile {
  body: string;
  etag: string;
}

export type RemoteRead =
  | { kind: 'missing' }
  | { kind: 'not-modified'; etag: string }
  | ({ kind: 'file' } & RemoteFile);

async function responseError(response: Response): Promise<WebDavError> {
  if (response.status === 403) {
    const detail = (await response.text()).slice(0, 4096);
    if (detail.includes('TrafficRateExhausted')) {
      return new WebDavError(403, '网盘上传流量不足，自动上传已暂停。额度恢复后可手动重试。', 'TrafficRateExhausted');
    }
    return new WebDavError(403, '网盘拒绝访问，请检查目录权限或服务限制。');
  }
  return new WebDavError(response.status);
}

/**
 * Minimal WebDAV client: enough for one JSON file in one collection.
 * Runs in the background service worker, where host_permissions allow the
 * cross-origin request (WebDAV servers rarely send CORS headers).
 */
export class WebDavClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(config: Pick<SyncConfig, 'url' | 'username' | 'password'>, baseUrl: string) {
    this.base = baseUrl;
    this.auth = basicAuthHeader(config.username, config.password);
  }

  private url(name: string): string {
    // Manifest references must never move authentication outside this folder.
    if (!/^[A-Za-z0-9._/-]*$/.test(name) || name.startsWith('/') ||
      name.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('Invalid WebDAV file reference.');
    }
    return new URL(name, this.base).toString();
  }

  private async request(name: string, init: RequestInit): Promise<Response> {
    return fetch(this.url(name), {
      ...init,
      headers: { Authorization: this.auth, ...(init.headers ?? {}) },
      // Never let a proxy or the HTTP cache answer a sync request.
      cache: 'no-store',
      credentials: 'omit',
      // The signal also covers response-body reads after headers arrive.
      signal: AbortSignal.timeout(25_000),
    });
  }

  /** Create the collection if missing. 405/301 mean it already exists. */
  async ensureCollection(name = ''): Promise<void> {
    const response = await this.request(name, { method: 'MKCOL' });
    if (response.ok || response.status === 405 || response.status === 301) return;
    // Some servers answer MKCOL on an existing collection with 409 when the
    // parent is fine but the target exists; treat a readable collection as OK.
    if (response.status === 409) {
      const probe = await this.request(name, { method: 'HEAD' });
      if (probe.ok || probe.status === 405) return;
    }
    throw await responseError(response);
  }

  /** Read the file, or null when it does not exist yet. */
  async get(name: string): Promise<RemoteFile | null> {
    const result = await this.read(name);
    return result.kind === 'file' ? { body: result.body, etag: result.etag } : null;
  }

  async read(name: string, etag?: string): Promise<RemoteRead> {
    const response = await this.request(name, { method: 'GET', ...(etag ? { headers: { 'If-None-Match': etag } } : {}) });
    if (response.status === 304) return { kind: 'not-modified', etag: response.headers.get('etag') || etag || '' };
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) throw await responseError(response);
    return { kind: 'file', body: await response.text(), etag: response.headers.get('etag') ?? '' };
  }

  /**
   * Write the file under optimistic concurrency, so a copy another device
   * pushed since we read cannot be clobbered:
   *  - `{ replaces: etag }` → If-Match (fails 412 if the remote moved on)
   *  - `'absent'`           → If-None-Match: * (fails 412 if it now exists)
   *  - `'unconditional'`    → no guard (servers without ETag support)
   */
  async put(
    name: string,
    body: string,
    precondition: { replaces: string } | 'absent' | 'unconditional',
  ): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (precondition === 'absent') headers['If-None-Match'] = '*';
    else if (precondition !== 'unconditional') headers['If-Match'] = precondition.replaces;
    const response = await this.request(name, { method: 'PUT', body, headers });
    if (!response.ok) throw await responseError(response);
    return response.headers.get('etag') ?? '';
  }
}
