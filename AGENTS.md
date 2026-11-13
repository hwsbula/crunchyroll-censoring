# Chrome extension builder instructions

## Mission

Turn the user's plain-language idea into a fully working, tested, installable Chrome extension. A brief description is sufficient. Deliver the implementation and package, not only a plan, scaffold, mockup, or suggestions.

Infer the goal, primary workflow, necessary features, useful defaults, and acceptance criteria. Decide routine architecture, UI, storage, naming, and tooling details yourself. Ask only when an unresolved choice materially changes behavior, access, integration, or scope and cannot reasonably be inferred. Do all useful unblocked work first. Do not require a questionnaire, completed specification, or planning approval.

Read `README.md`, `docs/PRODUCT.md`, and the relevant source before editing. Maintain a short `docs/PRODUCT.md` yourself with the current purpose, decisions/assumptions, and observable acceptance criteria. It is a work record, not a user task or a prerequisite for implementation.

## End-to-end workflow

For a new extension, own the entire development loop:

1. Derive a focused product goal and observable acceptance criteria from the user's description. Record material assumptions in `docs/PRODUCT.md` and proceed without a planning approval step.
2. Choose appropriate Chrome APIs, UI surfaces, permissions, storage, and integrations. Resolve routine choices yourself; ask only about consequential decisions that cannot reasonably be inferred.
3. Implement the complete requested workflow, including its interface, icons, data handling, background behavior, and useful failure states. Replace irrelevant demo functionality and branding.
4. Exercise the primary user workflow and applicable failure paths. Run code checks and browser tests, diagnose failures, fix the cause, and repeat the affected checks until they pass. Do not ask the user to implement code or run commands that the configured environment can run.
5. Run `npm run release` to require the code checks and browser suite before generating the release ZIP. Inspect the actual packaged manifest and assets; keep test permissions and private data out of the release.
6. Update product, architecture, privacy, and installation documentation. Record verification outcomes and the final artifact paths in `docs/PRODUCT.md`.
7. Deliver the finished source changes, loadable `dist/`, versioned extension ZIP, installation instructions, and a concise account of what was verified. Continue with requested revisions while preserving accepted behavior.

Completion requires implemented acceptance criteria, passing applicable code/browser checks, and a valid installable package. If an environment restriction, missing credential, or external service blocks a gate, complete independent work and label that gate **unverified** with the exact remaining requirement. A successful `npm run package` alone does not satisfy the release gate. Do not weaken checks or describe unverified behavior as production-ready.

The default deliverable is the extension and its installation package. When the user also requests Chrome Web Store submission, prepare the listing and disclosure materials and perform authorized account actions when access is available; report the actual submission/review status.

## New product versus revision

- Page Notes is a replaceable demonstration, not a permanent product requirement.
- On the first request for a different extension, transform the demo into that product. Replace its UI, business logic, messages, storage model, branding, and tests where irrelevant.
- Remove unused demo features, code, controls, permissions, and assets. Reuse the verified build/test/package foundation and appropriate existing helpers.
- Update `public/manifest.json`, `extension.policy.json`, package metadata, icons, README, product/architecture/privacy docs, validation assumptions, and release tests together.
- Packaging derives its filename from package name/version. Choose metadata that identifies the new extension; do not leave Page Notes naming in an unrelated product.
- A follow-up within an established product is a revision: preserve accepted behavior, branding, data, and design unless the user requests a change.
- If existing user data is present, preserve it through a deliberate migration or isolated new schema; do not erase it as part of renaming the demo.

## Sensible defaults

- Use Manifest V3, strict TypeScript, native HTML/CSS, and the existing esbuild pipeline unless requirements justify another approach.
- Choose the simplest useful surface: popup, options page, side panel, context menu, or page UI according to the task. Do not retain surfaces merely because the demo has them.
- Prefer local storage when the product needs persistence without sharing; add sync or a remote service when it serves the requested use case.
- Choose minimal permissions from implemented features. Prefer user-initiated or optional access when it meets the workflow; persistent content scripts or host access are allowed when required.
- Use restrained styling, readable typography, coherent spacing, native controls, visible keyboard focus, and accessible labels/status feedback.
- Include necessary empty, loading, error, and permission-denied states. Avoid placeholder buttons or controls with no behavior.
- Verify current official documentation when using unfamiliar APIs, new permissions, or external integrations.

## Toolchain and commands

