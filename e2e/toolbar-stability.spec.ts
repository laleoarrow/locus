import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { BASE_URL, expect, test } from './extension';

interface Frame {
  elapsed: number;
  visible: boolean;
  left: number;
  top: number;
  gap: number;
  overlapsRival: boolean;
  overlapsSelection: boolean;
  transform: string;
}

async function sampleSelection(page: Page, selector: string, text: string): Promise<Frame[]> {
  return page.evaluate(async ({ selector, text }) => {
    const scope = document.querySelector(selector)!;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let selected: Range | undefined;
    while ((node = walker.nextNode())) {
      const at = node.textContent!.indexOf(text);
      if (at < 0) continue;
      selected = document.createRange();
      selected.setStart(node, at);
      selected.setEnd(node, at + text.length);
      break;
    }
    if (!selected) throw new Error(`Missing selection: ${text}`);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(selected);
    const start = performance.now();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const frames: Frame[] = [];
    await new Promise<void>((resolve) => {
      const sample = () => {
        const toolbar = document.getElementById('locus-host')!.shadowRoot!
          .querySelector<HTMLElement>('[data-locus-toolbar]')!;
        const rect = toolbar.getBoundingClientRect();
        const style = getComputedStyle(toolbar);
        const selection = selected!.getBoundingClientRect();
        const rivalBoxes = (window as unknown as { rivalBoxes?: () => DOMRect[] }).rivalBoxes;
        const bubble = document.getElementById('search-bubble');
        const rivals = rivalBoxes?.() ?? (bubble ? [bubble.getBoundingClientRect()] : []);
        const overlaps = (box: DOMRect): boolean => Math.min(rect.right, box.right) > Math.max(rect.left, box.left) + 0.5 &&
          Math.min(rect.bottom, box.bottom) > Math.max(rect.top, box.top) + 0.5;
        const elapsed = performance.now() - start;
        frames.push({ elapsed, visible: rect.width > 0 && rect.height > 0 && style.display !== 'none' &&
          style.visibility !== 'hidden' && Number(style.opacity) > 0.01,
        left: rect.left, top: rect.top,
        gap: Math.hypot(Math.max(selection.left - rect.right, rect.left - selection.right, 0),
          Math.max(selection.top - rect.bottom, rect.top - selection.bottom, 0)),
        overlapsRival: rivals.some(overlaps), overlapsSelection: overlaps(selection), transform: style.transform });
        if (elapsed >= 1100) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return frames;
  }, { selector, text });
}

function expectSettled(frames: Frame[]) {
  const visible = frames.filter((frame) => frame.visible);
  expect(visible.length).toBeGreaterThan(3);
  const final = visible.at(-1)!;
  expect(Math.max(...visible.map((frame) => Math.hypot(frame.left - final.left, frame.top - final.top))))
    .toBeLessThanOrEqual(0.5);
  expect(visible.every((frame) => !frame.overlapsRival && !frame.overlapsSelection)).toBe(true);
  expect(Math.max(...visible.map((frame) => frame.gap))).toBeLessThanOrEqual(32);
  expect(visible.every((frame) => frame.transform === 'none')).toBe(true);
  expect(visible[0]!.elapsed).toBeLessThan(850);
}

for (const mode of ['late&delay=350', 'entering', 'late-shadow-open', 'late-shadow-closed']) {
  test(`E107: Auto first reveal waits for ${mode} rival and remains close without a visible hop`, async ({
    context, serviceWorker, extensionId,
  }, testInfo) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement: 'auto' }));
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/fixtures/competitor.html?mode=${mode}`);
    await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
    const frames = await sampleSelection(page, '#probe-2', 'a rival toolbar appear');
    await writeFile(testInfo.outputPath('visible-frames.json'), JSON.stringify(frames, null, 2));
    await page.screenshot({ path: testInfo.outputPath('settled-toolbar.png') });
    expectSettled(frames);
  });
}

test('E108: every visible frame stays near a punctuation selection inside a tall dictionary card', async ({
  context, serviceWorker, extensionId,
}, testInfo) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement: 'auto' }));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(`${BASE_URL}/fixtures/dictionary.html`);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  const frames = await sampleSelection(page, '#phrase', '，');
  await writeFile(testInfo.outputPath('visible-frames.json'), JSON.stringify(frames, null, 2));
  await page.screenshot({ path: testInfo.outputPath('dictionary-toolbar.png') });
  expectSettled(frames);
});
