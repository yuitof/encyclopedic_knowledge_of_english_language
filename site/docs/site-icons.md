# Website and iOS home-screen icons

The original **linked pages** mark is an open reference book with ivory pages,
a dark ink background, a blue ribbon, and three connected notes. It uses the
site's blue accent and stays legible at small sizes. It contains no fonts or
external artwork.

- `custom/favicon.svg` is the editable vector source and browser favicon.
- `custom/apple-touch-icon.png` is its opaque 180 × 180 export for iOS.
- `quartz.ts` adds one `apple-touch-icon` link and the Home Screen title
  **Encyclopedia** to every page, including articles, listings, the graph, and 404.
  The icon URL includes the configured deployment prefix and works on nested URLs.

The square artwork has a solid background; iOS applies the icon shape. An icon
link alone does not enable standalone mode, offline caching, or a service worker.

After editing the SVG, run `node scripts/generate-icons.mjs` from `site/` to
regenerate the PNG and its entries in `trusted-site-assets.json`. Review both
the icon and inventory before committing. The normal audited build copies the
two approved assets to `static/`.

`node --test tests/social-image.test.mjs` checks PNG dimensions and opacity,
copied bytes, and icon metadata on root and repository-subpath deployments.

To install the new icon on an iPhone, remove the existing Home Screen shortcut,
open the deployed website in Safari, and use **Share → Add to Home Screen** again.
The native iOS install sheet and Home Screen should also be checked on a real
device; browser tests verify the published metadata and image, not SpringBoard.

The integration follows Apple's [Web Clip icon documentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).
