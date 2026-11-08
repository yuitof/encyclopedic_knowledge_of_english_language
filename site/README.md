# English Encyclopedia — Quartz 5

A static Wikipedia-inspired interface for the English-language Obsidian collection. Website code lives on **main**; notes and attachments live on **vault**. Every note pushed to `vault/notes/` on the data branch is published automatically after validation.

## Local development

Use Node 24 and npm 10.9.2 or newer. From the repository root, create a data checkout once:

```sh
git fetch origin vault
git worktree add .vault-data vault
```

If no local `vault` branch exists, use `git worktree add -b vault .vault-data origin/vault`. Open `.vault-data/vault/` in Obsidian. Pull changes in that worktree after GitHub's timestamp repair commits.

From `site/`:

```sh
npm ci
npx quartz plugin install --from-config
npm run build
npm run preview
```

Preview is at `http://127.0.0.1:8080/`. Rebuild after changes. To use another data checkout, set `VAULT_ROOT=/absolute/path/to/data-checkout` (the directory containing `vault/`). For production set `SITE_BASE_URL=username.github.io/repository` without a scheme. `SITE_OUTPUT=public-review` selects a separate ignored artifact directory.

## Project map

| Path | Purpose |
| --- | --- |
| `.vault-data/` (ignored) | Local checkout of the vault branch |
| `quartz/` | Pinned upstream Quartz 5 core |
| `quartz.config.yaml`, `quartz.ts` | Plugins, theme and custom layout |
| `custom/` | Reading frame, navigation, search adaptation, appearance, sorting and graph |
| `content/` | Homepage, privacy, license and graph project pages |
| `scripts/discover-vault.mjs` | Automatic note/asset discovery and stable routes |
| `scripts/repair-vault-timestamps.mjs` | Git history repair, bot commits and bounded push retries |
| `scripts/publish.mjs`, `scripts/missing-notes.mjs` | Validation, staging and blank missing-note pages |
| `trusted-*.json` | Reviewed resource inventories |
| `tests/` | Publication, timestamp repair, rendering, sorting and browser checks |
| `workflows/vault-publish.yml` | Source copy of the vault branch's caller workflow |
| `../.github/workflows/pages.yml` | Shared build and Pages deployment workflow |

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

## Deployment

Push either branch to run validation, timestamp repair and Pages deployment. Both triggers use website code from main and data from vault. The GitHub Actions bot uses the built-in token to commit only missing timestamp fields. Its push does not start a second workflow. Permission failures and repeated concurrent edits stop deployment safely.

Keep `main` as the default branch and **Settings → Pages → Source → GitHub Actions**. The bot needs permission to push to `vault`; applicable branch rules must allow that push. No separate generated hosting branch is required.

The UI retains full-text local search, appearance preferences, date/name sorting, alphabet sections, calendar filters, backlinks, graph navigation and random real-note homepage snippets. Counts derive from the built collection. Image bytes are preserved; large original images can cause large transfers.

Original note/editorial text uses CC BY-SA 4.0 under `../LICENSE` and `../CONTENT-LICENSE.md`. Quartz software retains MIT licensing in `LICENSE.txt`; third-party material retains its rights.
