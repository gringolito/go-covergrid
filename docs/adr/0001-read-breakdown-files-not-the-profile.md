# Derive every number from breakdown files, never from the coverage profile

The action embeds `vladopajic/go-test-coverage` to run the threshold gate, and that tool already emits
`path;totalStatements;coveredStatements` breakdown files. Every figure in the comment — the Grid Map,
the total, the diff summary, the impacted tables — is computed from those files. Nothing parses
`cover.out`. The profile is accepted as an input only to hand straight to go-test-coverage.

The reason is a trap in the profile format. Runs using `-coverpkg=./...` make every test binary
instrument every package, so each block is emitted once per binary. The sample `cover.out` in this repo
carries 8,713 block lines for just **618 unique blocks**, each repeated 14 or 15 times. Summing the
statement column naively reports 13,992 statements at 8.1% coverage; collapsing duplicates first gives
the true **989 statements at 76.8%**. A profile parser that misses this is wrong by 23x on size and by
an order of magnitude on ratio.

Collapsing correctly is harder than it first looks, too. Block identity includes start and end
*columns*, not just lines, because `if x { a } else { b }` puts two distinct blocks on one line. Keying
on `file:startLine:endLine` over-collapses 4 of the 618 blocks, a 0.4% error that no amount of staring
at one implementation reveals. go-test-coverage has already solved all of this upstream.

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

The action cannot function without go-test-coverage, and that is accepted rather than regretted — its
version is pinned inside `action.yml`, so upgrading it requires a release of this action.

`packageForFile` semantics come from upstream: everything before the last `/`, with no rollup. So
`internal/tariff` and `internal/tariff/courier` are separate Tiles that happen to sit next to each
other, and `internal/tariff`'s 144 statements are its own files only, excluding every child package.
Readers may expect nesting; the Grid Map deliberately does not nest.
