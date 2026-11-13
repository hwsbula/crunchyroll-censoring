# Chrome Extension Builder — Codex Cloud scaffold

**Describe the Chrome extension you want. Codex turns that description into a working, tested, installable extension.**

This project supplies the build tools, agent instructions, tests, and packaging workflow. Codex chooses sensible defaults, implements the complete product, and asks questions only when the answer would materially change the result. You do not need to prepare a technical specification.

**Start with [START_HERE.md](START_HERE.md).** It explains the one-time project setup and provides the setup message to give Codex. The files are prepared; the GitHub repository and Codex Cloud environment still need to be created or connected in your account. After setup, your normal input is simply the extension idea.

**Page Notes is the included example extension.** It supplies implemented popup, storage, capture, and library workflows; a new extension request replaces the relevant demo features, branding, data model, and tests. Later requests revise your new product while preserving decisions that still apply.

## Start in three steps

1. **Download and extract the scaffold.** Keep a clean copy for future extension projects.
2. **Put it in your GitHub repository and select that repository in Codex Cloud.** Use Node.js 24 and configure the environment's install/setup command as shown below. See [Cloud setup](docs/CODEX_CLOUD.md) for the account and environment steps.
3. **Describe your extension in a Codex task.** Use ordinary language. Codex reads `AGENTS.md`, records its working assumptions, builds the product, runs checks, and produces `dist/` plus an extension ZIP.

Environment install/setup command, run from the repository root:

```bash
bash scripts/codex-setup.sh
```

On Linux, use `CODEX_INSTALL_SYSTEM_DEPS=1 bash scripts/codex-setup.sh` if the environment needs Playwright's OS packages and permits installing them. These scripts must be configured or run explicitly; Codex does not discover them automatically by filename.

### Your first request

```text
Build a Chrome extension that [description]. Follow AGENTS.md. Choose
sensible defaults, ask only questions that materially change behavior,
and deliver a tested installable extension.
```

For example:

```text
Build a Chrome extension that closes duplicate tabs in my current window
when I click a button. Keep one copy of each page and tell me how many
were closed. Follow AGENTS.md and make sensible decisions for the rest.
```

```text
Build a Chrome extension that lets me highlight text on a webpage and
save it in a searchable reading list. It should work without an account.
```

```text
Build a Chrome extension that helps me inspect a page's SEO title,
meta description, heading structure, and image alt text.
```

You can also add preferences such as “use a side panel,” “only on my WordPress sites,” or “keep everything on this device.” If omitted, Codex decides what fits the goal. [More request examples](docs/FEATURE_REQUEST.md) are optional.

### What Codex should deliver

A working implementation of the requested features, appropriate permissions, useful error and empty states, updated tests and documentation, a loadable `dist/` folder, and `artifacts/<package-name>-<version>.zip`. It should explain any actual verification limit or integration requirement. The workflow is defined in [AGENTS.md](AGENTS.md); [PRODUCT.md](docs/PRODUCT.md) is maintained by Codex, not a form you must fill out.

Codex owns implementation, testing, debugging, and packaging. `npm run release` runs the code checks and browser suite before creating the release ZIP. A failed gate stops that command; unresolved verification gaps must be reported explicitly. You review the result and install it in Chrome. Store submission is included when you request it and provide the necessary account access.

## Try the included Page Notes demo

The download includes a built `dist/` folder, so trying the demo does not require Node.js.

1. Extract the project to a permanent folder.
2. Open `chrome://extensions` in Google Chrome and enable **Developer mode**.
3. Choose **Load unpacked**, select **`dist`**, and pin **Page Notes**.
4. Visit an ordinary HTTP/S page, click the extension icon, write a note, and save it.

Reopen the popup to edit or delete the page's note. Select text on the main page, open the popup, and request capture to save a quotation. The library/options page provides search, revisit, delete, JSON export/import, and confirmed bulk deletion.

The demo stores data in the current Chrome profile with no account, backend, analytics, or runtime network calls. Local storage and exports are not encrypted by the extension. Uninstalling removes saved local notes; exported files remain wherever you saved them.

