# Caption timing investigation — November 16, 2026

**Status: confirmed implementation gaps; the exact cause of this episode's 20-second difference is not yet established.** No automatic timing correction is justified by the available live evidence. This investigation does not change the shipped runtime, claim a fix, or publish a release.

## Evidence and the important correction to earlier advice

The user reports source-list timestamps 2:30 and 8:52 for lines heard at 2:50 and 9:12. They confirmed that the latter are the times in **Crunchyroll's playback controls**, that the mismatch survives a fresh reload, and that it occurs both with and without Skip Intro. Text is displayed at the right moment and censored successfully.

These observations establish a +20-second difference between the listed source time and the player UI at two points, 382 seconds apart. They do **not** measure the underlying video element's time. Therefore the earlier recommendation to add +20 to both audio and links was premature: those operations may use different clocks. Do not treat 0.1.9's combined manual offset as a general fix or choose it from UI timestamps alone.

Let C be source cue time, M the underlying video element's `currentTime`, and P the player UI/SDK timeline. The report gives P − C = 20. Audio needs the C → M mapping; SDK seeking needs C → P, and seek completion must use the correct target clock. P − C does not determine M − C.

| Synthetic example at the first line | Implication                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C=150, P=170, M=170                 | A +20 media correction is consistent with this sample; resource identity and cue onset still need verification.                                                           |
| C=150, P=170, M=150                 | Caption and media clocks already agree. Adding +20 to audio moves a correctly timed mute away from this cue. Timestamp display/seeking still need a different conversion. |

Neither example is a live measurement. Both fit the two reported numbers. This is why a blanket offset cannot yet identify or solve the actual fault.

## Confirmed code findings

1. **Cue timestamps become playback timestamps without a mapping.** `src/core/captions.ts:4` parses ordinary timestamps correctly. `src/core/engine.ts:66` copies `cue.start` into the occurrence; `intervalsFor` applies only user padding/manual correction. `src/core/scheduler.ts:92` compares those intervals directly with `media.currentTime`. No production mapping from source clock to media clock is established.
2. **WebVTT timing metadata is ignored.** `src/core/captions.ts:112` skips non-cue header lines, including `X-TIMESTAMP-MAP`. A synthetic file with an explicit timestamp map and the same file without it both produce starts 150 and 532. This is a reproducible missing capability, not evidence that the episode's real caption file contains that header. The real file/format has not been supplied. A mapping also needs the media timeline context: blindly adding MPEGTS/90,000 is not generally correct.
3. **SDK seek requests and completion checks assume identical clocks.** `src/integration/seek.ts` forwards requested seconds to the site's registered Media Session `seekto` handler. `src/core/seeker.ts:45` nevertheless requires native `currentTime` to equal that same number. A synthetic SDK that legitimately maps presentation 170 to media 150 completes its seek, but the extension reports timeout. The existing regression models did not exercise separate SDK/media clocks.
4. **Multiple English CC tracks are not disambiguated for audio.** `src/core/engine.ts:44` chooses the first current-version English `captions` entry. Reversing two eligible en-GB/en-US entries changes the selected audio timing source. The DOM renderer separately requires a unique selected track. The popup aggregates matches from loaded English tracks without showing a track label per row. This is a possible independent asset-selection problem; we have not observed multiple CC variants in this user's playback response.
5. **Successful text replacement cannot validate any audio clock.** The 0.1.8 fallback identifies an exact unique complete cue by text within the selected track. That explains how text censorship can work despite timing disagreement. The action log records applied muting/text actions, not acoustic verification that the intended spoken word was silenced.

Normal time formatting and seconds conversion were checked: 00:02:30.000 → 150 → 2:30; 00:08:52.000 → 532 → 8:52. The scheduler uses media time rather than an accumulating wall-clock counter. Padding is milliseconds, not 20 seconds. There is no hardcoded 20-second production offset. The observed stable difference is consistent with an additive clock/source discrepancy, but does not establish its origin or rule out changes elsewhere in the episode.

## Player and standards evidence

