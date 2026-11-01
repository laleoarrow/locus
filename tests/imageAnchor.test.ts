import { beforeEach, describe, expect, it } from 'vitest';
import { captureImageAnchor, resolveImageAnchor } from '@/domain/anchor/image';

const SRC_A = 'https://example.com/a.png';
const SRC_B = 'https://example.com/b.png';

function img(id: string): HTMLImageElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLImageElement)) throw new Error(`no img #${id}`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('image anchors (U13)', () => {
  it('captures src, alt, index, and path', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}" alt="fig 1"><img id="two" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('two'), document.body);
    expect(anchor?.src).toBe(SRC_A);
    expect(anchor?.imgIndex).toBe(1);
    expect(anchor?.path.map((s) => s.tag)).toEqual(['ARTICLE', 'IMG']);
    expect(captureImageAnchor(img('one'), document.body)?.alt).toBe('fig 1');
  });

  it('resolves via DOM path on an unchanged page', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('one'), document.body);
    expect(resolveImageAnchor(anchor!, document.body)?.id).toBe('one');
  });

  it('detaches ambiguous repeated images when their structure changes instead of guessing an index', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"><img id="two" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('two'), document.body);
    document.body.innerHTML = `<main><div><img id="x" src="${SRC_A}"></div><div><img id="y" src="${SRC_A}"></div></main>`;
    expect(resolveImageAnchor(anchor!, document.body)).toBeNull();
    delete anchor!.matchCount;
    expect(resolveImageAnchor(anchor!, document.body)).toBeNull();
  });

  it('still recovers a unique source after a layout change, including older anchors', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('one'), document.body)!;
    document.body.innerHTML = `<main><div><img id="one" src="${SRC_A}"></div></main>`;
    expect(resolveImageAnchor(anchor, document.body)).toBe(img('one'));
    delete anchor.matchCount;
    expect(resolveImageAnchor(anchor, document.body)).toBe(img('one'));
  });

  it('detaches when the image is gone', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('one'), document.body);
    document.body.innerHTML = `<article><img src="${SRC_B}"></article>`;
    expect(resolveImageAnchor(anchor!, document.body)).toBeNull();
  });

  it('does not substitute a remaining duplicate when the captured index disappears', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"><img id="two" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('two'), document.body)!;
    img('two').remove();
    expect(resolveImageAnchor(anchor, document.body)).toBeNull();
    delete anchor.matchCount;
    expect(resolveImageAnchor(anchor, document.body)).toBeNull();
  });

  it('uses captured candidate count when an indistinguishable image moves into the deleted first image’s path', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}" alt="Figure"><img id="two" src="${SRC_A}" alt="Figure"></article>`;
    const anchor = captureImageAnchor(img('one'), document.body)!;
    expect(anchor.matchCount).toBe(2);
    img('one').remove();
    expect(resolveImageAnchor(anchor, document.body)).toBeNull();
  });

  it('uses distinct alt text to keep the correct duplicate after reordering', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}" alt="First figure"><img id="two" src="${SRC_A}" alt="Second figure"></article>`;
    const anchor = captureImageAnchor(img('two'), document.body)!;
    expect(anchor.matchCount).toBe(1);
    img('one').before(img('two'));
    expect(resolveImageAnchor(anchor, document.body)).toBe(img('two'));
    img('one').remove();
    expect(resolveImageAnchor(anchor, document.body)).toBe(img('two'));
    img('two').remove();
    expect(resolveImageAnchor(anchor, document.body)).toBeNull();
  });

  it('captures the displayed srcset resource instead of a shared fallback placeholder', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"><img id="two" src="${SRC_A}"></article>`;
    Object.defineProperty(img('one'), 'currentSrc', { configurable: true, value: SRC_B });
    Object.defineProperty(img('two'), 'currentSrc', { configurable: true, value: 'https://example.com/c.png' });
    const anchor = captureImageAnchor(img('two'), document.body)!;
    expect(anchor.src).toBe('https://example.com/c.png');
    expect(anchor.imgIndex).toBe(0);
    expect(resolveImageAnchor(anchor, document.body)).toBe(img('two'));
    Object.defineProperty(img('two'), 'currentSrc', { configurable: true, value: SRC_B });
    expect(resolveImageAnchor(anchor, document.body)).toBeNull();
  });

  it('does not capture empty src as the page URL or guess a lazy data-src', () => {
    document.body.innerHTML = `<img id="one" src="" data-src="${SRC_A}">`;
    expect(captureImageAnchor(img('one'), document.body)).toBeNull();
    img('one').removeAttribute('src');
    expect(captureImageAnchor(img('one'), document.body)).toBeNull();
  });

  it.each([null, undefined, { path: null }, { path: [null] }, { path: [{ tag: 'IMG', index: -1 }] },
    { alt: null }, { matchCount: 0 }, { matchCount: 1.5 }])('rejects malformed local image anchors safely (%j)', (invalid) => {
    document.body.innerHTML = `<img id="one" src="${SRC_A}">`;
    const valid = captureImageAnchor(img('one'), document.body)!;
    const anchor = invalid == null ? invalid : { ...valid, ...invalid };
    expect(resolveImageAnchor(anchor as typeof valid, document.body)).toBeNull();
  });
});
