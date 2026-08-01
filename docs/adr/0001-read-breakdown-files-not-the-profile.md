# Derive every number from breakdown files, never from the coverage profile

The action embeds `vladopajic/go-test-coverage` to run the threshold gate, and that tool already emits
`path;totalStatements;coveredStatements` breakdown files. Every figure in the comment — the Grid Map,
the total, the diff summary, the impacted tables — is computed from those files. Nothing parses
`cover.out`. The profile is accepted as an input only to hand straight to go-test-coverage.

The profile format presents a trap. Runs using `-coverpkg=./...` instrument every package in every test
binary, emitting each block once per binary. Naively summing duplicated blocks produces wildly wrong totals
and ratios — an order of magnitude error.

Block identity requires both start and end *columns*, not just lines. Go places multiple blocks on a single
line in constructs like `if x { a } else { b }`. Keying on `file:startLine:endLine` over-collapses blocks
and causes errors invisible to code inspection. go-test-coverage solves this upstream.

## Considered Options

- **Parse `cover.out` ourselves.** Attractive while go-test-coverage was optional, because it would let
  the action work for anyone running `go test -coverprofile` with no third-party dependency. That
  rationale died once the gate became an embedded step: the dependency exists regardless, so a second
  statement counter buys nothing and risks disagreeing with the first.
- **Grid Map from `cover.out`, everything else from breakdown files.** The worst option. Two data paths
  in one comment means two independently-derived totals, and any divergence in `-coverpkg` handling or
  rounding shows the reader two different coverage percentages with no way to tell which is right.
- **`cover.out` for everything, go-test-coverage purely as a gate.** Also a single data path, but it
  means reimplementing the diff summary and impacted tables against a new input for no gain.

## Consequences

The action cannot function without go-test-coverage — its version is pinned in `action.yml`, so
upgrading requires a new action release.

`packageForFile` semantics come from upstream: everything before the last `/`, with no rollup. This means
nested packages are separate Tiles, and parents' Statements exclude every child's. Readers may expect
nesting — see [ADR-0004](./0004-grid-map-geometry.md) for the design rationale.
