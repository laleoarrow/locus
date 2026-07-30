import { basicAuthHeader, describeSyncError, type SyncConfig } from '@/domain/sync';

/** Thrown for HTTP failures so callers can branch on status (e.g. 412). */
export class WebDavError extends Error {
  constructor(
    readonly status: number,
    message?: string,
  ) {
    super(message ?? describeSyncError(status));
    this.name = 'WebDavError';
  }
}

export interface RemoteFile {
  body: string;
  etag: string;
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
    return new URL(name, this.base).toString();
  }

  private async request(name: string, init: RequestInit): Promise<Response> {
    return fetch(this.url(name), {
      ...init,
      headers: { Authorization: this.auth, ...(init.headers ?? {}) },
      // Never let a proxy or the HTTP cache answer a sync request.
      cache: 'no-store',
      credentials: 'omit',
    });
  }

  /** Create the collection if missing. 405/301 mean it already exists. */
  async ensureCollection(): Promise<void> {
    const response = await this.request('', { method: 'MKCOL' });
    if (response.ok || response.status === 405 || response.status === 301) return;
    // Some servers answer MKCOL on an existing collection with 409 when the
    // parent is fine but the target exists; treat a readable collection as OK.
    if (response.status === 409) {
      const probe = await this.request('', { method: 'HEAD' });
      if (probe.ok || probe.status === 405) return;
    }
    throw new WebDavError(response.status);
  }

  /** Read the file, or null when it does not exist yet. */
  async get(name: string): Promise<RemoteFile | null> {
    const response = await this.request(name, { method: 'GET' });
    if (response.status === 404) return null;
    if (!response.ok) throw new WebDavError(response.status);
    return { body: await response.text(), etag: response.headers.get('etag') ?? '' };
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
    if (!response.ok) throw new WebDavError(response.status);
    return response.headers.get('etag') ?? '';
  }
}
