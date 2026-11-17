# Compatibility and live verification

CrunchyRoll Censoring filters supported English caption paths on desktop Chrome 120 or newer. This document describes the current integration boundaries and the manual checks that complement automated fixtures. User setup and troubleshooting are in the [README](../README.md).

## Scope of verification

The automated suite loads the built Manifest V3 extension in Chromium, with synthetic captions, metadata, player renderers, and a real media element playing a generated tone. These tests verify extension behavior against modeled contracts; they do not establish that every current Crunchyroll player follows those contracts.

A user reported successful opening-promo timing correction on several live episodes. Independent live playback remains unverified in the development environment. Historical commands, results, browser versions, and access blockers are recorded in [RELEASE.md](RELEASE.md). Chrome 120 is the declared minimum, rather than a separately verified test-browser version.

| Area                           | Automated evidence                                                                                      | Remaining live verification                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| English-dub CC audio           | Whole-cue mute scheduling, real media mute state, seeking, and user mute ownership                      | Episode-specific CC availability and acoustic synchronization beyond user-reported episodes |
| English text / other languages | Supported DOM replacement and restoration; Japanese audio and non-English subtitles unchanged           | Current renderer, selected-language detection, and actual subtitle output                   |
| ASS pre-render path            | Recognized SubtitlesOctopus lifecycle, source tags, layout, and cue times modeled in fixtures           | Current constructor exposure and real canvas output                                         |
| Autoplay and track selection   | Fresh episode identities, timing, and language choices across synthetic transitions                     | Current service menu timing, ownership, and real autoplay                                   |
| Recovery                       | Ready/replaced media, retries, metadata refresh, worker suspension, and simulated cached-page lifecycle | The reported intermittent live failure and native site BFCache eligibility                  |
| UI and settings                | Keyboard use, narrow layouts, restart persistence, exceptions, sync-storage events, tab/frame routing   | Actual toolbar gesture, signed-in cross-device delivery, and Chrome 120 itself              |
| Fullscreen                     | Player-container fullscreen in fixtures                                                                 | Real player fullscreen; video-only fullscreen cannot contain the HTML coverage notice       |
| Ads and source changes         | Invalidation of stale cues and release of owned muting                                                  | Same-source ad insertion and unannounced timeline remapping                                 |

Universal English-dub filtering remains outside verified coverage. Matching CC can be missing, inaccessible, or associated with another episode version. Translation and signs tracks cannot replace it. Audio and subtitle coverage are independent, and unavailable reasons remain visible.

## Integration requirements

### Caption resources and audio identity

The adapter observes page-initiated playback requests. It supports the inspected `/playback/v4/<version>/web/(chrome|firefox)/play` response shape with external text descriptors on a `stitchedElements` MAIN segment, or legacy top-level `captions` and `subtitles` records when stitched elements are absent. Episode metadata must identify the matching playback version and audio locale; a caption request alone does not establish the selected language.

English resources must be readable through ordinary page-context HTTPS/CORS with cookies omitted. Failed requests produce unavailable states and bounded retries, rather than privileged access to alternate sources. Preparation can delay a playback response by up to the five-second caption-request timeout. The known top page and `static.crunchyroll.com/vilos-v2/web/vilos/player.html` frame exchange current metadata; other frame paths are not assumed supported.

Complete captions and action logs stay in frame memory. Track parsing is limited to 3 MB, 12,000 cues per track, and 8,000 visible characters per cue; up to six English resources are preloaded. Scheduling considers up to 20,000 matches, while the popup/action log is bounded to 1,000 entries. See [privacy](PRIVACY.md) and [architecture](ARCHITECTURE.md).

### Subtitle renderers

Two guarded paths are implemented:

- **SubtitlesOctopus:** requires the recognized constructor/lifecycle and an associated English `subUrl`. Prepared ASS is supplied before construction or track selection.
- **Bitmovin DOM overlay:** requires the inspected player-container/caption hierarchy, a supported subtitle-menu checked label, an unambiguous current English resource, and exact complete-cue text agreement apart from whitespace. Native nodes, layout, styling, and originals are retained.

Current-time cue associations take priority. A unique complete displayed line can identify a cue elsewhere in the same selected track, but ambiguous repeated lines, different wording, and unmatched overlapping combinations remain unfiltered. Exact-text fallback never establishes an audio offset. An empty overlay waits for real cue evidence and cannot establish that subtitles are hardcoded.

