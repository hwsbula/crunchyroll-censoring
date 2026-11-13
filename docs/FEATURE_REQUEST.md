# Describe the extension you want

A short description is enough. You do not need to fill out a form, choose a framework, or design the data model. The repository's [AGENTS.md](../AGENTS.md) tells Codex to infer the requirements, choose sensible defaults, implement the product, and verify it.

## First request

```text
Build a Chrome extension that [description]. Follow AGENTS.md. Choose
sensible defaults, ask only questions that materially change behavior,
and deliver a tested installable extension.
```

## Simple examples

```text
Build a Chrome extension that shows the SEO title, meta description,
headings, and images missing alt text for the current page. I want it
for checking my clients' WordPress websites.
```

```text
Build a Chrome extension that lets me save highlighted passages from
webpages into a searchable reading list. Keep it on my device and
include an export option.
```

```text
Build a Chrome extension that closes duplicate tabs in the current
window when I ask, keeps one copy of each page, and shows a count.
```

```text
Build a Chrome extension that hides YouTube comments by default and
lets me show them again for the current video.
```

Codex should select the appropriate interface and access model for each goal. A page-specific background feature may need persistent site access, while a toolbar action may work with temporary access. It should explain material choices in its result and update the product's permission inventory and privacy copy.

## Follow-up requests

Once a product exists, describe the change directly. Existing decisions carry forward:

```text
Add an option to export the results as CSV. Keep the current design.
```

```text
The panel is too wide. Make it easier to use on a small laptop screen.
```

```text
When I revisit the page, restore my last settings automatically.
```

For a completely different product, begin with a clean scaffold copy or explicitly say that the current product should be replaced.

## Optional details that help

Include these only if they matter to you: who will use it, the sites it should work on, preferred interaction, data that must stay local, a service it must integrate with, or an example of a successful result.

Codex maintains [PRODUCT.md](PRODUCT.md) and derives acceptance criteria itself. It should ask about a missing detail only when guessing would materially change the requested behavior or an integration cannot proceed without it. A missing credential should not stop work on independent parts of the product.
