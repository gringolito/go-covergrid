# Grid Map geometry: flat squarified treemap in an 830px coordinate space, height grows with package count

The Grid Map is a **flat squarified treemap** (Bruls, Huizing, van Wijk). Each Package gets one Tile,
with area proportional to Statement count and no nesting. Squarified layout gives good aspect ratios
and no slivers, so every Tile can fit its label or Coverage Ratio. We rejected slice-and-dice, because
large Statement spreads turn it into ribbons too thin to label.

Nested treemaps exist elsewhere. This layout is flat because the Coverage Gate defines a Package as the
path before the last `/`, with no rollup, and the Grid Map follows that definition.

The coordinate space is 830px, matches GitHub's comment column width, and is not configurable. The
height grows with Package count and is capped, so the image never becomes a ribbon that needs scrolling.
A legend sits below the Tiles.

Matching the coordinate space to the display width makes sizes literal: `font-size="10"` is 10 pixels on
screen. Whether text is readable can be answered from the code, with no downscale factor.

Rectangles scale, but text doesn't. Font sizes and padding are absolute units. A wider coordinate space
therefore makes text smaller relative to Tiles, which fits more full paths at a smaller size. That
trades label size against completeness.

The SVG needs `width` and `height` **and** a matching `viewBox`. Together they render 1:1 at full width
and scale down when the column is narrow. Every `<text>` sets an explicit `textLength` with
`lengthAdjust="spacingAndGlyphs"`. The reader's font is unknown, and this forces the text to exactly the
reserved width. A per-Tile `clipPath` guards against vertical font metrics.

Coverage Band boundaries are **conventional thresholds**, not fitted to any repository's data. We
rejected tuning them to sample data, because sample data changes and a project should render as it
is. A colour must mean the same thing across runs and repositories.

## Consequences

Small Tiles stay bare colour chips. We don't merge them into an "other" Tile. A small Tile has few
Statements, so the layout already gives the space to what matters more.

In a flat treemap, nested packages are unrelated neighbours, and a parent's Statements exclude its
children's. Readers may expect nesting. This follows the Package definition from the Coverage Gate. See
[ADR-0001](./0001-read-breakdown-files-not-the-profile.md).

Labels use monospace fonts. The layout must know a string's width before it decides what fits. A fixed
advance makes that arithmetic exact, and `textLength` pins the width in any other font.

Name and statement count each claim their height band before the percentage is sized, so the percentage
can't overflow. When you change anything here, render the SVG and look at it.
