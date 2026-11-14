# Privacy practices and permission explanations

Paste the single-purpose and permission explanations below into the matching current dashboard fields. Review the dashboard's exact questions at submission time; do not select “no user data handled” simply because most processing is local. Google's policy requires disclosure of local processing and Chrome Sync as well.

## Single purpose

Filter user-selected English profanity in supported Crunchyroll desktop caption tracks and, when matching English-dub CC is available, silence the corresponding complete audio cues. Occurrence review, term settings, Chrome preferences sync and settings backup support that one purpose.

## Storage permission

Save filtering preferences, custom literal terms, disabled built-in terms and local occurrence exceptions. Use Chrome Sync only for preferences and word choices. Use session storage for bounded player-frame routing. Neither transcripts nor viewing-history logs are saved or synced. Local and sync areas are restricted to trusted extension contexts.

## Host access

- `https://www.crunchyroll.com/*`: identify the active episode/player and selected audio/subtitle track; process player-supplied English caption data; censor the recognized English caption layer and control the current media element's mute state/seek handler.
- `https://static.crunchyroll.com/vilos-v2/web/vilos/player.html*`: perform the same filtering and validated messaging inside the source-identified Vilos player frame. Chrome host permissions operate at origin granularity even when a path is supplied; content-script matching remains limited to the declared player path.

The extension requests no every-website, history, microphone, capture, downloads, identity or webRequest permission. It does not bypass subscriptions, DRM or authentication.

## Remote code explanation

All executable extension code is bundled in the submitted ZIP. No eval, remote imports, CDN scripts, dynamic code download or privileged general fetch/execution bridge is used. The website's already existing caption renderer remains website code. Caption text and Chrome Sync preferences are data, never executable code.

## Data-use disclosures

The privacy policy is public at https://github.com/hwsbula/crunchyroll-censoring/blob/main/docs/PRIVACY.md.

Disclose these handled data categories where the dashboard asks about collection/use (including local processing):

| Category                        | Actual scope                                                                                                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Website content                 | English captions, player/track language metadata and original subtitle text, processed in the current player frame; not uploaded to a developer service                                                                                                                  |
| Web history / browsing activity | Only the current Crunchyroll watch URL, episode/version and caption-resource identity needed to associate the correct player; no browser-history API or permanent viewing-history database                                                                               |
| User activity                   | Playback time/state, selected tracks and extension controls needed to schedule censorship and apply Ignore/Unignore; no analytics or behavioral profiling                                                                                                                |
| User-provided settings/content  | Preferences, custom terms and built-in choices are cached locally and may be transferred by Chrome's built-in Sync service when the extension toggle and Chrome account sync allow it. Explain this in free-text fields even if there is no separate dashboard checkbox. |

No authentication credentials, personally identifying account details, location, financial/health data or personal communications are intentionally accessed. The extension never asks users to put sensitive information into custom terms. Saved local exceptions contain hashes/offsets, not dialogue or signed URLs. Exported settings files contain preferences/word lists only, remain local unless the user shares them, and are excluded from the repository/submission ZIP.

There is no developer backend, sale of data, advertising, analytics, unrelated transfer, creditworthiness/lending use, or human review of a user's settings. Chrome/Google manages the account and transport for optional Chrome Sync; the extension cannot read the account identity or verify another device received data. Commit only synthetic test data and never upload real user backups with the store submission.

The Limited Use certifications must be answered according to these actual practices. Do not promise zero transmission while Chrome Sync is enabled.
