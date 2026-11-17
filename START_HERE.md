# CrunchyRoll Censoring

Start with [README.md](README.md) for installation, language modes, and coverage limits. See the [compatibility guide](docs/COMPATIBILITY.md#live-verification-checklist) for the manual verification checklist and the [development guide](docs/DEVELOPMENT.md) for builds and publishing. Load the generated `dist/` directory in Chrome or install the ZIP from the [latest release](https://github.com/hwsbula/crunchyroll-censoring/releases/latest).

For an existing installation, keep the same loaded folder, replace its files, click **Reload** on CrunchyRoll Censoring at `chrome://extensions`, and refresh Crunchyroll. Choose English [CC] (or English subtitles for Japanese audio) in Crunchyroll as usual. CrunchyRoll Censoring automatically reads the selected track for each new episode and leaves the preference unchanged. If automatic verification fails, a warning directs you to the player's menu. Text coverage becomes active only after a displayed cue agrees with the identified track. Brief loading/redraw messages no longer appear immediately over the video; genuine unavailable/error warnings remain visible.

Use Node 24 and npm 11 for development. Run `npm ci`, install the Playwright Chromium browser, and run `npm run release`. Existing cloud setup helpers remain available in `scripts/`; they must be invoked explicitly. The user reports the timing fix working on several episodes; independent live validation remains unavailable. see [release verification](docs/RELEASE.md).

For the public Web Store update, see [the publishing checklist](store/PUBLISH.md). Run `npm run release:store` for the upload ZIP and separate submission kit.
