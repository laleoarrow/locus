import { describe, expect, it } from 'vitest';
import { toUrlKey } from '@/domain/url';

describe('toUrlKey (U1)', () => {
  it('drops fragments', () => {
    expect(toUrlKey('https://example.com/paper#section-2')).toBe('https://example.com/paper');
  });

  it('drops tracking params but keeps meaningful query', () => {
    expect(toUrlKey('https://example.com/article?id=42&utm_source=x&fbclid=abc')).toBe(
      'https://example.com/article?id=42',
    );
  });

  it('drops default ports and lowercases the host', () => {
    expect(toUrlKey('https://Example.COM:443/a')).toBe('https://example.com/a');
    expect(toUrlKey('http://example.com:80/a')).toBe('http://example.com/a');
  });

  it('keeps non-default ports', () => {
    expect(toUrlKey('http://localhost:8137/fixtures/nested.html')).toBe(
      'http://localhost:8137/fixtures/nested.html',
    );
  });

  it('drops a trailing slash on non-root paths only', () => {
    expect(toUrlKey('https://example.com/dir/')).toBe('https://example.com/dir');
    expect(toUrlKey('https://example.com/')).toBe('https://example.com/');
  });

  it('is idempotent', () => {
    const once = toUrlKey('https://example.com/a/?utm_medium=m#x');
    expect(toUrlKey(once)).toBe(once);
  });

  it('returns invalid URLs unchanged', () => {
    expect(toUrlKey('not a url')).toBe('not a url');
  });
});