Automatic menu inspection reads the selected track without selecting a language or changing autoplay. It preserves a user-opened menu, defers to other open controls, and cancels on real user interaction. The selected item must appear within two seconds; a failed close restores visibility within a further 500 ms. Late menu metadata has bounded retries. A very early caption can remain unfiltered before selection is resolved; status stays loading.

Different markup, unknown/localized labels, ambiguous English variants, native browser text tracks, unrecognized canvas renderers, and hardcoded subtitles remain unsupported. The existence of readable on-screen text alone does not prove compatibility or before-paint filtering.

### Timing and muting

Supported automatic mapping uses a continuous, timeline-included sequence of optional opening promos/logos followed by one MAIN segment. MAIN's start is added to source caption times before scheduling; native subtitle timing is left to the player. A finite native duration must agree with the described timeline within one second.

Ads, excluded segments, gaps/overlaps, multiple MAIN segments, explicit VTT timestamp maps, cues beyond MAIN's duration, and unknown layouts are not automatically mapped. Missing duration remains loading. Independently verified English text filtering can continue when audio and timestamp links are unavailable.

Source changes and sustained displayed-cue disagreement invalidate affected scheduling. Same-source ads, timer throttling, and unannounced remapping need live verification. Successful text replacement and an action log are not acoustic proof that the intended speech was silenced.

Without word timestamps, the full matching cue is muted. Default padding is 80 ms before and 100 ms after, configurable from 0 to 300 ms each. Surrounding dialogue may be silenced. The extension preserves user mute intent and never changes volume. Seeking uses the player's registered Media Session handler when available and respects explicit seek rejection.

**Additional CC correction normally stays at 0.** Supported metadata offsets are automatic and episode-specific; adding a manual +20 on top of a +19.061 metadata adjustment would double-shift timing. Manual correction is for a separately verified residual discrepancy, resets on episode/reload, never syncs, and cannot bypass unsupported metadata. Developer tools expose diagnostics and controls without changing filtering or hiding coverage warnings. See [the timing investigation](TIMING-INVESTIGATION.md).

## Live verification checklist

Use an account/session normally authorized to play the episodes. Record the extension version, Chrome version, renderer, languages, availability, and timing results without retaining account credentials, signed URLs, or full caption documents. Report failed or inaccessible checks separately from passing fixtures.

1. **English dub and CC:** reload the page with the built extension. Without opening the native menu, verify selected-track detection, masked text, synchronized whole-cue muting, and absence of uncensored flashes. Check two separated lines. Leave additional correction at 0. With accessible CC, also check subtitles-off audio filtering.
2. **Autoplay:** watch through at least two transitions. Verify new episode identities, timing adjustments, continuing playback, and preserved native preferences without manually reopening menus. Different episodes can have different prefixes or none.
3. **Languages:** check Japanese audio with English subtitles, including a conflicting English override; audio must stay unchanged. Switch to non-English subtitles and verify original text. A reliable detected language takes priority over a manual override.
4. **Unavailable paths:** test an English dub without matching CC, unknown languages, and unsupported/hardcoded rendering. Expect separate truthful coverage warnings. Translation/signs captions must not drive dub muting.
5. **Exceptions and controls:** Ignore one of two matches in a cue; the other should still require whole-cue silence. Ignore both, Unignore one, seek, replay, pause, buffer, change playback rate, and edit terms during a paused cue. Disable filtering and verify original text and user sound choices are restored.
6. **UI and persistence:** check the real toolbar popup, keyboard focus, fullscreen, track switching, multiple tabs, browser restart, saved exceptions, and clearing exceptions. A user-opened native menu must remain visible/open. Exceptions must not transfer to a different episode/version/track.
7. **Recovery:** exercise navigation, ready/replaced videos, temporary resource failures, and back/forward restoration where supported. Confirm **Refresh player** retries failed caption reads and that permanent failures remain unavailable. See [RECOVERY.md](RECOVERY.md).
8. **Ads and discontinuities:** check the account/region's actual ad paths and source changes. Treat same-source insertion and undocumented timeline changes as unverified until directly observed.

No microphone, speech-recognition fallback, transcription service, or DRM/access-control bypass is provided. The extension cannot supply captions that the authorized player does not expose.
