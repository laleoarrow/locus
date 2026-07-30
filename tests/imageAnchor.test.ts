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

  it('falls back to src+index when the structure changes', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"><img id="two" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('two'), document.body);
    document.body.innerHTML = `<main><div><img id="x" src="${SRC_A}"></div><div><img id="y" src="${SRC_A}"></div></main>`;
    expect(resolveImageAnchor(anchor!, document.body)?.id).toBe('y');
  });

  it('detaches when the image is gone', () => {
    document.body.innerHTML = `<article><img id="one" src="${SRC_A}"></article>`;
    const anchor = captureImageAnchor(img('one'), document.body);
    document.body.innerHTML = `<article><img src="${SRC_B}"></article>`;
    expect(resolveImageAnchor(anchor!, document.body)).toBeNull();
  });
});
