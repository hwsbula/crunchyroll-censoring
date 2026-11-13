# Build extensions from a short request with Codex Cloud

## Recommended workflow

Set up the repository and reusable environment once using [START_HERE.md](../START_HERE.md). Then describe the extension in a task. Codex owns implementation, testing, debugging, and packaging under [AGENTS.md](../AGENTS.md); your normal build request does not need a technical specification.

Use a GitHub repository for the source, a reusable cloud environment for the toolchain, and local Chrome for a final interaction check. Once setup is complete, describe the extension in ordinary language. Codex implements, tests, builds, and packages it remotely; you load the resulting `dist/` folder in Chrome.

The current product is QuietRoll, an integration preview with documented live-service verification gaps. Its source, UI, permissions, tests and release package replace the original demonstration. No planning approval is required for routine revisions. [AGENTS.md](../AGENTS.md) is the operating guide; Codex maintains [PRODUCT.md](PRODUCT.md) from your request.

Current [Cloud environment guidance](https://learn.chatgpt.com/docs/environments/cloud-environments) describes reusable published environments. From a new task, choose **Work in > Cloud > Select environment > Create environment**, select the repository, and choose **Get started**. Codex can prepare the environment from a conversational setup request. The tested setup can be recorded in **Install script** and **Start skill** fields.

## 1. Create the repository

Create a GitHub repository you control and add the source files from this project. Preserve dotfiles, `AGENTS.md`, and `package-lock.json`. Exclude `node_modules/`, browser profiles, reports, exported notes, `dist/`, and `artifacts/` according to the project's ignore rules.

Keep a clean repository as your template if you plan to build several extensions. Create a new repository from that template for each product so its history, settings, data model, and release versions stay independent.

Connect GitHub to Codex and grant access to this repository. Repository creation, connection, and pushing this scaffold are account steps you perform; downloading the scaffold does not perform them.

## 2. Prepare the cloud environment

Ask Codex to prepare Node.js **24**. Confirm that `node --version` reports `v24.x` and that npm is available. The copy-and-paste setup message in [START_HERE.md](../START_HERE.md) covers dependencies, browser preparation, and verification.

Configure the environment's install/setup command to run from the repository root:

```bash
bash scripts/codex-setup.sh
```

These shell scripts are repository conventions, not special auto-discovered Codex configuration files. The setup command must be entered into the environment or run explicitly. If the environment contains multiple repositories, change to this repository's actual checkout path first; do not assume a universal `/workspace/...` name.

The setup script runs `npm ci`, installs Playwright Chromium, and runs `npm run check`. On Linux, enable installation of missing OS packages by configuring this install command instead:

```bash
CODEX_INSTALL_SYSTEM_DEPS=1 bash scripts/codex-setup.sh
```

This uses the locally installed, locked Playwright version. The environment must permit the OS package installation. If it does not, use an image with those dependencies or run browser tests in the provided CI/local workflow. After setup, run `npm run test:e2e` to verify that the browser can actually launch.

For environments with a maintenance hook, configure:

```bash
bash scripts/codex-maintenance.sh
```

The maintenance helper checks installed dependencies and runs `npm run check` without downloading packages. Where no maintenance field exists, run it explicitly to verify an already prepared environment. After changing `package-lock.json`, rerun the setup script with download access; maintenance does not update dependencies.

Publish the reusable environment after its code checks and actual browser tests succeed, then select it for new tasks. If browser execution is blocked, resolve that environment requirement or choose an allowed test environment; do not record the setup as fully verified. [Codex reads repository `AGENTS.md` guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md); this project supplies the commands and invariants there.

## 3. Configure network access deliberately

Dependency installation needs access to the npm registry. Browser installation also needs the download hosts used by the installed Playwright version; Linux package installation may need the image's package repositories. If a download is blocked, identify the host from the error and adjust the environment's allowed destinations.

Once dependencies and the browser are available, the demo's build and tests use local code and fixtures. Its runtime does not need external APIs or credentials. A new product may require service access, which Codex should configure and document according to its actual needs. A test that uses a loopback fixture server still needs local browser-to-server connectivity.

Browser extension files are visible to their users. If a product needs privileged third-party credentials, Codex must use an extension-appropriate authentication flow or a backend for private secrets. It should complete independent work and identify any credentials/account configuration needed to finish a live integration.

## 4. Run the first task

Copy this into a new Codex task with the repository selected:

```text
Build a Chrome extension that [description]. Follow AGENTS.md. Choose
sensible defaults, ask only questions that materially change behavior,
and deliver a tested installable extension.
```

For example, replace `[description]` with “shows the SEO title, meta description, headings, and missing image alt text for the current page.” Codex derives the requirements and acceptance criteria, removes irrelevant demo features, and delivers the new extension. [FEATURE_REQUEST.md](FEATURE_REQUEST.md) provides optional examples; it is not a required form.

Follow-up requests revise the current product. You can simply say “add CSV export” or “make the panel narrower.” Reopen the same task for unfinished work, and keep important source changes in the repository before starting a separate task. Start a separate scaffold copy for an unrelated extension.

## 5. Review the result

Read the feature summary, material decisions, and check results. For data/permission changes, review the manifest, `extension.policy.json`, and privacy copy. Download or check out the resulting code, run a fresh build when needed, then load `dist/` in Chrome. The packaged filename follows the product's package name and version.

Codex should run `npm run release` itself. This runs `npm run verify` before packaging, so an automated check failure prevents release creation. `npm run package` remains available for an explicitly labeled unverified build when an external blocker prevents a release gate; it is not evidence that browser tests passed.

Perform the product's primary interaction in Chrome. When it uses `activeTab`, opening `popup.html` as a browser tab is useful for automated UI checks but does not grant access the way invoking the extension action does. Any test-only permission used by automation must stay outside the packaged manifest.

Check [RELEASE.md](RELEASE.md) before distributing a build. Cloud task completion does not publish to the Chrome Web Store.

## Common setup failures

| Failure                              | Resolution                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| Node syntax or engine error          | Select Node 24 and rerun installation.                                                 |
| `npm ci` reports a lockfile mismatch | Review the intended dependency change; update and commit its lockfile together.        |
| Browser executable missing           | Install Chromium with the locked Playwright command above.                             |
| Missing shared libraries on Linux    | Prepare the environment with Playwright's OS dependencies.                             |
| Cached setup has stale packages      | Rerun setup or rebuild the environment from the current lockfile.                      |
| Only browser tests are unavailable   | Complete `npm run check`, report the browser limitation, and run E2E locally or in CI. |

Official references: [Codex Cloud](https://learn.chatgpt.com/docs/cloud) and [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
