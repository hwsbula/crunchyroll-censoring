# CrunchyRoll Censoring

The Page Notes demonstration has been replaced with CrunchyRoll Censoring. Start with [README.md](README.md) for installation, language modes, coverage limits, and the manual verification checklist. Load the generated `dist/` directory in Chrome or extract `artifacts/crunchyroll-censoring-0.1.4.zip`.

For an existing installation, keep the same loaded folder, replace its files, click **Reload** on CrunchyRoll Censoring at `chrome://extensions`, and refresh Crunchyroll. Choose English [CC] (or English subtitles for Japanese audio) in Crunchyroll as usual. CrunchyRoll Censoring automatically reads the selected track for each new episode and leaves the preference unchanged. If automatic verification fails, a warning directs you to the player's menu. Text coverage becomes active only after a displayed cue agrees with the identified track. Brief loading/redraw messages no longer appear immediately over the video; genuine unavailable/error warnings remain visible.

Use Node 24 and npm 11 for development. Run `npm ci`, install the Playwright Chromium browser, and run `npm run release`. Existing cloud setup helpers remain available in `scripts/`; they must be invoked explicitly. Live Crunchyroll compatibility is not yet verified; see [release verification](docs/RELEASE.md).
