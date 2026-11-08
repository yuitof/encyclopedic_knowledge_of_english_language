# Initial project audit

Read-only inspection preceded all project edits and Git worktree creation. The original checkout was clean on `main` at `c785417a697c3fcf69c450b7c96d65bb0f73b4e5`. No existing Quartz/Node application, `AGENTS.md`, nested Git repository or submodule was present.

| Classification | Finding and action |
| --- | --- |
| Important existing source | 2,681 tracked files: 2,585 Markdown files including README, 89 image assets, six `.obsidian` JSON files and `.gitignore`. After the user requested a tidy source tree, moved 2,584 notes into `vault/notes/`, 89 images into `vault/assets/`, and six settings files into `vault/.obsidian/`. All note/image bytes are unchanged; app.json and workspace.json received only path/settings updates. |
| Existing local-only work | 48 additional ignored Markdown files existed in the original vault, outside HEAD. A Git worktree does not copy them. They were not imported or published. |
| Original documentation | Root README introduction retained; development/publishing directions appended. `.gitignore` retains `Untitle*` and adds site build/dependency exclusions. |
| Relevant new source | `site/` contains pinned Quartz 5, modular customizations, configuration, samples, publication scripts, tests and documentation. Root `AGENTS.md` documents safe development conventions. |
| Generated files | Dependencies, Quartz caches, temporary publication input, output variants and browser artifacts are ignored or created outside the repository. |
| Potential duplicates/obsolete files | No existing file was deleted based on apparent redundancy. Names were retained within their new responsibility folders. Similar note names require subject-owner review before any future reorganization. |
| Further investigation | Real-note publication decisions, source repository visibility/history, image metadata, actual long-term corpus/search scale and any custom Obsidian plugins require future review. |

Development began in a new `codex/quartz-wikipedia` worktree, renamed at the user's request to `feature/quartz-wiki`. The isolated worktree remains `/Users/owner/quartz-wikipedia`; its directory name is retained to keep active tool paths stable. The original branch is not merged automatically. No stash/reset/clean, history rewrite, remote push or public deployment is part of this change.

## Vault migration verification

The optional one-time `npm run test:vault` compares Git blob hashes against the initial HEAD for every migrated original note/image and four unchanged configuration files. It checks the exact intentional settings differences for app.json and recursively rewritten workspace paths. It also audits wikilinks and confirms no local Markdown path references need rewriting. Bare basename wikilinks continue resolving in Obsidian across `notes/` and `assets/`; existing unresolved references are documented rather than invented or removed. The migration map for this run was supplied to the lead/reviewer at `/tmp/quartz-vault-migration-map.json`.

Obsidian app settings keep `alwaysUpdateLinks: true`, set `attachmentFolderPath: assets`, and set `newFileLocation: folder` / `newFileFolderPath: notes`. Tracked workspace open-file strings that match existing files now use vault-relative `notes/…` or `assets/…` paths. No ignored original files were imported. New notes/assets remain private until separately selected in the publication manifest.

The original migration baseline contains 328 unresolved wikilink targets; those are pre-existing (including references outside tracked HEAD) and were preserved. The migration introduces no additional unresolved links. The historical audit is intentionally excluded from normal website CI and requires the recorded original commit in Git history.
