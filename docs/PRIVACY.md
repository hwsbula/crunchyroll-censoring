# CrunchyRoll Censoring privacy policy

Applies to version 0.1.7 and later. CrunchyRoll Censoring is an independent extension, not affiliated with or endorsed by Crunchyroll. Support and privacy contact: https://github.com/hwsbula/crunchyroll-censoring/issues. No extension account, developer backend, advertising, analytics, telemetry, paid API or cloud transcription is used.

## Caption and player processing

The extension uses the active Crunchyroll watch-page identity, current episode/version, audio/subtitle language metadata, English captions and playback state solely to filter the selected episode and provide occurrence review, seeking and Ignore/Unignore. It observes page-initiated metadata requests and reads player-supplied English caption URLs with ordinary HTTPS/CORS and `credentials: omit`. It does not use Chrome's history API or create a permanent viewing-history database.

Manual episode timing corrections are held only in the current player frame, reset on episode navigation or reload, and are excluded from saved settings, backups and Chrome Sync.

Complete caption documents, original cue text and occurrence/action logs stay in the current player frame's memory. They are discarded on episode/player invalidation or page closure. The popup/action list is bounded to 1,000 entries; in-memory scheduling is limited to 20,000 matches. Signed caption-resource URLs are only retained transiently in the local player integration, never persisted or logged. The extension does not read cookies, authorization headers, access tokens, passwords, account email or identity, protected media, microphone input or DRM content, and does not bypass subscriptions or access controls.

Custom terms/preferences are passed to the extension's local filtering integration in the current page execution context. They are not secrets; do not enter passwords or other sensitive information as terms. Page/extension messages are validated and expose no general privileged fetch or execution interface. Executable extension code is packaged locally.

## Local preferences and occurrence exceptions

Preferences, custom words/phrases and disabled built-ins are saved in `chrome.storage.local` for durable offline playback. The legacy `quietroll.v1` key is retained so upgrades preserve data. Up to 1,000 occurrence exceptions are local only: SHA-256 episode/version/track/cue/term identifiers and match offsets, rather than dialogue, titles, timestamps or signed URLs. They can correlate an exact repeated occurrence on this device. **Term settings → Clear saved exceptions** removes them without erasing preferences. Storage access is restricted to trusted extension contexts; settings needed for filtering are sent to the current player through the validated extension bridge.

Bounded tab/frame/document routing descriptors use `chrome.storage.session`, are pruned on tab closure and disappear with the browser session. No transcript or occurrence log is written to extension storage. The extension does not add its own encryption to local settings or backup files. Uninstalling removes local extension storage; export settings before changing extension IDs or removing an installation if you want to retain them.

## Chrome settings sync

**Use Chrome settings sync** starts enabled and can be disabled independently on each installation. Only saved filtering preferences (enabled state, language override, reveal preference, mute padding), custom terms and disabled built-in choices are placed in `chrome.storage.sync`. Captions, resource URLs, episode identities, local occurrence exceptions, playback logs, account credentials and routing data are excluded.

When your Chrome profile has account sync enabled, Chrome/Google can transfer that settings data between installations of the same extension ID. When account sync is off or Chrome is offline, Chrome may retain the sync-area copy locally and send it later when you enable/resume syncing. The extension cannot read your Google account identity, confirm delivery to another device or separately access Google's servers. Chrome's account settings and Google's privacy policy govern that service. There is no developer-operated server or third-party analytics endpoint receiving the data.

Settings are sent as size-bounded chunks with a complete-profile integrity manifest. Missing, invalid, conflicting or over-quota profiles leave the durable local preferences active and show a status/choice in settings. Cloud failures do not discard locally saved edits. The conservative per-profile sync budget is 44 KB; very large custom lists may require a backup transfer instead. Local sync metadata records a content hash and pending/conflict state, not viewing history.

To stop this extension writing/reading synced preferences on a device, turn **Use Chrome settings sync** off. To remove its synced profile, turn sync off on your other installations, then confirm **Remove synced settings** on one device. This removes this extension's namespaced sync keys and turns sync off there, keeping local preferences. Removal propagates through Chrome's sync service; an installation still enabled with an edit pending can upload again. Manage account-level sync data through Chrome/Google as well; do not rely on uninstall alone to manage every account/device copy.

## Settings export and import

**Export saved settings** creates a JSON download containing preferences and word choices only. It excludes local occurrence exceptions, transcripts, timestamps, logs, credentials, extension/account IDs and sync transport metadata. The extension does not upload backup files. You control any later sharing and can delete a downloaded backup using your computer's normal file controls. Import validates the format, size and values, shows a preview and requires confirmation before replacing preferences. Local occurrence exceptions remain unchanged. Imported preferences can enter Chrome Sync if the sync toggle is enabled.

## Sharing, security and limited use

Data is used only for the described filtering, review, settings backup and user-controlled Chrome Sync features. It is not sold, used for advertising/profiling, shared with a developer service, used for creditworthiness/lending, or used for unrelated purposes. Caption processing is local; only user preferences/word choices may be transferred by Chrome Sync. There is no remote executable code.

The only API permission is `storage`; host access is limited to the Crunchyroll desktop origin and the source-identified static Vilos player origin. No every-website access, identity, history, microphone, capture or downloads API permission is requested. See the public source, `extension.policy.json`, and `docs/TERMS.md` for scope, term ambiguity and filtering limitations.
