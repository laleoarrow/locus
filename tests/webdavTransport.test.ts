import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebDavClient } from '@/lib/webdav';

const config = { url: 'https://dav.example/folder/', username: 'fixture-user', password: 'PRIVATE_PASSWORD' };
const client = () => new WebDavClient(config, config.url);
afterEach(() => vi.unstubAllGlobals());

describe('WebDAV transport', () => {
  it('uses conditional reads without mistaking 304 for a missing file', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await client().read('locus-library.json', 'stable-etag')).toEqual({ kind: 'not-modified', etag: 'stable-etag' });
    expect(fetcher.mock.calls[0]![1].headers['If-None-Match']).toBe('stable-etag');
  });

  it('rejects remote references that could send credentials outside the folder', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const name of ['https://other.example/a', '//other.example/a', '../a', 'locus-v4/../a', '%2e%2e/a', 'x?secret=1']) {
      await expect(client().read(name)).rejects.toThrow('Invalid WebDAV file reference');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('identifies exhausted upload quota without echoing the provider response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<error><code>TrafficRateExhausted</code><detail>PRIVATE_PASSWORD</detail></error>', { status: 403 })));
    const error = await client().put('locus-library.json', '{}', 'absent').catch((reason) => reason);
    expect(error.code).toBe('TrafficRateExhausted');
    expect(error.message).toContain('流量不足');
    expect(error.message).not.toContain(config.password);
    expect(error.message).not.toContain('Sign-in');
  });

  it('does not label every forbidden response as a password error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private provider detail', { status: 403 })));
    await expect(client().get('locus-library.json')).rejects.toThrow('权限或服务限制');
  });
});
