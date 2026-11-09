---
description: Markdown, images, and dates in a starter article.
tags:
  - getting-started
created: "2026-11-09T00:00:00Z"
modified: "2026-11-09T00:00:00Z"
---

# Writing notes

Create Markdown files in `vault/notes/`. Every nonhidden note in that folder is selected for publication. Keep templates in `vault/templates/`, outside the published collection.

## A short example

- Explain one idea clearly.
- Use headings and lists where helpful.
- Link to a related topic, such as [[Linking notes]].

| Field | Purpose |
| --- | --- |
| created | When the note was created |
| modified | When its content was last edited |

An inline equation works too: $E=mc^2$.

Existing dates are preserved by the repair tools. Missing dates are recovered from Git history during publication. The optional Obsidian timestamp plugin updates `modified` while you type.

Return to [[Welcome]].
