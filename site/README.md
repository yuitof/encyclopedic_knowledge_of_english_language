# English Encyclopedia — Quartz 5

A static Wikipedia-inspired interface for the English-language Obsidian collection. Website code lives on **main**; notes and attachments live on **vault**. Every note pushed to `vault/notes/` on the data branch is published automatically after validation.

## Local development

Use Node 24 and npm 10.9.2 or newer. Download website code and its pinned sample collection in one command:

```sh
git clone --recurse-submodules https://github.com/yuitof/encyclopedic_knowledge_of_english_language.git
```

For an existing clone, run `git submodule update --init --recursive` from its root. `.vault-data` is pinned to **sample-vault**, with three example notes, an image and a template outside the published notes folder. With `VAULT_ROOT` unset, builds and timestamp formatting default to this checkout.

The data submodule includes **Update modified date 1.5.4**, its MIT license, and shared timestamp settings. In Obsidian's **Settings → Community plugins**, review and exit Restricted mode if you want community plugins to run, refresh the plugin list if needed, and enable **Update modified date**. It uses `created`/`modified`, typing-only updates, and a 10-second delay. Each installation makes its own Restricted mode decision; cloning does not disable it. See the [sample setup instructions](https://github.com/yuitof/encyclopedic_knowledge_of_english_language/blob/sample-vault/README.md) for details. Per-device layouts, caches, and trash are ignored; plugin files and shared settings are versioned.

Local builds also initialize `.vault-data` automatically if it is absent or empty, using the recorded commit. An existing checkout is used as-is, including local edits; builds never pull, switch branches or reset it. If `VAULT_ROOT` is set, that checkout must already contain `vault/notes/` and is never initialized automatically.

Keep actual content in a separate checkout of **vault**. From the website repository root:

```sh
git clone --branch vault --single-branch https://github.com/yuitof/encyclopedic_knowledge_of_english_language.git ../english-vault
```

Open `../english-vault/vault/` in Obsidian to edit live notes. Commit and push from `../english-vault` to `origin vault`, then pull again after automatic timestamp repairs. This separate checkout never changes the website's recorded sample pin.

The website records a specific **sample-vault** commit. Use `git submodule update --remote .vault-data` only to deliberately update the sample, then review and commit that pin. `--remote-submodules` follows sample-vault too. GitHub Pages uses the configured production branch (by default **vault**) independently of the sample pin, falling back to the pinned sample if that branch is absent. A recursive clone can still download other history from this repository; the sample is not a privacy boundary.

To deploy a new collection in your own repository, configure Pages and update the `.gitmodules` URL for your starter collection. With no production branch, Actions deploys the pinned sample. When ready, create a production branch from `sample-vault` and add the caller from `site/workflows/vault-publish.yml`, changing its repository reference to your website repository. Keep the caller's source copy on main synchronized. Other branch names and separate content repositories are supported; see [content source setup](docs/content-sources.md).

If `.vault-data` is still an older Git worktree, move it aside first with `git worktree move .vault-data ../vault-data-worktree`, then initialize the submodule. The old checkout and any local edits remain in that sibling directory; transfer any intended edits before using the new checkout.

From `site/`:

```sh
npm ci
npx quartz plugin install --from-config
npm run build
npm run preview
```

Preview is at `http://127.0.0.1:8080/`. Rebuild after changes. To use another data checkout, set `VAULT_ROOT=/absolute/path/to/data-checkout` (the directory containing `vault/`). For production set `SITE_BASE_URL=username.github.io/repository` without a scheme. `SITE_OUTPUT=public-review` selects a separate ignored artifact directory.

For the separate live checkout, from `site/` use `VAULT_ROOT=/absolute/path/to/english-vault npm run build` and the same prefix for `npm run lint:timestamps`, `npm run fix:timestamps`, or `npm test`. Builds print the selected source directory. Without that prefix the sample is used. Tests select starter checks for the sample marker and collection-independent browser checks for other checkouts. Add `SITE_TEST_PROFILE=reference` for the original collection's full browser matrix; this repository's production CI retains that matrix.

## Project map

