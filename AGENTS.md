# Development

Work only in the isolated feature worktree. The feature checkout organizes the collection under `vault/notes/`, `vault/assets/`, and `vault/.obsidian/`. Open `vault/` in Obsidian. Preserve migrated note/image bytes and the original checkout. Do not automatically import notes, push, merge, or deploy.

Website sources live in `site/`. Quartz 5 core is vendored at the commit recorded in `site/UPSTREAM.md`; prefer YAML plugins and `site/custom/` extensions to core edits. Publishing uses an explicit per-file manifest, including assets. Never point Quartz at the vault root.

Use Node 24 LTS and npm 10.9.2 or later. From `site/`: `npm ci`, `npx quartz plugin install --from-config`, `npm run test:publication`, `npm run check:types`, `npm run build`, `npm run test:output`, `npm run test:paths` (Chrome installed, or `npx playwright install chromium`). The production command always reconstructs its approved input and clears its owned output.

One implementation agent owns source writes. The independent reviewer reads source and may run tests/builds; use distinct output directories when another build is running. Keep commits focused. Deploy only through the manually triggered, default-branch-guarded Pages workflow after user authorization.

The current version 2 publication manifest freezes the user-approved existing corpus (2,584 notes and 85 referenced images), plus its alphabetical homepage. Normal builds never discover future files. `npm run snapshot:corpus` is an explicit selection update requiring review of its diff. Keep per-note unresolved-target approvals strict: known existing-body labels may render as plain text; new unknown references fail. Preserve source bytes and literal punctuation-bearing filenames. Rich-format regression content belongs only in temporary test fixtures, never production pages.
