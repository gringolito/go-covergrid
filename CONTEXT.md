# Coverage Grid Map

A reusable composite GitHub Action. It runs a Go coverage gate, renders the result as a **Grid Map**,
and posts one pull request comment with the gate result, the Grid Map, and the change since the base
branch. The Grid Map shows where a repository's tests are and aren't, with each tile sized by
statement count and coloured by coverage.

## Language

### Input data

**Coverage Profile**:
The file `go test -coverprofile` writes. The Action accepts one only to pass to the Coverage Gate. No
part of this project parses it. See
[ADR-0001](./docs/adr/0001-read-breakdown-files-not-the-profile.md).
_Avoid_: coverage report, coverage output, cover.out (a filename, not a concept)

**Coverage Gate**:
The embedded `vladopajic/go-test-coverage` step. It passes or fails the run against configured
thresholds and writes the Breakdown File that everything else reads.
_Avoid_: checker, validator, linter, threshold check

**Breakdown File**:
The Coverage Gate's machine-readable output. It has one line per Go source file, in the form
`path;totalStatements;coveredStatements`, and it is the only source of the numbers this project
reports.
_Avoid_: report (the Gate's `report` output is human-formatted prose and must never be parsed), summary,
coverage data

**Statement**:
The unit a Breakdown File counts. The `go` toolchain reports Statements, never lines. A Tile's area and
its colour are both measured in Statements.
_Avoid_: line, LOC, line count, SLOC

**Baseline**:
The Breakdown File from the most recent successful run on the base branch, taken from that run's
artifacts. A repository's first run has none, so every comparison must work without it.
_Avoid_: main, base, previous, diff-base

### The picture

**Grid Map**:
The rendered picture. Each Package is one Tile, with area proportional to its Statement count and
colour set by its Coverage Band.
_Avoid_: treemap, heatmap, chart, graph, sunburst

**Tile**:
One Package's rectangle in the Grid Map. Tiles don't nest. The Grid Map is flat.
_Avoid_: cell, box, square, block

**Package**:
Everything before the last `/` of a Breakdown File path. Deeper paths don't roll up into shallower
ones. `internal/tariff` and `internal/tariff/courier` are two separate Packages, not parent and child,
and the first one's Statements exclude the second's. This matches the Coverage Gate's package naming,
so our numbers agree with its threshold annotations.
_Avoid_: module (the `go.mod` unit; a repository normally has one), directory, folder

**Coverage Ratio**:
A Package's covered Statements divided by its total Statements. A Tile's area is also its Statement
count, so the coloured share of the Grid Map's area is the repository's overall Coverage Ratio.
_Avoid_: coverage score, percentage (the number drawn on a Tile is a Coverage Ratio formatted as a
percentage)

**Coverage Band**:
One of five fixed Coverage Ratio ranges. It alone determines a Tile's colour. The boundaries are
conventional (50 / 70 / 85 / 95) and are not fitted to any repository's distribution. A project whose
Packages all reach the top Band renders as a solid block of green, because that is the true picture.
_Avoid_: bucket, tier, grade, level, gradient
