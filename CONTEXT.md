# Coverage Grid Map

A reusable composite GitHub Action that runs a Go coverage gate, turns the result into a **Grid Map** —
a proportionally-sized, coverage-coloured picture of where a repository's tests are and aren't — and
posts one pull request comment carrying the gate result, the Grid Map, and the change since the base
branch.

## Language

### Input data

**Coverage Profile**:
The file `go test -coverprofile` writes. The Action accepts one only to hand to the Coverage Gate; no
part of this project parses it. See
[ADR-0001](./docs/adr/0001-read-breakdown-files-not-the-profile.md) for why.
_Avoid_: coverage report, coverage output, cover.out (that's a filename, not a concept)

**Coverage Gate**:
The embedded `vladopajic/go-test-coverage` step. It decides pass or fail against configured thresholds
and writes the Breakdown File that everything else reads.
_Avoid_: checker, validator, linter, threshold check

**Breakdown File**:
The Coverage Gate's machine-readable output: one line per Go source file, semicolon-delimited
`path;totalStatements;coveredStatements`. The single source of every number this project reports.
_Avoid_: report (the Gate's `report` output is human-formatted prose and must never be parsed), summary,
coverage data

**Statement**:
The unit a Breakdown File counts. The `go` toolchain reports Statements, never lines, and a Statement is
what both a Tile's area and its colour are measured in.
_Avoid_: line, LOC, line count, SLOC

**Baseline**:
The Breakdown File from the most recent successful run on the base branch, retrieved from that run's
artifacts. Absent on a repository's first run, and every comparison must degrade gracefully without it.
_Avoid_: main, base, previous, diff-base

### The picture

**Grid Map**:
The whole rendered picture: every Package laid out as one Tile, each Tile's area proportional to its
Statement count and its colour set by its Coverage Band.
_Avoid_: treemap, heatmap, chart, graph, sunburst

**Tile**:
One Package's rectangle in the Grid Map. Tiles do not nest — the Grid Map is flat.
_Avoid_: cell, box, square, block

**Package**:
Everything before the last `/` of a Breakdown File path, with no rollup of deeper paths into shallower
ones. `internal/tariff` and `internal/tariff/courier` are two separate Packages, not a parent and a
child, and the former's Statements exclude the latter's entirely. This matches the Coverage Gate's own
package naming, so our numbers agree with its threshold annotations.
_Avoid_: module (a module is the `go.mod` unit; a repository normally has one), directory, folder

**Coverage Ratio**:
A Package's covered Statements divided by its total Statements. Because a Tile's area is also its
Statement count, the coloured proportion of the Grid Map's area *is* the repository's overall Coverage
Ratio.
_Avoid_: coverage score, percentage (the number drawn on a Tile is a Coverage Ratio formatted as a
percentage)

**Coverage Band**:
One of five fixed ranges a Coverage Ratio falls into, and the only thing determining a Tile's colour.
Boundaries are conventional (50 / 70 / 85 / 95) and deliberately not fitted to any repository's
distribution — a project whose Packages all reach the top Band should render as a solid block of green,
because that is the true picture.
_Avoid_: bucket, tier, grade, level, gradient
