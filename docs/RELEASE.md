# Build and release the current product

For a new extension request, Codex performs the build and verification work in [AGENTS.md](../AGENTS.md) and updates this checklist for the chosen product. The user can start with a short description; this document is not a specification they must complete.

## 1. Prepare the source

- Set the intended product name, version, description, and icons in the source metadata.
- Keep the package and manifest version consistent through the project's build conventions.
- Choose a license before making the source an open-source template; this scaffold does not assign one.
- Update the README, privacy policy, and any user-facing explanation for changed behavior.
- Review requested permissions against implemented features.
- Match `extension.policy.json` to required/optional API and host permissions in the manifest.
- Remove obsolete demo branding, feature code, UI, privacy claims, and tests when building another product.

Chrome requires an increasing version for store updates. The manifest description must be no longer than 132 characters. See [Chrome's preparation guide](https://developer.chrome.com/docs/webstore/prepare).

## 2. Run the verification gates

From a clean checkout with Node.js 24:

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run package
```

Use `npx playwright install --with-deps chromium` when a Linux environment also needs OS packages. Do not mark browser checks successful if the browser could not launch.

The loadable extension is `dist/`. The extension-only archive is `artifacts/<package-name>-<version>.zip`, derived from the current package metadata. `manifest.json` must be at the ZIP root; do not upload the full scaffold/source archive to the store.

## 3. Test the product in Chrome

Load `dist/` at `chrome://extensions` with Developer mode enabled. Use a separate test profile with fixture data when possible.

Verify the primary user workflow and acceptance criteria in [PRODUCT.md](PRODUCT.md), along with relevant failure states, site/permission scope, persistence, keyboard interaction, narrow widths, and reload behavior. If the product connects to an external service, verify actual integration when access is available and clearly identify any unverified service behavior.

### Included demo checklist

The following checks apply to Page Notes. Codex replaces them with the requested product's checks on the first build:

- Invoke the toolbar action on an ordinary HTTP/S page; save, close, reopen, edit, and delete a note.
- Select text on the main page, request capture, and verify that the stored quotation matches.
- Verify empty selection and unsupported/protected-page feedback.
- Open the library, search long titles/text, revisit a page, and delete an entry.
- Export fixture notes, import them into a clean test profile, and check the merge result.
- Try an invalid JSON/schema import and confirm existing records remain unchanged.
- Cancel bulk deletion, verify no change, then confirm deletion using fixture records.
- Reload the extension and confirm saved data survives. Check an edit conflict from two open UI contexts.
- Navigate the popup and library by keyboard; check labels, visible focus, text wrapping, and narrow widths.
- Inspect the extension's error list and service-worker console after these flows.

Automated tests may open extension pages directly or use test-only permission fixtures. That does not prove a toolbar action grants `activeTab` correctly; a real interaction check covers that boundary for products using this permission.

## 4. Inspect the release artifact

Confirm the ZIP contains only required runtime files. It must not contain source maps with private source, test manifests, test-only permissions, local exports, environment files, browser profiles, credentials, or development dependencies.

Check that all scripts, styles, icons, and HTML referenced by the manifest are present and load locally. No executable code may be fetched remotely. Keep a copy of the reviewed source revision, package lock, verification results, and release ZIP together in your normal release records.

## 5. Prepare the Chrome Web Store listing

1. Register or use your Chrome Web Store developer account and complete its current account requirements.
2. Complete the extension's name, summary, detailed purpose, category, language, and support/contact information.
3. Supply the required icons, screenshots, and promotional assets using the dashboard's current specifications.
4. Publish the completed [privacy policy](PRIVACY.md) at an accessible public URL and enter it in the dashboard.
5. Explain the single purpose and why each permission is required.
6. Complete data-use disclosures for the actual product. The included demo handles page URLs, titles, notes, and selected text locally; a different extension may handle or transmit different information.
7. Upload the extension-only ZIP, review the resulting metadata, and submit when ready.

Publication is a separate account action. Passing project checks or creating a valid ZIP does not guarantee store approval. Review the [store preparation guide](https://developer.chrome.com/docs/webstore/prepare), [privacy rules](https://developer.chrome.com/docs/webstore/program-policies/privacy), and [program policies](https://developer.chrome.com/docs/webstore/program-policies/policies) against the final product.

## Updates and recovery

Ship schema changes with tested migrations and preserve users' existing data. Keep an appropriate backup during upgrade tests. If a release needs a code rollback, prepare a corrected build with a new, higher version; do not assume the store will accept a lower version or that older code can read a newer data schema.

Uninstalling is not a data-preserving recovery step: it removes extension-local storage. Document any support recovery procedure before instructing users to remove the extension.