- Use Node.js 24 and npm with the committed lockfile; install with `npm ci`.
- Keep local TypeScript imports explicitly suffixed `.ts`; keep strict types enabled.
- `npm run check` runs formatting, lint, types, unit tests, build, and output validation.
- `npm run test:e2e` runs the built extension in Playwright Chromium; install its browser/OS dependencies through environment setup.
- `npm run package` builds `dist/` and `artifacts/<package-name>-<version>.zip`.
- `npm run release` runs all code and browser checks, then packages only if they succeed.
- `npm run dev` rebuilds source; Chrome still requires a manual extension Reload.
- Configure the Cloud setup helpers explicitly. Their filenames are not auto-discovered.
- Keep dependency additions justified and lockfiles consistent. Keep build-time Node APIs out of browser bundles.

## Security and permissions

- Keep the supported Chrome baseline explicit; the demo uses Chrome 120+. Deliberately update compatibility metadata/tests when features require newer APIs.
- Register service-worker listeners synchronously at module top level. Do not rely on a permanently running worker.
- Use `chrome.*` APIs and async message responses compatible with the chosen baseline; the current pattern uses `sendResponse` and literal `return true`.
- Validate message type, payload, sender identity, and allowed context before privileged operations. Treat page content, imports, storage, and service responses as untrusted.
- Render text with `textContent` or input values. Never evaluate user/page strings as HTML or executable code.
- Keep injected functions self-contained; Chrome does not preserve their original closures. Prefer the isolated world and limit frames/access to what the feature needs.
- Match the manifest's required/optional API and host permissions exactly to `extension.policy.json`. Update both for a justified new feature and record the reason in `docs/PRODUCT.md`; never disable validation to pass a check.
- Package executable code locally. No remote scripts, inline JavaScript, `eval`, or `new Function`.
- Keep a restrictive CSP and make any necessary resource/network changes specific to the feature.
- Remote APIs are allowed when appropriate. Use extension-appropriate authentication and secure transport; never bundle private API keys, client secrets, signing keys, or passwords.
- Keep sensitive data out of logs, fixtures, source control, and reports. Update privacy disclosures for actual data access, storage, transmission, retention, and deletion.
- Restrict extension storage access to trusted contexts when content scripts do not need it. Keep durable state outside worker globals.

## Data integrity

- Use a consistent mutation path, await persistence, and handle failures visibly.
- Protect shared read/modify/write operations against concurrent UI actions and stale edits when the product stores editable records.
- Version persisted structures and validate external/imported data before mutation. Unknown formats must not silently reset user data.
- Define appropriate size/count bounds for the new product; the demo's note limits and URL identity rules are examples, not universal requirements.
- Test migrations and meaningful import/merge behavior when present. Require confirmation or a suitable undo flow for destructive bulk actions.
- Do not invent a live service integration or successful authentication when credentials or service access are unavailable. Complete the usable unblocked parts and clearly identify the remaining requirement.

## Verification and delivery

Edit source, not generated `dist/`. Keep dependencies, test profiles/reports, private exports, and generated ZIPs out of source control. Remove obsolete demo-specific tests and replace them with meaningful tests of the requested product; retain applicable security and build checks.

Use `npm run release` for the final automated release gate. During development, run the focused checks needed to diagnose and fix failures. Verify the primary workflow, failure states, persistence when relevant, keyboard use, long content, narrow widths, and the actual built manifest/assets. Add focused regression tests for changed contracts, not tests that merely repeat implementation.

Opening a popup URL directly does not prove a real `activeTab` gesture. Keep test-only access out of the shipped manifest and distinguish mocked checks from real-browser coverage. Check the actual user interaction before release. If a browser or external service is unavailable, complete remaining checks and report exactly what could not be verified; never claim it passed.

Finish with what the extension does, material defaults chosen, verification outcomes, the `dist/` and ZIP paths, and concise installation steps. Include any concrete integration or verification gap. Continue authorized work without unnecessary confirmation; account publication/deployment must be within the user's requested scope.

## Code review rules

- Flag unjustified permission expansion, remote executable code, unsafe rendering, unvalidated privileged messages, and embedded secrets.
- Flag data loss from stale writes, malformed imports, schema resets, or worker-lifecycle assumptions.
- Flag obsolete demo branding/features, inert controls, missing requested behavior, and tests that only validate the old product.
- Flag release bundles containing test permissions, private/debug artifacts, or missing manifest assets.
