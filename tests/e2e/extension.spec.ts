import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import type { Backup, Note } from '../../src/shared/model.ts';

// Browser plugin is unavailable in the generation environment. These tests use
// genuine Chromium extension contexts, not mocked chrome.* APIs.
async function launchExtension(localHostAccess = false) {
  const directory = await mkdtemp(join(tmpdir(), 'page-notes-e2e-'));
  let extensionPath = resolve('dist');
  if (localHostAccess) {
    // Direct popup navigation does NOT grant activeTab. This isolated test copy
    // grants localhost access to exercise capture; it never enters dist or ZIPs.
    extensionPath = join(directory, 'extension');
    await cp(resolve('dist'), extensionPath, { recursive: true });
    const manifestPath = join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.host_permissions = ['http://127.0.0.1/*'];
    await writeFile(manifestPath, JSON.stringify(manifest));
  }
  const userDataDir = join(directory, 'profile');
  await mkdir(userDataDir);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      ...(executablePath ? { executablePath } : { channel: 'chromium' }),
      headless: true,
      viewport: { width: 1100, height: 800 },
      acceptDownloads: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const errors: string[] = [];
  function observe(page: Page) {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  }
  context.pages().forEach(observe);
  context.on('page', observe);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  return {
    context,
    extensionId,
    errors,
    cleanup: async () => {
      await context.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function note(page: string, text = 'A practical note'): Note {
  return {
    url: `https://example.com/${page}`,
    title: `Page ${page}`,
    text,
    quote: '',
    createdAt: 100,
    updatedAt: 200,
    revision: `backup-${page}`,
  };
}
function backup(notes: Note[]): Backup {
  return { format: 'page-notes', version: 1, exportedAt: '2026-01-01T00:00:00.000Z', notes };
}
async function openOptions(context: BrowserContext, id: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#import-file')).toBeEnabled();
  return page;
}
async function importBackup(page: Page, data: unknown, confirm = true): Promise<void> {
  // setInputFiles can dispatch change before startup finishes. Wait for the
  // storage handshake so the UI's busy guard does not discard the import.
  await expect(page.locator('#import-file')).toBeEnabled();
  await page.locator('#import-file').setInputFiles({
    name: 'notes.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  });
  if (confirm) {
    await expect(page.locator('#confirm-dialog')).toBeVisible();
    await page.locator('#confirm-action').click();
  }
}

test('packaged popup handles a restricted page and opens the working library', async () => {
  const extension = await launchExtension();
  try {
    const popup = await extension.context.newPage();
    await popup.goto(`chrome-extension://${extension.extensionId}/popup.html`);
    await expect(popup).toHaveTitle(/Page Notes/i);
    await expect(popup.locator('#save-note')).toBeDisabled();
    await expect(popup.locator('#capture-selection')).toBeDisabled();
    await expect(popup.locator('#status')).toHaveAttribute('role', 'alert');
    const opened = extension.context.waitForEvent('page');
    await popup.locator('#open-library').click();
    const options = await opened;
    await expect(options).toHaveURL(`chrome-extension://${extension.extensionId}/options.html`);
    await expect(options.locator('#search')).toBeVisible();
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('packaged extension imports, safely renders, searches, persists, and exports notes', async () => {
  const extension = await launchExtension();
  try {
    const options = await openOptions(extension.context, extension.extensionId);
    const html = '<img src=x onerror=alert(1)> Keep this as text.';
    await importBackup(options, backup([note('one', html), note('two', 'Research details')]));
    await expect(options.locator('#notes-list article')).toHaveCount(2);
    await expect(options.locator('#notes-list')).toContainText(html);
    await expect(options.locator('#notes-list img')).toHaveCount(0);
    await options.locator('#search').fill('Research');
    await expect(options.locator('#notes-list article')).toHaveCount(1);
    await expect(options.locator('#notes-list')).toContainText('Page two');
    await options.locator('#search').fill('');
    await options.reload();
    await expect(options.locator('#notes-list article')).toHaveCount(2);
    const downloaded = options.waitForEvent('download');
    await options.locator('#export-notes').click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const file = await download.path();
    expect(file).toBeTruthy();
    const exported = JSON.parse(await readFile(file!, 'utf8')) as Backup;
    expect(exported.format).toBe('page-notes');
    expect(exported.notes).toHaveLength(2);
    expect(exported.notes.some((item) => item.text === html)).toBe(true);
    await options.screenshot({
      path: test.info().outputPath('options-desktop.png'),
      fullPage: true,
    });
    await options.setViewportSize({ width: 390, height: 844 });
    expect(
      await options.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await options.screenshot({
      path: test.info().outputPath('options-mobile.png'),
      fullPage: true,
    });
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('packaged extension rejects an invalid import without changing saved notes', async () => {
  const extension = await launchExtension();
  try {
    const options = await openOptions(extension.context, extension.extensionId);
    await importBackup(options, backup([note('one')]));
    await expect(options.locator('#notes-list article')).toHaveCount(1);
    await importBackup(options, backup([{ ...note('unsafe'), url: 'javascript:alert(1)' }]), false);
    await expect(options.locator('#status')).toContainText(/HTTP|HTTPS|supported|invalid/i);
    await options.reload();
    await expect(options.locator('#notes-list article')).toHaveCount(1);
    await expect(options.locator('#notes-list')).toContainText('Page one');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('packaged extension confirms deletion and supports canceling clear-all', async () => {
  const extension = await launchExtension();
  try {
    const options = await openOptions(extension.context, extension.extensionId);
    await importBackup(options, backup([note('one'), note('two')]));
    await expect(options.locator('#notes-list article')).toHaveCount(2);
    await options
      .locator('#notes-list article')
      .filter({ hasText: 'Page one' })
      .getByRole('button', { name: /delete/i })
      .click();
    await expect(options.locator('#confirm-dialog')).toBeVisible();
    await options.locator('#confirm-action').click();
    await expect(options.locator('#notes-list article')).toHaveCount(1);
    await options.locator('#clear-notes').click();
    await expect(options.locator('#confirm-dialog')).toBeVisible();
    await options.locator('#cancel-action').click();
    await expect(options.locator('#notes-list article')).toHaveCount(1);
    await options.locator('#clear-notes').click();
    await options.locator('#confirm-action').click();
    await expect(options.locator('#notes-list article')).toHaveCount(0);
    await options.reload();
    await expect(options.locator('#notes-list article')).toHaveCount(0);
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('localhost-only test fixture captures selection and saves/edits a note through real Chrome APIs', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      '<!doctype html><html lang="en"><head><title>Local research page</title></head><body><h1>Research</h1><p id="selection">A useful selection for my note.</p></body></html>',
    );
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('The local fixture server did not start.');
  let extension: Awaited<ReturnType<typeof launchExtension>> | undefined;
  try {
    extension = await launchExtension(true);
    const source = await extension.context.newPage();
    const url = `http://127.0.0.1:${address.port}/article`;
    await source.goto(url);
    await source.locator('#selection').selectText();
    const popup = await extension.context.newPage();
    await source.bringToFront();
    // Background-tab navigation preserves the normal webpage as the active tab.
    await popup.goto(`chrome-extension://${extension.extensionId}/popup.html`);
    await expect(popup.locator('#page-title')).toHaveText('Local research page');
    await expect(popup.locator('#capture-selection')).toBeEnabled();
    await source.bringToFront();
    await popup.locator('#capture-selection').click();
    await expect(popup.locator('#quote')).toHaveText('A useful selection for my note.');
    await popup.locator('#note-text').fill('Check the source later.');
    await popup.locator('#save-note').click();
    await expect(popup.locator('#status')).toHaveText('Saved on this device.');
    await popup.screenshot({ path: test.info().outputPath('popup-saved.png'), fullPage: true });
    await source.bringToFront();
    const untrustedAccess = await popup.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (active?.id === undefined) throw new Error('Missing active fixture tab.');
      const result = await chrome.scripting.executeScript({
        target: { tabId: active.id, frameIds: [0] },
        world: 'ISOLATED',
        func: async () => {
          let storageReadable = false;
          try {
            await chrome.storage.local.get('pageNotesState');
            storageReadable = true;
          } catch {
            /* Protected storage is expected. */
          }
          const response = (await chrome.runtime.sendMessage({ type: 'state:get' })) as {
            ok: boolean;
          };
          return { storageReadable, privilegedMessageAccepted: response.ok };
        },
      });
      return result[0]?.result as { storageReadable: boolean; privilegedMessageAccepted: boolean };
    });
    expect(untrustedAccess).toEqual({ storageReadable: false, privilegedMessageAccepted: false });
    await popup.locator('#note-text').fill('Checked the source.');
    await popup.locator('#save-note').click();
    await expect(popup.locator('#status')).toHaveText('Saved on this device.');
    const options = await openOptions(extension.context, extension.extensionId);
    await expect(options.locator('#notes-list article')).toHaveCount(1);
    await expect(options.locator('#notes-list')).toContainText('Checked the source.');
    await expect(options.locator('#notes-list')).toContainText('A useful selection for my note.');
    expect(extension.errors).toEqual([]);
  } finally {
    if (extension) await extension.cleanup();
    await new Promise<void>((resolveClose, reject) =>
      server.close((error) => (error ? reject(error) : resolveClose())),
    );
  }
});
