# English Encyclopedia — Quartz 5 site

A static, Wikipedia-inspired reading interface for the existing English-language Obsidian collection. The **explicit approval manifest** selects the published notes and images, plus the homepage, privacy and license pages. Collection membership and page counts come from that manifest and the generated static index. The earlier demonstration notes and image have been removed. Original vault files remain unchanged by publication.

## Local development

Use **Node 24 LTS** and npm **10.9.2 or newer**. From this directory:

```sh
npm ci
npx quartz plugin install --from-config
npm run build
npm run preview
```

Open `http://127.0.0.1:8080/`. Preview serves built static files without a live-reload WebSocket. Rebuild after changing content or configuration. It handles dotted article slugs, query strings, fragments and folder indexes.

For production, set a host and optional repository path without `https://`:

```sh
SITE_BASE_URL=username.github.io/repository npm run build
SITE_BASE_URL=username.github.io npm run build
```

The fallback is `example.invalid`; the Pages workflow supplies the real URL. `SITE_OUTPUT=public-review` uses a separate ignored artifact directory. Only `public` and `public-<lowercase-name>` are accepted, and the selected output is cleared on every build before validation. `npm run prepare:content` validates the selection without writing public output.

## Project map

| Path                                      | Responsibility                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `../vault/notes/`                         | Original Markdown notes                                                                      |
| `../vault/assets/`, `../vault/.obsidian/` | Original images and Obsidian settings; open `vault/` in Obsidian                             |
| `quartz/`                                 | Pinned Quartz 5 core; see `UPSTREAM.md` and MIT license                                      |
| `quartz.config.yaml`, `quartz.ts`         | Quartz 5 plugins, layout, and small configuration overrides                                  |
| `custom/`                                 | Encyclopedia frame, stock-search presentation/accessibility adapter and modular styles       |
| `content/`                                | Compact homepage and policy/license pages                                                    |
| `publish-manifest.json`                   | Explicit source/target mappings and per-note unresolved-reference approvals                  |
| `scripts/`                                | Snapshot creation, safe staging, reference mapping, build/output audits, preview and testing |
| `tests/`                                  | Privacy tests, real-corpus output/browser checks and temporary rich-feature fixture          |
| `trusted-*.json`                          | Reviewed vendor static, generated plugin-resource and local math-resource inventories        |
| `public/`, `public-*/`                    | Ignored generated artifacts                                                                  |
| `../.github/workflows/pages.yml`          | Manual, guarded GitHub Pages deployment                                                      |

Only Quartz's intended `quartz/styles/custom.scss` entrypoint is customized; it imports `custom/encyclopedia.scss`. Other core source remains unchanged. npm plugin packages are pinned by `package-lock.json`. `quartz.lock.json` has no Git plugins because the selected plugins use their Quartz 5 npm APIs.

## Publication selection

Read [the publication policy](docs/publication.md) before changing approvals.

The user approved replacing the demonstration corpus with the existing collection on 8 November 2026. The committed manifest records each selected file individually. **Normal builds consume this manifest; they never discover or automatically import future vault files.** Four unreferenced original images, all Obsidian settings and the original checkout's 48 ignored notes remain outside the selection.

To deliberately regenerate a selection from currently tracked notes and their referenced raster assets:

```sh
npm run snapshot:corpus
```

This explicit command replaces the manifest. Review the Git diff before accepting its new files and unresolved-reference approvals. It is never called by `npm run build` or the deployment workflow. You can instead edit individual mappings manually; the next build regenerates the static index and article listing. A changed referenced filename requires a reviewed mapping update; no original note compatibility edits are needed.

Version 2 manifest entries retain the original display title and map to URL-safe paths such as `articles/100-percent.md`. Filesystem source names are literal: `100%.md` and `Have you a pen?.md` remain valid source names. Source validation still rejects hidden paths, traversal, controls, backslashes and symlink ancestors. Target paths use stricter URL-safe checks. Both `head on.md` and `head-on.md` receive stable short hashes because Quartz otherwise gives them the same slug.

The builder copies only the listed sources into a fresh canonical OS temporary directory. It injects `publish: true` and a missing title in the temporary copy, rewrites approved links through the manifest mapping, builds Quartz, audits output and removes staging. Explicit `publish: false` or `draft: true` remains an error. A failure removes the generated artifact, so stale output cannot be uploaded accidentally. Never point raw Quartz at the vault or bypass this builder for production.

There are **315 currently unresolved reference occurrences** after resolving unique case differences. Their exact raw targets are frozen per note in `approvedUnresolved`; only these approved existing-body references become escaped plain labels. Unknown embeds get an unavailable-attachment label. No placeholder article is generated. A new unresolved reference still stops publication until its target or literal label is reviewed. The old exact-case migration audit counted 328 unresolved occurrences; unique case-insensitive resolution recovers 13 of those. Two wikilink examples inside code remain literal code.

