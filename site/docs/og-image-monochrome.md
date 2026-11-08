# Monochrome OGP comparison

[Monochrome variant](../custom/english-encyclopedia-og-monochrome.png) · [Original blue version](../custom/english-encyclopedia-og.png). Both are opaque 1200 × 630 PNG images for later side-by-side comparison.

The original remains the active social-sharing image and its approved bytes are unchanged. This variant is saved separately and is not included in the deployed asset inventory. The square border and previously blue vertices are black; the other vertices and connecting edges retain lighter grays.

Created using the built-in imagegen editing tool with the original as the edit target, then exported to the same 1200 × 630 dimensions with Sharp. The full-size output was visually inspected and the original checked against its trusted SHA-256 hash. No application/configuration changes or new build tests were required.

## Edit prompt

```text
Use case: precise-object-edit.
Edit target: the supplied English Encyclopedia OGP image. Create a separate monochrome comparison variant.
Change ONLY these colors: turn the blue square outline around the letter E into solid near-black matching the title; turn all blue network vertices (including the center vertex) into the same near-black. Preserve the other network vertices as their original lighter gray, visibly distinct from the newly black vertices. Connecting edges and horizontal rule should remain gray. Remove any remaining blue tint so the result is black, white, and gray.
Keep the square's white interior, the black E, the exact text "English Encyclopedia" and "Words, usage, and connections", the fonts, letter shapes, spacing, layout, image dimensions/aspect ratio, sizes and positions of every element, network topology, white background, margins, and all other details unchanged. Do not redraw, rearrange, add, crop, stylize, or alter the typography. Opaque background. This is a strict recolor of the existing image for later side-by-side comparison, not a redesign.
```
