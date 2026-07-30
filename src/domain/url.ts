const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', 'ref_src']);

function isTrackingParam(name: string): boolean {
  return name.startsWith('utm_') || TRACKING_PARAMS.has(name);
}

/**
 * Normalize a URL into the key used to match a page back to its source.
 * Drops fragment and tracking params, lowercases the host, removes default
 * ports and a trailing slash on non-root paths. Keeps the remaining query,
 * since academic sites often key articles off query IDs.
 */
export function toUrlKey(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackingParam(name)) url.searchParams.delete(name);
  }
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  let key = url.toString();
  if (key.endsWith('?')) key = key.slice(0, -1);
  return key;
}
