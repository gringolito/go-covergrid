# Ship as a composite action with zero runtime dependencies

This is a composite action, not a JavaScript action. Composite actions have no bundling step and no
`node_modules`, so any npm dependency would force `npm ci` into every consumer run. That is slow, needs
the network, and adds supply-chain risk to a tool that already uploads images. **No runtime
dependencies.** The logic is plain Node scripts run as `node "$GITHUB_ACTION_PATH/src/..."` with
`shell: bash`, using only the standard library.

The renderer outputs **SVG**, which makes this workable. `<rect>` and `<text>` are strings, so no
library is needed. `sharp`, `resvg`, `canvas`, and headless Chrome are unnecessary. Curl handles the
upload, and Node's built-in `fetch` handles the GitHub API.

The constraint holds only because the output is text. Anything that needs rasterization would mean
breaking the rule or writing an encoder by hand. A proposal to change the output format is a proposal to
revisit this decision.

## Consequences

Composite action constraints:

- **No `runs.post`.** There is no cleanup hook, so temporary files go under `RUNNER_TEMP` for the runner
  to discard.
- **`shell:` is required** on every step.
- **Secrets aren't passed automatically**, so the token is an explicit `github-token` input. Consumers
  must grant `pull-requests: write` themselves.
- Outputs are declared with `value:` referencing a step output.
- Files are reached through `$GITHUB_ACTION_PATH`, never relative paths, because the working directory
  is the consumer's checkout.

Without `@actions/core`, step outputs are appended to `$GITHUB_OUTPUT` and log annotations are raw
`::warning::` and `::error::` commands.