Privacy controls apply to the generated Pages artifact. **The Git repository and its history still contain the vault and settings.** Repository visibility is a separate decision. Review selected text and embedded image metadata before making the source or website public; these controls cannot recognize a private sentence inside an explicitly approved note.

## Obsidian and reading features

Quartz plugins provide Markdown, displayed wikilink aliases, backlinks, headings, note/heading transclusions, YAML metadata, tags, callouts, tables, footnotes, highlighted code and accessible KaTeX HTML+MathML. The actual corpus includes English/Japanese text, Unicode and punctuation-bearing filenames, image embeds and a long article with footnotes. Its 42 empty original notes remain real searchable entries.

Rich-feature regression coverage now creates a separate temporary fixture corpus for math, code, callouts, tables, footnotes and transclusions; it is built outside public artifacts and removed after testing. No demonstration article is part of the production manifest or output.

Raw HTML, unsupported metadata, alias redirects, non-raster attachments and symlinks remain rejected. Supported metadata is listed in the policy. Obsidian-specific programs such as Dataview or Templater do not run in the browser. Preserve the originals and use reviewed public-copy transformations if future formats require changes.

The responsive layout supplies serif headings, blue links, article contents/topic navigation, backlinks and search. Backlinks are compiled directly into a normal section after the article body, with matching heading typography and list spacing. Both this section and its Contents shortcut are omitted when no published, listed note links to the page; there is no empty placeholder or right-sidebar backlink widget. Appearance controls in the right sidebar offer small/standard/large text, standard/wide content, and automatic/light/dark color; browser-local preferences persist across navigation and reload. The standalone alphabetical catalogue has been removed. Article-specific contents and Explorer share one bounded sidebar scrollbar; wheel input over either section moves the same panel. Both desktop sidebars size to their content, with a viewport height limit, and stay at the top edge once reached while scrolling. They stop before the footer. On smaller screens, Appearance remains below the article and the left navigation stays sticky. On mobile, section jumps account for the sidebar’s measured height so headings stay visible. Contents and Explorer are separate sibling panels with matching headings and independent native mouse/keyboard disclosures. Section links appear directly under Contents. (Top) and the current Markdown section use bold themed text. Both navigation panels start collapsed on mobile. The header links to the generated article listing. Hover previews omit the repeated article title; Quartz keeps hover windows disabled at mobile widths.

Quartz emits article files as `slug.html` and uses extensionless links. Dots can be part of a slug. Folder pages use `folder/index.html`; arbitrary trailing slashes on a non-folder article are unsupported. Use generated links or explicit `.html` URLs when sharing.

## Search and corpus size

Search uses the stock **Quartz 5 `@quartz-community/search` component and bundled FlexSearch engine**. It searches note titles and bodies, updates suggestions while typing, supplies excerpts, supports Japanese and English, arrow keys, Enter, Escape, native Tab navigation and `Ctrl/Cmd+K`. Our adapter changes presentation/focus only; there is no search backend or custom ranking engine.

Quartz writes `static/contentIndex.json`; the page downloads it and the client builds in-memory title/content/tag indexes. Queries run locally after loading. The compact homepage and policy pages are marked `unlisted` through Quartz's official UnlistedPages plugin. All selected notes are indexed, including empty ones; generated directory/tag pages may add records. Counts are derived from the index rather than assumed. `unlisted` controls discovery, not access or privacy.

