# Final verification record

Verified locally on 8 November 2026. No push, merge, remote Actions run or public deployment was performed.

## Executed checks

| Check | Verified result |
| --- | --- |
| Publication safeguards | 19/19 tests passed, independently rerun under Node 24.22.2. Explicit selection, privacy flags, safe source/target paths, symlinks, unresolved-reference approvals, collisions, static inventories and failed-output cleanup are covered. |
| Ordinal article ordering | 2/2 fixture tests passed for all six modes, equal dates, deterministic filename ties, unknown dates last and explicit-date validation. Independent review also checked every real article’s computed ranks and actual DOM ordering. |
| TypeScript | Quartz core and custom components/scripts passed. |
| Rich Markdown fixture | 1/1 temporary build test passed for accessible math, highlighted code, tables, footnotes, callouts, images and transclusions. Fixture input/output is removed afterward and never appears in production. |
| Root and repository URLs | Both production builds passed all five output checks. Final default `public/` also passed five output checks. |
| Browser suite | 36/36 Chrome cases passed at 1440, 900, 390 and 320px across root and repository paths. |
| Independent UI review | 5/5 complete viewport checks passed at 1440/801/800/390/320px, including the responsive boundary. No open P1/P2 implementation findings remain. |
| Full reference crawl | 158,217 local references across 2,591 HTML pages resolved with zero missing files or fragments. |
| Vault and approvals | All 2,679 vault files match the pre-change byte baseline. The exact 2,584 existing note mappings, 85 image mappings and unresolved-reference approvals are unchanged. The user’s entire `AGENTS.md` Notes section is preserved exactly. |
| Generated output | 2,776 static files; index has 2,586 entries, 875,692 bytes raw / 248,160 bytes gzip for this build. |

The browser checks cover real note links/images/aliases, dotted URLs, English title/body and Japanese search, offline-after-load queries, native keyboard navigation, all six sort modes, articles-page-only sort controls, persistence across reload/SPA navigation, appearance choices and malformed saved preferences, the shared sidebar scrollbar, disclosures, current-section highlighting, catalogue nesting/order/anchors, random real-note snippets, footer policies, favicon and desktop previews without repeated article titles. Quartz intentionally suppresses hover windows at touch widths.

Independent checks additionally exercised fewer-than-limit homepage selection without empty cards, system light/dark changes, settled active-section color/weight, repeated mouse/Enter/Space interactions and 800/801px behavior. Reviewer-owned preview servers and browsers were closed after verification.

## Data and privacy boundaries

The explicit manifest selects 2,584 existing notes, 85 referenced images, and four project pages: homepage, catalogue, Privacy and License. Four unreferenced original images and the original checkout’s 48 ignored notes remain outside the selection. Normal builds never discover future notes.

There are 1,326 resolved original-body wikilink/embed occurrences and 315 approved unresolved occurrences outside code (313 per-note raw-target approval items). Thirteen old exact-case misses resolve uniquely ignoring case; two code examples remain literal. Known unresolved references become escaped labels, while new unknown references fail. No placeholder article is generated. The punctuation-bearing filenames and `head on` / `head-on` collision retain safe mapped routes without source edits.

Article order is computed privately from approved source basenames and source modification/birth times, preferring explicit valid frontmatter dates. Only ordinal `{name, created, modified}` ranks and null unknown markers are added to the public index. Independent review recomputed all 2,584 rank records and found no exact filesystem timestamps, new basename fields or absolute source paths. Source file times can reflect checkout/copy operations rather than historical authorship; temporary staging times do not determine order.

The homepage and dedicated catalogue are unlisted from search through Quartz’s supported plugin, avoiding duplicate catalogue matches. All real notes, including 42 empty notes, remain indexed. The two extra index records are `articles/index` and `tags/index`. Unlisted HTML is accessible and is not a privacy control.

## Reading experience and resources

Appearance offers validated browser-local text size, content width and automatic/light/dark color choices. The outer sidebar scrolls as one unit; catalogue, article contents and Explorer retain their native disclosures and keyboard use. Current (Top)/Markdown sections use bold themed text. The default article order is modified-newest-first; the six-choice selector appears only on the articles folder page.

The homepage selects up to six nonempty real notes per load by default; `site-settings.json` controls the maximum. Safe text-only cards use a compact responsive grid. Privacy/License pages and the footer describe browser storage, hosting, original-text CC BY-SA 4.0 terms, third-party rights and preserved software licenses. The E favicon is an original SVG with a reviewed asset hash. Generated script changes were inspected before the explicit resource inventory was updated; builds never refresh trust inventories automatically.

## Remaining limitations and blocked item

Automatic remote-main-push publication is the sole blocked request. Automatic approval review rejected enabling that future public-deployment trigger twice, citing the original requirement for explicit approval before public deployment and not accepting the later authorization as trusted approval. The workflow remains manual with default-branch and experimental-feature exclusion guards. The exact unapplied change is documented in `automatic-pages-proposal.md`; a reviewable patch is also prepared at `/tmp/quartz-enable-main-push.patch`. Explicit user approval is needed to enable it. No remote operation was attempted.

The byte-preserved images total 145,133,964 bytes (about 138.4 MiB), with a largest image of about 18.9 MiB. Image-heavy pages have a material transfer cost. Full-index browser memory exceeds raw JSON size; gzip here is illustrative rather than a claim about Pages transfer encoding.

The official Latex plugin bundles KaTeX 0.16.47, retaining the documented low-severity advisory requiring pre-existing prototype pollution. Rendering uses `trust: false`; local CSS/fonts use fixed KaTeX 0.18 assets. Prefer an upstream plugin update over a custom renderer fork.

Source-repository/history visibility is separate from static publication. A full assistive-technology and cross-browser audit or a live public deployment is not claimed.
