import { describe, expect, it } from 'vitest';
import { extractDoi, normalizeDoi } from '@/domain/doi';
import { isNewerVersion } from '@/domain/version';

describe('normalizeDoi (U16)', () => {
  it('lowercases and strips prefixes and trailing punctuation', () => {
    expect(normalizeDoi('DOI:10.1097/ALN.0000000000002960')).toBe('10.1097/aln.0000000000002960');
    expect(normalizeDoi('https://doi.org/10.1000/xyz123.')).toBe('10.1000/xyz123');
    expect(normalizeDoi('not a doi')).toBe('');
  });
});

describe('extractDoi (U16)', () => {
  it('reads citation_doi meta tags', () => {
    document.head.innerHTML = '<meta name="citation_doi" content="10.1097/ALN.0000000000002960">';
    expect(extractDoi(document, 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7643051/')).toBe(
      '10.1097/aln.0000000000002960',
    );
    document.head.innerHTML = '';
  });

  it('falls back to a DOI embedded in the URL path (ovid-style, tilde-delimited)', () => {
    document.head.innerHTML = '';
    const url =
      'https://www.ovid.com/jnls/anesthesiology/abstract/10.1097/aln.0000000000002960~artificial-intelligence?redirectionsource=fulltextview';
    expect(extractDoi(document, url)).toBe('10.1097/aln.0000000000002960');
  });

  it('returns empty when no DOI is present', () => {
    document.head.innerHTML = '';
    expect(extractDoi(document, 'https://example.com/article?id=42')).toBe('');
  });
});

describe('isNewerVersion (U17)', () => {
  it('compares dotted versions with optional v prefix', () => {
    expect(isNewerVersion('v0.3.0', '0.2.0')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.2.0')).toBe(false);
    expect(isNewerVersion('0.2.0', '0.10.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.3', '0.2.9')).toBe(true);
  });
});
