// Synthetic DOM verification for the optional read-only DevTools helper.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const script = await readFile(new URL('./clock-snapshot.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(
    '<div id="player-container"><video></video><span data-testid="timestamp">2:50 / 24:30</span><input class="timeline-slider" aria-valuenow="170"></div>',
  );
  await page.evaluate(() => {
    const video = globalThis.document.querySelector('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 150.25 });
    video.volume = 0.4;
    video.muted = true;
    const track = video.addTextTrack('captions', 'SYNTHETIC PRIVATE LABEL', 'en-US');
    track.addCue(new globalThis.VTTCue(150, 152, 'SYNTHETIC PRIVATE DIALOGUE'));
    track.mode = 'hidden';
  });
  const before = await page.content();
  const report = JSON.parse(await page.evaluate(script));
  assert.equal(report.mediaSeconds, 150.25);
  assert.equal(report.playerDisplayedSeconds, 170);
  assert.equal(report.playerSliderSeconds, 170);
  assert.equal(report.displayedMinusMediaSeconds, 19.75);
  assert.equal(report.nativeTracks[0].loadedCueCount, 1);
  assert.equal(report.nativeTracks[0].mode, 'hidden');
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.equal(await page.content(), before);
  assert.deepEqual(
    await page
      .locator('video')
      .evaluate((video) => [
        video.currentTime,
        video.muted,
        video.volume,
        video.paused,
        video.textTracks[0].mode,
      ]),
    [150.25, true, 0.4, true, 'hidden'],
  );
  await page.locator('[data-testid="timestamp"]').evaluate((clock) => {
    clock.textContent = '2:30 / 24:30';
  });
  assert.equal(JSON.parse(await page.evaluate(script)).displayedMinusMediaSeconds, -0.25);
  await page.locator('[data-testid="timestamp"]').evaluate((clock) => {
    clock.remove();
  });
  const missing = JSON.parse(await page.evaluate(script));
  assert.equal(missing.playerDisplayedSeconds, null);
  assert.equal(missing.displayedMinusMediaSeconds, null);
  await page.locator('video').evaluate((video) => {
    video.after(video.cloneNode());
  });
  assert.equal(JSON.parse(await page.evaluate(script)).videoCount, 2);
  await page.setContent('<div>No player in this document.</div>');
  assert.equal(JSON.parse(await page.evaluate(script)).videoCount, 0);
  console.log(
    'Passed: distinct/equal clocks, unchanged media/DOM/track state, excluded dialogue/labels, missing clock, ambiguous/missing video. Synthetic Chromium only.',
  );
} finally {
  await browser.close();
}
