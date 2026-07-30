import { beforeEach, describe, expect, it } from 'vitest';
import { captureAnchor } from '@/domain/anchor/capture';
import { resolveAnchor } from '@/domain/anchor/resolve';
import { buildTextIndex, offsetsToRange, rangeToOffsets } from '@/domain/anchor/textIndex';
import type { AnchorData } from '@/domain/types';

function setBody(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

/** Build a Range covering the first occurrence of `text` via the index. */
function rangeFor(text: string): { range: Range; anchor: AnchorData } {
  const index = buildTextIndex(document.body);
  const at = index.text.indexOf(text);
  expect(at).toBeGreaterThanOrEqual(0);
  const range = offsetsToRange(index, at, at + text.length);
  if (!range) throw new Error('failed to build range');
  const anchor = captureAnchor(range, index, document.body);
  if (!anchor) throw new Error('failed to capture anchor');
  return { range, anchor };
}

function resolveNow(anchor: AnchorData) {
  return resolveAnchor(anchor, buildTextIndex(document.body), document.body);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('text index (U2)', () => {
  it('concatenates visible text and skips script/style', () => {
    setBody('<p>Hello <em>world</em></p><script>var x = 1;</script><style>p{}</style>');
    const index = buildTextIndex(document.body);
    expect(index.text).toBe('Hello world');
  });

  it('round-trips range ↔ offsets across nested elements', () => {
    setBody('<p>One <em>two <strong>three</strong></em> four</p>');
    const index = buildTextIndex(document.body);
    const at = index.text.indexOf('two three');
    const range = offsetsToRange(index, at, at + 'two three'.length);
    expect(range?.toString()).toBe('two three');
    const back = rangeToOffsets(index, range as Range);
    expect(back).toEqual({ start: at, end: at + 'two three'.length });
  });
});

describe('capture (U3)', () => {
  it('stores exact, prefix, suffix, positions, and DOM paths', () => {
    setBody('<article><p>Before text. The exact selected words. After text.</p></article>');
    const { anchor } = rangeFor('exact selected words');
    expect(anchor.exact).toBe('exact selected words');
    expect(anchor.prefix.endsWith('The ')).toBe(true);
    expect(anchor.suffix.startsWith('. After')).toBe(true);
    expect(anchor.end - anchor.start).toBe(anchor.exact.length);
    expect(anchor.startPoint.steps.map((s) => s.tag)).toEqual(['ARTICLE', 'P']);
    expect(anchor.endPoint.offset).toBeGreaterThan(0);
  });
});

describe('resolve strategies', () => {
  it('re-anchors via DOM path on an unchanged page (U4)', () => {
    setBody('<article><p>Alpha beta gamma delta.</p></article>');
    const { anchor } = rangeFor('beta gamma');
    const resolved = resolveNow(anchor);
    expect(resolved?.strategy).toBe('dom-path');
    expect(resolved?.range.toString()).toBe('beta gamma');
  });

  it('falls back to character position when paths break (U5)', () => {
    setBody('<article><p>Alpha beta gamma delta.</p></article>');
    const { anchor } = rangeFor('beta gamma');
    // Restructure: same text, new wrapper — same page text, dead paths.
    setBody('<main><div><span>Alpha beta gamma delta.</span></div></main>');
    const resolved = resolveNow(anchor);
    expect(resolved?.strategy).toBe('position');
    expect(resolved?.range.toString()).toBe('beta gamma');
  });

  it('finds the right occurrence of repeated text by context (U6)', () => {
    setBody(
      '<p>Alpha context. The powerhouse of the cell. Alpha after.</p>' +
        '<p>Beta context. The powerhouse of the cell. Beta after.</p>' +
        '<p>Gamma context. The powerhouse of the cell. Gamma after.</p>',
    );
    const index = buildTextIndex(document.body);
    const second = index.text.indexOf('The powerhouse', index.text.indexOf('Beta context'));
    const range = offsetsToRange(index, second, second + 'The powerhouse of the cell.'.length);
    const anchor = captureAnchor(range as Range, index, document.body);
    if (!anchor) throw new Error('capture failed');
    // Prepend content: positions shift, DOM paths break.
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<h1>Inserted heading changes every position</h1><p>And an inserted paragraph too.</p>',
    );
    const resolved = resolveNow(anchor);
    expect(resolved?.strategy).toBe('quote');
    expect(resolved?.range.toString()).toBe('The powerhouse of the cell.');
    // Verify it picked the *second* occurrence: its prefix should be Beta's.
    const after = buildTextIndex(document.body);
    const offsets = rangeToOffsets(after, resolved!.range);
    expect(after.text.slice((offsets?.start ?? 0) - 14, offsets?.start)).toContain('Beta context');
  });

  it('returns null (detached) when the text is gone (U7)', () => {
    setBody('<p>Sentence that will vanish entirely.</p><p>Sentence that stays.</p>');
    const { anchor } = rangeFor('will vanish');
    setBody('<p>Sentence that stays.</p>');
    expect(resolveNow(anchor)).toBeNull();
  });

  it('refuses to guess among ambiguous candidates with no context match (U7b)', () => {
    setBody('<p>alpha token beta</p>');
    const { anchor } = rangeFor('token');
    // Two occurrences, both with completely different context than stored.
    setBody('<p>xx token yy</p><p>zz token ww</p>');
    expect(resolveNow(anchor)).toBeNull();
  });
});
