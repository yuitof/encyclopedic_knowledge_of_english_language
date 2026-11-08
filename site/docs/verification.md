# Verification record

Verified on 8 November 2026. This is a local implementation and review record; no remote push, merge or public deployment was performed.

## Executed checks

| Check | Result |
| --- | --- |
| Reproducible independent install | Reviewer copied source into a clean temporary checkout without vault/dependencies/caches/output; `npm ci` and Quartz 5 plugin preparation passed under actual Node 24.22.2. Lockfile bytes stayed unchanged. |
| Publication safeguards | 16/16 tests passed under Node 24.22.2, independently rerun. Covers explicit per-file selection, private/draft flags, staged-only metadata injection, source symlinks/ancestors, unsafe references, raw HTML, collisions, trusted static inventory, stale output, output symlinks and extra static output. |
| TypeScript | `npm run check:types` passed. |
| Production URL layouts | Root and `/knowledge/` builds passed; four generated-output tests passed for each. |
| Main browser suite | 9/9 Playwright tests passed: desktop 1440px, tablet 900px and mobile 390px; actual Chrome browser. |
| Independent browser matrix | Reviewer passed 8/8 cases: root and repository subpaths at 1440, 768, 390 and 320px. Checked navigation, title/body/Japanese search, offline queries, keyboard use, math/MathML, images, code, embeds, backlinks and overflow. No page errors, failed resources, external runtime requests or WebSockets were observed. |
| Retained upstream tests | 42/42 Quartz path, slug-collision and page-frame tests passed, including after the minimatch major upgrade; independently rerun. |
| Vault migration | 2,584 original note files, 89 images and six configuration files accounted for. 2,677 files match original Git blob hashes byte-for-byte; app/workspace settings match their exact intended transformations. All 1,643 existing wikilinks preserved, zero local Markdown path rewrites needed. |
| Fresh final production artifact | `npm run build` and four output tests passed after the final stylesheet changes. 117 static files; search index has 18 entries, 9,919 bytes raw and 3,758 bytes with illustrative gzip compression. |

The independent clean full suite included the first 13 publication cases. The three additional builder/output regressions were then independently rerun as part of the final 16-case publication file. The last runtime change only corrects contrast for TOC links and callout labels; it does not change search, rendering or publication logic. The reviewer separately rebuilt both URL layouts after that stylesheet change, reran four output checks per build and all nine browser tests, and confirmed full-opacity TOC links, themed dark callout text and zero horizontal overflow at 1440, 390 and 320px. An independent crawl checked 705 local references across 19 generated HTML pages, including 404, with zero missing files or fragments. No P1/P2 findings remain unresolved.

## Findings and disposition

- **P1 privacy:** Quartz's vendor Static emitter could follow symlinks outside the manifest. Fixed with exact reviewed source inventories/hashes, ancestor/symlink checks, and strict emitted static-resource inventories. Independent negative probes verified rejection.
- **P2 correctness:** Simplified slug checks missed Quartz index/symbol/folder collisions; reference validation used different resolution from the renderer. Fixed by using Quartz's actual slug and link utilities and aligning its shortest-link strategy.
- **P2 metadata:** Non-boolean draft values could be approved and silently filtered later. Fixed with explicit boolean validation and regression tests. Plain Markdown now receives public metadata only in a temporary copy.
- **P2 accessibility:** Default math emitted hidden visual HTML without accessible MathML. Enabled `htmlAndMathml`. Fixed SPA skip-link focus, preserved native Tab navigation, made mobile navigation inline/collapsible, preserved narrow-screen appearance controls, and corrected dim TOC/callout text.
- **P2 deployment:** Added Pages-read permission for configuration and a default-branch plus explicit feature-branch exclusion guard. Deployment remains manual.
- Build dependency findings for sharp, source-map-js and minimatch were remediated with explicit fixed-version updates, validated builds and retained upstream tests. A live `npm audit --omit=dev` reported zero listed advisories for the installed dependency graph.

## Remaining limitations

The official Latex 1.0.0 plugin bundles KaTeX 0.16.47 internally, which dependency audit does not enumerate. The inherited low-severity advisory requiring pre-existing prototype pollution remains documented in the README; local CSS/fonts use fixed KaTeX 0.18 assets and rendering uses `trust: false`. An upstream plugin update is the preferred remedy.

328 wikilink targets were already unresolved in the tracked original collection; the migration preserves that baseline rather than inventing notes. The original checkout's 48 ignored local Markdown files were not present in HEAD and were not copied into the feature worktree. They remain in the original checkout.

Only sample content is approved for the generated website. Review real note text, frontmatter and image metadata before selection. Source repository/history privacy is separate from Pages artifact selection. A full assistive-technology and cross-browser audit, real-corpus performance measurement, source visibility decisions and actual deployment remain outside this local verification.
