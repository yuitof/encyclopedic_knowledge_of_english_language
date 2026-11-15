# Website and iOS home-screen icons

The selected **F** design shows a blue center with twelve gray surrounding nodes:
five long spokes and seven shorter ones, with varied node sizes. The center is
larger so it stands out. A dark background fades from `#242c36` at the top to
`#101418` at the bottom, tilted 5 degrees from vertical toward the right.

The blue is `#577fd9`; the surrounding nodes use subdued gray `#7f8791`. Very faint
rim reflections follow upper-left lighting. Spokes parallel or nearly parallel
to that light have no edge highlight. The raised edge and overall lighting are
deliberately slight. The artwork is SVG geometry without fonts or external art.

- `custom/favicon.svg` is the browser favicon: a simplified five-spoke graph on
  a transparent background, with larger nodes and thicker edges for small sizes.
  It uses solid fills and strokes, with no gradients, highlights, or extrusion.
- `custom/apple-touch-icon.svg` is the separate dark F source for iOS.
- `custom/apple-touch-icon.png` is its opaque 180 × 180 export for iOS.
- `quartz.ts` adds one `apple-touch-icon` link and the Home Screen title
  **Encyclopedia** to every page, including articles, listings, the graph, and 404.
  The icon URL includes the configured deployment prefix and works on nested URLs.

The square artwork has an opaque background; iOS applies the icon shape. The
browser uses the transparent favicon in both reading themes; iOS uses dark F. An icon
link alone does not enable standalone mode, offline caching, or a service worker.

After editing either SVG, run `node scripts/generate-icons.mjs` from `site/` to
regenerate the iOS PNG from its dark source and refresh the favicon and PNG
entries in `trusted-site-assets.json`. Review both
the icon and inventory before committing. The normal audited build copies the
two approved assets to `static/`.

`node --test tests/social-image.test.mjs` checks PNG dimensions and opacity,
copied bytes, and icon metadata on root and repository-subpath deployments.

To install the new icon on an iPhone, remove the existing Home Screen shortcut,
open the deployed website in Safari, and use **Share → Add to Home Screen** again.
The native iOS install sheet and Home Screen should also be checked on a real
device; browser tests verify the published metadata and image, not SpringBoard.

The integration follows Apple's [Web Clip icon documentation](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).
