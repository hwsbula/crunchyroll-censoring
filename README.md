# CrunchyRoll Censoring

A Chrome extension that filters selected English words in supported Crunchyroll subtitles and silences matching English-dub caption cues. Filtering runs locally, with configurable word lists, per-occurrence exceptions, and optional Chrome settings sync.

This is an independent project, unaffiliated with Crunchyroll.

[Download the latest release](https://github.com/hwsbula/crunchyroll-censoring/releases/latest) · [Privacy policy](docs/PRIVACY.md) · [Report a problem](https://github.com/hwsbula/crunchyroll-censoring/issues)

## What it does

- Replaces matching words with `****` in supported English subtitle renderers while preserving their styling.
- Silences the **whole caption cue** containing a match when suitable English-dub closed captions are available. Surrounding dialogue may also be silenced.
- Accounts for supported opening promos automatically, using fresh timing metadata for each episode, including autoplay transitions.
- Lets you review detected matches, seek to their timestamps, and Ignore/Unignore individual occurrences.
- Provides searchable built-in categories, custom words and phrases, settings backups, and optional settings sync.

## Coverage and limitations

**Filtering is not guaranteed to catch every word.** Coverage depends on the episode's captions, timing metadata, and player renderer. Check the popup's separate **Audio filtering** and **Subtitle filtering** statuses; an unavailable status explains which function cannot run.

| Playback choice                                 | Supported behavior                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------- |
| English audio with matching English dialogue/CC | Audio cue muting; English subtitle filtering where the renderer is supported |
| Japanese audio with English subtitles           | English subtitle filtering where supported; Japanese audio stays unchanged   |
| Subtitles off                                   | Audio filtering can continue if matching English CC data is accessible       |
| Non-English subtitles                           | Text stays unchanged                                                         |

English translation or signs-only subtitles cannot substitute for matching dub CC. Hardcoded subtitles cannot be replaced. Unsupported timelines, ads, or caption-rendering paths can prevent filtering. Dictionary matching can miss unfamiliar spellings or censor harmless uses of ambiguous terms.

Automated tests use synthetic players. A user has reported successful opening-promo timing correction on several real episodes; independent live-service verification remains incomplete. See [compatibility and live verification](docs/COMPATIBILITY.md) and the [release verification records](docs/RELEASE.md).

## Install

Requires **desktop Chrome 120 or newer** and normal access to the Crunchyroll episode you want to watch. No separate extension account, API key, or extension subscription is required. Mobile Chrome is not supported.

1. Open the [latest GitHub release](https://github.com/hwsbula/crunchyroll-censoring/releases/latest) and download **`crunchyroll-censoring-<version>-extension.zip`** under **Assets**.
2. Extract the ZIP into a permanent folder. Its root should contain `manifest.json`.
3. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
4. Select the extracted folder containing `manifest.json`.
5. Pin **CrunchyRoll Censoring**, then reload any open Crunchyroll episode.

GitHub's **Source code** downloads contain development files and require a build before installation. To build from source, see [Development](#development).

### Update an unpacked installation

Download and extract the latest extension ZIP, then replace the files in the **same folder originally loaded into Chrome**. At `chrome://extensions`, click **Reload** on CrunchyRoll Censoring, then reload Crunchyroll.

Keeping the same loaded folder preserves the extension ID, saved settings, and local Ignore choices. Avoid removing the extension or loading a second copy from another folder when updating. Unpacked installations require this manual update process.

## Use

1. Choose your audio and subtitle tracks in Crunchyroll. For an English dub, select **English [CC]** when available. For Japanese audio, select **English** subtitles.
2. Open the extension popup, keep **Enabled** on, and leave **Audio mode** on **Automatic detection** normally.
3. Check both filtering statuses. Subtitle coverage may remain loading until a displayed cue can be verified. Read any unavailable reason before relying on filtering.

The extension checks the selected subtitle track automatically and preserves your language and autoplay choices. If detection cannot verify the selection, open Crunchyroll's subtitle menu yourself and click **Refresh player** in the extension.

In **Detected matches**, timestamps seek within the current episode. **Upcoming** means a match has been detected but has not yet been censored. **Censored · audio/text** records an applied action in this session. Originals remain masked until you choose **Reveal originals**.

**Ignore** restores that occurrence; **Unignore** enables its filtering again. Another enabled match in the same cue still requires muting that whole cue.

### Choose what to filter

Open **Settings** to search built-in terms, switch individual terms or whole categories on/off, and add one custom literal word or phrase per line. Click **Save settings** to apply changes to active Crunchyroll tabs. Category buttons affect the whole category, including terms hidden by search.

All six categories start enabled, including mild name-calling and sexual anatomy. Review them to suit your preferences. Matching is case-insensitive and respects word boundaries; custom terms are literal text. See [term coverage and ambiguity](docs/TERMS.md).

### Settings sync and backups

**Use Chrome settings sync** starts enabled. With Chrome account sync enabled, saved preferences and word choices can transfer between installations with the same extension ID. Local playback works without sync; quota errors and conflicts appear in Settings. The sync status does not confirm delivery to another device.

Use **Export saved settings** and import the JSON backup to transfer preferences manually. Backups and sync exclude local occurrence Ignore choices. Unpacked copies are not automatically installed on another computer through this feature.

When moving to a store installation with a different extension ID, export first, disable the old copy, then import and verify your settings in the new copy. See the [migration instructions](store/PUBLISH.md#move-your-existing-settings-safely).

## Troubleshooting

| Problem                                            | What to check                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio filtering unavailable                        | Confirm English audio and matching English CC are available. Translated subtitles alone are insufficient. Read the popup's reason.                            |
| Subtitles visible but filtering unavailable        | Confirm the selected English track in Crunchyroll, then click **Refresh player**. Visible text alone does not establish a supported renderer or matching cue. |
| Filtering stops after loading or changing episodes | Click **Refresh player** to recheck the renderer and retry failed caption downloads. If it persists, reload the episode.                                      |
| Audio or timestamp links seem early/late           | Leave **Additional CC correction** at **0** normally; supported promos are handled automatically. Report a remaining discrepancy with two examples.           |

For diagnostics, enable **Settings → Developer tools → Show developer tools**. The popup then exposes caption diagnostics and manual timing controls. Manual correction resets on episode changes or reload. Coverage warnings remain visible with developer tools hidden.

After installing an extension update, reload the Crunchyroll page once so it receives the updated scripts. Detailed investigations: [player recovery](docs/RECOVERY.md) and [caption timing](docs/TIMING-INVESTIGATION.md).

## Privacy and permissions

Captions and playback logs are processed in page memory. Preferences and hashed occurrence exceptions are stored locally; only saved preferences and word choices are offered to Chrome Sync. There is no developer backend, analytics, cloud transcription, or microphone access.

The extension uses the **storage** permission and host access to Crunchyroll's desktop site and its identified embedded player path. It does not bypass subscriptions or access controls. Read the [privacy policy](docs/PRIVACY.md) for retention, deletion, sync, and backup details.

## Development

Use **Node.js 24** and **npm 11** with the committed lockfile:

```bash
git clone https://github.com/hwsbula/crunchyroll-censoring.git
cd crunchyroll-censoring
npm ci
npm run build
```

Load the generated `dist/` folder in Chrome. For rebuilds, use `npm run dev`, then reload the extension and episode. Build output and generated ZIPs are excluded from Git.

See the [development and publishing guide](docs/DEVELOPMENT.md) for browser setup, checks, packaging, and GitHub releases. See [architecture](docs/ARCHITECTURE.md) for integration details and the [Web Store checklist](store/PUBLISH.md) for store updates. GitHub releases and Web Store publication are separate steps.

## Support and contributions

[Open an issue](https://github.com/hwsbula/crunchyroll-censoring/issues) with the extension and Chrome versions, episode page link, selected audio/subtitle options, exact coverage message, and steps to reproduce. For timing problems, include two expected/observed timestamps. Share diagnostic text only; omit account credentials, request headers, signed resource URLs, and full network exports.

For code changes, follow the [development guide](docs/DEVELOPMENT.md), keep permissions limited, and include relevant regression checks. Describe whether verification used synthetic fixtures or real playback.

## License and artwork

The package is currently marked **UNLICENSED**; the repository does not grant an open-source license. Third-party icon attribution and license information are documented in [Icon source](assets/ICON-SOURCE.md). Crunchyroll trademarks belong to their respective owner.
