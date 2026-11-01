import { writeFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { BASE_URL, expect, selectText, test } from './extension';

const RIVALS = `${BASE_URL}/fixtures/competitor.html`;
const NESTED = `${BASE_URL}/fixtures/nested.html`;

async function setPlacement(panel: Page, placement: 'auto' | 'above' | 'below') {
  await panel.evaluate((placement) => chrome.runtime.sendMessage({ type: 'prefs:set-placement', placement }), placement);
}

async function sampleReveal(page: Page) {
  return page.evaluate(async () => {
    const node = document.querySelector('#probe-2')!.firstChild!;
    const at = node.textContent!.indexOf('a rival toolbar appear');
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + 'a rival toolbar appear'.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    const start = performance.now();
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const frames: { elapsed: number; visible: boolean; left: number; top: number; width: number; height: number; overlapsRival: boolean; transform: string }[] = [];
    await new Promise<void>((resolve) => {
      const sample = () => {
        const toolbar = document.getElementById('locus-host')!.shadowRoot!
          .querySelector<HTMLElement>('[data-locus-toolbar]')!;
        const rect = toolbar.getBoundingClientRect();
        const style = getComputedStyle(toolbar);
        const rivals = (window as unknown as { rivalBoxes(): DOMRect[] }).rivalBoxes();
        const elapsed = performance.now() - start;
        frames.push({ elapsed, visible: style.display !== 'none' && style.visibility !== 'hidden' &&
          Number(style.opacity) > 0.01 && rect.width > 0 && rect.height > 0,
        left: rect.left, top: rect.top, width: rect.width, height: rect.height,
        overlapsRival: rivals.some((rival) => Math.min(rect.right, rival.right) > Math.max(rect.left, rival.left) + 0.5 &&
          Math.min(rect.bottom, rival.bottom) > Math.max(rect.top, rival.top) + 0.5), transform: style.transform });
        if (elapsed >= 700) resolve();
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return frames;
  });
}

for (const mode of ['pointer-events', 'late']) {
  test(`E103: Auto first visible frame is already at the settled destination with ${mode} rival`, async ({
    context, serviceWorker, extensionId,
  }, testInfo) => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await setPlacement(panel, 'auto');
    const page = await context.newPage();
    await page.goto(`${RIVALS}?mode=${mode}`);
    await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
    const frames = await sampleReveal(page);
    await writeFile(testInfo.outputPath('visible-frames.json'), JSON.stringify(frames, null, 2));
    const visible = frames.filter((frame) => frame.visible);
    expect(visible.length).toBeGreaterThan(3);
    const first = visible[0]!;
    const settled = visible.at(-1)!;
    expect(visible.every((frame) => !frame.overlapsRival)).toBe(true);
    expect(Math.max(...visible.map((frame) => Math.hypot(frame.left - settled.left, frame.top - settled.top))))
      .toBeLessThanOrEqual(0.5);
    expect(visible.every((frame) => frame.transform === 'none')).toBe(true);
    expect(first.elapsed).toBeLessThan(600);
  });
}

test('E104: cancelled and replaced pending reveals never bring back a stale toolbar', async ({
  context, serviceWorker, extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await setPlacement(panel, 'auto');
  const page = await context.newPage();
  await page.goto(NESTED);
  const toolbar = page.locator('[data-locus-toolbar]');
  await selectText(page, '#probe-2', 'footnote marker');
  await page.waitForTimeout(60);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await expect(toolbar).toBeHidden();

  await selectText(page, '#probe-2', 'footnote marker');
  await page.waitForTimeout(60);
  await page.evaluate(() => getSelection()!.removeAllRanges());
  await page.waitForTimeout(400);
  await expect(toolbar).toBeHidden();

  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.body.style.minHeight = '1600px';
    document.querySelector<HTMLElement>('#probe-2')!.style.marginTop = '280px';
  });
  await selectText(page, '#probe-2', 'footnote marker');
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const target = document.querySelector('#probe-3')!;
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    setTimeout(() => scrollTo(0, 100), 80);
  });
  await expect(toolbar).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const rect = document.getElementById('locus-host')!.shadowRoot!
      .querySelector('[data-locus-toolbar]')!.getBoundingClientRect();
    const selection = getSelection()!.getRangeAt(0).getBoundingClientRect();
    return Math.min(Math.abs(rect.top - selection.bottom - 10), Math.abs(selection.top - rect.bottom - 10));
  })).toBeLessThan(0.5);
  await page.waitForTimeout(250);
  await expect(toolbar).toBeVisible();

  // Native selectionchange can run before the queued keyboard-selection task.
  // Cancelling A's preflight must not invalidate the legitimate task for B.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  await selectText(page, '#probe-2', 'footnote marker');
  await page.waitForTimeout(60);
  await expect(toolbar).toBeHidden();
  const keyboardRevealGap = await page.evaluate(async () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#probe-3')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
    const deadline = performance.now() + 900;
    return new Promise<number | null>((resolve) => {
      const sample = () => {
        const element = document.getElementById('locus-host')!.shadowRoot!
          .querySelector<HTMLElement>('[data-locus-toolbar]')!;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (rect.width > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0.01) {
          const selected = range.getBoundingClientRect();
          resolve(Math.min(Math.abs(rect.top - selected.bottom - 10), Math.abs(selected.top - rect.bottom - 10)));
        } else if (performance.now() >= deadline) resolve(null);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
  expect(keyboardRevealGap).not.toBeNull();
  expect(keyboardRevealGap!).toBeLessThan(0.5);
});

test('E105: fast colour shortcuts save text and images during Auto preflight without a late reveal', async ({
  context, serviceWorker, extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await setPlacement(panel, 'auto');
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'footnote marker');
  await page.waitForTimeout(60);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await page.keyboard.press('2');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');

  await page.goto(`${BASE_URL}/fixtures/images.html`);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNode(document.getElementById('figure-1')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(60);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await page.keyboard.press('1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-locus-toolbar]')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
});

test('E106: choosing an explicit side during Auto preflight reveals there without a later stale jump', async ({
  context, serviceWorker, extensionId,
}) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await setPlacement(panel, 'auto');
  const page = await context.newPage();
  await page.goto(NESTED);
  await selectText(page, '#probe-2', 'footnote marker');
  await page.waitForTimeout(60);
  const toolbar = page.locator('[data-locus-toolbar]');
  await expect(toolbar).toBeHidden();
  await setPlacement(panel, 'above');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveAttribute('data-placement', 'above');
  const before = await toolbar.boundingBox();
  await page.waitForTimeout(400);
  await expect(toolbar).toHaveAttribute('data-placement', 'above');
  const after = await toolbar.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 1);
  expect(after!.y).toBeCloseTo(before!.y, 1);
});
