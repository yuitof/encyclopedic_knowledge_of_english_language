# Publication policy

The original collection lives in `vault/notes/`, `vault/assets/` and `vault/.obsidian/`. The vault is never a raw Quartz input directory. The user approved replacing sample content with the current existing collection; the version 2 manifest is an explicit per-file snapshot of that selection.

## Approval and source files

The manifest lists each approved note, referenced raster asset, and the explicitly selected homepage, Privacy and License pages. No fixed note count is assumed. Normal builds do not scan directories, follow reference graphs into new files, or import future notes. `npm run snapshot:corpus` is a separate deliberate operation that enumerates currently tracked notes/assets and replaces the approval manifest; review its diff before accepting a changed selection. The four unreferenced images and original checkout's 48 ignored notes are not selected.

Filesystem names are literal and never URL-decoded. Question marks and percent signs are valid source filename characters. Hidden path segments, absolute paths, traversal, empty segments, backslashes, control characters, symlink files and symlink ancestors remain forbidden. Only individual regular files can be approved. Targets have stricter normalized Unicode/URL path checks; Quartz's canonical slug function detects collisions. Readable `articles/` routes preserve Unicode and use a stable source hash for every member of a collision group, such as `head on` / `head-on`.

Only matching-signature PNG/JPEG/GIF/WebP/AVIF attachments are accepted, each separately listed. No configuration, hidden directories, SVG, executable scripts, PDFs or arbitrary attachments are copied from the vault. Original text and image bytes are unchanged; temporary note copies receive public metadata and mapped references. Review source text and image metadata as public information.

## Metadata and references

Allowed metadata: `title`, `description`, `publish`, `draft`, `tags`, `created`, `modified`, `lang` and the boolean `unlisted`. Explicit `publish: false` / `draft: true` is rejected; non-boolean flags are rejected. Only explicitly approved project pages may be unlisted, to remove its duplicate title list from search. Unlisted HTML remains accessible and is not a privacy mechanism. Unsupported metadata and alias-redirect fields stop the build; displayed wikilink aliases remain supported.

The version 2 resolver uses only manifest entries, trying exact original names first and unique case-insensitive names second. It rewrites existing notes/assets to approved targets in staging and preserves original labels/aliases. Literal `100%` and question marks are interpreted as filenames in wikilinks, while ordinary Markdown URL links can be decoded for lookup. Internal heading/block references remain supported. Raw HTML and unsafe protocols/paths are rejected.

There are 315 currently unresolved reference occurrences outside code after unique-case recovery of 13 earlier unresolved references. Each note freezes its approved raw unresolved targets in `approvedUnresolved`. Only those known existing-body targets become escaped plain labels, with unavailable text for an unresolved embed. They do not become links, placeholder pages, attachment imports or index records. A newly introduced unknown/unapproved reference still fails publication. Adding a private file whose name matches a frozen unresolved label never causes automatic publication; the resolver cannot read outside the manifest.

Code and inline-code wikilink examples remain literal. Footnote definitions are preserved as footnotes, not treated as file resources. All approved prose/code and image metadata still require human content review.

## Other static resources

Quartz copies vendor `quartz/static/` independently of content selection. Exact SHA-256 inventories reject changed/unexpected vendor files, symlinks and extra emitted static resources. Local KaTeX CSS/fonts have a separate reviewed inventory. Production builds never automatically accept a new resource hash. Re-review inventories after dependency/UI resource changes.

## Builds and failures

The builder clears its owned generated output before validation, copies only selected sources into a fresh canonical OS temporary directory, invokes Quartz, copies checked math fonts, audits output and removes staging in `finally`. A failure removes the generated artifact. Quartz respects ancestor Git ignores, so staging outside the repository also avoids silently ignored input. The only uploadable production artifact is a fresh successful `site/public/` from this process.

Rich-format tests create a separate temporary corpus and remove it after the test. Its math/code/image/embedding fixture is absent from the production manifest and output. Never upload test/debug artifacts or use raw `quartz build -d ..` against the vault.

Pages selection does not change source-repository visibility or history. All vault data remains in Git and is readable to anyone with source access. No publication/deployment has been performed by this local change.

## Ordinal ordering and browser preferences

The build privately compares original approved basenames and source filesystem times (or explicit valid frontmatter dates), then adds only ordinal sort ranks to existing approved index records. No exact filesystem timestamps, absolute paths or added basename field is emitted. Unknown dates remain `null` and sort last. Source timestamps can reflect checkout/copy operations and are not asserted to be historical authorship dates. Temporary staging times do not determine order.

Appearance and article-order preferences stay in browser local storage. The homepage selects only existing nonempty public index entries; it does not discover additional vault content. The SVG favicon is byte-pinned separately in `trusted-site-assets.json`. The original vault-note/image approval entries and known-unresolved whitelists are unchanged; only three explicitly selected project-page mappings were added.

For the Articles calendar, approved notes publish only their filename initial group and created/modified UTC calendar days in `sortDetails`, alongside existing ordinal `sortRanks`. These values are derived from the same approved originals and validated against the build result. Exact filesystem clock times, original basenames and source paths are not added to the index. Explicit date metadata still takes precedence over filesystem dates, which can reflect checkout/copy operations.
