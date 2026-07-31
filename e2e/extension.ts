import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chromium,
  expect as baseExpect,
  test as base,
  type BrowserContext,
  type Page,
  type Worker,
} from '@playwright/test';

export const EXTENSION_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../.output/chrome-mv3-e2e',
);

/** Launch a second, fully independent install — used to test device-to-device sync. */
export async function launchSeparateProfile(): Promise<{
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await expectPoll(async () => {
    const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    return scripts.length > 0;
  });
  return { context, worker, extensionId: new URL(worker.url()).host };
}

export const BASE_URL = 'http://localhost:8137';

interface ExtensionFixtures {
  context: BrowserContext;
  serviceWorker: Worker;
  extensionId: string;
}

/**
 * Loads the `--mode e2e` build (localhost pre-granted, see wxt.config.ts) in
 * a throwaway profile per test, and waits until the background has registered
 * the dynamic content script for the granted origins.
 */
export const test = base.extend<ExtensionFixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent('serviceworker');
    // Registration is derived from granted permissions on install; wait for it.
    await expectPoll(async () => {
      const scripts = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
      return scripts.length > 0;
    });
    await use(worker);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
});

export const expect = test.expect;

async function expectPoll(fn: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Select `text` (first occurrence inside `selector`) and fire mouseup so the toolbar shows. */
export async function selectText(page: Page, selector: string, text: string): Promise<void> {
  // The anchored attribute appears once bootstrap finished and listeners are
  // wired; selecting earlier would race the content script's init.
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await page.evaluate(
    ({ selector, text }) => {
      const scope = document.querySelector(selector);
      if (!scope) throw new Error(`no element for ${selector}`);
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        const at = data.indexOf(text);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const selection = getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      throw new Error(`text not found: ${text}`);
    },
    { selector, text },
  );
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
}

/** Select all text inside `selector`, optionally focusing it as the keyboard event target. */
export async function selectContents(
  page: Page,
  selector: string,
  focusTarget = false,
): Promise<void> {
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  await page.evaluate(
    ({ selector, focusTarget }) => {
      const scope = document.querySelector<HTMLElement>(selector);
      if (!scope) throw new Error(`no element for ${selector}`);
      if (focusTarget) {
        scope.tabIndex = -1;
        scope.focus();
      }
      const range = document.createRange();
      range.selectNodeContents(scope);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { selector, focusTarget },
  );
}

/**
 * Create a highlight over `text` using the floating toolbar, and wait until it
 * is actually persisted. Without the wait, a follow-up action can race the
 * create round-trip (e.g. reading the remembered last-used colour before the
 * content script has been told about it).
 */
export async function highlight(page: Page, selector: string, text: string, color = 'yellow'): Promise<void> {
  const before = Number((await page.locator('html').getAttribute('data-locus-anchored')) ?? '0');
  await selectText(page, selector, text);
  await page.locator(`[data-locus-toolbar] .swatch[data-color="${color}"]`).click();
  await baseExpect
    .poll(
      async () => Number((await page.locator('html').getAttribute('data-locus-anchored')) ?? '0'),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(before);
}

/** Real mouse click on the middle of `text` inside `selector` (hits highlights). */
export async function clickText(page: Page, selector: string, text: string): Promise<void> {
  const point = await page.evaluate(
    ({ selector, text }) => {
      const scope = document.querySelector(selector);
      if (!scope) throw new Error(`no element for ${selector}`);
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const data = (node as Text).data;
        const at = data.indexOf(text);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      throw new Error(`text not found: ${text}`);
    },
    { selector, text },
  );
  await page.mouse.click(point.x, point.y);
}

/** Read an annotation row straight from the extension-origin IndexedDB. */
export async function readAnnotationRow(
  extensionPage: Page,
  id: string,
): Promise<{ id: string; deletedAt: number } | undefined> {
  return extensionPage.evaluate(
    (annotationId) =>
      new Promise<{ id: string; deletedAt: number } | undefined>((resolve, reject) => {
        const open = indexedDB.open('locus');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction('annotations').objectStore('annotations').get(annotationId);
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            db.close();
            resolve(get.result as { id: string; deletedAt: number } | undefined);
          };
        };
      }),
    id,
  );
}
