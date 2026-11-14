# Publish the unlisted store version

## Build and upload

```bash
npm ci
npx playwright install chromium
npm run release:store
```

In this workspace use `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright npm run release:store`.

The command runs all source/browser checks before generating the extension and submission kit. Upload **`artifacts/crunchyroll-censoring-0.1.7-webstore.zip`** to the Chrome Web Store Developer Dashboard. Its root contains `manifest.json` and compiled runtime files. Do not upload the source ZIP, the whole repository or the submission-kit ZIP as the extension.

`artifacts/webstore-0.1.7/` contains the upload ZIP/checksum, icon, real UI screenshots, listing copy, privacy/permission explanations, reviewer notes and this checklist. `artifacts/crunchyroll-censoring-0.1.7-submission-kit.zip` is a convenient bundle of that folder for you; it is not the extension upload.

## Dashboard steps

1. Use your own Chrome Web Store developer account. Google requires registration, its one-time fee, account verification/2-step verification and acceptance of current terms. These account actions have not been performed by this task.
2. Create **New item** and upload the `-webstore.zip`. Google assigns the store extension ID. No `key`, OAuth client, private signing key, API secret or fixed fake store ID is included in the submitted manifest.
3. Copy fields from `LISTING.md`. Supply the required verified contact email in the dashboard. Use `icon-128.png` and the supplied 1280×800 JPEG screenshots. The 128px icon has the recommended transparent padding. Branding is independent and contains no claim of authorization; the publisher must ensure permitted use of the chosen brand artwork. Google's review can still require a different icon/listing.
4. Complete **Privacy practices** using `PRIVACY-AND-PERMISSIONS.md`. Publish/link the supplied public privacy policy URL; check that it loads signed out. Include `REVIEWER-INSTRUCTIONS.md` in test instructions. The store account/region may request additional fields; do not invent an address, website ownership, approval, or credentials.
5. In **Distribution → Visibility**, select **Unlisted** and the intended regions. Unlisted still undergoes Google's review and anyone with the direct URL can install it. It is not a private listing restricted to your account.
6. Submit for review. Publication/approval has not been performed or guaranteed by this task. After approval install from the store URL and keep this same store item for future updates; creating a new item creates a different extension ID.

## Move your existing settings safely

1. Keep the old unpacked installation and update its files in the same loaded folder to this version. Reload it, refresh Crunchyroll and open Term settings.
2. Click **Export saved settings** and keep the JSON file. This exports the saved form, not unsaved edits, transcripts or local episode Ignore choices.
3. Install the approved store item. Disable the unpacked copy so two filters do not control the same player. In the store version choose the JSON file, review the counts and click **Replace saved settings**. Verify your preferences before removing the old copy. Occurrence exceptions are not transferred to a different extension ID.
4. Enable **Use Chrome settings sync**. In Chrome sign into the same Google account and enable sync for Extensions and Settings. Other desktop installations of the same store item can receive preferences and term choices. Enterprise policies can restrict installation/sync. Mobile Chrome extensions are not a supported target.
5. Chrome's delivery is eventual. If profiles differ, export a backup first and choose **Upload this device's saved settings** or **Use synced settings**. A stale settings form cannot overwrite a remotely applied revision. No user identity/login is available to this extension, so “saved to sync storage” does not prove another device has received the profile.

Local settings remain usable offline. Very large/custom Unicode lists can exceed the conservative 44 KB sync profile budget; they still save locally and export in full. Reduce terms or transfer a backup in that case. Retry after Chrome quota errors. For an incomplete/damaged cloud profile, local filtering continues; wait/retry, or export a backup, remove synced settings and upload your chosen profile again. To remove cloud preferences, turn sync off on other installations, then confirm **Remove synced settings** here. It disables sync on this device and removes this extension's sync keys; other still-enabled installations can upload again after an edit.

## Official references reviewed

- https://developer.chrome.com/docs/extensions/reference/api/storage
- https://developer.chrome.com/docs/webstore/cws-dashboard-distribution
- https://developer.chrome.com/docs/webstore/images
- https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property
