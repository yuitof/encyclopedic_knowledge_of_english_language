# Development

Work only in the isolated feature worktree. The feature checkout organizes the collection under `vault/notes/`, `vault/assets/`, and `vault/.obsidian/`. Open `vault/` in Obsidian. Preserve migrated note/image bytes and the original checkout. Do not automatically import notes, push, merge, or deploy.

Website sources live in `site/`. Quartz 5 core is vendored at the commit recorded in `site/UPSTREAM.md`; prefer YAML plugins and `site/custom/` extensions to core edits. Publishing uses an explicit per-file manifest, including assets. Never point Quartz at the vault root.

Use Node 24 LTS and npm 10.9.2 or later. From `site/`: `npm ci`, `npx quartz plugin install --from-config`, `npm run test:publication`, `npm run check:types`, `npm run build`, `npm run test:output`, `npm run test:paths` (Chrome installed, or `npx playwright install chromium`). The production command always reconstructs its approved input and clears its owned output.

One implementation agent owns source writes. The independent reviewer reads source and may run tests/builds; use distinct output directories when another build is running. Keep commits focused. Deploy only through the manually triggered, default-branch-guarded Pages workflow after user authorization.

The current version 2 publication manifest freezes the user-approved existing corpus (2,584 notes and 85 referenced images), plus explicitly selected project pages. Normal builds never discover future files. `npm run snapshot:corpus` is an explicit selection update requiring review of its diff. Keep per-note unresolved-target approvals strict: known existing-body labels may render as plain text; new unknown references fail. Preserve source bytes and literal punctuation-bearing filenames. Rich-format regression content belongs only in temporary test fixtures, never production pages.

# Notes

- When the cursor hovers a link to another page, the preview shows up in small window. Do not show its title because the user knows the title when they hover it.
- create the button to change appearance right above Backlinks: text, width, color. Make them look like the ones from wikipedia.
- move "Alphabetical catalogue" inside "Explorer" and above "articles"
- rename "Contents & topics" to "Contents"
- In each individual page's side bar, create a link to each section based on the # tags of md files.
- Highlight the section you are in with bold black characters.
- set the Modified time (new to old) as the arrangement of articles in the side bar.
- the functionality to change the arrangement rules of articles is implemented only when you are in the articles page.
- create Alphabetical catalogue's own page. On the landing page, pick up sveral random pages every time the page is loaded and put the snippets of them. Set the maximum amount of page to be shown. If pages don't hit the limit, scoot over to make no redundant room. Make it look like the main anding page of wikipedia. cf https://en.wikipedia.org/wiki/Main_Page
- Add foot notes. Privacy policy, License, etc...
- Use the same License as wikipedia.
- link to my socials: Here is my website https://www.yuitof.com/ And the link to the github repo of this project.
- create a favicon: I like the "E" inside a white square with black boarder such that you've already created on the top left corner of the page.
- Create the mobile website. Use the design of mobile wikipedia.
- you may have already done though, make sure this website is automatically every time the project is commited onto remote the github repo.

```text
├── Contents
│   ├── (Top)
│   ├── section 1
│   │   └── subsection 1
│   ├── ...
│   └── bibliography
└── Explorer
    ├── alphabetical catalogue
    │       ├── A ... Z
    │       ├── Symbols and numbers
    │       └── 日本語 and other scripts
    ├── articles
        ├── -196
        ├── ...
        └── 高所恐怖症

```
