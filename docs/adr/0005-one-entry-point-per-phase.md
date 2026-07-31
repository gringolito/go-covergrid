# One entry point per phase, so the renderer is testable where the network is not

The action's logic is split into four independently invocable units, each a step in `action.yml`:

| Unit | Reads | Writes | Network |
| --- | --- | --- | --- |
| `src/find-baseline.js` | token, base branch, `GITHUB_WORKFLOW_REF` | `run-id` | GitHub API |
| `src/render-gridmap.js` | a Breakdown File | an SVG, the coverage outputs | none |
| `scripts/publish-image.sh` | an SVG | `url`, `expires`, `content-type` | Litterbox |
| `src/post-comment.js` | two Breakdown Files, an image URL | `comment-id` | GitHub API |

The split is forced by [ADR-0002](./0002-public-image-hosting.md): the catbox.moe domains do not resolve on the
development network, so nothing that renders may also upload, or the renderer becomes untestable
offline. `render-gridmap.js` therefore takes a file path and produces a file, and the published URL
reaches the comment as a plain `IMAGE_URL` environment variable.

The same reasoning applies to the comment. `post-comment.js` neither renders nor uploads, so the
comment body is a pure function of two Breakdown Files, an outcome string and a URL — which is what
lets the full posting path be driven end to end against a `http://127.0.0.1` stand-in for the GitHub
API. That is not a mock of our own code; it is the real script, the real `fetch`, the real request
bodies, asserted from the other side of a socket.

## Consequences

Every unit communicates through `$GITHUB_OUTPUT` and environment variables rather than by importing
each other's state. That is more plumbing in `action.yml` than one big script would need, and the
plumbing is the part a type checker cannot see — a renamed step id or a dropped `shell:` fails only on
a real runner. `test/action-yml.test.js` scans `action.yml` for exactly those mistakes, by indentation,
because no YAML parser is available under the zero-dependency rule.

The Coverage Gate runs with `continue-on-error: true` and the job is failed by a final step instead.
A comment explaining why coverage regressed is more useful than a bare red X, and the gate failing must
not prevent the Breakdown File from being uploaded — tomorrow's Baseline is today's Breakdown File, so
skipping the upload on failure would break the next run's comparison as well as this one's.

`continue-on-error` on a composite action's steps was verified against the metadata-syntax
documentation before being relied on; it is listed among the supported `runs.steps[*]` keys.

## What has not run in CI

The gate, the renderer and the comment have all executed against a real repository. Two paths have not:

- **`publish-image.sh` itself.** Litterbox was measured uploading and serving `image/svg+xml` from a
  runner, but by a probe using its own inline curl. The script's first real exercise is still ahead, and
  the userhash branch has never run at all.
- **Cross-run artifact download**, because the run that would have exercised it had no baseline yet.

A failure in either degrades rather than breaking the job, which is the split in the table above earning
its keep — but degrading quietly is exactly how a path stays unverified, so neither should be assumed
working on the strength of a green run.
