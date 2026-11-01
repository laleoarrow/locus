import { afterEach, describe, expect, it, vi } from 'vitest';
import { mutationAnchorWork, type MutationAnchor } from '@/content/mutations';
import { captureAnchor } from '@/domain/anchor/capture';
import { captureImageAnchor } from '@/domain/anchor/image';
import { buildTextIndex } from '@/domain/anchor/textIndex';

function textTarget(): MutationAnchor {
  const node = document.querySelector('#excerpt')!.firstChild!;
  const range = document.createRange();
  range.selectNodeContents(node);
  return { anchor: captureAnchor(range, buildTextIndex(document.body), document.body)!,
    detached: false, range, image: null };
}
function imageTarget(): MutationAnchor {
  const image = document.querySelector('img')!;
  return { anchor: captureImageAnchor(image, document.body)!, detached: false, range: null, image };
}
function changes(edit: () => void): MutationRecord[] {
  const observer = new MutationObserver(() => undefined);
  observer.observe(document.body, { subtree: true, characterData: true, childList: true, attributes: true });
  edit();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}
afterEach(() => { document.body.textContent = ''; vi.restoreAllMocks(); });

describe('mutation-triggered anchor recovery', () => {
  it('keeps healthy ranges through unrelated ticker updates and insertions before the text', () => {
    document.body.innerHTML = '<aside>0</aside><p id="excerpt">Exact  whitespace\n stays</p>';
    const target = textTarget();
    for (let i = 0; i < 20; i++) {
      const records = changes(() => { document.querySelector('aside')!.textContent = String(i); });
      expect(mutationAnchorWork(records, [target], document.body)).toBeNull();
    }
    const inserted = changes(() => { document.body.prepend(document.createElement('p')); });
    expect(mutationAnchorWork(inserted, [target], document.body)).toBeNull();
  });

  it('restores a replaced text node but does not index a style-only change', () => {
    document.body.innerHTML = '<p id="excerpt">saved excerpt</p>';
    const target = textTarget();
    const style = changes(() => { document.querySelector<HTMLElement>('p')!.style.padding = '10px'; });
    expect(mutationAnchorWork(style, [target], document.body)).toBeNull();
    const replaced = changes(() => { document.querySelector('p')!.innerHTML = 'saved <b>excerpt</b>'; });
    expect(mutationAnchorWork(replaced, [target], document.body)).toBe('reanchor');
  });

  it('retries detached text only when the changed subtree contains its exact excerpt', () => {
    document.body.innerHTML = '<aside>0</aside><p id="excerpt">saved excerpt</p>';
    const target = { ...textTarget(), detached: true, range: null };
    document.querySelector('p')!.remove();
    const ticker = changes(() => { document.querySelector('aside')!.textContent = '1'; });
    expect(mutationAnchorWork(ticker, [target], document.body)).toBeNull();
    const unrelated = changes(() => { document.body.append(document.createElement('p')); });
    expect(mutationAnchorWork(unrelated, [target], document.body)).toBeNull();
    const restored = changes(() => { document.body.insertAdjacentHTML('beforeend', '<p>saved <b>excerpt</b></p>'); });
    expect(mutationAnchorWork(restored, [target], document.body)).toBe('retry');
  });

  it('detects removed images and replacement nodes even when the renderer has no connected target', () => {
    document.body.innerHTML = '<img src="https://example.test/a.png" alt="Figure A">';
    const target = imageTarget();
    const removed = changes(() => { target.image!.remove(); });
    expect(mutationAnchorWork(removed, [{ ...target, image: null }], document.body)).toBe('reanchor');
    const restored = changes(() => { document.body.append(target.image!.cloneNode(true)); });
    expect(mutationAnchorWork(restored, [{ ...target, image: null, detached: true }], document.body)).toBe('reanchor');
  });

  it('retains src, alt, duplicate identity and currentSrc load checks without reacting to a ticker', () => {
    document.body.innerHTML = '<aside>0</aside><img src="https://example.test/a.png" alt="Figure A">';
    const target = imageTarget();
    const ticker = changes(() => { document.querySelector('aside')!.textContent = '1'; });
    expect(mutationAnchorWork(ticker, [target], document.body)).toBeNull();
    const duplicate = changes(() => { document.body.append(target.image!.cloneNode(true)); });
    expect(mutationAnchorWork(duplicate, [target], document.body)).toBe('reanchor');
    document.querySelectorAll('img')[1]!.remove();
    const alt = changes(() => { target.image!.alt = 'Other'; });
    expect(mutationAnchorWork(alt, [target], document.body)).toBe('reanchor');
    target.image!.alt = 'Figure A';
    Object.defineProperty(target.image, 'currentSrc', { value: 'https://example.test/b.png' });
    expect(mutationAnchorWork([], [target], document.body, true)).toBe('reanchor');
  });

  it('shares one image index across an image-change check without caching later changes', () => {
    document.body.innerHTML = Array.from({ length: 30 }, (_, i) => `<img src="https://example.test/${i}.png" alt="Figure ${i}">`).join('');
    const targets: MutationAnchor[] = [...document.querySelectorAll('img')].map((image) => ({
      anchor: captureImageAnchor(image, document.body)!, detached: false, range: null, image,
    }));
    const queries = vi.spyOn(document.body, 'querySelectorAll');
    expect(mutationAnchorWork([], targets, document.body, true)).toBeNull();
    expect(queries.mock.calls.filter(([selector]) => selector === 'img')).toHaveLength(1);
    targets[29]!.image!.src = 'https://example.test/replaced.png';
    expect(mutationAnchorWork([], targets, document.body, true)).toBe('reanchor');
    expect(queries.mock.calls.filter(([selector]) => selector === 'img')).toHaveLength(2);
  });

});
