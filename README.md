# English Encyclopedia — vault data

Open `vault/` in Obsidian. All Markdown notes in `vault/notes/` are published automatically; supported referenced raster images come from `vault/assets/`. Obsidian settings are retained for editing and are not included in the website artifact.

Push changes to this **vault** branch. Its small workflow calls the website build maintained on **main**. Do not merge main into this branch: main contains the website software, while this branch contains the collection.

GitHub Actions preserves existing `created` and `modified` frontmatter. Missing fields are filled using the earliest/latest note commits in full Git history, following renames where Git can detect them, and committed back here by `github-actions[bot]`. Pull after a repair before making further changes. Existing dates are never automatically refreshed; update `modified` when editing if desired. No local timestamp hook is required yet.

Missing Markdown targets become blank timestamped pages only in temporary build content. Missing image references remain unchanged. Other validation failures stop deployment.

## Obsidian plugin setup

The vault includes the official **Update modified date 1.5.4** plugin release and its shared settings under `vault/.obsidian/`. No separate download or Node installation is needed. Release provenance and file checksums are recorded in `obsidian-plugins.json`; the upstream MIT license is included with the plugin.

After cloning, open this checkout's `vault/` folder in Obsidian. In **Settings → Community plugins**, choose **Exit Restricted mode** if needed. Review that decision on each installation: it permits community plugins to execute. Refresh the installed-plugin list if necessary, then enable **Update modified date**. Keeping Restricted mode on leaves the notes usable without the plugin.

The shared settings use `created` and `modified`, the date format `YYYY-MM-DD[T]HH:mm:ssZ`, typing-only updates, a 10-second delay after typing stops, and single dates rather than history arrays. The plugin preserves an existing `created` value and updates `modified` while writing. It also limits updates to approximately once per 30 seconds. On a note with no creation date, it uses the file's creation time; recover dates for older imported notes using the project's Git-history formatter before editing them.

Device-specific `workspace.json`/`workspace-mobile.json`, caches, and trash are ignored. Plugin release files, `community-plugins.json`, and the timestamp plugin's `data.json` are intentionally versioned so other clones get the same setup. Local plugin installation alone never publishes plugin code or settings to GitHub Pages.

Original text uses CC BY-SA 4.0; see `CONTENT-LICENSE.md` and `LICENSE`. Third-party material retains its own rights. The source history still includes earlier website code and vault versions.
