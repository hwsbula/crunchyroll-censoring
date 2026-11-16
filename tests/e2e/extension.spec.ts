import { test, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RoutedPlayer } from '../../src/shared/protocol.ts';
import type { SavedState } from '../../src/core/types.ts';
import { BUILTINS } from '../../src/core/terms.ts';
import { syncBundle, SYNC_HEAD } from '../../src/shared/settings-sync.ts';
import { DEFAULT_SETTINGS } from '../../src/core/settings.ts';
import { settingsBackup } from '../../src/core/backup.ts';

// Browser plugin not available. These tests load the actual unpacked MV3 bundle
// in Chromium. Host responses are intercepted synthetic fixtures, not live CR.
const fixtureRoot = resolve('tests/fixtures');
const html = await readFile(join(fixtureRoot, 'player.html'), 'utf8');
const script = await readFile(join(fixtureRoot, 'player.js'), 'utf8');
const ass = await readFile(join(fixtureRoot, 'english.ass'), 'utf8');
const vtt = await readFile(join(fixtureRoot, 'english.vtt'), 'utf8');
const bitmovinHtml = await readFile(join(fixtureRoot, 'bitmovin.html'), 'utf8');
const bitmovinScript = await readFile(join(fixtureRoot, 'bitmovin.js'), 'utf8');
const frameParent =
  '<!doctype html><title>Frame fixture</title><script src="/fixture-parent.js" defer></script><h1>Cross-origin player fixture</h1><button id="prime">Load parent metadata</button><button id="replace">Replace player frame</button><p id="ready">Not loaded</p><iframe title="Synthetic Vilos frame" src="https://static.crunchyroll.com/vilos-v2/web/vilos/player.html" width="1000" height="720"></iframe>';
const frameParentScript = `document.querySelector('#prime').onclick=async()=>{await fetch('/content/v2/cms/objects/TESTEN?fixture=english');await fetch('/playback/v4/TESTEN/web/chrome/play?fixture=english');document.querySelector('#ready').textContent='Metadata ready';};document.querySelector('#replace').onclick=()=>{const frame=document.querySelector('iframe');const next=frame.cloneNode();frame.replaceWith(next);};`;
async function launch(profile?: string) {
  const directory = profile ?? (await mkdtemp(join(tmpdir(), 'quietroll-e2e-')));
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const context = await chromium.launchPersistentContext(join(directory, 'profile'), {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    headless: true,
    viewport: { width: 1100, height: 850 },
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`],
  });
  const errors: string[] = [];
  const observe = (page: Page): void => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  };
  context.pages().forEach(observe);
  context.on('page', observe);
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  await context.route('https://www.crunchyroll.com/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/watch/FRAME/synthetic-fixture')
      return route.fulfill({ contentType: 'text/html', body: frameParent });
    if (url.pathname === '/fixture-parent.js')
      return route.fulfill({ contentType: 'text/javascript', body: frameParentScript });
    if (url.pathname.startsWith('/watch/DOM'))
      return route.fulfill({ contentType: 'text/html', body: bitmovinHtml });
    if (url.pathname.startsWith('/watch/'))
      return route.fulfill({ contentType: 'text/html', body: html });
    if (url.pathname === '/fixture-player.js')
      return route.fulfill({ contentType: 'text/javascript', body: script });
    if (url.pathname === '/fixture-bitmovin.js')
      return route.fulfill({ contentType: 'text/javascript', body: bitmovinScript });
    // Deliberately identical text in both language tracks: language metadata,
    // never an English-looking phrase, must decide whether text is filtered.
    if (url.pathname === '/fixture.vtt' || url.pathname === '/spanish.vtt')
      return route.fulfill({ contentType: 'text/vtt', body: vtt });
    if (url.pathname === '/fixture.ass')
      return route.fulfill({ contentType: 'text/plain', body: ass });
    if (url.pathname === '/spanish.ass')
      return route.fulfill({
        contentType: 'text/plain',
        body: ass.replace('That damn class is full of shit!', 'Un damn de prueba en español.'),
      });
    if (url.pathname.startsWith('/content/v2/cms/objects/')) {
      const mode = url.searchParams.get('fixture');
      const version = url.pathname.split('/').at(-1)!;
      return route.fulfill({
        json: {
          data: [
            {
              id: version,
              episode_metadata: {
                ...(mode === 'unknown'
                  ? {}
                  : { audio_locale: mode === 'japanese' ? 'ja-JP' : 'en-US' }),
              },
            },
          ],
        },
      });
    }
    if (url.pathname.startsWith('/playback/v4/')) {
      const fixtureMode = url.searchParams.get('fixture') ?? '';
      const dom = fixtureMode.startsWith('dom-');
      const mode = fixtureMode.replace(/^dom-/, '');
      const track = {
        language: 'en-US',
        format: dom ? 'vtt' : 'ass',
        url: dom
          ? 'https://www.crunchyroll.com/fixture.vtt'
          : 'https://www.crunchyroll.com/fixture.ass?signature=synthetic-only',
      };
      return route.fulfill({
        json: {
          captions: mode === 'missing' || mode === 'japanese' ? {} : { 'en-US': track },
          subtitles: {
            ...(mode === 'missing' || mode === 'japanese' ? { 'en-US': track } : {}),
            'es-ES': {
              language: 'es-ES',
              format: dom ? 'vtt' : 'ass',
              url: dom
                ? 'https://www.crunchyroll.com/spanish.vtt'
                : 'https://www.crunchyroll.com/spanish.ass',
            },
          },
        },
      });
    }
    return route.fulfill({ status: 404, body: 'fixture resource not found' });
  });
  await context.route('https://static.crunchyroll.com/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: html.replace(
        'src="/fixture-player.js"',
        'src="https://www.crunchyroll.com/fixture-player.js"',
      ),
    }),
  );
  return {
    context,
    worker,
    id,
    errors,
    directory,
    cleanup: async (remove = true) => {
      await context.close();
      if (remove) await rm(directory, { recursive: true, force: true });
    },
  };
}
async function activeTab(worker: Worker, page: Page): Promise<number> {
  const url = page.url();
  const tabId = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    const tab = tabs[0];
    if (tab?.id === undefined) throw new Error('Missing fixture tab.');
    await chrome.tabs.update(tab.id, { active: true });
    return tab.id;
  }, url);
  return tabId;
}
async function openPopup(
  context: BrowserContext,
  worker: Worker,
  id: string,
  fixture?: Page,
): Promise<Page> {
  const popup = await context.newPage();
  // A directly opened popup isn't a toolbar gesture. This extension has no
  // activeTab dependency; focus the episode before its first async handshake.
  if (fixture) await activeTab(worker, fixture);
  await popup.goto(`chrome-extension://${id}/popup.html`);
  if (fixture) await activeTab(worker, fixture);
  await expect(popup.locator('#enabled')).toBeEnabled();
  return popup;
}
async function readPlayer(popup: Page): Promise<RoutedPlayer> {
  return popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const response = (await chrome.runtime.sendMessage({ type: 'player:get', tabId: tab?.id })) as {
      ok: boolean;
      data: RoutedPlayer;
      error?: string;
    };
    if (!response.ok) throw new Error(response.error);
    return response.data;
  });
}
async function start(
  context: BrowserContext,
  mode = 'english',
  episode = 'FIXTURE',
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`https://www.crunchyroll.com/watch/${episode}/synthetic-fixture`);
  await page
    .getByRole('button', {
      name:
        mode === 'english'
          ? 'English audio + CC'
          : mode === 'japanese'
            ? 'Japanese audio + English subtitles'
            : mode,
      exact: true,
    })
    .click();
  await expect(page.locator('#fixture-state')).toContainText('Ready:');
  return page;
}
async function startOverlay(context: BrowserContext, mode = 'english', query = ''): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`https://www.crunchyroll.com/watch/DOMPLAYER/synthetic-fixture${query}`);
  await page.locator(mode === 'japanese' ? '#japanese' : '#english').click();
  await expect(page.locator('#fixture-state')).toHaveText(`Ready: ${mode}`);
  await media(page, 1);
  return page;
}
async function media(page: Page, time: number, play = false): Promise<void> {
  await page.locator('video').evaluate(
    async (element: HTMLVideoElement, args) => {
      element.pause();
      element.currentTime = args.time;
      if (args.play) await element.play();
    },
    { time, play },
  );
}

