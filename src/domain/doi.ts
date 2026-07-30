/**
 * DOI detection. Local-only: reads the page's meta tags and the URL; nothing
 * is fetched. Used to recognize the same paper across publisher/PMC/preprint
 * versions.
 */

const DOI_PATTERN = /10\.\d{4,9}\/[^\s"'<>~?#&]+/i;

const META_NAMES = ['citation_doi', 'dc.identifier', 'dc.identifier.doi', 'prism.doi', 'doi'];

export function normalizeDoi(raw: string): string {
  let doi = raw.trim().toLowerCase();
  doi = doi.replace(/^(doi:|https?:\/\/(dx\.)?doi\.org\/)/, '');
  doi = doi.replace(/[.,;)\]]+$/, '');
  return DOI_PATTERN.test(doi) ? (DOI_PATTERN.exec(doi)?.[0] ?? '') : '';
}

/** Extract a DOI from meta tags first, then from the URL path. */
export function extractDoi(doc: Document, url: string): string {
  for (const name of META_NAMES) {
    const meta = doc.querySelector<HTMLMetaElement>(
      `meta[name="${name}" i], meta[property="${name}" i]`,
    );
    if (meta?.content) {
      const doi = normalizeDoi(meta.content);
      if (doi) return doi;
    }
  }
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    const match = DOI_PATTERN.exec(path);
    if (match) return normalizeDoi(match[0]);
  } catch {
    // invalid URL: fall through
  }
  return '';
}
