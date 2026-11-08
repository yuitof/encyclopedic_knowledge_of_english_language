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

The six arrangement controls in the main body of the **articles** page are now implemented; see the Article sorting verification entry below. They reuse the generated JSON, preserve dynamic membership, and keep the sidebar newest-modified-first. The catalogue page remains removed.

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

## Independent sidebar panels

Contents and Explorer now render as sibling native disclosure panels in the left sidebar. Both use the same heading, separator, spacing and arrow styling. Each opens or closes independently using mouse, Enter or Space; both start collapsed on mobile. Quartz still owns the existing file tree and folder controls, with its redundant top-level toggle buttons removed by the custom wrapper. A single outer sidebar scrollbar remains in use.

The complete Node 24.22.2 suite passed: 19 publication/privacy cases, 2 ranking cases, 4 backlink cases, TypeScript, the rich-content fixture, 7 output checks for each root/subpath build, and 56 browser cases across desktop, tablet and 320px/390px mobile screens. New coverage verifies sibling structure, matching computed heading styles, independent native controls and mobile defaults. Existing search, article links, folder navigation, recent articles, Show more, backlinks, Top, shared scrolling and footer checks passed. Desktop and mobile screenshots were inspected. The default local preview artifact was rebuilt and passed seven output checks. Reviewed client-script hashes were updated for the panel initializer and removal of the old single-panel mobile setup.

Source vault files and publication approvals remain unchanged. The original main checkout is untouched; user edits to AGENTS.md were preserved. No subagents, pushes or deployments were used.

## Sidebar pinned at the window edge

The complete left sidebar now uses explicit sticky positioning at the viewport's top edge, including mobile. It follows normal document flow until reaching that edge, remains stationary while reading, and is bounded by the reading row so it cannot overlap the footer. Its opaque theme background covers article text on narrow screens. Contents and Explorer retain their independent disclosures and single shared scrollbar.

A cleaned-up ResizeObserver measures the navigation height for mobile scroll padding; section targets remain visible below expanded or collapsed navigation without hardcoded panel heights. Active-section highlighting uses the same visible reading area. The existing native document-top link still reaches scroll position zero. The two changed generated client scripts were inspected and their approved hashes updated.

Node 24.22.2 TypeScript checks passed. Root, repository-subpath and default preview builds each passed all seven generated-output checks. All 60 browser cases passed across desktop, tablet and 320px/390px mobile screens. New coverage checks normal movement before the boundary, pinning during further scrolling, expanded panels, visible mobile section targets and active state, return scrolling, and footer clearance. Existing search, backlinks, Top, keyboard controls and shared scrolling checks passed. Desktop/mobile previews were inspected and the final default artifact was rebuilt.

All 2679 source vault files match the preservation baseline; the original main checkout remains clean at c785417a697c3fcf69c450b7c96d65bb0f73b4e5. User AGENTS.md edits remain untouched. No subagents or remote operations were used.

## Both sidebars on shorter articles

Reproduced the reported failure directly on the existing preview at port 8080. Both sidebars previously reserved nearly the entire viewport height; on shorter articles their bottom boundary forced them upward before their visible controls needed to move. Sidebars now use their natural content height, capped to the viewport, with a shared explicit sticky top of zero. Desktop Appearance now sticks with Contents while the footer remains outside their containing row. The responsive layout continues to place Appearance below the article at narrower widths.

Applied the related AGENTS.md presentation instructions: removed Around this article; Text, Width and Color use regular weight with separators underneath; removed the bottom Appearance separator and the personal website footer link. Article sorting remains a separate pending task. Section selection also handles pages that fit entirely on screen, where an anchor click produces no scroll event. The generated client-script change was reviewed before updating its approved hash.