Chrome protects internal browser pages and the Chrome Web Store from this capture flow. The demo captures the main document's selection, excluding form values and embedded frames. These are demo choices; a different product receives its own appropriate design.

## Develop and verify locally

Use Node.js **24**. From the repository root:

```bash
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
npm run package
```

On Linux, `npx playwright install --with-deps chromium` also installs required OS packages where permitted. The setup script runs installation and the non-browser checks; browser tests verify that the environment can actually launch Chromium.

| Command            | Purpose                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `npm ci`           | Install the committed dependency tree.                                    |
| `npm run check`    | Check formatting, lint, types, unit tests, build, and output validation.  |
| `npm run test:e2e` | Run integration tests against the built extension in Playwright Chromium. |
| `npm run build`    | Build the loadable `dist/` directory.                                     |
| `npm run dev`      | Rebuild source changes; extension reload remains manual.                  |
| `npm run package`  | Build `artifacts/<package-name>-<version>.zip`.                           |
| `npm run release`  | Require all code/browser checks to pass, then create the extension ZIP.   |

After a rebuild, click **Reload** on the extension's card at `chrome://extensions`, then reopen its UI. The watch command does not provide browser hot reload. Before release, test the actual user interaction in Chrome; opening a popup URL directly does not verify a real toolbar `activeTab` grant.

## Project map

| Location                | Purpose                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| `AGENTS.md`             | The autonomous builder's operating instructions.                  |
| `START_HERE.md`         | One-time setup and the setup message for Codex.                   |
| `docs/PRODUCT.md`       | Codex-maintained purpose, decisions, and acceptance criteria.     |
| `src/`                  | Product logic, UI, messages, storage, and capture code.           |
| `public/`               | Manifest, packaged HTML/CSS, and icons.                           |
| `extension.policy.json` | Explicit inventory of required/optional API and host permissions. |
| `scripts/`              | Build, validation, packaging, and Cloud helpers.                  |
| `tests/`                | Unit and browser tests for the current product.                   |
| `dist/`                 | Generated extension loaded by Chrome.                             |
| `artifacts/`            | Generated extension ZIPs.                                         |

The default stack is strict TypeScript, native HTML/CSS, esbuild, Node's test runner, Playwright, ESLint, and Prettier. The demo targets Chrome 120+ and has no third-party runtime dependencies. Codex can change product-specific architecture when the requested functionality justifies it.

## Reuse and release

Create one repository from a clean scaffold for each new extension. In an existing product, follow-up requests are revisions. For a new product, Codex should remove irrelevant demo code and update the name, icons, metadata, package filename, permissions, tests, README, architecture, and privacy copy together.

The ZIP is ready to load after extraction. Chrome Web Store publication additionally requires a developer account, listing materials, accurate disclosures, and review. See [RELEASE.md](docs/RELEASE.md). No open-source license has been assigned; choose one before distributing the source as an open-source template.

## Troubleshooting

### Verification of this supplied scaffold

Formatting, ESLint, strict TypeScript, 37 unit tests, the production build, manifest/permission/CSP checks, and ZIP creation passed. The five Playwright extension scenarios are included but could not run in the generation workspace: its shell denies Chromium's local Unix sockets, and its managed browser blocks unpacked extension installation. This is a verification gap, not a passing browser result. Run `npm run test:e2e` in the configured Cloud environment, CI, or your local development environment, then complete the real toolbar interaction check before distributing the extension.

### Common issues

| Symptom                         | Check                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| Chrome cannot find the manifest | Select `dist/`, not the source directory or ZIP.                                           |
| Changes do not appear           | Wait for the build, reload the extension, and reopen its UI.                               |
| Browser tests cannot launch     | Install the locked Playwright Chromium and required OS packages.                           |
| Permission validation fails     | Review the manifest and `extension.policy.json`; update both for justified product access. |
| Demo capture is empty           | Select text in the main page before invoking the toolbar action.                           |
| Demo save reports a conflict    | Copy the unsaved draft, then reopen the note to load its latest revision.                  |

References: [Codex Cloud](https://learn.chatgpt.com/docs/cloud), [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Chrome extension loading](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world).
