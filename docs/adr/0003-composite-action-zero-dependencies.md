# Ship as a composite action with zero runtime dependencies

This is a composite action, not JavaScript. Composite actions have no bundling step or `node_modules`, so
any npm dependency would force `npm ci` into every consumer run — slow, network-dependent, and a supply-chain
surface on a tool that already uploads publicly. **No runtime dependencies**: logic is plain Node scripts
run as `node "$GITHUB_ACTION_PATH/src/..."` with `shell: bash`, using only the standard library.

The renderer outputs **SVG**, making this affordable: `<rect>` and `<text>` are strings, needing no library.
`sharp`, `resvg`, `canvas`, and headless Chrome are unnecessary. Curl handles the upload; the GitHub API
uses Node's built-in `fetch`.

This constraint is cheap only because output is text. Anything requiring rasterization would mean breaking
the rule or hand-rolling an encoder. Treat a proposal to change the output format as a proposal to revisit
this decision.

## Consequences

Composite action constraints:

- **No `runs.post`.** No cleanup hook — temporary files go under `RUNNER_TEMP` for the runner to discard.
- **`shell:` is required** on every step.
- **Secrets aren't auto-passed**, so the token is an explicit `github-token` input. Consumers must grant
  `pull-requests: write` themselves.
- Outputs declared with `value:` referencing a step output.
- Files reached via `$GITHUB_ACTION_PATH`, never relative paths (working directory is the consumer's checkout).

Without `@actions/core`, step outputs append to `$GITHUB_OUTPUT` and log annotations are raw `::warning::` /
`::error::` commands.
