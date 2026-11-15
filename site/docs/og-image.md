# Open Graph image

The shared social image is [english-encyclopedia-og.png](../custom/english-encyclopedia-og.png), an opaque 1200 × 630 PNG. The original editorial card was created with imagegen. Its right-hand network has been replaced with the approved radial graph: one blue center, twelve gray nodes, five long spokes and seven shorter spokes. All nodes connect directly to the center.

The graph and square around E share blue `#577fd9`; the outer nodes use gray
`#7f8791`. The card stays white and flat, without gradients, highlights, shadows
or extrusion. Imagegen supplied the edit studies; final compositing used the
exact vector graph geometry and original typography to avoid changing letter
shapes.

The selected layout enlarges the radial graph by about 15% and centers its
visible bounds vertically (149px above, 148px below). The complete left block
(boxed E, title, divider and tagline) is 10% smaller, with its left edge at x=55.
The original line breaks and relative spacing are preserved. The card remains
an opaque 1200 × 630 PNG.

The custom head in `quartz.ts` uses this image for Open Graph and Twitter large-image cards, with absolute URLs derived from the configured base URL. Root sites and GitHub Pages repository subpaths are supported. Dimensions, PNG type, and matching alt text are included; duplicate/default image tags are removed. The reviewed image hash lives in `trusted-site-assets.json`. No upstream Quartz asset is overwritten.

Run `node --test tests/social-image.test.mjs` from `site/` with Node 24 to verify isolated root/subpath builds, image dimensions and metadata across homepage, article, listing, graph and 404 pages. The check uses a temporary note collection and dedicated ignored output directories.

## Original generation prompt

Mode: built-in imagegen; no CLI/API fallback.

```text
Use case: ads-marketing
Asset type: Open Graph/social sharing image for the existing English Encyclopedia website, landscape 1200 x 630 pixels (approximately 1.91:1).
Primary request: Create a refined editorial social card for a personal encyclopedia of English words, usage, and connections.
Scene/backdrop: clean white paper-like background with a subtle gray rule and generous negative space.
Subject/composition: a prominent original boxed serif letter E, large black serif editorial title, and a restrained circular network of small blue and gray connected nodes suggesting connected notes. Keep the network secondary to the title. Balanced, understated encyclopedia typography; all elements comfortably inside a 60-pixel safe margin.
Exact text, verbatim and crisply legible: "English Encyclopedia" and "Words, usage, and connections". The title may wrap onto two lines. The boxed mark contains only "E".
Color palette: white, near-black #101418, encyclopedia blue #3366cc, subtle cool grays.
Style: polished flat editorial graphic with very clean type and fine network lines, suitable for readable link thumbnails. No screenshot framing, browser controls, photography, 3D effects, gradients, extra copy, numbers, domain name, watermark, puzzle globe, or Wikipedia branding. Opaque background.
```

## Original verification

The final 1200 × 630 opaque PNG is 421,705 bytes. Its text and full-size export were visually inspected. Node 24.22.2 TypeScript checks passed. Both dedicated tests passed, including isolated audited production builds for root and repository-subpath URLs (with a trailing slash). Each build checked the homepage, article, folder listing, graph and 404 metadata for exactly one image per tag, PNG type/dimensions, matching alt text, preserved page titles and favicon, and byte-identical copied image content. The temporary fixture source remained unchanged and its output directories were removed.

The normal collection build passed its output audit and all seven existing output tests. A live preview request returned the image with HTTP 200 and image/png, with bytes matching the source; homepage metadata points to the correct configured absolute image URL. No production-browser test suite was rerun for this static-image/head-only change. No remote push or public deployment was performed. Source vault data and concurrent publication/graph workflow edits were left untouched by this task.

## Original radial graph revision

The edit request was to change only the right-hand network to the new radial
mark, preserving all text, layout and the white background. The vector finish
removes all lighting from the graph. The title, boxed E, tagline and divider were
checked against the original pixels. The monochrome comparison is an earlier
study and has not been revised. The updated PNG hash is recorded in
`trusted-site-assets.json`.
