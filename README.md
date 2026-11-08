# English Encyclopedia — vault data

Open `vault/` in Obsidian. All Markdown notes in `vault/notes/` are published automatically; supported referenced raster images come from `vault/assets/`. Obsidian settings are retained for editing and are not included in the website artifact.

Push changes to this **vault** branch. Its small workflow calls the website build maintained on **main**. Do not merge main into this branch: main contains the website software, while this branch contains the collection.

GitHub Actions preserves existing `created` and `modified` frontmatter. Missing fields are filled using the earliest/latest note commits in full Git history, following renames where Git can detect them, and committed back here by `github-actions[bot]`. Pull after a repair before making further changes. Existing dates are never automatically refreshed; update `modified` when editing if desired. No local timestamp hook is required yet.

Missing Markdown targets become blank timestamped pages only in temporary build content. Missing image references remain unchanged. Other validation failures stop deployment.

Original text uses CC BY-SA 4.0; see `CONTENT-LICENSE.md` and `LICENSE`. Third-party material retains its own rights. The source history still includes earlier website code and vault versions.
