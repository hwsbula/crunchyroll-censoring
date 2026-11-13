# Page Notes privacy policy draft

**Publication status:** This draft describes the included Page Notes demonstration. When building a different extension, Codex replaces the product-specific policy with one that describes the actual data practices. You do not need to complete these fields to request or run a local build. Before store publication, supply your publisher name, effective date, and contact method and host the completed policy at a public URL.

**Publisher:** [Your publisher name]  
**Effective date:** [Date]  
**Contact:** [Support email or contact URL]

## Purpose

Page Notes lets you save personal notes and selected quotations for web pages, then search, revisit, export, import, or delete those notes.

## Information the extension handles

When you invoke the extension on a supported webpage, it reads the current page's URL and title to identify the page. When you request selection capture, it reads selected text in the main page document. It also processes the note text you enter and records needed to manage saved entries, such as timestamps and revision information.

Saving a note stores its page URL, title, note, and any captured quotation in the current Chrome profile. URL fragments are omitted; query parameters are retained and may contain personal information. URLs with an embedded username or password are rejected.

Import reads the JSON file you choose and validates it before merging its records into local notes. Export creates a JSON file containing your saved data.

## Where information is stored and sent

Saved notes are stored locally using Chrome's extension storage. This extension does not transmit your notes, page details, selections, or import/export contents to the publisher or a third party. It has no account system, remote backend, advertising, tracking, or analytics. It does not synchronize notes through Chrome Sync.

Opening a saved page navigates your browser to that website. The website then receives the normal information associated with your visit under its own privacy practices.

The extension does not encrypt its stored records or exported JSON. Anyone with appropriate access to your device, browser profile, or exported file may be able to read them. If you place an export in a synced or shared folder, that storage service's settings and policies apply to the file.

## Access permissions

- **`activeTab`:** access the current page after you invoke the extension.
- **`scripting`:** capture selected text when you request that action.
- **`storage`:** keep notes in the current browser profile.

The extension does not request persistent access to all websites or continuously collect your browsing history. Selection capture targets the main page document and does not read form or password fields.

## Use, sharing, and sale

The extension uses the information only to provide the note-taking and management features described above. The publisher does not receive it through the extension, share it, sell it, or use it for advertising.

Our use of information received through Chrome APIs complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Retention and deletion

Saved notes remain in extension-local storage until you delete individual entries, clear saved notes, or uninstall the extension. Clearing ordinary browsing history does not delete extension-local notes. Bulk deletion uses an in-product confirmation.

Deletion inside the extension does not remove previously exported JSON files or copies you placed elsewhere. Delete those copies separately. Keep an export if you need a backup before uninstalling or changing browser profiles.

## Changes and contact

If a future version changes the data it handles, how it uses that information, or whether information leaves your device, update this policy and provide the disclosures required for that change. Contact the publisher using the method above for questions about the released extension.

## Publisher preparation notes

Remove this preparation section and replace the bracketed fields before publishing. Verify the statements against the actual release; do not retain local-only claims if you add cloud sync, telemetry, authentication, external APIs, or a backend.

The [Chrome Web Store privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy) apply when an extension handles user data, including a product with local storage. Complete the dashboard's current disclosures accurately and link the hosted policy. Review [disclosure requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements) and [Limited Use rules](https://developer.chrome.com/docs/webstore/program-policies/policies) before submission.