The public [CrOptix Katamari source](https://github.com/stratumadev/croptix/blob/52b7436b310802affd27db93d3161ea7e8f2aa00/src/utils/katamari.js#L3973) computes elapsed text from `playheadData.timelineTime`. Its skip logic uses `streamTime`, and its timeline code converts native buffered media time through `manifest.stitchedElements`. The [Media Session handler](https://github.com/stratumadev/croptix/blob/52b7436b310802affd27db93d3161ea7e8f2aa00/src/utils/katamari.js#L4731) also publishes `timelineTime`. This is a modified third-party copy, not an independently captured current production bundle. Its Git blob `1e6c6f5cfa4334da4125865896a8951d5df5f0ba` matches the inspected local copy. The user's earlier pasted DOM independently contains the same timestamp element and timeline control, but does not serialize the video element's runtime `currentTime`.

[Bitmovin's synchronization documentation](https://developer.bitmovin.com/playback/docs/why-are-my-webvtt-subtitle-tracks-not-in-sync-with-the-video) describes caption-to-stream timestamp mapping. [RFC 8216 section 3.5](https://datatracker.ietf.org/doc/html/rfc8216#section-3.5) defines the WebVTT-to-MPEG timestamp association. [Shaka's VTT parser](https://shaka-project.github.io/shaka-player/docs/api/lib_text_vtt_text_parser.js.html) applies a time context and HLS mapping when appropriate. These establish mechanisms that our parser does not model; they do not establish which player/library/protocol/mapping this episode uses.

The current live check remained blocked: the Cloud browser failed opening the episode with “Browser Use could not read requirements”; the shell previously returned proxy CONNECT 403. Web search could read only the public unsupported-browser shell, not playback metadata, captions or a running media element. No credentials, alternate playback versions, protected media, authentication endpoints or DRM were accessed.

## Reproduction and verification

From the repository root:

```bash
node scripts/diagnostics/reproduce-timing.mjs
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node scripts/diagnostics/verify-clock.mjs
npx eslint scripts/diagnostics --max-warnings 0
```

The first command uses the actual 0.1.9 parser, scheduler, seeker and track selector with **synthetic** inputs. It confirmed ignored timestamp mapping; correct numeric formatting; source-timed muting at media 150.1 versus no mute after +20 in the hypothetical separate-clock case; a seek-completion timeout despite the SDK reaching its presentation target; and order-dependent English CC selection. These are characterization checks of unresolved behavior, **not passing acceptance tests for a repair**.

The second command passed in Chromium: distinct/equal clocks, unchanged media/DOM/native-track state, excluded dialogue/labels, missing UI clock, and ambiguous/missing video. ESLint passed for all diagnostic scripts. `npm run check` also passed formatting, lint, strict TypeScript, all 53 existing unit tests, build and manifest validation. The rebuilt production files remain byte-identical to the existing 0.1.9 ZIP; the 25-scenario extension browser suite was not rerun for these documentation/diagnostic-only changes. This helper is not imported into `src/`, copied into `public/`, or shipped by the build. It does not fetch, install hooks, write storage, record media, modify subtitles, change playback or transmit data.

## The next decisive live measurement

Pause on one of the affected lines. Record the time in the player and run this read-only Console expression in the document containing the video:

```js
document.querySelector('video')?.currentTime;
```

Compare at two separated affected cues. The more complete optional [clock snapshot](../scripts/diagnostics/clock-snapshot.js) returns bounded numeric media/UI/slider/native-active-cue data without URLs, credentials, caption text or persistent logs. A missing native text track is not evidence that Crunchyroll has no captions; its renderer may be independent of native text tracks. A paused sample cannot test audio muting, since our scheduler releases extension muting on pause. UI timestamps are rounded and can briefly lag; a single subsecond difference is not a confirmed mapping.

If media time agrees with the player UI, inspect the actual selected CC resource identity, cue start/end and any timing header/manifest mapping next. Compare only the clear-text metadata already fetched by the authorized player; do not collect cookies, headers, signed URLs, protected segments or licenses. If media time differs from UI time, establish the separate SDK/media mapping before changing audio timing. If cue time already agrees with media time while audio escapes, inspect the active media element and actual muted state during playback as a separate audio-control failure. Source/header snippets or a user-supplied caption file can support that next step; they have not yet been obtained.

A completed repair must map C → M for precomputed mute intervals and C → P for displayed timestamps/SDK seeks, preserve current episode/track identity, and invalidate mappings at discontinuities. It must retain the existing subtitle behavior and Japanese-audio protections, work before cue display, and be verified on the reported episode before claiming the root cause or publishing a production timing fix.
