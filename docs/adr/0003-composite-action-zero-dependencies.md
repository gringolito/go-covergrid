# Ship as a composite action with zero runtime dependencies

The deliverable is a reusable composite action, not a JavaScript action. Composite actions have no
bundling step and no `node_modules`, so any npm dependency would force an `npm ci` step into every
consumer's run — slow, network-dependent, and a supply-chain surface on a tool that already uploads
data publicly. We therefore allow **no runtime dependencies at all**: the logic is plain Node scripts
invoked as `run: node "$GITHUB_ACTION_PATH/src/..."` with `shell: bash`, using only the standard
library.

The renderer emits **SVG**, which is why this rule costs nothing: `<rect>` and `<text>` are strings,
and string building needs no library. `sharp`, `resvg`, `canvas` and headless Chrome are all off the
table and none of them are wanted. Curl handles the upload, so there is no HTTP client dependency
either, and the GitHub API is reached through the `fetch` that ships with Node.

The rule is only this cheap because the output format is text. Anything that required rasterising here
would mean either breaking the rule or hand-rolling an encoder, so treat a proposal to change the
output format as a proposal to revisit this ADR as well.

## Consequences

Verified constraints of `runs.using: composite`:

- **No `runs.post`.** Composite actions have no cleanup hook, so nothing may rely on teardown. Every
  temporary file goes under `RUNNER_TEMP` and is left for the runner to discard.
- **`shell:` is required** on every `run` step.
- **Secrets are not passed to actions automatically**, so the token is an explicit `github-token`
  input rather than something read from context. Consumers must also grant
  `pull-requests: write` themselves; the action cannot request permissions on their behalf.
- Outputs are declared with `value:` referencing a step output.
- Files shipped with the action are reached via `$GITHUB_ACTION_PATH`, never a relative path, because
  the working directory belongs to the consumer's checkout.

Because `@actions/core` is unavailable, step outputs are written by appending to `$GITHUB_OUTPUT` and
log annotations are emitted as raw `::warning::` / `::error::` workflow commands.
