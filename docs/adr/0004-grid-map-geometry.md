# Grid Map geometry: flat squarified treemap in an 830px coordinate space, height grows with package count

The Grid Map is a **flat squarified treemap** (Bruls/Huizing/van Wijk): one Tile per Package, area
proportional to Statement count, no nesting. This produces good aspect ratios with no slivers and fits
every Tile with its label or Coverage Ratio. Slice-and-dice was rejected: large statement spreads
become unlabelable ribbons.

Nested treemaps are available elsewhere. This flat layout follows from the Package definition in the
Coverage Gate, matching how the gate itself treats packages.

The coordinate space matches GitHub's comment column width and is not configurable. The Tile area grows
dynamically with Package count and caps to prevent an unscrolled ribbon. A legend sits below the Tiles.

Matching the coordinate space to display width makes the numbers honest: `font-size="10"` means 10 pixels
on screen. "Readable?" is answerable from code, not a downscale factor.

Rectangles are scale-invariant, but text is not. Font sizes and padding are absolute unit counts that don't
scale, so widening shrinks text relative to Tiles and fits more full paths at smaller size. This trades
label size against completeness.

The SVG needs both `width`/`height` **and** a matching `viewBox` for 1:1 rendering at full width and
responsive scaling when narrow. Every `<text>` has explicit `textLength` with `lengthAdjust="spacingAndGlyphs"`
because the reader's font is unpredictable — this forces the run to exactly the reserved width. A per-Tile
`clipPath` guards vertical metrics.

Coverage Band boundaries are **conventional thresholds**, not fitted to any repository's data. Tuning to
sample data was rejected: sample data changes, and projects should render as they truly are. Colors must
mean the same thing across runs and repositories.

## Consequences

Small Tiles remain bare color chips, not aggregated into an "other" Tile — small precisely means few
Statements, so the layout already prioritizes what matters.

The flat treemap makes nested packages unrelated neighbors; parents' Statements exclude their children's.
Readers may expect nesting — this follows the Package definition from the Coverage Gate (see
[ADR-0001](./0001-read-breakdown-files-not-the-profile.md)).

Labels use monospace fonts. Monospace is required because the layout must know string width before deciding
fit; fixed advance makes arithmetic exact, and `textLength` pins it for any differing font.

Name and statement count each claim their height band before the percentage is sized, so the percentage
can't overflow. Render and look when changing anything here.