test('unpacked popup has truthful empty states; settings persist through popup and browser restart', async () => {
  let extension = await launch();
  const directory = extension.directory;
  try {
    const popup = await openPopup(extension.context, extension.worker, extension.id);
    await expect(popup).toHaveTitle('CrunchyRoll Censoring');
    await expect(popup.locator('#status')).toContainText(/active Crunchyroll|No active|accessible/);
    await expect(popup.locator('#audio-reason')).toContainText('Audio filtering unavailable');
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(options.locator('#save')).toBeEnabled();
    await options.locator('#custom').fill('space wizard\n  SPACE   WIZARD\nliteral.*term');
    await options.getByLabel('hell', { exact: true }).uncheck();
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    await expect(options.locator('#custom')).toHaveValue('space wizard\nliteral.*term');
    await options.locator('#before').focus();
    await options.keyboard.press('Tab');
    await expect(options.locator('#after')).toBeFocused();
    await options.screenshot({ path: '/tmp/quietroll-options-desktop.png', fullPage: true });
    await options.setViewportSize({ width: 390, height: 844 });
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await options.screenshot({ path: '/tmp/quietroll-options-narrow.png', fullPage: true });
    expect(extension.errors).toEqual([]);
    await extension.cleanup(false);
    extension = await launch(directory);
    const reopened = await extension.context.newPage();
    await reopened.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(reopened.locator('#custom')).toHaveValue('space wizard\nliteral.*term');
    await expect(reopened.getByLabel('hell', { exact: true })).not.toBeChecked();
  } finally {
    await extension.cleanup();
  }
});

test('expanded term settings search, keyboard, all-category disabling and legacy data persist', async () => {
  let extension = await launch();
  const directory = extension.directory;
  const exception = `${'a'.repeat(64)}.${'b'.repeat(64)}.0.4.${'c'.repeat(64)}`;
  try {
    await extension.worker.evaluate(async (exception) => {
      await chrome.storage.local.set({
        'quietroll.v1': {
          version: 1,
          revision: 4,
          settings: {
            enabled: true,
            mode: 'auto',
            reveal: false,
            beforeMs: 80,
            afterMs: 100,
            custom: ['space wizard'],
            disabledBuiltins: ['hell'],
          },
          exceptions: [exception],
        },
      });
    }, exception);
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(options.locator('#save')).toBeEnabled();
    await expect(options.getByLabel('hell', { exact: true })).not.toBeChecked();
    await expect(options.getByLabel('idiot', { exact: true })).toBeChecked();
    await expect(options.locator('#custom')).toHaveValue('space wizard');
    await options.getByLabel('Search built-in terms', { exact: true }).fill('MASTURBAT');
    await expect(options.locator('.term-group:visible')).toHaveCount(1);
    await expect(options.getByLabel('masturbation', { exact: true })).toBeVisible();
    await options.locator('#term-search').focus();
    await options.keyboard.press('Tab');
    await expect(
      options.getByRole('button', {
        name: 'Enable category: Sexual acts and explicit content',
        exact: true,
      }),
    ).toBeFocused();
    await options
      .getByRole('button', {
        name: 'Disable category: Sexual acts and explicit content',
        exact: true,
      })
      .click();
    await options.locator('#term-search').fill('vibrator');
    await expect(options.getByLabel('vibrator', { exact: true })).not.toBeChecked();
    await options.locator('#term-search').fill('no such built-in term');
    await expect(options.locator('#term-empty')).toBeVisible();
    await options.locator('#term-search').fill('');
    await expect(options.locator('.term-group:visible')).toHaveCount(6);
    for (const button of await options.getByRole('button', { name: /^Disable category:/ }).all())
      await button.click();
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    await expect(options.locator('#term-count')).toContainText('0 enabled');
    await expect(options.locator('#exception-count')).toContainText('1 saved');
    const saved = (await extension.worker.evaluate(
      async () => (await chrome.storage.local.get('quietroll.v1'))['quietroll.v1'],
    )) as SavedState;
    expect(saved.settings.disabledBuiltins).toHaveLength(BUILTINS.length);
    expect(saved.exceptions).toEqual([exception]);
    await options.setViewportSize({ width: 390, height: 844 });
    await options.locator('#term-search').fill('dick');
    expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await options.screenshot({ path: '/tmp/crunchyroll-expanded-terms.png', fullPage: true });
    expect(extension.errors).toEqual([]);
    await extension.cleanup(false);
    extension = await launch(directory);
    const reopened = await extension.context.newPage();
    await reopened.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(reopened.locator('#term-count')).toContainText('0 enabled');
    await expect(reopened.locator('#custom')).toHaveValue('space wizard');
    await expect(reopened.locator('#exception-count')).toContainText('1 saved');
  } finally {
    await extension.cleanup();
  }
});