Node 24.22.2 TypeScript passed. Root, repository-subpath and default preview builds passed all seven output checks each. All 64 browser cases passed, including a new short-article mouse-wheel regression that checks both desktop sidebars, absence of unused vertical space, appearance styling and the removed footer link. Existing footer, Top, shared scrolling, search, keyboard controls and backlinks checks passed. Direct inspection of the rebuilt port-8080 preview confirmed both sidebar tops at 0px after scrolling, with natural heights of approximately 535px and 382px and the footer below them. Its screenshot was visually inspected. The existing preview process was left running.

Source vault files are unchanged, and the original main HEAD remains at c785417a697c3fcf69c450b7c96d65bb0f73b4e5. An editor change to the original checkout’s .obsidian/workspace.json appeared during verification and was left untouched. User AGENTS.md edits were preserved; no subagents or remote operations were used.

## Article sorting

The main Articles page now has a labelled native Sort articles select with all six requested filename, modification-time and creation-time orders. It defaults to filename A-Z and stores the preference separately from the sidebar. Controls render only on the Articles folder page. Its existing complete Quartz list is reordered in place, preserving links, metadata and dynamic membership. The shared content index supplies the existing privacy-preserving ordinal ranks; missing dates stay last in either direction and ties use filename ranks. The recent-ten sidebar is unchanged.

The control supports native keyboard type-ahead, announcements, offline changes after index loading, SPA navigation and reloads. Invalid or unavailable local storage falls back safely. Initializers and listeners are cleaned up during navigation. Without JavaScript, Quartz's complete static list remains available and the sorting control is disabled with a noscript explanation. No backend, dependency or additional index fetch was added. The one new generated client script was inspected and added to the approved resource hashes; existing script hashes are unchanged apart from generated sequence numbers.

Node 24.22.2 checks passed: 19 publication/privacy cases plus 2 ranking cases, 4 backlinks cases, TypeScript and the rich-content fixture. Root, repository-subpath and final default builds each passed all seven output checks. The 64 existing browser cases passed. All 12 new sorting cases passed in targeted reruns after correcting native select, noscript and collapsed-folder test interactions. They cover all six complete-list orders, tied and missing dates, invalid/unavailable preferences, native keyboard selection, offline changes, sidebar independence, persistence across folder navigation and reloads, working article links and no-JavaScript membership. Coverage spans desktop, tablet and 320px/390px mobile screens. Desktop and mobile screenshots of the rebuilt live preview were inspected.

The sorting task previously listed under Resume here is complete. All 2679 source vault files match their preservation baseline, and publication approvals are unchanged. Original main HEAD remains c785417a697c3fcf69c450b7c96d65bb0f73b4e5; its editor-modified .obsidian/workspace.json and user edits to AGENTS.md were left untouched. No subagents or remote operations were used.

## Articles grouping and calendar navigation

Only the full Articles listing omits the recent-ten tree and Show more link from its Explorer panel. Individual notes and the homepage retain the recent-ten navigation. Filename modes add populated A–Z heading groups in the main list and matching Contents shortcuts. Descending mode reverses the letters and filename order within groups; Symbols and numbers remains immediately above 日本語 and other scripts at the end. Group classification uses the approved source filename's normalized initial, without publishing the filename. Dynamic Contents links share the existing active-section and document-top behavior.

Modified/created modes remove the filename headings and show native From/To date calendars under Explorer. Filtering uses inclusive UTC days, supports either blank endpoint and restores every article when cleared. Missing dates are included without a filter and excluded with a bound; empty results and reversed ranges have explicit messages. Calendar bounds and counts are computed from the collection. Switching back to filename order restores all articles. Date ranges stay during mode changes but reset on navigation/reload; sort preference persistence remains intact.

The approved publication pipeline now supplies sortDetails with only the filename group and created/modified calendar days, alongside ordinal ranks. These minimal fields support the requested calendar while keeping exact clock times and source paths excluded. Build output auditing compares these values against the approved source calculation. Documentation explicitly describes this day-level publication and the existing checkout-time limitation. The measured static index is 1,069,748 bytes raw and 255,982 bytes gzip. Two changed client scripts were inspected before updating their approved hashes.

