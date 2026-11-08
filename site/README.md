# Knowledge Commons — Quartz 5 site

A static, Wikipedia-inspired reading interface for selected Obsidian notes. The existing vault is organized under `vault/`; only explicit per-file approvals reach the generated website. The current manifest selects **five original sample articles and one sample image**, with no existing vault notes approved.

## Local development

Use **Node 24 LTS** and npm **10.9.2 or newer**. From this directory:

```sh
npm ci
npx quartz plugin install --from-config
npm run build
npm run preview
```

Open `http://127.0.0.1:8080/`. Preview serves the built static artifact and uses no live-reload WebSocket. After changing content or configuration, rebuild and refresh. `npm run prepare:content` validates the manifest without creating public output.

For a production URL, set `SITE_BASE_URL` to a host and optional repository path, without `https://`:

```sh
SITE_BASE_URL=username.github.io/repository npm run build
# Root-level user/organization site:
SITE_BASE_URL=username.github.io npm run build
```

The local fallback is `example.invalid`, deliberately unsuitable for a real deployment. The Pages workflow obtains the real URL automatically. `SITE_OUTPUT=public-review` selects a separate ignored output directory for review. Only names `public` and `public-<lowercase-name>` are accepted. These directories are generated and cleared on every build, including before a publication validation failure.

## Project map

| Path | Responsibility |
| --- | --- |
| `../vault/notes/`, `../vault/assets/`, `../vault/.obsidian/` | Existing private collection, excluded unless explicitly approved |
| `quartz/` | Pinned Quartz 5 core; see `UPSTREAM.md` and MIT license |
| `quartz.config.yaml` | Current Quartz 5 plugin, theme, and layout declarations |
| `quartz.ts` | Small configuration override for our frame, stock search wrapper, local math assets |
| `custom/` | Encyclopedia frame, search presentation/accessibility adapter, modular styles |
| `samples/` | Reviewed demonstration articles and a generated raster illustration |
| `publish-manifest.json` | Individual approved note and attachment mappings |
| `scripts/` | Publication validation, isolated staging, build/output audits, static preview and test orchestration |
| `tests/` | Privacy/unit tests, generated-output checks, Playwright browser tests |
| `trusted-*.json` | Reviewed byte inventories for vendor static files, generated plugin static files, and local math assets |
| `public/`, `public-*/` | Ignored static artifacts; upload only the intended `public/` artifact |
| `../.github/workflows/pages.yml` | Manually triggered GitHub Pages build and deploy |

`quartz/styles/custom.scss` is the intended upstream customization entrypoint and imports `custom/encyclopedia.scss`. Other Quartz core source remains unchanged. Plugin npm packages and their transitive dependencies are pinned by `package-lock.json`. `quartz.lock.json` has an empty Git-plugin inventory because all selected plugins come from npm; `quartz plugin install --from-config` verifies those installed packages.

## Publication and privacy

Read [the publication policy](docs/publication.md) before selecting real content.

1. Review each note and its metadata for public suitability. The manifest is the explicit approval; the builder adds `publish: true` and a missing title only to the temporary public copy, so original notes need no compatibility edits.
2. Approve the note explicitly with a `source` path relative to the repository root and a `target` path relative to the public collection in `publish-manifest.json`.
3. Review and list every required raster image independently in `assets`. Approval does not traverse directories or automatically include linked files.
4. Run validation and build; review the rendered result, search index, sitemap and RSS feed before authorizing deployment.

Example mapping:

```json
{
  "version": 1,
  "notes": [{"source": "site/samples/index.md", "target": "index.md"}],
  "assets": []
}
```

The standard build validates the complete selection, copies only approved files into a unique canonical OS temporary directory, runs Quartz against that directory, audits output, then removes the temporary input. This temporary directory is necessary because Quartz's file discovery respects ancestor `.gitignore` files and would skip ignored staging under this repository. It also isolates stale and concurrent build input. On failure, the builder removes its output artifact. Never invoke Quartz directly against the vault root or bypass this builder for production.

Privacy is scoped to the generated Pages artifact. **The vault, `.obsidian` files and earlier history remain tracked in this Git repository. Making this source repository public exposes those files regardless of the website's publication rules.** Use an appropriate private-source repository or a separately reviewed clean source repository if needed. This implementation does not rewrite existing history or change repository visibility.

The manifest is the publication decision; it does not detect private sentences in an approved note, private text in a code block, or personal metadata embedded inside an approved raster image. Review those contents and image metadata before approval. Future formats require explicit policy and tests, rather than widening the attachment filter.

## Obsidian compatibility

Quartz 5 plugins handle Markdown, wikilinks, displayed aliases (`[[target|label]]`), heading links, backlinks, note/heading transclusions, YAML metadata, tags, callouts, tables, footnotes, highlighted code, and LaTeX rendered with KaTeX. Unicode/Japanese filenames and mixed Japanese/English article content are supported. The demonstration corpus and browser tests exercise these features.

The publication preflight intentionally accepts a narrower input than Quartz: raw HTML, unsupported frontmatter, frontmatter alias redirects, non-raster attachments (SVG/PDF/audio/video), symlinks, hidden paths and links to unpublished files are rejected. Local references must resolve unambiguously under the configured `shortest` strategy; use collection-root paths for clarity. An unpublished-link error stops publication, so private note names never become generated dead links. Frontmatter's supported properties are documented in the policy.

Obsidian plugins such as Dataview, Tasks, Templater and application-specific commands do not execute on this website. No arbitrary Obsidian plugin code, workspace configuration, canvas or Bases support is enabled. Export the desired result into a reviewed public Markdown copy when needed; original notes need not be rewritten.

