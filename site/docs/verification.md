# Verified checkpoint

Verified locally on 8 November 2026. Work is paused at the user's request. No push, merge or public deployment occurred.

## Completed changes

- Both sticky sidebars now belong to a reading-row containing block that ends before the footer. Before the fix they extended about 90 pixels into it. Footer links remain unobstructed after scrolling to the bottom of short articles, long articles, the homepage and policy pages, in standard and wide layouts.
- The standalone Alphabetical catalogue page, its source, manifest entry, sidebar navigation and links were removed. Explorer and the generated articles listing remain available.
- The sidebar always sorts by newest modification time, with filename ties and unknown dates last. Obsolete stored arrangement choices cannot change it.
- The homepage reads its note count and eligible snippets from Quartz's prebuilt `static/contentIndex.json`. Tests exercise 0, 2 and 9 notes; lists and counts do not assume a fixed corpus size. Output assertions derive membership from the approval manifest.

## Executed checks

- Node 24.22.2: 19 publication/privacy tests and 2 rank tests passed.
- TypeScript and the isolated rich-Markdown fixture passed.
- Root and repository-subpath production builds each passed 6 output checks. The final default `site/public/` build also passed all 6 checks.
- All 40 Chrome cases passed at 1440, 900, 390 and 320 pixels. New coverage checks sidebar/footer geometry, hit testing and actual footer-link clicks; always-modified sidebar order; catalogue absence; and variable JSON collection sizes. Existing search, appearance, disclosure, scrolling, image and keyboard coverage remains in the suite.
- The two changed generated client scripts were inspected before their pinned hashes were updated. Builds do not refresh trust inventories automatically.

The footer defect was independently reproduced before the fix. Both subagents subsequently reached their usage limits, so the lead completed these changes and ran the final checks; there was no independent post-fix review in this checkpoint.

## Preservation and publication boundaries

Original vault files and all existing note/image approvals are unchanged. The only manifest membership change removes the catalogue project page. The user's current `AGENTS.md` instructions are preserved verbatim. Counts in the build report describe that build and are not constants used by the application.

Only explicit manifest selections reach the static site. Future approved additions enter the next build's JSON and generated listing; future unapproved files remain excluded. Sorting metadata contains relative ranks rather than exact source filesystem timestamps.

## Resume here

The latest user instructions put arrangement controls in the main body of the **articles** page, while the sidebar must remain newest-modified-first. Those body controls are the next implementation task; no arrangement selector is currently shown. Reuse the generated JSON and keep counts and membership dynamic. The catalogue page must remain removed.

Automatic deployment on pushes to main remains an unapplied proposal pending explicit approval after the earlier automatic-review rejection. The existing workflow is manual and continues to block the experimental feature branch. No remote operation was attempted.

Existing documented limitations remain: filesystem times can reflect checkout/copy operations; original image sizes affect transfer costs; the upstream Latex plugin bundles the previously reported low-severity KaTeX issue; repository/history privacy is separate from the generated-site selection.

## Recent sidebar follow-up

The sidebar now shows at most the 10 most recently modified articles across the approved collection, newest first. Equal modification ranks use the existing filename tie-breaker; unknown dates stay last. The cap is a display limit, not a fixed corpus size. Older entries remain in the full articles page and search index.

A single **Show more** link follows the recent entries inside the articles folder and opens the full articles page. Folder disclosures, the shared sidebar scrollbar, SPA navigation and root/repository URL prefixes are preserved. No publication approvals or source notes changed.

TypeScript and the root/subpath builds passed, including all six output checks for each build. The 40-case browser coverage passed for the recent limit, dynamic 0/2/9/14-note collections (including tied and missing modification ranks), search, full article membership, appearance, sidebar controls and footer behavior. The four additional Show more navigation cases pass on desktop, tablet, 320px and 390px screens; mobile checks reopen the normally collapsed Contents panel after navigation. The final local `public/` artifact was rebuilt and verified. No subagents were used for this follow-up.

Existing uncommitted user edits to `AGENTS.md` were left untouched. Work on the pending article-body arrangement controls remains paused.

## Build-time article backlinks

Backlinks now render directly inside the article HTML as a normal section following the original body. It uses an ordinary heading and list, inheriting existing article typography, separators, spacing and appearance settings. The matching On this page entry shares its conditional selection and unique anchor. When no published, listed source links to the article, neither generated element is present. The previous right-sidebar widget is disabled.

Rendering uses a new HAST root with the original body followed by the section. Original Markdown, indexed content and transcluded source trees are not modified. Existing section/heading IDs are checked before choosing an anchor. The implementation adds no browser-side backlinks fetching or new client code; the obsolete widget's generated overflow script was removed from the reviewed resource inventory.

The complete Node 24.22.2 checks passed: 19 publication/privacy cases, 2 ranking cases, 4 backlink cases, TypeScript, the temporary rich-content fixture, 7 generated-output checks for each URL layout, and 48 browser cases across desktop/tablet/mobile root and repository URLs. Backlinks-specific output checks inspect compiled HTML directly, including empty cases. Browser checks verify article placement, inherited font/list styling, the sidebar jump and active state, absence from the right sidebar, and omission of both section and shortcut on a page without backlinks. The final default artifact was rebuilt and verified separately.

All source vault files, publication approvals and the original checkout remain unchanged. The user's existing AGENTS.md edits remain untouched. No subagents, remote pushes or deployments were used for this change.

## Document-top navigation fix

The Contents `(Top)` link now targets the existing `#quartz-root` document wrapper instead of `#main-content`, so it returns to scroll position zero and includes the masthead. This uses Quartz's existing anchor navigation and native fragment fallback; no custom scrolling script was added. The accessibility Skip to article link still targets the article body.

TypeScript passed. Root, repository-subpath and final default builds each passed all seven output checks. Twelve targeted desktop/tablet/mobile browser cases passed: mouse and keyboard Top activation from deep scroll, repeated activation, exact scroll position zero, masthead visibility, active-state highlighting, and continued behavior after SPA navigation. Article section links, backlinks navigation, sidebar collapse and shared scrolling also passed their targeted regressions. User AGENTS.md edits were left untouched; no remote operations occurred.

## Direct Contents links

Removed the nested On this page disclosure and its styling. Section links now render as a direct list below (Top), with Backlinks only when present. The outer Contents control and Explorer remain intact, including mobile behavior, the shared scrollbar, active-section highlighting and document-top navigation.

TypeScript passed. Root, repository-subpath and final default builds each passed seven output checks. Twelve targeted browser cases passed across desktop/tablet/mobile: the disclosure and label are absent, the direct list is visible, section and backlinks jumps work, Explorer still collapses, and Top still reaches scroll position zero. No new client code or dependencies were added. Existing user AGENTS.md edits were left untouched.
