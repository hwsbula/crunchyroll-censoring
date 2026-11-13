# Start your Chrome Extension Builder project

Once this project is connected to Codex Cloud, give Codex a short description of the extension you want. It should infer requirements, choose sensible defaults, implement the product, test and debug it, then deliver an installable ZIP and its source code. [AGENTS.md](AGENTS.md) defines that workflow.

These files prepare the project. They do not create a GitHub repository or publish a Codex Cloud environment in your account.

## One-time setup

### 1. Put the project in a repository

Extract the download and put the project contents in a GitHub repository you control. A suitable template repository name is `chrome-extension-builder`. Keep `AGENTS.md`, `package.json`, and the lockfile at the repository root, and preserve the included dotfiles and `.github` directory.

Use Git so `.gitignore` excludes installed dependencies, generated builds, exports, and test output. If uploading through a web interface, exclude those folders yourself; `.gitignore` does not filter a browser upload.

Keep a clean template and make a separate copy/repository for each unrelated extension. Follow-up requests for the same extension belong in its existing project.

### 2. Create the Codex Cloud environment

In a new task, select **Work in > Cloud > Select environment > Create environment**. Select the repository, connect GitHub if prompted, and choose **Get started**. You can also create the environment from **Settings > Codex Cloud > Environments**.

Give the environment a recognizable name, such as **Chrome Extension Builder**.

### 3. Give Codex this setup message

Paste this into the environment setup conversation:

```text
Prepare this repository as my end-to-end Chrome extension development project.

Read START_HERE.md and AGENTS.md. Use Node.js 24 and the committed npm lockfile.
Run bash scripts/codex-setup.sh from the repository root. Install the Linux
browser dependencies when needed and permitted, using
CODEX_INSTALL_SYSTEM_DEPS=1 bash scripts/codex-setup.sh.

Run npm run test:e2e to confirm that the real Chromium extension tests work
in this environment. Fix setup problems you can resolve. If a permission,
credential, or environment restriction prevents a check, state the exact
blocker without bypassing it or marking the check as passed.

Record the working setup command in the environment's Install script.
Keep the example extension until I describe the extension I want to build.
Summarize whether the environment is ready for implementation and browser tests.
```

Allow the dependency and browser downloads required by setup. Review the setup result, save changes, and select **Publish** after the environment checks succeed. More details are in [CODEX_CLOUD.md](docs/CODEX_CLOUD.md).

The supplied example has passed its code/build checks; its browser tests still need to run in the environment you prepare. See the [verification status](README.md#verification-of-this-supplied-scaffold).

## Each time you want an extension

Select the prepared environment and start a task with an ordinary request:

```text
Build a Chrome extension that checks the current page's SEO title,
meta description, heading structure, canonical URL, and missing image alt text.
Follow AGENTS.md and complete the extension end-to-end.
```

Your description can be shorter. Optional preferences such as “use a side panel,” “only on my WordPress sites,” or “keep everything on this device” help when you already have a preference. Codex should decide routine details and ask only consequential questions.

Codex owns requirements, implementation, testing, debugging, documentation, and packaging. It runs `npm run release` so code and browser checks must pass before the release ZIP is created. A blocked verification step must be labeled unverified.

## What you receive

- Source code implementing your requested extension.
- A loadable `dist/` folder.
- `artifacts/<package-name>-<version>.zip` and its checksum.
- Installation instructions, material design decisions, and actual verification results.

Install by extracting the files, opening `chrome://extensions`, enabling Developer mode, choosing **Load unpacked**, and selecting `dist/`. The Page Notes example is replaced when you request your real extension.

Keep important code changes in the repository. Continue the same task when work is unfinished; a separate cloud task has its own working files. For the same product, subsequent requests such as “add CSV export” should revise it while preserving accepted behavior.

If you also want Chrome Web Store submission, include that in your request. Codex can prepare listing materials and perform authorized steps when account access is available; the developer account, required owner information, and store review remain external requirements.

Official setup reference: [Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments).
