import { describe, expect, it } from 'vitest';
import {
  basicAuthHeader,
  describeSyncError,
  isConfigComplete,
  normalizeCollectionUrl,
  type SyncConfig,
} from '@/domain/sync';

const base: SyncConfig = {
  enabled: true,
  url: 'https://dav.jianguoyun.com/dav/locus',
  username: 'reader@example.com',
  password: 'app-password',
  intervalMinutes: 5,
};

describe('normalizeCollectionUrl (U23)', () => {
  it('adds the trailing slash WebDAV collections require', () => {
    expect(normalizeCollectionUrl('https://dav.jianguoyun.com/dav/locus')).toBe(
      'https://dav.jianguoyun.com/dav/locus/',
    );
    expect(normalizeCollectionUrl('  https://dav.jianguoyun.com/dav/locus/  ')).toBe(
      'https://dav.jianguoyun.com/dav/locus/',
    );
  });

  it('strips query and fragment', () => {
    expect(normalizeCollectionUrl('https://host/dav/x?a=1#f')).toBe('https://host/dav/x/');
  });

  it('rejects empty input and non-http schemes', () => {
    expect(normalizeCollectionUrl('')).toBeNull();
    expect(normalizeCollectionUrl('   ')).toBeNull();
    expect(normalizeCollectionUrl('not a url')).toBeNull();
    expect(normalizeCollectionUrl('ftp://host/dav/')).toBeNull();
    expect(normalizeCollectionUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('isConfigComplete (U23)', () => {
  it('requires a usable url, a username and a password', () => {
    expect(isConfigComplete(base)).toBe(true);
    expect(isConfigComplete({ ...base, url: '' })).toBe(false);
    expect(isConfigComplete({ ...base, username: '   ' })).toBe(false);
    expect(isConfigComplete({ ...base, password: '' })).toBe(false);
  });
});

describe('basicAuthHeader (U24)', () => {
  it('encodes ASCII credentials', () => {
    expect(basicAuthHeader('user', 'pass')).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('survives non-ASCII credentials that would break btoa', () => {
    expect(() => basicAuthHeader('用户', '密码')).not.toThrow();
    const header = basicAuthHeader('用户', '密码');
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe('用户:密码');
  });
});

describe('describeSyncError (U24)', () => {
  it('explains the statuses users actually hit', () => {
    expect(describeSyncError(401)).toContain('app password');
    expect(describeSyncError(403)).toContain('app password');
    expect(describeSyncError(404)).toContain('address');
    expect(describeSyncError(507)).toContain('space');
    expect(describeSyncError(503)).toContain('retry');
  });
});