The complete Node 24.22.2 test run passed: 19 publication/privacy tests, 3 metadata/ranking tests, 4 backlink tests, TypeScript, the temporary rich-content fixture, 7 output checks each for root and repository URLs, and all 80 browser cases across desktop, tablet and 320px/390px mobile. New coverage exercises both heading orders, Contents jumps and current-section indication, inclusive/single-day/open date ranges, missing days, no-match and reversed ranges, clearing and mode transitions, and the list's page-specific omission. The final default preview build also passed seven output checks. Desktop/mobile screenshots were visually inspected.

All 2679 source vault files match the existing preservation baseline, and note/asset approvals are unchanged. Original main HEAD remains c785417a697c3fcf69c450b7c96d65bb0f73b4e5; its existing Obsidian workspace change and the user's feature-worktree AGENTS.md edits were left untouched. No subagents or remote operations were used.

## Show more opens newest-modified order

The sidebar Show more link now carries `?sort=modified-desc`. The Articles initializer accepts a valid explicit URL sort ahead of the saved preference, so normal navigation, a new tab and reload all start with Modified time (new to old). Ordinary Articles visits still use the saved preference or filename A-Z default. A subsequent manual sort updates an existing sort URL parameter and the stored preference, preventing reload from undoing the user's new choice. Other query parameters and fragments are retained. No new dependency or publication metadata was added. Two changed generated client scripts were reviewed and their approved hashes updated.

Node 24.22.2 TypeScript passed. Root, repository-subpath and final default builds each passed seven generated-output checks. Twelve targeted browser cases passed across desktop, tablet and 320px/390px mobile: Show more with a conflicting stored sort, complete newest-modified order, reload, later manual sorting and reload, existing six modes and preference persistence, and document-top navigation. A separate check against the running port-8080 preview opened Show more in a new tab with a stored filename-descending preference and confirmed modified-desc. The default preview artifact is refreshed.

All 2679 source vault files match the preservation baseline. Original main HEAD remains c785417a697c3fcf69c450b7c96d65bb0f73b4e5; its existing editor workspace change and the feature-worktree AGENTS.md edits were left untouched. No subagents or remote operations were used.

## Browse entries opens filename A-Z

Browse entries now links to the Articles page with `?sort=name-asc`, using the existing URL-sort override. It opens the grouped filename A-Z view even when another order is saved. Show more continues to request modified-desc. No client scripts, dependencies or publication data changed.

Node 24.22.2 TypeScript passed. Root, repository-subpath and default preview builds each passed all seven output checks. Four targeted browser cases passed across desktop, tablet and 320px/390px mobile, covering both link defaults against conflicting stored preferences, subsequent sorting/reloads and complete-list order. Desktop/tablet coverage clicks Browse entries; the compact mobile header hides that link, so mobile coverage opens its URL in a new tab and verifies filename A-Z. The default preview is rebuilt.

Original main HEAD remains c785417a697c3fcf69c450b7c96d65bb0f73b4e5. Source notes, the existing Obsidian workspace change and user AGENTS.md edits were left untouched. No subagents or remote operations were used.

## Browse entries repeated-navigation correction

Reproduced the user's follow-up failure on the running port-8080 preview: the first Browse entries click from a freshly loaded note used A-Z, but subsequent navigation changed the header link from a relative query URL to /articles/ with no query. Selecting another sort and clicking that rewritten link reused the saved preference. Quartz's normalizeRelativeURLs rebases relative href values as pathname plus hash and omits the search portion. The previous regression checked only the first click and missed the damaged link on the destination page.

The custom frame now renders Browse entries with a root-relative path using exactly the deployment prefix calculation used by Quartz's renderer, including the local serve exception. Such links retain their query through Quartz's SPA normalization. No Quartz core, custom scripts or dependency changes were needed.

