import JSZip from 'jszip';
import type { Page, Worker } from '@playwright/test';
import { BASE_URL, expect, test } from './extension';

const PAGE_URL = `${BASE_URL}/fixtures/nested.html`;

async function openPanelFor(
  page: Page,
  worker: Worker,
  extensionId: string,
  url: string,
): Promise<Page> {
  const tabId = await worker.evaluate(async (tabUrl) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === tabUrl)?.id ?? null;
  }, url);
  const panel = await page.context().newPage();
  await panel.goto(
    `chrome-extension://${extensionId}/sidepanel.html?url=${encodeURIComponent(url)}&tabId=${tabId ?? ''}`,
  );
  return panel;
}

async function makePageNoteZip(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'webpage/page.json',
    JSON.stringify({
      version: 12,
      tables: {
        webpage: [
          {
            key: 'fixture-page',
            url: PAGE_URL,
            title: 'Fixture: nested text nodes',
            createAt: 100,
            updateAt: 200,
            deleted: false,
          },
        ],
      },
    }),
  );
  zip.file(
    'light/highlight.json',
    JSON.stringify({
      version: 12,
      tables: {
        light: [
          {
            key: 'fixture-highlight',
            webpageKey: 'fixture-page',
            url: PAGE_URL,
            text: 'Quotation blocks',
            suffix: ' add another level',
            bg: '#FFE534',
            noteKey: 'fixture-note',
            createAt: 120,
            updateAt: 140,
            deleted: false,
            lightType: 'light',
          },
        ],
      },
    }),
  );
  zip.file(
    'note.json',
    JSON.stringify({
      version: 12,
      tables: {
        note: [
          {
            key: 'fixture-note',
            markdown: '**Imported PageNote note**',
            createAt: 120,
            updateAt: 140,
            deleted: false,
          },
        ],
      },
    }),
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('E27: PageNote ZIP imports through the panel and is idempotent', async ({
  context,
  serviceWorker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.locator('html[data-locus-anchored]').waitFor({ state: 'attached' });
  const panel = await openPanelFor(page, serviceWorker, extensionId, PAGE_URL);
  const archive = {
    name: 'manual.v10.pagenote.zip',
    mimeType: 'application/zip',
    buffer: await makePageNoteZip(),
  };

  await panel.locator('input[data-locus-import-input]').setInputFiles(archive);
  await expect(panel.locator('[data-locus-backup-status]')).toContainText('1 added');
  await expect(panel.locator('[data-locus-backup-status]')).toContainText(
    'PageNote source: 1 highlights, 1 with notes',
  );
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
  await expect(panel.locator('.annotation-exact')).toHaveText('Quotation blocks');
  await expect(panel.locator('.annotation-comment strong')).toHaveText(
    'Imported PageNote note',
  );

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-locus-anchored', '1');
  await expect(page.locator('html')).toHaveAttribute('data-locus-detached', '0');

  await panel.locator('input[data-locus-import-input]').setInputFiles(archive);
  await expect(panel.locator('[data-locus-backup-status]')).toContainText('0 added');
  await expect(panel.locator('.annotation-item')).toHaveCount(1);
});