Quartz emits article files as `name.html` and internal navigation normally uses extensionless URLs. GitHub Pages resolves `/name`; arbitrary trailing slashes on a non-folder article (`/name/`) are not supported. Folder pages use `folder/index.html`. Use generated links or explicit `.html` URLs for sharing; there is no catch-all server redirect.

## Search architecture and scale

The UI wraps **Quartz 5's stock `@quartz-community/search` component**, keeping its bundled FlexSearch engine, ranking, CJK tokenizer, suggestions, title/content matching, result excerpts, arrow keys, Enter, Escape, and `Ctrl/Cmd+K`. Our adapter makes its existing input always visible, preserves native Tab navigation, fixes skip-link focus with the SPA router, and adds result announcements. It implements no replacement search engine or network search API.

Quartz's `ContentIndex` emitter writes `static/contentIndex.json`. The HTML starts downloading that JSON with `fetchData`; the stock component builds its title/content/tag indexes in browser memory. It queries locally after loading. Current inspected npm search code bundles FlexSearch into its client script (the older plugin README's CDN statement does not match that package). KaTeX CSS and fonts are also served locally. No production backend or WebSocket is needed.

Measured sample index: **9,919 bytes raw / 3,758 bytes gzip**, **18 entries** (5 articles plus generated folder/tag pages). Gzip is an illustrative compressed size; actual Pages transfer encoding depends on hosting. Every reader loads the complete index, and browser index construction requires more memory than the JSON file. Recheck raw/gzip size, load time and browser memory as the collection grows. Investigate [Pagefind](https://pagefind.app/) as a future chunked static search alternative if full-index download or memory becomes excessive; do not replace the current engine based on corpus count alone.

## Tests

```sh
npm run test:vault         # One-time historical migration audit (requires original Git history)
npm run test:publication   # Manifest, unsafe references, symlinks, collisions, trusted static sources
npm run check:types       # Quartz core and custom TypeScript
npm run test:output       # Requires npm run build first
npm run test:paths        # Builds root + /knowledge/ variants, output checks, browser matrix
npm test                  # Publication + types + both builds/output + browser matrix
```

Browser tests use installed Google Chrome on macOS when available. Else run `npx playwright install chromium`; CI installs Chromium and its system dependencies. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a browser executable when necessary. The matrix covers desktop (1440px), tablet (900px), mobile (390px), root/subpath navigation and search, English title/content queries, Japanese queries, suggestions while typing, keyboard selection, offline-after-load queries, article rendering, images, backlinks, page overflow, skip-link focus, topic collapse and dark mode. Browser ports 4173/4174 must be free. Test traces are retained only for failures and are ignored.

`test:vault` is a one-time migration verification against the recorded original commit. It requires that commit in local Git history and intentionally fails after ordinary later edits to original notes. It is separate from `npm test` and CI so normal vault development and shallow Pages checkouts remain supported.

The production builder also audits the vendor-static inventory before Quartz runs and rejects unexpected `static/` files afterward. The reviewed `trusted-generated-static.json` intentionally fails after changes to bundled UI/plugin resource scripts; inspect those changes and regenerate a reviewed inventory in a temporary build before accepting it. Do not automatically refresh inventories during production builds. `trusted-math.json` must be reviewed and updated after a KaTeX asset package upgrade. Inventory checks complement lockfiles; they are not a defense against a malicious source-code change that removes those checks.

## GitHub Pages deployment

Deployment is **prepared, not performed**. No remote push or public deployment has been made by this implementation.

After reviewing the feature branch, explicitly authorize and perform your chosen merge/push process. In GitHub repository **Settings → Pages**, select **GitHub Actions**. Then manually run **Build and deploy Knowledge Commons** from the default branch. Both jobs require the default branch and explicitly exclude `feature/quartz-wiki`; pushing the experimental branch cannot trigger publication.

The workflow uses Node 24, `npm ci`, Quartz plugin preparation, tests, both path variants, a fresh production build, official Pages configuration/artifact/deploy Actions, and the Pages-provided URL. The build job has `contents: read` and `pages: read`; only deployment receives `pages: write` and `id-token: write`. The uploaded directory is exactly `site/public`, with `.nojekyll`. GitHub environment protection may require an approval before the deploy job. Follow your repository's existing protections.

See [the executed verification record](docs/verification.md) for independent review findings and test evidence.

## Maintenance and limitations

The feature worktree organizes the original collection into `vault/notes/` (2,584 notes), `vault/assets/` (89 images), and `vault/.obsidian/` (6 configuration files). All note/image bytes are preserved. Obsidian app settings and tracked workspace paths are updated for the move. Open `vault/` as the Obsidian vault, rather than the Git repository root. The original checkout and its 48 ignored local notes remain untouched. No file was deleted merely because it appeared obsolete. See [the audit](docs/project-audit.md) for classification and [upstream provenance](UPSTREAM.md) before upgrading Quartz.

Automated checks do not replace a human content review, a full assistive-technology audit, or testing every browser/Obsidian extension. The samples demonstrate functionality without publishing real notes. Public deployment, real-note approval, and domain configuration remain user decisions.

Dependency audit: a live `npm audit --omit=dev` reported zero advisories for the installed dependency graph. The official Latex 1.0.0 plugin also bundles its own KaTeX **0.16.47** renderer inside compiled JavaScript; npm audit does not identify that bundled copy. It retains the upstream low-severity [GHSA-238p-pmpm-9mq7](https://github.com/advisories/GHSA-238p-pmpm-9mq7), requiring pre-existing prototype pollution to bypass trust restrictions. Our configuration sets `trust: false`, uses reviewed source only, and performs rendering during the build. Local CSS/fonts use the fixed KaTeX 0.18 package. A future upstream Latex plugin update should align the bundled renderer and assets; no custom renderer fork is introduced here.
