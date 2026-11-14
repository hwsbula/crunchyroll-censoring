# Built-in term coverage

Version 0.1.6 replaces the 27-entry starter list with **1,161 literal entries** in six curated categories. All categories start enabled, including mild name-calling. Existing disabled terms and custom words are retained; new built-ins are enabled on upgrade. The authoritative literal entries are in [terms.ts](../src/core/terms.ts). This is a broad language/content filter, not a judgment that every included word is inherently profane.

| Category                         | Intended dialogue coverage                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Swearing and compounds           | Exclamations and battle dialogue; inflections and compounds such as shat, shithole, motherfucking and clusterfuck                |
| Insults and name-calling         | Strong insults, but also idiot, moron, loser, stupid, pervert, brat, coward and shut up                                          |
| Sexual acts and explicit content | Sexual acts, common spaced/hyphenated slang, nudity, pornography, clinical sexual vocabulary and serious sexual-assault dialogue |
| Sexual anatomy and slang         | Genital and reproductive anatomy, breasts, buttocks, crotch and common slang                                                     |
| Discriminatory slurs             | Explicit racial, homophobic, transphobic and ableist insults; neutral identity words such as gay are not included                |
| Regional swearing and euphemisms | British variants, softer substitutions, common censored spellings and abbreviations such as WTF                                  |

## Controls

Open **Term settings** to search the built-ins, uncheck individual words or use **Enable category / Disable category**. Category buttons affect every term in that category, including terms hidden by the current search. Changes apply after **Save settings** and propagate to active players. Enabling a category re-enables its individually disabled entries. The saved state records individual terms, not a rule that disables future additions to that category.

Custom literal terms remain limited to 250 entries of at most 100 characters. Disabling all built-ins is supported independently of that limit. A custom term can explicitly re-enable the same text even if its built-in checkbox is off. Occurrence Ignore/Unignore still applies only to the exact episode/version/track/cue/match. Saved exception records are retained; a newly added longer phrase may form a different match and needs its own exception.

## Literal matching and variants

- Matching ignores case, normalizes Unicode compatibility characters, curly/modifier apostrophes, repeated whitespace and ordinary/nonbreaking Unicode hyphens. Original offsets are retained for correct replacement.
- Inflections, common dropped-g spellings, joined/spaced/hyphenated compounds, British/American variants and selected obscured spellings are explicitly listed. No automatic stemming, fuzzy matching, translation, speech recognition or user-supplied regular expressions are used.
- Whole-word boundaries keep **class**, **assassin**, **cockpit**, **breastplate**, **grapes**, **therapist** and **analysis** untouched. **Screw you** is an entry; the ordinary word **screw** is not. Possessives can match the base word before an apostrophe.
- Repeated matches remain independent. A longest overlapping phrase owns its span, and another non-ignored match in the same cue still requires whole-cue audio muting.
- No finite catalogue contains every possible spelling, invented insult, euphemism or context-dependent use. Add missing variants as custom terms. The tests use synthetic dialogue, not a comprehensive survey of Crunchyroll transcripts.

## Ambiguous words

Exact terms can match harmless language: **Dragon Balls**, a **breast** of chicken, a rooster (**cock**), **Dick** or **Fanny** as names, a **jerk** of movement, **nuts**, **bloody** battle wounds, clinical anatomy or a serious discussion of sexual violence. Mild entries such as **fool**, **coward**, **shut up** and **creep** deliberately make the default filter broad. Disable unwanted entries or categories; use occurrence Ignore for one particular use. There is no semantic classifier to decide intent. Ordinary character names are not maintained as a separate blocklist.

## Playback coverage

The expanded list uses the same locally processed English-caption engine. English audio still requires matching English-dub dialogue/CC. Japanese audio stays unchanged. Non-English subtitles remain untouched. Whole-cue muting can silence surrounding dialogue, and missing/mismatched captions and unsupported rendering still report unavailable. Expanding vocabulary does not establish universal audio or live-player coverage.
