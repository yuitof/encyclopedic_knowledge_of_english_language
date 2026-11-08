# Open Graph image

The shared social image is [english-encyclopedia-og.png](../custom/english-encyclopedia-og.png), an opaque 1200 × 630 PNG. It was created with the built-in imagegen tool and exported at the deployment size with Sharp, retaining the complete design.

The custom head in `quartz.ts` uses this image for Open Graph and Twitter large-image cards, with absolute URLs derived from the configured base URL. Root sites and GitHub Pages repository subpaths are supported. Dimensions, PNG type, and matching alt text are included; duplicate/default image tags are removed. The reviewed image hash lives in `trusted-site-assets.json`. No upstream Quartz asset is overwritten.

Run `node --test tests/social-image.test.mjs` from `site/` with Node 24 to verify isolated root/subpath builds, image dimensions and metadata across homepage, article, listing, graph and 404 pages. The check uses a temporary note collection and dedicated ignored output directories.

## Generation prompt

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

## Verification

The final 1200 × 630 opaque PNG is 421,705 bytes. Its text and full-size export were visually inspected. Node 24.22.2 TypeScript checks passed. Both dedicated tests passed, including isolated audited production builds for root and repository-subpath URLs (with a trailing slash). Each build checked the homepage, article, folder listing, graph and 404 metadata for exactly one image per tag, PNG type/dimensions, matching alt text, preserved page titles and favicon, and byte-identical copied image content. The temporary fixture source remained unchanged and its output directories were removed.

The normal collection build passed its output audit and all seven existing output tests. A live preview request returned the image with HTTP 200 and image/png, with bytes matching the source; homepage metadata points to the correct configured absolute image URL. No production-browser test suite was rerun for this static-image/head-only change. No remote push or public deployment was performed. Source vault data and concurrent publication/graph workflow edits were left untouched by this task.
