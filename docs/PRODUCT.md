# Current product

**Status: scaffold demonstration; browser verification incomplete.** The user has not yet selected the product to build from this copy.

Codex maintains this file. On the first real extension request, replace the demo description with the inferred product goal, material decisions, and acceptance criteria. The user can start with one sentence and does not need to complete this document. Operational instructions live in [AGENTS.md](../AGENTS.md).

## Included demonstration: Page Notes

**Purpose:** Save a personal note and an optional selected quotation for a web page, then find and manage saved notes.

**Audience:** Someone collecting small pieces of information while browsing, without an account or remote service.

## Current decisions

| Decision                                                  | Reason                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Popup for the current page; separate library/options page | Keep capture quick while providing room for managing saved records.             |
| Local-only storage; no account or network service         | The demo does not need sharing or synchronization.                              |
| `activeTab`, `scripting`, `storage`                       | Support explicit page capture and persistence without permanent website access. |
| Main-document capture, excluding forms                    | Bound the example's page access to selected reading content.                    |
| Versioned storage, serialized writes, revision checks     | Preserve saved data and reject stale edits.                                     |
| URL fragments ignored, queries retained                   | Share notes across ordinary in-page anchors while preserving page identifiers.  |
| At most 200 notes with bounded fields                     | Keep the example's storage and import behavior predictable.                     |

The exact current permission inventory is [extension.policy.json](../extension.policy.json). These choices apply to the demo; replace them when the requested product has different needs.

## Demo acceptance criteria

- The toolbar popup identifies a supported HTTP/S page and saves, reopens, edits, or deletes its note.
- Selection capture happens on request and reports unavailable access or empty selection clearly.
- The library searches saved records, opens their pages, and deletes individual entries.
- JSON export/import preserves valid records using the documented merge policy; invalid imports do not partially mutate data.
- Bulk deletion requires confirmation. A stale edit cannot silently replace a newer record.
- Data survives popup closure and worker/browser restart without a server.
- The built extension loads in Chrome, passes the applicable automated checks, and packages with the manifest at the ZIP root.

## On the next build request

Codex should infer the product from the user's description, record material defaults and acceptance criteria here, and implement it immediately. Resolve routine choices without questions. Ask only about consequential ambiguities that cannot reasonably be inferred, while completing independent work. Replace demo behavior and its supporting tests/docs rather than adding an unrelated product beside it.

After that first build, keep this file current as the user requests revisions. Record only decisions that affect the product; avoid an unnecessary implementation diary.

## Delivery status

Codex updates this section for the current product, including which acceptance criteria were actually exercised.

- Product/version: Page Notes demonstration, 1.0.0.
- Source checks: formatting, lint, strict TypeScript, and 37 unit tests passed in the creation workspace.
- Build/package checks: production build, manifest/permission/CSP validation, and ZIP validation passed.
- Browser acceptance criteria: unverified. The creation workspace blocked automated Chromium startup and unpacked extension installation. Run the included five browser scenarios and the actual toolbar interaction in a permitted environment.
- Artifacts: `dist/` and `artifacts/page-notes-1.0.0.zip`.
- Release gate: `npm run release` requires code checks and browser tests to pass before packaging. The supplied demo archive is a build with the browser-verification gap described above.
- Account setup: repository connection and Codex Cloud environment creation/publication remain to be completed in the user's account.
