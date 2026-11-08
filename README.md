# Encyclopedic Knowledge of English Language

An evolving encyclopedia of the English language.

This repository is where I collect what I discover about English—whether it
concerns a word, an expression, grammar, usage, history, or culture. The notes
are not limited to a single subject or format; together, they form a growing
record of the language and the ideas surrounding it.

## What you will find here

- Words, phrases, and their meanings
- Grammar and usage notes
- Cultural and historical context
- Connections between related ideas
- Other discoveries about the English language

This is a living collection, so its contents will continue to grow and change
as I learn.

## Website development

A Quartz 5 website for an explicitly selected public collection lives in [`site/`](site/README.md). Its Wikipedia-inspired interface includes full-text client search, topic navigation, article contents, backlinks and mathematical typesetting.

The original collection lives on the **`vault` branch**, under `vault/notes/`, `vault/assets/` and `vault/.obsidian/`. Every note pushed there is automatically included in the website after validation. Open the data branch's `vault/` folder in Obsidian. Website code lives on **`main`**.

Read [`site/README.md`](site/README.md) for local data checkout setup, tests, automatic GitHub Pages deployment and timestamp repair. Actions fills missing timestamps from Git history, commits them back to `vault`, then builds and deploys. Missing Markdown targets become temporary blank pages; missing image references remain unchanged. Local timestamp enforcement is deferred. The source history still contains earlier vault versions.

The reading interface also offers persistent text/width/color controls, a newest-modified-first sidebar, a generated article listing, a configurable selection of real-note snippets on the main page, and a Graph view under Explorer. Builds add timestamped blank pages for genuinely missing note links in temporary output; existing unapproved files remain excluded. Install the timestamp pre-commit hook with `cd site && npm run setup:hooks`. Original note/editorial text uses [CC BY-SA 4.0](LICENSE); see [the content license notice](CONTENT-LICENSE.md) for attribution and scope. Software and third-party material retain their own licenses.