test('expanded dialogue filters English audio and captions, preserves Japanese audio, and category edits restore text', async () => {
  const extension = await launch();
  try {
    const source = ass.replace(
      'That damn class is full of shit!',
      'You stupid pervert! Stop staring at her breasts.',
    );
    await extension.context.route('https://www.crunchyroll.com/fixture.ass*', (route) =>
      route.fulfill({ contentType: 'text/plain', body: source }),
    );
    const page = await start(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await media(page, 1, true);
    await expect(page.locator('#fixture-caption')).toHaveText(
      'You **** ****! Stop staring at her ****.',
    );
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(true);
    await media(page, 1);
    for (let n = 0; n < 3; n++) await popup.locator('.ignore').nth(n).click();
    await media(page, 1, true);
    await expect(page.locator('#fixture-caption')).toHaveText(
      'You stupid pervert! Stop staring at her breasts.',
    );
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(false);
    await page
      .getByRole('button', { name: 'Japanese audio + English subtitles', exact: true })
      .click();
    await expect(page.locator('#fixture-state')).toHaveText('Ready: japanese');
    await media(page, 1, true);
    await expect(page.locator('#fixture-caption')).toHaveText(
      'You **** ****! Stop staring at her ****.',
    );
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await media(page, 1);
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(options.locator('#save')).toBeEnabled();
    await options
      .getByRole('button', { name: 'Disable category: Insults and name-calling', exact: true })
      .click();
    await options
      .getByRole('button', { name: 'Disable category: Sexual anatomy and slang', exact: true })
      .click();
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    await expect(page.locator('#fixture-caption')).toHaveText(
      'You stupid pervert! Stop staring at her breasts.',
    );
    await options
      .getByRole('button', { name: 'Enable category: Insults and name-calling', exact: true })
      .click();
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    await expect(page.locator('#fixture-caption')).toHaveText(
      'You **** ****! Stop staring at her breasts.',
    );
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('settings backup downloads, previews, cancels and imports across profiles without changing exceptions', async () => {
  const a = await launch();
  const b = await launch();
  try {
    const options = await a.context.newPage();
    await options.goto(`chrome-extension://${a.id}/options.html`);
    await expect(options.locator('#save')).toBeEnabled();
    await options.locator('#custom').fill('space wizard\nliteral.*term');
    await options.getByLabel('hell', { exact: true }).uncheck();
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    const downloadPromise = options.waitForEvent('download');
    await options.locator('#export-settings').click();
    const download = await downloadPromise;
    const text = await readFile((await download.path())!, 'utf8');
    expect(JSON.parse(text).settings.custom).toEqual(['space wizard', 'literal.*term']);
    expect(text).not.toContain('exceptions');
    const other = await b.context.newPage();
    await other.goto(`chrome-extension://${b.id}/options.html`);
    await expect(other.locator('#save')).toBeEnabled();
    const localException = `${'a'.repeat(64)}.${'b'.repeat(64)}.0.4.${'c'.repeat(64)}`;
    await b.worker.evaluate(async (id) => {
      await chrome.storage.local.set({
        'quietroll.v1': {
          version: 1,
          revision: 0,
          settings: {
            enabled: true,
            mode: 'auto',
            reveal: false,
            beforeMs: 80,
            afterMs: 100,
            custom: [],
            disabledBuiltins: [],
          },
          exceptions: [id],
        },
      });
    }, localException);
    await other.locator('#import-settings').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(other.locator('#import-summary')).toContainText('2 custom terms');
    await other.locator('#import-cancel').click();
    await expect(other.locator('#custom')).toHaveValue('');
    await other.locator('#import-settings').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await other.locator('#import-confirm').click();
    await expect(other.locator('#status')).toContainText('Settings imported');
    await expect(other.locator('#custom')).toHaveValue('space wizard\nliteral.*term');
    await expect(other.getByLabel('hell', { exact: true })).not.toBeChecked();
    expect(
      await b.worker.evaluate(
        async () => (await chrome.storage.local.get('quietroll.v1'))['quietroll.v1'],
      ),
    ).toMatchObject({ exceptions: [localException] });
    await other.locator('#import-settings').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"format":"wrong"}'),
    });
    await expect(other.locator('#status')).toContainText('Unsupported settings backup');
    await expect(other.locator('#custom')).toHaveValue('space wizard\nliteral.*term');
    await other.locator('#sync-enabled').focus();
    await other.keyboard.press('Tab');
    await expect(other.locator('#sync-retry')).toBeFocused();
    await other.setViewportSize({ width: 390, height: 844 });
    expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await other.screenshot({ path: '/tmp/crunchyroll-sync-narrow.png', fullPage: true });
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
});

test('native Chrome Sync changes wait for complete chunks, update active filtering and reject stale form saves', async () => {
  const extension = await launch();
  try {
    const page = await start(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await media(page, 1);
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(options.locator('#save')).toBeEnabled();
    const initial = (await extension.worker.evaluate(
      async () => (await chrome.storage.local.get('quietroll.v1'))['quietroll.v1'],
    )) as SavedState | undefined;
    const bundle = await syncBundle({
      ...DEFAULT_SETTINGS,
      enabled: false,
      custom: ['from another device'],
      disabledBuiltins: [...BUILTINS],
    });
    // Simulated transport between profiles, using the real Chrome Sync storage API.
    await extension.worker.evaluate(
      async (head) => {
        await chrome.storage.sync.set(head);
      },
      { [SYNC_HEAD]: bundle.head },
    );
    await expect(options.locator('#sync-status')).toContainText('Waiting for the complete');
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await extension.worker.evaluate(async (chunks) => {
      await chrome.storage.sync.set(chunks);
    }, bundle.items);
    await expect(popup.locator('#audio-phase')).toHaveText('disabled');
    await expect(page.locator('#fixture-caption')).toHaveText('That damn class is full of shit!');
    await options.locator('#custom').fill('stale draft');
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('changed in another window');
    await expect(options.locator('#custom')).toHaveValue('stale draft');
    await options.locator('#reload').click();
    await expect(options.locator('#custom')).toHaveValue('from another device');
    const current = (await extension.worker.evaluate(
      async () => (await chrome.storage.local.get('quietroll.v1'))['quietroll.v1'],
    )) as SavedState;
    expect(current.revision).toBeGreaterThan(initial?.revision ?? 0);
    await options.locator('#sync-clear').click();
    await options.locator('#sync-confirm-no').click();
    expect(
      await extension.worker.evaluate(
        async (key) => (await chrome.storage.sync.get(key))[key] !== undefined,
        SYNC_HEAD,
      ),
    ).toBe(true);
    await options.locator('#sync-clear').click();
    await options.locator('#sync-confirm-yes').click();
    await expect(options.locator('#sync-enabled')).not.toBeChecked();
    expect(
      await extension.worker.evaluate(
        async (key) => (await chrome.storage.sync.get(key))[key],
        SYNC_HEAD,
      ),
    ).toBeUndefined();
    await options.locator('#sync-enabled').check();
    await extension.worker.evaluate(
      async (data) => {
        await chrome.storage.sync.set(data);
      },
      { [SYNC_HEAD]: bundle.head },
    );
    await expect(options.locator('#sync-status')).toContainText('Waiting for the complete');
    await options.locator('#custom').fill('keep this unsaved draft');
    await options.locator('#sync-remote').click();
    await options.locator('#sync-confirm-yes').click();
    await expect(options.locator('#sync-status')).toContainText('Waiting for the complete');
    await expect(options.locator('#custom')).toHaveValue('keep this unsaved draft');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Web Store screenshots show actual settings and legacy sync conflicts require a choice', async () => {
  const extension = await launch();
  try {
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(options.locator('#save')).toBeEnabled();
    await options.setViewportSize({ width: 1280, height: 800 });
    await expect(options).toHaveTitle('CrunchyRoll Censoring — Term settings');
    await expect(options.locator('#sync-status')).not.toContainText('Checking');
    await options.screenshot({
      path: '/tmp/crunchyroll-store-sync.jpg',
      type: 'jpeg',
      quality: 95,
    });
    await options.locator('#term-search').fill('hell');
    await options
      .getByRole('heading', { name: 'Built-in terms', exact: true })
      .evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await options.screenshot({
      path: '/tmp/crunchyroll-store-terms.jpg',
      type: 'jpeg',
      quality: 95,
    });
    const backup = settingsBackup({ ...DEFAULT_SETTINGS, custom: ['saved on this device'] });
    await options.locator('#import-settings').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(backup),
    });
    await options.locator('#import-confirm').click();
    await expect(options.locator('#status')).toContainText('Settings imported');
    await options.locator('#sync-enabled').uncheck();
    await expect(options.locator('#sync-status')).toContainText('Sync is off');
    await options.locator('#custom').fill('offline local change');
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    const remote = await syncBundle({ ...DEFAULT_SETTINGS, custom: ['other device profile'] });
    await extension.worker.evaluate(
      async (data) => {
        await chrome.storage.sync.set(data);
      },
      { ...remote.items, [SYNC_HEAD]: remote.head },
    );
    await options.locator('#sync-enabled').check();
    await expect(options.locator('#sync-status')).toContainText('different preferences');
    await expect(options.locator('#custom')).toHaveValue('offline local change');
    await options.locator('#sync-remote').click();
    await options.locator('#sync-confirm-no').click();
    await expect(options.locator('#custom')).toHaveValue('offline local change');
    await options.locator('#sync-remote').click();
    await options.locator('#sync-confirm-yes').click();
    await expect(options.locator('#custom')).toHaveValue('other device profile');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Bitmovin overlay: verified English CC, no painted flashes, Ignore/Unignore and original restoration', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(page.locator('#menu-reads')).toHaveText('1');
    await expect(page.locator('#manual-menus')).toHaveText('0');
    await expect(page.locator('[data-testid="track-selection-button"]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(popup.locator('#subtitle-language')).toHaveText('en-US');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await expect(captions.locator('b')).toHaveCount(1);
    await expect(captions.locator('i')).toHaveCount(1);
    await expect(page.locator('#unrelated')).toHaveText(
      'Unrelated damn title and shit description remain unchanged.',
    );
    const painted = await page.evaluate(async () => {
      const samples: string[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push(document.querySelector('.bitmovinplayer-container ul')!.textContent!);
      }
      return samples;
    });
    expect(painted).toHaveLength(30);
    expect(painted.every((text) => text === 'That **** class is full of ****!')).toBe(true);
    await expect(popup.locator('.playback-state').first()).toContainText('Censored');
    await popup.locator('.ignore').nth(0).click();
    await expect(captions).toHaveText('That damn class is full of ****!');
    await media(page, 1, true);
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(true);
    await media(page, 1);
    await popup.locator('.ignore').nth(1).click();
    await expect(captions).toHaveText('That damn class is full of shit!');
    await media(page, 1, true);
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(false);
    await media(page, 1);
    await popup.locator('.ignore').nth(0).click();
    await expect(captions).toHaveText('That **** class is full of shit!');
    await popup.locator('#enabled').uncheck();
    await expect(captions).toHaveText('That damn class is full of shit!');
    await expect(popup.locator('#subtitle-phase')).toHaveText('disabled');
    await popup.locator('#enabled').check();
    await expect(captions).toHaveText('That **** class is full of shit!');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Bitmovin overlay: exact displayed cue identity survives renderer timing differences without shifting audio', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context, 'english', '?caption-delay=2.5');
    await media(page, 3.5);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(popup.locator('#subtitle-reason')).toContainText('timing differs');
    const samples = await page.evaluate(async () => {
      const values: string[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        values.push(document.querySelector('.bitmovinplayer-container ul')!.textContent!);
      }
      return values;
    });
    expect(samples.every((value) => value === 'That **** class is full of ****!')).toBe(true);
    const rows = (await readPlayer(popup)).snapshot.occurrences;
    expect(rows.slice(0, 2).every((row) => row.textCensored && !row.audioCensored)).toBe(true);
    expect(rows[2]!.textCensored).toBe(false);
    // Ignore remains tied to the source cue, despite a different media clock.
    await popup.locator('.ignore').nth(0).click();
    await expect(captions).toHaveText('That damn class is full of ****!');
    await popup.locator('.ignore').nth(0).click();
    await expect(captions).toHaveText('That **** class is full of ****!');
    await popup.locator('#enabled').uncheck();
    await expect(captions).toHaveText('That damn class is full of shit!');
    await popup.locator('#enabled').check();
    await expect(captions).toHaveText('That **** class is full of ****!');
    await media(page, 4, true);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await media(page, 4);
    await page.screenshot({ path: '/tmp/crunchyroll-caption-timing.png' });
    await page.locator('#japanese').click();
    await expect(page.locator('#fixture-state')).toHaveText('Ready: japanese');
    await media(page, 3.5);
    await expect(captions).toHaveText('That **** class is full of ****!');
    await expect(popup.locator('#audio-phase')).toHaveText('disabled');
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await page.getByRole('button', { name: 'Audio and subtitle language options' }).click();
    await page
      .getByRole('menu', { name: 'Subtitle and closed caption selection' })
      .getByRole('menuitemradio', { name: 'Spanish', exact: true })
      .click();
    await expect(popup.locator('#subtitle-phase')).toHaveText('disabled');
    await expect(captions).toHaveText('That damn class is full of shit!');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Bitmovin overlay: timing drift never borrows a repeated cue exception, including layer replacement', async () => {
  const extension = await launch();
  try {
    await extension.context.route('https://www.crunchyroll.com/fixture.vtt', (route) =>
      route.fulfill({
        contentType: 'text/vtt',
        body: `${vtt}\nthree\n00:00:05.000 --> 00:00:06.500\nWhat the hell?\nWatch your step.\n`,
      }),
    );
    const page = await startOverlay(extension.context, 'english', '?caption-delay=2.5');
    await media(page, 3.5);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await expect(popup.locator('#occurrences li')).toHaveCount(4);
    await popup.locator('.ignore').nth(3).click();
    // At media time 5 the renderer displays source time 2.5, not source time 5.
    // Identical text cannot establish which of those occurrence IDs is showing.
    await media(page, 5);
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(popup.locator('#subtitle-reason')).toContainText('multiple cue identities');
    await expect(captions).toHaveText('What the hell?\nWatch your step.');
    await page.locator('#replace-layer').click();
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    const rows = (await readPlayer(popup)).snapshot.occurrences;
    expect(rows.slice(2).every((row) => !row.textCensored)).toBe(true);
    expect(rows[2]!.ignored).toBe(false);
    expect(rows[3]!.ignored).toBe(true);
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Bitmovin overlay: Japanese audio, keyboard track selection, non-English originals and fullscreen', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context, 'japanese');
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    const toggle = page.getByRole('button', { name: 'Audio and subtitle language options' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(popup.locator('#audio-phase')).toHaveText('disabled');
    await popup.locator('#mode').selectOption('english');
    await media(page, 1, true);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await media(page, 1);
    const tracks = page.getByRole('menu', { name: 'Subtitle and closed caption selection' });
    await tracks.getByRole('menuitemradio', { name: 'Spanish', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(popup.locator('#subtitle-language')).toHaveText('es-ES');
    await expect(popup.locator('#subtitle-phase')).toHaveText('disabled');
    // This fixture's Spanish metadata intentionally accompanies identical text.
    await expect(captions).toHaveText('That damn class is full of shit!');
    await tracks.getByRole('menuitemradio', { name: 'None', exact: true }).click();
    await expect(captions).toBeEmpty();
    await expect(popup.locator('#subtitle-language')).toHaveText('off');
    await tracks.getByRole('menuitemradio', { name: 'English', exact: true }).click();
    await expect(captions).toHaveText('That **** class is full of ****!');
    await toggle.click();
    await page.locator('#replace-layer').click();
    await expect(captions).toHaveText('That **** class is full of ****!');
    await page.locator('#fullscreen').click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('player-container');
    await expect(captions).toBeVisible();
    await expect(page.locator('ul')).toHaveCount(1);
    await expect(captions).toHaveText('That **** class is full of ****!');
    await page.screenshot({ path: '/tmp/quietroll-bitmovin-fullscreen.png' });
    await page.keyboard.press('Escape');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Bitmovin overlay: prefetched tracks never select a language; mismatches and rule edits recover safely', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await page.locator('#prefetch').click();
    await expect(page.locator('#menu-reads')).toHaveText('2');
    await expect(popup.locator('#subtitle-language')).toHaveText('en-US');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await page.locator('#mismatch').click();
    await expect(captions).toHaveText('Unassociated damn caption!');
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(popup.locator('#subtitle-reason')).toContainText('do not match');
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await options.locator('#custom').fill('class');
    await options.locator('#save').click();
    await expect(options.locator('#status')).toContainText('Settings saved');
    await activeTab(extension.worker, page);
    await expect(captions).toHaveText('Unassociated damn caption!');
    await page.locator('#mismatch').click();
    await expect(captions).toHaveText('That **** **** is full of ****!');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(popup.locator('#occurrences li')).toHaveCount(4);
    await media(page, 2.4);
    await expect(captions).toHaveText('What the ****?\nWatch your step.');
    await popup.locator('#enabled').uncheck();
    await expect(captions).toHaveText('What the hell?\nWatch your step.');
    await popup.locator('#enabled').check();
    await expect(captions).toHaveText('What the ****?\nWatch your step.');
    // A changed/unrecognized layer must never inherit a successful status.
    await captions.evaluate((node) => {
      (node as HTMLElement).style.position = 'relative';
    });
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(captions).toHaveText('What the hell?\nWatch your step.');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Bitmovin overlay: empty/hardcoded coverage stays unavailable and an audio/version change clears exceptions', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context, 'english', '?empty');
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    await expect(popup.locator('#subtitle-phase')).toHaveText('loading');
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(popup.locator('#subtitle-reason')).toContainText('not exposed');
    await expect(page.locator('#quietroll-coverage')).toContainText('not exposed');
    await expect(captions).toBeEmpty();
    expect((await readPlayer(popup)).snapshot.occurrences.every((row) => !row.textCensored)).toBe(
      true,
    );
    await page.locator('#empty').click();
    await expect(captions).toHaveText('That **** class is full of ****!');
    await popup.locator('.ignore').first().click();
    await expect(captions).toHaveText('That damn class is full of ****!');
    const before = (await readPlayer(popup)).snapshot.occurrences[0]!.id;
    await page.getByRole('button', { name: 'Audio and subtitle language options' }).click();
    await page
      .getByRole('menu', { name: 'Audio track selection' })
      .getByRole('menuitemradio', { name: 'Japanese', exact: true })
      .click();
    await expect(page.locator('#fixture-state')).toHaveText('Ready: japanese');
    await media(page, 1);
    await expect(popup.locator('#audio-language')).toHaveText('ja-JP');
    await expect(popup.locator('#audio-phase')).toHaveText('disabled');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(captions).toHaveText('That **** class is full of ****!');
    const after = (await readPlayer(popup)).snapshot.occurrences[0]!;
    expect(after.id).not.toBe(before);
    expect(after.ignored).toBe(false);
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('autoplay rechecks each episode without user menus, preserves playback, and never inherits English over Spanish', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context, 'english', '?slow-menu');
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    const captions = page.locator('.bitmovinplayer-container ul');
    await expect(captions).toHaveText('That **** class is full of ****!');
    await popup.locator('.ignore').first().click();
    const initial = (await readPlayer(popup)).snapshot.occurrences[0]!.id;
    await page.locator('#autoplay').check();
    await page.locator('#next-audio').selectOption('japanese');
    await page.locator('video').evaluate((v: HTMLVideoElement) => {
      v.volume = 0.27;
    });
    await page.locator('#play').click();
    // A real native ended event drives the synthetic site's own autoplay.
    // Fast-forwarding keeps this deterministic without waiting twelve seconds.
    await page.locator('video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 11.85;
    });
    await expect(page.locator('#sequence')).toHaveText('1');
    await expect(popup.locator('#audio-language')).toHaveText('ja-JP');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(captions).toContainText('****');
    expect(
      await page.locator('video').evaluate((v: HTMLVideoElement) => ({
        paused: v.paused,
        muted: v.muted,
        volume: v.volume,
      })),
    ).toEqual({ paused: false, muted: false, volume: 0.27 });
    const japanese = (await readPlayer(popup)).snapshot.occurrences[0]!;
    expect(japanese.id).not.toBe(initial);
    expect(japanese.ignored).toBe(false);
    await page.locator('#next-audio').selectOption('english');
    await page.locator('#next-subtitle').selectOption('spanish');
    await page.locator('video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 11.85;
    });
    await expect(page.locator('#sequence')).toHaveText('2');
    await expect(popup.locator('#audio-language')).toHaveText('en-US');
    await expect(popup.locator('#subtitle-language')).toHaveText('es-ES');
    await expect(popup.locator('#subtitle-phase')).toHaveText('disabled');
    await expect(captions).toHaveText('That damn class is full of shit!');
    await page.locator('#next-subtitle').selectOption('english');
    await page.locator('video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 11.85;
    });
    await expect(page.locator('#sequence')).toHaveText('3');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(captions).toContainText('****');
    await expect(page.locator('#manual-menus')).toHaveText('0');
    await expect(page.locator('#menu-reads')).toHaveText('4');
    await expect(page.locator('[data-testid="track-selection-button"]')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(page.url()).toContain('/watch/DOMAUTO3/');
    // Allow the navigation poll to run: fresh metadata must not be invalidated
    // again merely because the URL changed earlier in this same transition.
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1.3);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    const finalOccurrence = (await readPlayer(popup)).snapshot.occurrences[0]!;
    expect(finalOccurrence.id).not.toBe(initial);
    expect(finalOccurrence.ignored).toBe(false);
    await page.screenshot({ path: '/tmp/quietroll-autoplay.png', fullPage: true });
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('short empty caption redraws do not flash warnings or uncensored text', async () => {
  const extension = await launch();
  try {
    const page = await startOverlay(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(page.locator('#quietroll-coverage')).toBeHidden();
    await page.locator('#transients').click();
    const frames = await page.evaluate(async () => {
      const samples: Array<{ text: string; warning: boolean; menu: boolean }> = [];
      for (let i = 0; i < 240; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const warning = document.querySelector<HTMLElement>('#quietroll-coverage');
        const menu = document.querySelector<HTMLElement>('[data-testid="audio-text-track-menu"]');
        samples.push({
          text: document.querySelector('.bitmovinplayer-container ul')!.textContent!,
          warning: !!warning && !warning.hidden,
          menu: !!menu && getComputedStyle(menu).visibility !== 'hidden',
        });
      }
      return samples;
    });
    expect(frames.some((frame) => frame.text === '')).toBe(true);
    expect(frames.some((frame) => frame.text === 'That **** class is full of ****!')).toBe(true);
    expect(
      frames.every((frame) => !frame.warning && !frame.menu && !/damn|shit/.test(frame.text)),
    ).toBe(true);
    await page.locator('#transients').click();
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(page.locator('.bitmovinplayer-container ul')).toHaveText(
      'That **** class is full of ****!',
    );
    await page.screenshot({ path: '/tmp/quietroll-quiet-redraw.png', fullPage: false });
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('automatic menu read is bounded, restores native visibility, and leaves a user-opened menu alone', async () => {
  const extension = await launch();
  try {
    const page = await extension.context.newPage();
    await page.goto('https://www.crunchyroll.com/watch/DOMPLAYER/synthetic-fixture?broken-menu');
    const probeFrames = page.evaluate(async () => {
      let mounted = 0,
        visible = 0;
      for (let i = 0; i < 180; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const menu = document.querySelector<HTMLElement>('[data-testid="audio-text-track-menu"]');
        if (menu) {
          mounted++;
          if (getComputedStyle(menu).visibility !== 'hidden') visible++;
        }
      }
      return { mounted, visible };
    });
    await page.locator('#english').click();
    await expect(page.locator('#fixture-state')).toHaveText('Ready: english');
    await media(page, 1);
    const observedProbe = await probeFrames;
    expect(observedProbe.mounted).toBeGreaterThan(0);
    expect(observedProbe.visible).toBe(0);
    await expect(page.locator('#english')).toBeFocused();
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(popup.locator('#subtitle-reason')).toContainText(
      'could not be verified automatically',
    );
    const toggle = page.getByRole('button', { name: 'Audio and subtitle language options' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#menu-reads')).toHaveText('1');
    await expect(page.locator('#quietroll-coverage')).toBeVisible();
    await popup.locator('#enabled').uncheck();
    await expect(page.locator('#quietroll-coverage')).toBeHidden();
    await popup.locator('#enabled').check();
    await expect(page.locator('#menu-reads')).toHaveText('2');
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(page.locator('[data-testid="audio-text-track-menu"]')).toBeVisible();
    await expect(page.locator('#chosen-subtitle')).toHaveText('English [CC]');
    await expect(page.locator('#menu-reads')).toHaveText('2');
    const manual = await extension.context.newPage();
    await manual.goto('https://www.crunchyroll.com/watch/DOMUSER/synthetic-fixture');
    const manualToggle = manual.getByRole('button', {
      name: 'Audio and subtitle language options',
    });
    await manualToggle.click();
    await manual.locator('#english').click();
    await expect(manual.locator('#fixture-state')).toHaveText('Ready: english');
    await media(manual, 1);
    await expect(manual.locator('.bitmovinplayer-container ul')).toHaveText(
      'That **** class is full of ****!',
    );
    await expect(manualToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(manual.locator('[data-testid="audio-text-track-menu"]')).toBeVisible();
    await expect(manual.locator('#menu-reads')).toHaveText('0');
    await expect(manual.locator('#manual-menus')).toHaveText('1');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('English CC: pre-render text, real media muting, Ignore/Unignore, seek and subtitle restoration', async () => {
  const extension = await launch();
  try {
    const page = await start(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(popup.locator('#occurrences li')).toHaveCount(3);
    await expect(popup.locator('#occurrences')).not.toContainText(/damn|shit|hell/);
    await expect(popup.locator('.playback-state').first()).toContainText('Upcoming');
    await media(page, 1);
    await expect(page.locator('#fixture-caption')).toHaveText('That **** class is full of ****!');
    await popup.locator('.ignore').nth(0).click();
    await expect(popup.locator('.ignore').nth(0)).toHaveText('Unignore');
    await expect(page.locator('#fixture-caption')).toHaveText('That damn class is full of ****!');
    await media(page, 1, true);
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(true);
    await media(page, 1);
    await popup.locator('.ignore').nth(1).click();
    await expect(page.locator('#fixture-caption')).toHaveText('That damn class is full of shit!');
    await media(page, 1, true);
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(false);
    await media(page, 1);
    await popup.locator('.ignore').nth(0).click();
    await expect(page.locator('#fixture-caption')).toHaveText('That **** class is full of shit!');
    await popup.locator('.timestamp').nth(2).click();
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(1.92, 1);
    expect(page.url()).toContain('/watch/FIXTURE/');
    await page.locator('#play').click();
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(2.25);
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('disable/restore, reveal, keyboard controls and occurrence exceptions persist in the popup', async () => {
  const extension = await launch();
  try {
    const page = await start(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await popup.locator('.ignore').nth(1).click();
    await expect(popup.locator('.ignore').nth(1)).toHaveText('Unignore');
    await media(page, 1, true);
    await expect(popup.locator('.playback-state').first()).toContainText('Censored');
    await media(page, 1);
    await popup.locator('#enabled').uncheck();
    await expect(page.locator('#fixture-caption')).toHaveText('That damn class is full of shit!');
    await expect(popup.locator('#audio-phase')).toHaveText('disabled');
    await popup.locator('#enabled').check();
    await expect(page.locator('#fixture-caption')).toHaveText('That **** class is full of shit!');
    await popup.locator('#reveal').check();
    await expect(popup.locator('.match').first()).toHaveText('damn');
    await popup.locator('#reveal').uncheck();
    await expect(popup.locator('#occurrences')).not.toContainText(/damn|shit|hell/);
    await page.locator('#off').click();
    await expect(popup.locator('#subtitle-phase')).toHaveText('disabled');
    await page.locator('#restore-subtitles').click();
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(page.locator('#fixture-caption')).toHaveText('That **** class is full of shit!');
    await popup.locator('#retry').focus();
    await popup.keyboard.press('Tab');
    await expect(popup.locator('#settings')).toBeFocused();
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await popup.setViewportSize({ width: 410, height: 600 });
    await popup.screenshot({ path: '/tmp/quietroll-popup.png', fullPage: true });
    await popup.reload();
    await activeTab(extension.worker, page);
    await expect(popup.locator('.ignore').nth(1)).toHaveText('Unignore');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('Japanese audio stays audible with English censorship; non-English captions stay original', async () => {
  const extension = await launch();
  try {
    const page = await start(extension.context, 'japanese');
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-language')).toHaveText('ja-JP');
    await expect(popup.locator('#audio-reason')).toContainText('Japanese audio is unchanged');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await media(page, 1, true);
    await expect(page.locator('#fixture-caption')).toHaveText('That **** class is full of ****!');
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await popup.locator('#mode').selectOption('english');
    await expect(popup.locator('#selected-mode')).toContainText('Japanese audio (detected)');
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await page.getByRole('button', { name: 'Spanish subtitles', exact: true }).click();
    await expect(page.locator('#fixture-state')).toContainText('Ready: spanish');
    await media(page, 1);
    await expect(page.locator('#fixture-caption')).toHaveText('Un damn de prueba en español.');
    await expect(popup.locator('#subtitle-language')).toHaveText('es-ES');
    await expect(popup.locator('#subtitle-phase')).toHaveText('disabled');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('missing CC, unknown audio, off/unsupported subtitles, fullscreen and ads report real coverage', async () => {
  const extension = await launch();
  try {
    const page = await start(extension.context, 'English audio without CC');
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-reason')).toContainText('no English dialogue/CC');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    await expect(page.locator('#quietroll-coverage')).toContainText('Audio filtering unavailable');
    await page.locator('#fullscreen').click();
    await expect
      .poll(() => page.evaluate(() => document.fullscreenElement?.id))
      .toBe('fixture-player');
    await expect(page.locator('#quietroll-coverage')).toBeVisible();
    await page.evaluate(() => document.exitFullscreen());
    await page.getByRole('button', { name: 'Unknown audio', exact: true }).click();
    await expect(page.locator('#fixture-state')).toContainText('Ready: unknown');
    await expect(popup.locator('#audio-reason')).toContainText('audio language unresolved');
    await media(page, 1, true);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    await page.getByRole('button', { name: 'Subtitles initially off', exact: true }).click();
    await expect(page.locator('#fixture-state')).toContainText('Ready: off');
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await media(page, 1, true);
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(true);
    await page.getByRole('button', { name: 'Unsupported renderer', exact: true }).click();
    await expect(page.locator('#fixture-state')).toContainText('Ready: unsupported');
    await expect(popup.locator('#subtitle-phase')).toHaveText('unavailable');
    await expect(page.locator('#fixture-caption')).toContainText('Uncensored fixture text: damn');
    await expect(page.locator('#quietroll-coverage')).toContainText(
      'Subtitle filtering unavailable',
    );
    await page.getByRole('button', { name: 'Synthetic ad transition', exact: true }).click();
    await expect(popup.locator('#audio-phase')).toHaveText('unavailable');
    await expect(popup.locator('#occurrences li')).toHaveCount(0);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('tab/document targeting, stale actions and page messages cannot mutate stored settings', async () => {
  const extension = await launch();
  try {
    const first = await start(extension.context);
    const popup = await openPopup(extension.context, extension.worker, extension.id, first);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    const original = await readPlayer(popup);
    const second = await start(extension.context, 'japanese', 'SECOND');
    await activeTab(extension.worker, second);
    await expect(popup.locator('#audio-language')).toHaveText('ja-JP');
    const rejected = (await popup.evaluate(
      async (target) =>
        chrome.runtime.sendMessage({ type: 'player:action', target, action: 'seek', id: 'x' }),
      original.target,
    )) as { ok: boolean };
    expect(rejected.ok).toBe(false);
    await first.evaluate(() => {
      window.postMessage(
        {
          channel: 'quietroll-v1',
          kind: 'command',
          payload: { action: 'fetch', url: 'https://evil.test' },
        },
        location.origin,
      );
      window.postMessage({ type: 'preferences:patch', patch: { enabled: false } }, location.origin);
    });
    const state = (await popup.evaluate(async () =>
      chrome.runtime.sendMessage({ type: 'settings:get' }),
    )) as { data: { settings: { enabled: boolean } } };
    expect(state.data.settings.enabled).toBe(true);
    await media(first, 1, true);
    await expect
      .poll(() => first.locator('video').evaluate((v: HTMLVideoElement) => v.muted))
      .toBe(true);
    await media(second, 1, true);
    expect(await second.locator('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('cross-origin Vilos frame receives metadata and actions bind to its exact document', async () => {
  const extension = await launch();
  try {
    const page = await extension.context.newPage();
    await page.goto('https://www.crunchyroll.com/watch/FRAME/synthetic-fixture');
    await page.locator('#prime').click();
    await expect(page.locator('#ready')).toHaveText('Metadata ready');
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('#quietroll-coverage')).toContainText(
      'Loading current media timeline',
    );
    await frame.getByRole('button', { name: 'English audio + CC', exact: true }).click();
    await expect(frame.locator('#fixture-state')).toContainText('Ready: english');
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await expect(popup.locator('#subtitle-phase')).toHaveText('active');
    const current = await readPlayer(popup);
    expect(current.target.frameId).toBeGreaterThan(0);
    await popup.locator('.timestamp').first().click();
    await expect
      .poll(() => frame.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeCloseTo(0.72, 1);
    await frame.locator('#play').click();
    await expect
      .poll(() => frame.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1.05);
    await frame.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
    await popup.locator('.ignore').first().click();
    await expect(popup.locator('.ignore').first()).toHaveText('Unignore');
    await page.locator('#replace').click();
    await expect(frame.locator('#fixture-state')).toHaveText('Choose a fixture');
    const rejected = (await popup.evaluate(
      async (target) =>
        chrome.runtime.sendMessage({ type: 'player:action', target, action: 'seek', id: 'stale' }),
      current.target,
    )) as { ok: boolean };
    expect(rejected.ok).toBe(false);
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('occurrence exceptions survive browser restart and clearing them updates an active player', async () => {
  let extension = await launch();
  const directory = extension.directory;
  try {
    let page = await start(extension.context);
    let popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    await popup.locator('.ignore').first().click();
    await expect(popup.locator('.ignore').first()).toHaveText('Unignore');
    await extension.cleanup(false);
    extension = await launch(directory);
    page = await start(extension.context);
    popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('.ignore').first()).toHaveText('Unignore');
    await expect(popup.locator('.playback-state').nth(1)).not.toContainText('Censored');
    const options = await extension.context.newPage();
    await options.goto(`chrome-extension://${extension.id}/options.html`);
    await expect(options.locator('#clear')).toBeEnabled();
    await options.locator('#clear').click();
    await expect(options.locator('#clear-confirm')).toBeVisible();
    await options.locator('#cancel-clear').click();
    await expect(options.locator('#clear-confirm')).toBeHidden();
    await options.locator('#clear').click();
    await options.locator('#confirm-clear').click();
    await expect(options.locator('#exception-count')).toContainText('0 saved');
    await activeTab(extension.worker, page);
    await expect(popup.locator('.ignore').first()).toHaveText('Ignore');
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});

test('timestamp seek keeps SDK controls in sync so paused playback resumes and playing playback continues', async () => {
  const extension = await launch();
  try {
    const page = await start(extension.context);
    await page.locator('#managed-controls').click();
    // Negative control models the reported failure: a raw media seek moves the
    // clock but leaves a stateful player's controls locked until its slider is used.
    await media(page, 1);
    await expect(page.locator('#sdk-state')).toHaveText('Out of sync');
    await page.locator('#play').click();
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.locator('#fixture-timeline').focus();
    await page.locator('#fixture-timeline').press('ArrowRight');
    await expect(page.locator('#sdk-state')).toHaveText('In sync');
    await page.locator('#play').click();
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.3);
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.pause());
    const popup = await openPopup(extension.context, extension.worker, extension.id, page);
    await expect(popup.locator('#audio-phase')).toHaveText('active');
    const seeks = Number(await page.locator('#sdk-seeks').textContent());
    await popup.locator('.timestamp').first().click();
    await expect(page.locator('#sdk-seeks')).toHaveText(String(seeks + 1));
    await expect(page.locator('#sdk-state')).toHaveText('In sync');
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.locator('#play').click();
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(1.05);
    await popup.locator('.timestamp').nth(2).click();
    await expect(page.locator('#sdk-state')).toHaveText('In sync');
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(2.25);
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await page.locator('video').click();
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.locator('video').click();
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(2.6);
    await page.screenshot({ path: '/tmp/quietroll-seek-resume.png', fullPage: false });
    expect(extension.errors).toEqual([]);
  } finally {
    await extension.cleanup();
  }
});
