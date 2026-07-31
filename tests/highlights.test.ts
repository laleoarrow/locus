import { describe, expect, it } from 'vitest';
import { rangesOverlap } from '@/content/highlights';

function range(text: Text, start: number, end: number): Range {
  const result = document.createRange();
  result.setStart(text, start);
  result.setEnd(text, end);
  return result;
}

describe('highlight range overlap', () => {
  it('detects partial, contained, and exact overlap', () => {
    document.body.innerHTML = '<p>abcdefghij</p>';
    const text = document.querySelector('p')?.firstChild as Text;
    const annotation = range(text, 2, 6);

    expect(rangesOverlap(range(text, 0, 3), annotation)).toBe(true);
    expect(rangesOverlap(range(text, 3, 5), annotation)).toBe(true);
    expect(rangesOverlap(range(text, 1, 8), annotation)).toBe(true);
    expect(rangesOverlap(range(text, 2, 6), annotation)).toBe(true);
  });

  it('rejects disjoint, boundary-only, and collapsed ranges', () => {
    document.body.innerHTML = '<p>abcdefghij</p>';
    const text = document.querySelector('p')?.firstChild as Text;
    const annotation = range(text, 2, 6);

    expect(rangesOverlap(range(text, 0, 2), annotation)).toBe(false);
    expect(rangesOverlap(range(text, 6, 9), annotation)).toBe(false);
    expect(rangesOverlap(range(text, 8, 10), annotation)).toBe(false);
    expect(rangesOverlap(range(text, 4, 4), annotation)).toBe(false);
  });

  it('compares ranges across different nested text nodes', () => {
    document.body.innerHTML = '<p><span>abc</span><em>def</em></p>';
    const left = document.querySelector('span')?.firstChild as Text;
    const right = document.querySelector('em')?.firstChild as Text;
    const annotation = document.createRange();
    annotation.setStart(left, 1);
    annotation.setEnd(right, 2);

    expect(rangesOverlap(range(right, 0, 3), annotation)).toBe(true);
    expect(rangesOverlap(range(left, 0, 1), annotation)).toBe(false);
  });
});
