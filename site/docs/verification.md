# Verified checkpoint — paused

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