Current index measurement: **875,692 bytes raw / 248,160 bytes gzip**. Compression is illustrative; actual Pages encoding depends on hosting. Local independent browser measurements observed cold initialization of 216–253 ms and queries of 6–43 ms, depending on query type; deployed network/device performance will vary. Browser memory exceeds raw JSON size, and every reader downloads the complete index. Re-measure load/query latency and memory as the collection grows. [Pagefind](https://pagefind.app/) remains a future option if complete-index download or memory becomes excessive; no replacement engine is needed for this measured corpus.

At the recorded snapshot, the approved original images total **145,133,964 bytes (about 138.4 MiB)**; the largest is about **18.9 MiB**. They are preserved byte-for-byte. Individual image-heavy pages therefore have a noticeable transfer cost; reviewed, optimized web copies are a future opt-in improvement.

## Article order and landing-page selection

The sidebar shows up to the 10 most recently modified articles, newest first, with deterministic filename ties and unknown dates last. A “Show more” link below them opens the full articles page. This limit applies only to sidebar links: search and the main articles page retain all approved notes. The sidebar ignores saved arrangement choices. The standalone catalogue page remains removed.

The full Articles page has a keyboard-accessible **Sort articles** dropdown: File name (A-Z), File name (Z-A), Modified time (new to old), Modified time (old to new), Created time (new to old), and Created time (old to new). It starts with File name (A-Z) and remembers the choice across navigation and reloads. Sorting reorders the existing complete Quartz list using the shared browser index, including offline after loading; no additional search service or request is needed. Invalid or unavailable browser storage falls back safely. Without JavaScript, the complete static list remains accessible in Quartz’s default order and the sorting control is disabled.

Sorting is computed from approved source-note basenames and source filesystem modification/birth times, with explicit valid `created`/`modified` frontmatter taking precedence. Only ordinal name/created/modified ranks and `null` unknown markers enter the public index. Exact filesystem timestamps, source paths and a new basename field are not published. Unknown dates sort last in either direction; ties use deterministic filename ranks. Filesystem times can reflect a Git checkout or copy (especially in CI), not historical authorship; add reviewed explicit metadata if historical dates matter. Temporary staging timestamps are never used for sorting.

The homepage samples up to `homepageMaximumNotes` nonempty real articles from the existing browser index on each load. Set this nonnegative integer in `site-settings.json` (default **6**). A compact responsive grid contains only actual selected cards, with text-only excerpts and no bulk image loading. The homepage’s displayed note count is computed from the same JSON, including empty notes; neither the list nor the count assumes a fixed corpus size.

Original note/editorial text now carries **CC BY-SA 4.0** under `../CONTENT-LICENSE.md`, as requested; quoted works and third-party media retain their own rights. Software licenses remain unchanged, including Quartz MIT. The footer links local Privacy and License pages and the source repository. An original SVG E-in-square favicon is a reviewed site asset.

## Tests

```sh
npm run test:sort         # Ordinal ranks, ties, unknown dates, explicit-date validation
npm run test:backlinks    # Conditional build-time sections, source immutability and anchor collisions
npm run test:publication  # Selection, paths, flags, symlinks, static sources, failure paths, frozen unresolved references
npm run test:features     # Isolated temporary rich-feature build; no public fixture pages
npm run check:types
npm run test:output       # Requires npm run build
npm run test:paths        # Root + /knowledge/ builds, output checks, 1440/900/390/320px browser matrix
npm test                 # Publication + types + temporary feature build + both URL/browser variants
npm run test:upstream     # Retained Quartz path/slug/frame compatibility tests
npm run test:vault        # One-time historical migration audit; requires original Git history
```

Browser tests use installed Chrome on macOS or `npx playwright install chromium`; CI installs Chromium/system dependencies. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a browser. Ports 4173/4174 must be free. Failure traces and generated artifacts are ignored.

`test:vault` checks the original migration baseline and intentionally fails after later ordinary edits to original notes. It is separate from ongoing CI, which supports shallow Pages checkouts.

Resource inventories deliberately fail when trusted vendor files, local math assets or generated plugin scripts change. Review such changes and update inventories from a separate temporary build; production builds never refresh their own trust baseline. Inventory checks complement dependency lockfiles and do not protect against a source change that removes the checks themselves.

## Deployment and maintenance

GitHub Pages deployment is **prepared, not performed**. No push, merge or public deployment has occurred. After authorizing your merge/push process, set repository **Settings → Pages → GitHub Actions**, then manually run **Build and deploy English Encyclopedia** from the default branch. Both workflow jobs require the default branch and exclude `feature/quartz-wiki`; pushing this feature cannot publish.

The workflow uses Node 24, reproducible npm installation, Quartz plugins, tests, the Pages-provided base URL, a fresh audited `site/public` artifact, and official Pages Actions. The build has `contents: read` / `pages: read`; only deploy has `pages: write` / `id-token: write`. Existing environment protection remains applicable.

See [the project audit](docs/project-audit.md), [verification record](docs/verification.md) and [upstream provenance](UPSTREAM.md). Original notes/images were moved into `vault/` during the earlier organization stage without byte edits; this corpus publication also leaves all 2,679 vault files unchanged.

A live dependency audit previously reported zero listed advisories, but the official Latex 1.0.0 plugin bundles its own **KaTeX 0.16.47** renderer. npm audit cannot enumerate that bundled copy. The inherited low [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7) requires pre-existing prototype pollution to bypass trust restrictions. Rendering uses `trust: false`; local CSS/fonts use fixed KaTeX 0.18 assets. Prefer an upstream plugin update rather than a custom renderer fork.

The requested automatic remote-main-push trigger remains **blocked**: automatic approval review rejected the local workflow configuration change twice, citing the earlier requirement for approval before public deployment. The workflow remains manual and default-branch guarded. No remote action, push, merge or deployment was attempted. Explicit user approval for enabling future automatic publication is still needed. The exact reviewable configuration is in [the automatic Pages trigger proposal](docs/automatic-pages-proposal.md).