Node 24.22.2 TypeScript passed. Root, repository-subpath and final default builds passed all seven generated-output checks each. Twelve targeted browser cases passed across desktop, tablet and 320px/390px mobile: both entry defaults, existing sorting/persistence and a new repeated-navigation case that checks the destination link after every click. It cycles through three alternate sorts, follows Browse entries repeatedly, then repeats from the homepage and an individual note, asserting complete A-Z group order and the retained query. Mobile checks invoke the hidden compact-header link programmatically. A separate reproduction against the rebuilt existing preview confirmed that the previously failing sequence now preserves /articles/?sort=name-asc and selects name-asc on each visit.

The preview is rebuilt and its existing server remains running. Original main HEAD remains c785417a697c3fcf69c450b7c96d65bb0f73b4e5; source notes, the existing editor workspace change and user AGENTS.md edits remain untouched. No subagents or remote operations were used.

## Sticky sidebar breathing room

Both sticky sidebars now stop 1.5rem below the viewport top (24px with the default root font), controlled by --sidebar-top. The viewport height cap reserves that inset plus bottom clearance, preserving the existing single scrollbar and natural content height. Mobile anchor scroll padding includes the inset so headings stay visible below the pinned navigation.

Root, repository-subpath and final default builds passed all seven generated-output checks each. Twenty targeted browser cases passed across desktop, tablet and 320px/390px mobile, covering sticky positioning, shorter pages, shared scrolling, footer clearance, section visibility and grouped Articles/calendar navigation. Existing sticky tests now assert a meaningful top gap and track its computed value. Inspection of the running preview confirmed both sidebar top positions at 24px after scrolling; its screenshot was visually checked. The default preview artifact is refreshed. No scripts, dependencies or publication data changed. Original notes, the existing editor workspace change and user AGENTS.md edits remain untouched. No subagents or remote operations were used.

## Recently updated label and automatic empty-panel closure

The recent articles group uses a plain Recently updated span instead of the articles link, folder button or arrow. Quartz still generates the existing note links; the custom presentation keeps this group expanded regardless of its old fileTree preference. Explorer reopens once the recent links load, including after reload on mobile. Users can close the outer panel during the current visit. The full Articles listing continues to omit this recent group.

Contents and Explorer now close whenever they have no meaningful content. A lone Top shortcut does not count as Contents sections. Explorer is empty while the Articles calendar is hidden in filename modes. A transition from empty to populated reopens the corresponding panel, so filename groups open Contents and timestamp modes open the calendar in Explorer. Manual closure remains respected while a panel stays populated. Empty panels are also rendered closed initially. This reuses the existing content-change event and cleanup lifecycle. The recent label has no nested toggle interaction. The two changed client scripts were reviewed before updating their approved hashes.

Node 24.22.2 TypeScript, 19 publication/privacy tests, 3 ranking/metadata tests, 4 backlink tests and the rich-content fixture passed. Root, repository-subpath and final default builds each passed all seven output checks. The full 92-case browser run passed 90 cases; the two mobile styling comparisons still compared a closed Contents marker with the newly opened Explorer marker. The final test compares styles after opening both panels, and all four targeted desktop/tablet/mobile disclosure-style cases passed. Thus the new reload/empty-panel cases and the existing navigation, search, calendar, footer and shared-scroll cases are verified. Sort-persistence coverage now returns from an article using browser history because the former linked folder heading has deliberately been removed. Screenshots of the plain label and the empty Explorer state were inspected, and direct live checks confirmed filename and date modes switch the panel states correctly.

The local preview is rebuilt and its existing server remains running. All 2679 source vault files match their preservation baseline. Original main HEAD remains c785417a697c3fcf69c450b7c96d65bb0f73b4e5; its existing Obsidian workspace change and user AGENTS.md edits remain untouched. No subagents, remote pushes or deployments were used.
