# One entry point per phase, so the renderer is testable where the network is not

Logic splits into four independently invocable units, each a `action.yml` step:

| Unit | Reads | Writes | Network |
| --- | --- | --- | --- |
| `src/find-baseline.js` | token, base branch, `GITHUB_WORKFLOW_REF` | `run-id` | GitHub API |
| `src/render-gridmap.js` | a Breakdown File | an SVG, coverage outputs | none |
| `scripts/publish-image.sh` | an SVG | `url`, `expires`, `content-type` | Litterbox |
| `src/post-comment.js` | two Breakdown Files, image URL | `comment-id` | GitHub API |

[ADR-0002](./0002-public-image-hosting.md) enforces this split: the external image hosting doesn't resolve
on development networks, so nothing rendering can also upload. The renderer becomes untestable offline
otherwise. The renderer takes a file path, outputs a file; the URL reaches the comment as an environment
variable.

Same for the comment: the comment builder neither renders nor uploads, so the body is a pure function of
Breakdown Files, an outcome, and a URL. This lets the full posting path run end-to-end against a local
mock GitHub API — not mocked code, but the real script, real `fetch`, real request bodies, asserted
from the other side of a socket.

## Consequences

Each unit communicates via `$GITHUB_OUTPUT` and environment variables, not by importing state. This is
more `action.yml` plumbing than one script would need, and plumbing escapes type checking — a renamed
step ID or dropped `shell:` fails only on a real runner. `test/action-yml.test.js` scans for these by
indentation.

The Coverage Gate runs with `continue-on-error: true`; a final step fails the job instead. A comment
explaining why coverage regressed beats a bare red X. The gate failing must not prevent Breakdown File
upload — tomorrow's Baseline is today's Breakdown File, so skipping upload breaks the next run's comparison
too. `continue-on-error` on composite steps is supported per the metadata-syntax docs.

## Untested paths

The gate, renderer, and comment have executed against real repositories. The publish and cross-run artifact
paths haven't.

Either degrading (not breaking) is why the split works — but quiet degradation means unverified paths,
so neither should be trusted on green alone.
