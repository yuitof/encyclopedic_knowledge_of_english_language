# Verification record

Verified on 8 November 2026 after replacing the public demonstration corpus with the user's existing notes. No remote push, merge or public deployment was performed.

## Current executed checks

| Check | Result |
| --- | --- |
| Actual-corpus full suite | Independent reviewer ran `npm test` under actual Node 24.22.2: all checks below passed. |
| Publication safeguards | 19/19 tests: explicit selection, flags, staged-only metadata, literal punctuation-bearing filenames, source/ancestor/output symlinks, collision handling, approved unresolved labels, rejection of new unknown/private references, static inventories, stale artifacts and unexpected output files. |
| TypeScript | Passed for Quartz core and custom source. |
| Temporary rich-feature corpus | 1/1 isolated build test passed for math HTML+MathML, highlighted code, callouts, tables, footnotes, images, heading links and transclusions. Temporary input/output removed afterward; no fixture pages in production. |
| Production URL layouts | Root and `/knowledge/` builds passed; all four output checks passed for each. |
| Browser matrix | 12/12 Chrome tests passed at 1440, 900, 390 and 320px across root/repository URLs. Actual-note navigation, image loading, aliases, backlinks, English title/body and Japanese search, offline-after-load queries, keyboard use, bounded mobile Explorer, dark mode and overflow checks passed. |
| Dotted/folder routes | Browser assertions passed for `r.e.p.o.` with query/fragment, `u.s.-state` with query, and the `articles/` directory redirect, on both URL layouts. |
| Independent full local-reference crawl | 82,972 local references across 2,588 HTML pages resolved to existing files/anchors. |
| Asset inclusion/integrity | All 85 emitted corpus images match original SHA-256 bytes. Four unreferenced original images remain absent. |
| Original vault preservation | All 2,679 vault files match the pre-corpus-update baseline. No original note/image/settings bytes were changed by this publication update. |
| Text/output privacy scan | No old demonstration text/routes, source filesystem paths, Obsidian settings, Markdown sources or source maps were found in generated text output. New unknown references and future private files remain excluded by manifest-only lookup. |
| Independent browser checks | 8/8 additional root/subpath cases passed at 1440/768/390/320px, plus 54 punctuation/dotted HTTP routes, delayed-index early typing, and final full-reference crawl. |
| Local search timing | Browser-observed local cold initialization 216–253 ms; title queries 16–19 ms, body queries 6–8 ms, Japanese queries 36–43 ms. These local measurements are not deployment/network guarantees. |
| Current artifact | 2,770 static files. Index: 2,586 entries, 731,734 bytes raw / 216,948 bytes gzip. |

The indexed entries are 2,584 real notes plus `articles/index` and `tags/index`. The emitted alphabetical homepage is excluded from search/discovery using the official UnlistedPages transformer so its repeated title list cannot crowd actual-note matches. All 42 empty original notes remain searchable by title. Unlisted is not an access/privacy restriction.

## Corpus mapping and review findings

- The user-approved snapshot explicitly selects 2,584 tracked notes and only their 85 referenced raster images. Normal builds never rescan the vault. The separate snapshot command is a deliberate selection change requiring Git diff review.
- Thirty-four question-mark filenames and `100%.md` retain their literal filesystem source names. Only staged targets/references change. Both `head on` and `head-on` have stable disambiguating hashes.
- There are 1,326 resolved existing-body wikilink/embed occurrences and 315 explicitly frozen unresolved occurrences outside code (313 per-note raw-target approval items). The catalogue adds 2,584 resolved links. Thirteen old exact-case misses resolve through a unique case-insensitive match; two wikilink examples inside code remain literal. No unresolved target becomes a placeholder article.
- **P2 fixed:** preview routing originally treated dots in real article slugs as file extensions and returned 404. Missing exact paths now try their `.html` sibling regardless of apparent extension; real directories redirect to their slash/index URL. Query/fragment and both deployment-path regressions passed.
- **Search finding fixed:** the full catalogue initially dominated body search matches. The official homepage-only unlisted flag removes its duplicate text from the stock index without modifying the search engine. Actual content query `death rolls` finds the existing “Crocodile and alligator” note.

The earlier implementation's independently verified privacy/static-source, canonical-slug, metadata, MathML, keyboard, mobile and contrast fixes remain in place. The retained Quartz path/slug/frame checks previously passed 42/42. No P1/P2 implementation findings remain open.

## Limits and costs

The 85 byte-preserved images total 145,133,964 bytes (about 138.4 MiB), with the largest about 18.9 MiB. Transfer cost is material on image-heavy pages; optimized reviewed web copies remain a future opt-in change. Full-index browser memory exceeds raw JSON size; compression shown here is illustrative, not a claim about Pages transfer encoding.

The official Latex plugin bundles KaTeX 0.16.47, retaining the documented low-severity advisory requiring pre-existing prototype pollution. It uses `trust: false`; local CSS/fonts use fixed KaTeX 0.18 assets. A future upstream plugin update is preferred over a custom renderer fork.

Original source/history privacy is separate from static publication. The original checkout's 48 ignored files were not in tracked HEAD and remain outside this feature snapshot. Current unrecorded references remain plain approved-body labels; new unreviewed references fail safely. A full assistive-technology/cross-browser audit and actual public deployment are not claimed.