| Path                                               | Purpose                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `.vault-data/` (submodule)                         | Pinned starter checkout; tracks sample-vault for explicit remote updates    |
| `quartz/`                                          | Pinned upstream Quartz 5 core                                               |
| `quartz.config.yaml`, `quartz.ts`                  | Plugins, theme and custom layout                                            |
| `custom/`                                          | Reading frame, navigation, search adaptation, appearance, sorting and graph |
| `content/`                                         | Homepage, privacy, license and graph project pages                          |
| `scripts/discover-vault.mjs`                       | Automatic note/asset discovery and stable routes                            |
| `scripts/repair-vault-timestamps.mjs`              | Git history repair, bot commits and bounded push retries                    |
| `scripts/publish.mjs`, `scripts/missing-notes.mjs` | Validation, staging and blank missing-note pages                            |
| `trusted-*.json`                                   | Reviewed resource inventories                                               |
| `tests/`                                           | Publication, timestamp repair, rendering, sorting and browser checks        |
| `workflows/vault-publish.yml`                      | Source copy of the vault branch's caller workflow                           |
| `../.github/workflows/pages.yml`                   | Shared build and Pages deployment workflow                                  |

Read [publication.md](docs/publication.md) for rules, timestamp semantics and concurrency behavior. The former per-file manifest has been removed. Missing Markdown references become blank timestamped pages during builds; missing image references stay unchanged. Filesystem timestamps are used only as a local preview fallback when no explicit dates or Git history exist. Actions requires full Git history and commits missing dates back to the data branch.

## Tests

```sh
npm test                 # Publication, repair integration, types, rich fixture, root/subpath browser matrix
npm run test:publication
npm run check:types
npm run test:output      # Requires a successful build
npm run test:paths       # Root/subpath builds and responsive browser checks
npm run test:upstream
```

Browser tests use installed Chrome on macOS or Playwright Chromium. CI installs Chromium and dependencies. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select a browser. Ports 4173/4174 must be free. Generated artifacts, traces and dependencies are ignored. The historical `test:vault` migration audit remains an archival check rather than a current CI requirement.

The earlier local hook implementation is retained for later evaluation but is not required or installed by this setup. Timestamp repair is performed by GitHub Actions before the tests/build. Existing explicit values are never overwritten or refreshed automatically.

For local timestamp checks, run `npm run lint:timestamps` from `site/`. Use `npm run fix:timestamps` to fill missing fields in `.vault-data/vault/notes/` and the website's `site/content/` pages. `VAULT_ROOT` can select another data checkout. Both existing fields are preserved; a missing field uses the note's first/latest relevant Git commits. Filesystem dates are used only when no history exists and the file is untracked. A staged new file without any commit history, or a tracked file in a shallow checkout, produces an error instead of using checkout dates. Format new files before staging, or commit them and run the formatter afterward. Formatting preserves note bodies and filesystem modification times and does not stage, commit or push changes.

## Deployment

With the default settings, pushes to main or vault run validation, timestamp repair and Pages deployment. Both triggers use website code from the website's default branch and the latest configured production content, checked out with full history into `website/.vault-data`. A confirmed missing production branch selects the pinned sample. For same-repository production content, the bot commits only missing timestamp fields back to the selected branch using the built-in token. Its push does not start a second workflow. External content uses the notifier described below. Permission failures and repeated concurrent edits stop deployment safely.

Keep `main` as the default branch and **Settings → Pages → Source → GitHub Actions**. The bot needs permission to push to `vault`; applicable branch rules must allow that push. No separate generated hosting branch is required.

The UI retains full-text local search, appearance preferences, date/name sorting, alphabet sections, calendar filters, backlinks, graph navigation and random real-note homepage snippets. Counts derive from the built collection. Image bytes are preserved; large original images can cause large transfers.

Original note/editorial text uses CC BY-SA 4.0 under `../LICENSE` and `../CONTENT-LICENSE.md`. Quartz software retains MIT licensing in `LICENSE.txt`; third-party material retains its rights.

## Configurable production content

GitHub Actions accepts optional `CONTENT_REPOSITORY` and `CONTENT_BRANCH` repository variables (defaults: this repository and `vault`). A confirmed missing branch uses the pinned sample from `.gitmodules`; inaccessible repositories and other errors stop the build. For external content, a notifier workflow repairs dates in the content repository, then dispatches the website workflow. See [content source setup](docs/content-sources.md) for credentials, branch naming, fallback rules, and validation-only runs. Deployment always belongs to the website repository.

Browser checks default to the bundled sample profile or collection-independent checks for other data. Set `SITE_TEST_PROFILE=reference` locally, or `CONTENT_TEST_PROFILE=reference` in this repository’s Actions variables, to run the full original-collection browser matrix.
