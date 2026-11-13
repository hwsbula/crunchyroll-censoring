# Current demo architecture

This document describes the included Page Notes demonstration, not a fixed design for every extension. No product has been selected from this scaffold yet. On a new product request, Codex chooses the appropriate architecture, replaces irrelevant demo code, and updates this document. The reusable operating rules are in [AGENTS.md](../AGENTS.md); inferred requirements and decisions belong in [PRODUCT.md](PRODUCT.md).

## Product boundary

Page Notes saves one note record per normalized HTTP/S page URL. The popup handles the current page; the library/options page manages all saved records. Selection capture is explicit. The extension does not track browsing in the background, inject persistent scripts, synchronize data, or contact a server.

The implementation uses strict TypeScript and native DOM APIs. esbuild turns source into packaged JavaScript. Development dependencies do not become runtime services or external downloads.

## Execution contexts

| Context                  | Responsibility                                                                           | Trust boundary                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Popup                    | Read the current page, edit a note, request capture/save/delete.                         | Validate form inputs; render page and note strings as text.               |
| Library/options page     | Search/open/delete records, export/import JSON, confirm bulk deletion.                   | Treat imported files as untrusted; use the worker's mutation path.        |
| Extension service worker | Validate messages and senders, apply domain rules, serialize writes, access Chrome APIs. | Reject unrecognized requests and unauthorized sender contexts.            |
| Injected function        | Read the current main-document selection on request.                                     | Treat all values from the webpage as untrusted.                           |
| `chrome.storage.local`   | Persist versioned state between popup closures and worker restarts.                      | Restrict access to trusted extension contexts and validate stored values. |

Chrome may suspend the worker when idle. Event listeners register at module top level; durable state comes from storage, not assumed process lifetime. See [Chrome's worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and [event registration guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/events).

## Permissions and capture

| Permission  | Implemented reason                                                                 |
| ----------- | ---------------------------------------------------------------------------------- |
| `activeTab` | Temporarily read the current tab's URL/title after the user invokes the extension. |
| `scripting` | Execute the packaged selection-capture function on the user-authorized page.       |
| `storage`   | Save and retrieve notes in extension-local storage.                                |

The current inventory is recorded in [extension.policy.json](../extension.policy.json) and validated against the manifest, including optional permissions and host access. The demo has no persistent host permissions. A new product can change this inventory when its implemented features require different access. [Chrome documents `activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) as temporary access associated with a user gesture. Browser-internal pages and other protected contexts can still reject access.

`src/content.ts` exports a self-contained function. The worker imports it and passes it to `chrome.scripting.executeScript` as `func`. Chrome serializes the function: it cannot depend on imported helpers or closed-over module variables at execution time. All required values must be local to the function or passed explicitly as arguments. It runs in the isolated world and main frame, without a persistent content-script bundle.

See [the scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) for injection semantics. Captured content is data, never executable HTML. A missing selection, restricted page, closed tab, or navigation during capture is an expected failure case and needs useful UI feedback.

## Messages and writes

UI pages send explicit operation messages to the worker. The worker validates both the message and its origin before using privileged APIs. Replies use JSON-compatible success/error envelopes. Async handlers retain the `sendResponse` plus literal `return true` pattern for the supported Chrome baseline.

The worker is the single writer. Mutations run through a queue so multiple open UI contexts cannot interleave read/modify/write operations. Revision checks protect against a stale editor overwriting a newer save. The queue coordinates a running worker; it is not durable storage and is not a substitute for awaiting persistence.

The popup and library both use this mutation path. Unsupported or malformed stored schemas fail closed instead of silently resetting user data. A new product may use a different persistence model, with an explicit migration or isolated schema if it needs to preserve existing data.

## Data model and limits

| Value              | Rule                                                            |
| ------------------ | --------------------------------------------------------------- |
| Page identity      | HTTP/S URL, fragment omitted, query parameters retained.        |
| URL credentials    | Reject URLs containing a username or password.                  |
| Record count       | At most 200 notes after any mutation or import merge.           |
| URL length         | At most 2,048 characters.                                       |
| Title length       | At most 240 characters.                                         |
| Note length        | At most 5,000 characters.                                       |
| Quotation length   | At most 2,000 characters.                                       |
| Import/export size | At most 5,000,000 bytes; writes preserve this round-trip bound. |
| Persistence        | Versioned records in `chrome.storage.local`.                    |

Queries are retained because they can identify different pages, such as product IDs or search results. Consequently saved URLs and exports can contain sensitive query values. Fragments are omitted so ordinary in-page anchors share the same note. Hash-based applications may need a different identity rule; changing that rule requires an explicit compatibility decision.

The browser storage quota remains a separate limit. Application bounds help control data size but do not replace catching rejected storage writes. Local storage is not encryption. See [Chrome storage behavior](https://developer.chrome.com/docs/extensions/reference/api/storage) and [PRIVACY.md](PRIVACY.md).

## Import and export

Export generates JSON in the user's browser. It is not sent to the developer. Import reads a selected file, validates its schema and all records, enforces limits on the resulting merged collection, and only then persists the merge. Opening saved links uses validated HTTP/S URLs.

For a matching page URL, a strictly newer imported `updatedAt` replaces the saved record; an equal or older imported timestamp keeps the existing record. Duplicate URLs within an import keep their newest entry; equal timestamps keep the first entry. Imported replacements receive new revisions so an open editor detects the change. Imports merge rather than erasing pages absent from the file.

Keep import parsing separate from state mutation so invalid data cannot produce a partial import. Do not restore executable values, arbitrary prototype properties, or unknown schema versions from imported objects. Preserve the duplicate-resolution policy when changing merge behavior.

## Build and package boundary

`npm run build` produces `dist/`, the directory Chrome loads. HTML refers to packaged JavaScript and CSS; there is no remote runtime loader. The manifest and every referenced asset must exist in the built output. Source is the authority; build output is replaceable.

`npm run package` creates `artifacts/<package-name>-<version>.zip` with `manifest.json` at the archive root. The filename follows package metadata, so renaming the product also renames its artifact. It is separate from a source-code archive. Output validation checks the actual bundle and permission inventory.

## Testing responsibilities

- Unit tests cover domain rules, URL handling, import validation, data limits, and mutation behavior without needing a browser.
- Browser tests exercise the built extension UI and worker through Playwright Chromium with local fixtures.
- A manual Chrome check covers real toolbar invocation, `activeTab`, keyboard interaction, protected pages, reload behavior, and final packaged assets.

Opening the popup URL directly is insufficient to verify the user gesture that grants page access. Any automated fixture that supplies extra access must be isolated from release output and described honestly in test results.

For a new product, replace demo-specific tests with meaningful coverage of its actual workflows. Preserve applicable build and security checks. A page monitoring product, for example, needs lifecycle and site-scope tests rather than unused note import tests.

## Adapting the scaffold

Codex can choose a popup, side panel, options page, context menu, content script, remote API, or another supported extension capability as the brief requires. The three demo permissions, local-only behavior, note limits, and URL identity rules are not permanent restrictions. Changes should remain specific to the implemented product and be reflected in its permission inventory, tests, architecture, and privacy copy.
