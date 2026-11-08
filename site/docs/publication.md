# Publication policy

The original Obsidian collection lives under `vault/`, with `notes/`, `assets/` and `.obsidian/`. It is never a Quartz content directory. The reviewed `publish-manifest.json` is the only list of source notes/assets for the normal production builder.

## Approved input

Every mapping selects one regular file under the repository root and gives it a public collection path. Notes must be Markdown. Plain Markdown without frontmatter is accepted. The manifest provides approval; staging adds `publish: true` and derives a missing title from the source filename. Original note bytes remain unchanged. Targets must include `index.md` for the home page. Raster images require separate entries and matching PNG/JPEG/GIF/WebP/AVIF signatures. Files are not discovered by directory recursion, graph traversal, tags, `publish` flags alone, or attachment filename similarity.

Source and target paths must be normalized Unicode NFC relative paths. Hidden segments, empty segments, traversal, backslashes, URL syntax/percent escapes, and symlinks (including any ancestor) are refused. Quartz's own canonical slug function detects naming collisions such as `index.md`/`_index.md`, `a&b.md`/`a-and-b.md`, and `foo/foo.md`/`foo/index.md`. Generated `static`, `tags` and `404` destinations are reserved.

Supported frontmatter keys are `title`, `description`, `publish`, `draft`, `tags`, `created`, `modified`, `lang`. Frontmatter `aliases` is rejected until redirect output has a separate tested policy; displayed wikilink aliases are supported. Unknown fields, including social image/resource paths, stop the build. Notes explicitly marked private/draft cannot be selected. Review all permitted metadata as public information.

## References and transformed features

The validator uses a Markdown AST for ordinary links, images, definitions/reference links, raw HTML, and code boundaries, then checks Obsidian wikilinks/embeds outside code. Every local target must be separately approved and resolve to exactly one selected file using Quartz's own slug and shortest-link utilities. Percent-encoded content links are decoded before validation. Article-local heading and block links need no separate file. Links with `http`, `https`, and `mailto` protocols remain links; other protocols are rejected. Raw HTML is deliberately unsupported, covering `srcset`, iframes, scripts and hidden HTML resource references as well as ordinary HTML.

A reference to an unpublished file is an error. The builder stops and removes the output; it does not emit a dead link, private filename suggestion, transclusion, index record, or sitemap entry. Error output stays in the local build/CI log; do not share logs if they contain filenames from a real reviewed selection.

Code blocks and inline code are literal approved content, not a resource-discovery mechanism. They can contain sensitive text and must be reviewed along with prose. The image signature check is a format gate, not a metadata scrubber or malware scanner.

## Additional static sources

Quartz always copies its own `quartz/static/` directory independently of Markdown filters. Therefore `trusted-static.json` pins its entire shipped file inventory and SHA-256 bytes. Unexpected or modified files and symlinks abort the normal build. `trusted-generated-static.json` pins known emitted plugin scripts/styles; the output audit rejects extra static files. `trusted-math.json` pins the packaged local KaTeX CSS/fonts. Source additions and dependency upgrades must review and update these inventories deliberately.

## Output and failures

A build clears only its owned generated output, validates everything, copies approved bytes into a fresh canonical OS temp directory, invokes Quartz, copies checked math font resources, validates generated output, and removes temporary content in `finally`. Any error removes the generated artifact. This prevents old approval decisions or stale staged files from surviving a later build.

Do not use raw `npx quartz build -d ..`, copy the vault into output, manually add output files, or upload test/debug artifacts. The only production artifact is a successfully audited fresh `site/public/` from `npm run build`. The workflow re-runs that command immediately before uploading.

The selection controls Pages output, not the Git repository or past history. All original vault source/history remains intact and may be visible to anyone who can read the source repository.
