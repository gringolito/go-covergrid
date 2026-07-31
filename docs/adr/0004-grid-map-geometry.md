# Grid Map geometry: flat squarified treemap in an 830px coordinate space, height grows with package count

The Grid Map is a **flat squarified treemap** (Bruls/Huizing/van Wijk): one Tile per Package, area
proportional to Statement count, no nesting. Measured against the 18-package sample fixture it produces
aspect ratios between 1.00 and 1.82 — no slivers — and every Tile fits its Coverage Ratio, with 13 of 18
also fitting the full package path, 4 falling back to their last segment and 1 too small to name.
Slice-and-dice was rejected because a 144-vs-14 statement spread turns it into unlabelable ribbons.
`test/treemap.test.js` and `test/gridmap.test.js` assert those figures, so this paragraph cannot drift
without a test failing.

Prior art: `nikolaydubina/go-cover-treemap` already renders a Go coverage profile as an SVG treemap,
and it does nest. It was not adopted because it is a CLI that draws a picture, where this gates, diffs
against a Baseline and posts one comment — the picture is one section of that. Worth knowing about when
someone asks why this doesn't nest: nesting is available elsewhere, and the flat layout here follows
from the Package definition inherited from the Coverage Gate, not from it being easier to draw.

The coordinate space is **830 units wide**, which is GitHub's comment content column, and must not be
made configurable. The Tile area starts **467** tall and **grows with Package count** at 6 units per
Package past 24, capped at **1245**. Verified on a synthetic 120-Package fixture, which lands at 1043
and draws a percentage on 112 of 120 Tiles; at the base height a band of them degrade to unlabelled
chips. A 32-unit legend strip sits below the Tiles, carrying the five Band swatches and the repository
total, so the document is always 32 taller than the figures above.

Matching the coordinate space to the display width is what makes the numbers in the source honest.
`font-size="10"` means ten pixels on the reader's screen, so "is this readable?" is answerable by
reading the code rather than by first dividing by a downscale factor. Every threshold in the renderer —
the 7-unit floor below which a percentage is dropped, the 26-unit height below which a Tile gets no
name — is a real screen measurement.

That property is also the thing to be careful about when changing the width. The rectangles are
scale-invariant, so a treemap laid out in an 830 space and the same treemap in a 1200 space displayed at
830 are identical. The text is not: font sizes and padding are absolute unit counts that do not scale
with the space, so widening the space shrinks the text relative to every Tile and fits more full paths
at a smaller size. Changing this number trades label size against label completeness. It is not a
cosmetic rename of a constant.

The cap exists because past it the picture is a ribbon nobody scrolls, and the Tiles that would gain
from more height are the ones holding so few Statements that they are chips either way.

Two things follow that are easy to get wrong. The SVG carries `width`/`height` **and** a matching
`viewBox`, so it renders 1:1 where the column is full width and scales down responsively where it is
not — a narrow window shrinks the text, which is unavoidable in any coordinate space. And the reader's
machine resolves the font, not ours, so every `<text>` carries an explicit `textLength` with
`lengthAdjust="spacingAndGlyphs"`: whatever font wins, the run is forced to exactly the width the
layout reserved. Without that a wide fallback font overflows its Tile and no amount of measuring at
this end can prevent it. A per-Tile `clipPath` backs it up for vertical metrics.

Coverage Band boundaries are **conventional (50 / 70 / 85 / 95)** and explicitly not fitted to any
repository's distribution. Tuning them to the sample data was tried and rejected as overfitting: sample
data moves, and a project that improves until every Package reaches the top Band *should* render as a
solid block of green, because that is the true picture. Colours must mean the same thing across runs and
across repositories.

## Consequences

Tiles too small to label are left as bare colour chips rather than aggregated into an "other" Tile.
A Tile is small precisely because it holds few Statements, so the layout already prioritises what
matters, and an aggregate Tile would have no meaningful Coverage Ratio of its own.

Because the treemap is flat, `internal/tariff` and `internal/tariff/courier` are unrelated neighbours
and the parent's Statements exclude every child's. Readers may expect nesting. This follows from the
Package definition inherited from the Coverage Gate — see
[ADR-0001](./0001-read-breakdown-files-not-the-profile.md).

Labels are drawn in `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`. Monospace because the
layout has to know a string's width before it can decide whether it fits, and a fixed advance makes
that arithmetic exact: every glyph is 0.6em, and `textLength` pins the result for any font that
disagrees.

Within a Tile the name and the statement count each claim their band of height before the percentage is
sized, so the percentage can never grow into either. Getting that order wrong put a large percentage
straight through the statement count on Tiles just tall enough for both, and it was found by
rasterising the 120-Package fixture and looking at it rather than by reasoning about the code. Render
the picture and look at it when changing anything in this file.
