# Derive every number from breakdown files, never from the coverage profile

The action embeds `vladopajic/go-test-coverage` to run the threshold gate. That tool already writes
`path;totalStatements;coveredStatements` breakdown files. Every figure in the comment is computed from
those files: the Grid Map, the total, the diff summary, and the impacted tables. Nothing parses
`cover.out`. The profile is an input only so the action can pass it to go-test-coverage.

The profile format has a trap. With `-coverpkg=./...`, every test binary instruments every package, so
each block appears once per binary. Summing the duplicates gives totals and ratios that are off by an
order of magnitude.

Deduplicating blocks needs both start and end *columns*, not just lines. Go can put several blocks on
one line, as in `if x { a } else { b }`. Keying on `file:startLine:endLine` merges distinct blocks, and
the error is hard to spot by reading code. go-test-coverage already handles this upstream.

## Considered Options

- **Parse `cover.out` ourselves.** This made sense while go-test-coverage was optional, because the
  action could work with no third-party dependency. Once the gate became an embedded step, the
  dependency was there anyway. A second statement counter adds nothing and can disagree with the
  first.
- **Grid Map from `cover.out`, everything else from breakdown files.** The worst option. Two data paths
  in one comment give two independently derived totals. Any difference in `-coverpkg` handling or
  rounding shows the reader two coverage percentages with no way to tell which is right.
- **`cover.out` for everything, go-test-coverage only as a gate.** One data path, but the diff summary
  and impacted tables would need reimplementing against a new input, for no gain.

## Consequences

The action can't work without go-test-coverage. Its version is pinned in `action.yml`, so upgrading it
needs a new action release.

`packageForFile` semantics come from upstream: everything before the last `/`, with no rollup. Nested
packages are separate Tiles, and a parent's Statements exclude its children's. Readers may expect
nesting. See [ADR-0004](./0004-grid-map-geometry.md) for the rationale.
