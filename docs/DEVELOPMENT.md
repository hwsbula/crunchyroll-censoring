# Development and publishing

## Local setup

Use Node.js 24 and npm 11 with the committed lockfile. Run these commands from the repository root:

```bash
npm ci
npx playwright install chromium
npm run build
```

Linux environments may also need Playwright's OS dependencies; use `npx playwright install --with-deps chromium` where permitted. If the environment supplies a separate browser cache, set `PLAYWRIGHT_BROWSERS_PATH` to its actual location. Cloud-specific setup is documented in [CODEX_CLOUD.md](CODEX_CLOUD.md).

Load `dist/` as an unpacked extension in a development Chrome profile. Keep that profile separate from any store installation used for normal watching. `npm run dev` rebuilds source; Chrome still requires extension **Reload**, followed by reloading the episode.

Edit source and public assets, rather than generated `dist/`. Keep generated packages, browser profiles, private exports, and account data out of Git. See [architecture](ARCHITECTURE.md), [term matching](TERMS.md), and the repository's [agent instructions](../AGENTS.md) for implementation constraints.

## Checks and packaging

| Command                 | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `npm run build`         | Build `dist/` and validate the production manifest/assets              |
| `npm run check`         | Formatting, lint, strict TypeScript, unit tests, build, and validation |
| `npm run test:e2e`      | Build and exercise the unpacked extension in Playwright Chromium       |
| `npm run package`       | Build and create the versioned ZIP and checksum                        |
| `npm run release`       | Require all source/browser checks before packaging                     |
| `npm run release:store` | Run the release gate and prepare Web Store upload/submission materials |

The local extension archive is `artifacts/crunchyroll-censoring-<version>.zip`, with `manifest.json` at its root. A build or packaging command alone does not establish that browser tests passed.

Browser tests use synthetic player fixtures. For player integration changes, also use the [live verification checklist](COMPATIBILITY.md#live-verification-checklist) when service access is available. Record any unavailable checks explicitly; passing fixtures does not prove universal live compatibility. Historical results are in [RELEASE.md](RELEASE.md).

## Publish a GitHub release

The [Publish extension workflow](../.github/workflows/release.yml) tests and builds an exact existing tag, then attaches an installable ZIP and SHA-256 checksum to its GitHub Release. Pushing a tag by itself does not trigger this workflow; its triggers are manual dispatch and a published-release event.

For a new version:

1. Update the package, lockfile, and `public/manifest.json` versions together. Run `npm run release` and perform the applicable live checks.
2. Push the change through a pull request, let CI pass, and merge the tested version into `main`.
3. Create and push a new `v<version>` tag on that tested commit. Confirm the tag's version agrees with the package and manifest. Preserve published tags; corrections ship under a higher version.
4. Choose **Actions → Publish extension → Run workflow**, select `main`, and enter the existing version tag. The workflow checks out that exact tag without moving it.
5. Wait for the workflow to pass. Verify the release contains `crunchyroll-censoring-<version>-extension.zip` and its `.sha256` file, and that the ZIP has `manifest.json` at its root.

If no release exists, the workflow creates a draft, uploads both verified assets, and publishes it after the uploads succeed. An existing draft remains a draft for the publisher to publish. Existing published releases can receive missing assets when GitHub permits it. An existing asset with different bytes causes failure and is preserved rather than overwritten.

With immutable releases enabled, create a draft using the existing tag, run the workflow while that release is still a draft, then publish it after verifying the assets. An immutable published release cannot accept new assets.

The built-in GitHub token handles uploads; no personal token is needed. Start a new workflow run after changing the workflow definition. Rerunning an old failed run uses its old definition; editing release notes does not trigger a build.

The separate [Extension checks workflow](../.github/workflows/ci.yml) also retains generated packages as run artifacts. GitHub's automatic **Source code** downloads are tracked source snapshots and cannot be loaded directly as the built extension.

## Update the Chrome Web Store item

Run `npm run release:store`. Upload `artifacts/crunchyroll-censoring-<version>-webstore.zip` to the **existing store item**, preserving its extension ID. The separate `-submission-kit.zip` contains screenshots, listing text, disclosures, and reviewer instructions; it is not the extension upload.

Follow the [Web Store publishing checklist](../store/PUBLISH.md), update relevant privacy/listing disclosures, and submit for Google's review. GitHub publication does not upload to the store. Store approval and real cross-device sync delivery require separate verification.
