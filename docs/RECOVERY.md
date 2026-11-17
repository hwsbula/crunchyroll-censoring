# Intermittent filtering investigation — 0.1.12

The user reports occasional unavailable audio or subtitle filtering that returns after refreshing the episode or restarting Chrome. No consistent trigger or current failing example was available. We found and reproduced recovery defects in the existing code; we have not established which defect caused each live incident.

## Reproduced failures

Four new tests failed against v0.1.11 before implementation and passed after the fixes. They load the actual unpacked MV3 extension in Chromium with synthetic HTTPS responses, caption files and native media:

| Trigger                                                                | Previous behavior                                                                          | Correction                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Video finishes loading before insertion into the DOM                   | Waits forever for a `loadedmetadata` event that already fired; audio/text stay loading     | Check the attached video's actual `readyState`, within the current fresh metadata generation                                  |
| Page refreshes unchanged playback metadata without reloading the media | Clears timeline readiness and waits for another media-load event; filtering stops          | Restore only the identical previously verified episode, captions, timeline, video and source, with no intervening media event |
| One caption download returns HTTP 503                                  | Caches the incomplete session indefinitely; Refresh player only reanalyzes that empty data | Retry transient current-resource reads, reusing successful downloads; manual refresh also re-downloads failed resources       |
| A cached page receives pagehide and later pageshow                     | Teardown removes media scheduling and caption observers; no resume handler reattaches them | Release owned muting on suspension, reconnect the verified same player and re-register its frame on restoration               |

Additional tests cover replacement of the video during a fresh playback request, late selected-subtitle metadata, preservation of an ASS renderer/manual timing correction on an unchanged metadata refresh, and worker shutdown/wake. Registration timeout/failure/cancellation, retryable worker initialization, caption retry budgets, permanent errors, and cancellation of obsolete episode downloads have focused unit coverage.

## Why restarting appeared to help

A refresh/restart creates fresh content scripts, media listeners, registration attempts and caption downloads. It can make an ordering or transient failure disappear without fixing the underlying recovery gap. That explains why these defects can seem random. It does not establish that every reported failure had the same cause.

Normal Manifest V3 service-worker sleep is expected. Precision muting and rendering remain in the player page, not the worker. The regression suite explicitly checks the worker's stopped/running lifecycle through Chrome's debugging protocol; Playwright's retained Worker handle alone is not proof that a worker is still running. No heartbeat was added to keep the worker alive.

## Recovery limits and safety

- Registration gets a five-second attempt timeout and up to five delayed retries. It stops after success; restored pages and missing-connection probes can retry. Only validated saved state activates filtering, and older responses cannot replace newer settings.
- Caption downloads remain limited to the current, observed English resources (six maximum, three MB per body). Automatic retries use 0.5/1.5/4-second backoff for network/timeout/429/5xx failures. Missing/denied/oversized/malformed files do not cause endless requests. Refresh player can retry failed downloads explicitly. No authentication or playback API replay is introduced.
- An unchanged metadata refresh may restore session timing corrections and timing-disagreement guards only after matching complete track identity/content/timeline and the original media binding. An unexplained source reset still discards cues and releases extension-owned muting. No stale-episode fallback or global timing offset is added.
- Subtitle-menu metadata is checked at most three times per reset, with five-/ten-second spacing after the first attempt. The extension conceals only the known menu it opens, restores styles/focus, never changes a selected item, and stops reopening after user interruption.
- Cache restoration requires a completed, verified same-source session. Incomplete or changed media requires fresh metadata. The tests dispatch deterministic persisted lifecycle events; they do not establish Crunchyroll/DRM eligibility for Chrome's native back/forward cache. An incomplete caption recovery job is canceled when the page is suspended.
- Unknown languages, missing matching English-dub CC, unsupported timelines/renderers and late/unidentified ASS renderers remain unavailable. These fixes do not create universal audio coverage or prevent every possible site integration failure. Whole-cue muting still silences surrounding dialogue.
- No new permissions, dependencies, services, telemetry, persistent schema or transcript storage. Settings, term choices, occurrence exceptions and user-owned mute remain intact.

## Verification and remaining live check

Focused tests run with:

```bash
node --test tests/unit/recovery.test.ts
npm run build
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npx playwright test -g 'recovery:'
```

The final release gate and artifact results are recorded in [RELEASE.md](RELEASE.md). The live attempt in this environment failed before navigation with **“Browser Use could not read requirements.”** This is a browser-tool blocker, not a confirmed site block. No live audio/subtitle reliability claim follows from the fixture tests.

After installing the update and refreshing the episode once, check:

1. English audio/CC starts filtering after a cold Chrome launch and after opening another episode tab. Close the popup and play through a known match; both words and audio should be censored.
2. Let multiple episodes autoplay without opening the subtitle menu. Each episode must load its own data/timing. Repeat with Japanese audio and English subtitles; Japanese audio must stay untouched.
3. Leave/revisit the episode, use back/forward, seek/replay, pause, change speed, and enter fullscreen. Verify manual mute/volume and Ignore/Unignore still work.
4. If unavailable persists, use Refresh player once and inspect the separate audio/subtitle reasons. Missing captions or a newly unsupported player path should remain plainly unavailable. Record only the extension version and displayed reason if reporting a recurrence; do not share signed caption URLs, tokens or full network dumps.

An extension update cannot replace scripts already running in an old episode page. Reload that page once after updating. Web Store users receive this version only after the publisher uploads it and Google approves/delivers the update.
