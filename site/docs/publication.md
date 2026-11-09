# Publication and branch policy

## Branches

`main` holds the website code. `vault` holds `vault/notes/`, `vault/assets/`, Obsidian settings, the content license, and a small Actions caller. Git history is retained on both branches; removing a directory from the current tree does not erase history.

Every nonhidden Markdown file under `vault/notes/` is selected automatically on every build. There is no per-note approval manifest. Referenced supported PNG/JPEG/GIF/WebP/AVIF images under `vault/assets/` are included after signature validation. Unreferenced attachments and Obsidian settings are excluded from the generated website. All pushed notes must be suitable for publication; `publish: false` and `draft: true` are validation errors rather than silent exclusions.

Local builds read `.vault-data/` by default, or a checkout root specified by `VAULT_ROOT`. This root contains `vault/notes/` and `vault/assets/`, not just their contents. Website project pages come from `main`'s `site/content/`.

`.vault-data` is a submodule pointing to this repository's `vault` branch. Recursive cloning downloads both code and the recorded data commit. The branch setting supports explicit `git submodule update --remote .vault-data`; ordinary submodule updates use the recorded commit. The Pages workflow still checks out the latest `vault` branch separately so a data push does not require updating the pin on `main`.

Local publication initializes the default submodule only when its directory is absent or empty. Existing checkouts, including uncommitted notes, are used without fetching or changing revisions. An incomplete populated checkout or invalid explicit `VAULT_ROOT` fails with an actionable error. CI places its separate full-history data checkout at `website/.vault-data`, repairs missing dates there, and builds from that repaired revision.

## Timestamps

Explicit valid `created` and `modified` fields always win. GitHub Actions checks out complete data history, fills only missing fields from first/latest note commits (`git log --follow`), and commits the repaired files back to `vault`. Rename detection is subject to Git's similarity heuristics. Commit dates approximate history; they cannot reconstruct dates before the note's first Git import. The known timestamp-only bot commits are ignored when recovering dates.

Repair validates all timestamp records before writing. It then validates publication before committing and pushing. A normal push is used, never a force push. If a concurrent edit advances the branch, the bot discards only its disposable attempt, fetches the latest files, and regenerates missing fields. Three failed race attempts or a permission/protection rejection stop the run without deployment. The original user edits and explicit timestamps are preserved. No local pre-commit timestamp enforcement is installed as part of this workflow; it is deferred until GitHub repair is verified.

The standard `GITHUB_TOKEN` push does not trigger another push run. The current workflow continues with the repaired commit. Readers receive ordinal sort ranks and calendar dates rather than source filesystem paths or precise filesystem metadata. Existing dates are not refreshed automatically on edits.

## References and validation

Links resolve against all discovered notes and supported assets, with exact matching followed by unique case-insensitive matching. Filenames are literal in wikilinks. URL-safe targets follow Quartz slug rules; collision groups receive deterministic source-path hashes. Ambiguous links fail validation.

Missing Markdown targets generate blank timestamped pages in temporary build content only. Aliases, embeds, ordinary Markdown links and repeated references resolve to the generated page. Placeholder dates derive from the referring notes. Code examples remain literal. Missing image references are retained as written; no image files or replacement labels are generated. Other unsupported or unsafe references fail validation.

Source symlinks, hidden paths, traversal, raw HTML, unsafe protocols, unsupported metadata and invalid image signatures remain rejected. Allowed note metadata is `title`, `description`, `publish`, `draft`, `tags`, `created`, `modified`, `lang`, and boolean `unlisted`; unlisted is reserved for the explicitly selected site pages. Displayed wikilink aliases remain supported; frontmatter alias redirects are rejected.

Only selected files are staged in a fresh OS temporary directory. Resource hash inventories validate vendor resources, local math resources, graph resources and the favicon. The builder clears its output before validation, audits the result, removes failed output, and removes staging in `finally`. Test fixture pages never enter the production artifact.

## Actions and deployment

Pushes to either `main` or `vault` run the shared `.github/workflows/pages.yml` maintained on `main`. The vault caller is stored in `site/workflows/vault-publish.yml` on main and `.github/workflows/publish.yml` on vault. Keep these copies synchronized when changing the caller. Each run checks out current main and vault separately. A shared concurrency group serializes deployments; an active run finishes, and GitHub retains the newest pending run.

The build job needs `contents: write` for timestamp repair. Branch protections/rulesets must allow the bot's normal push. Deployment uses Pages artifacts, `pages: write`, `id-token: write`, and the existing `github-pages` environment. Keep Pages configured to use GitHub Actions. Failed validation/tests/builds cannot deploy. Manual dispatch remains available on both branches.

Privacy controls govern the generated artifact, not repository visibility or Git history. Third-party content retains its rights; original text uses CC BY-SA 4.0.
