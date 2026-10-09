# One entry point per phase, so the renderer is testable where the network is not

The logic is split into four units. Each runs on its own as an `action.yml` step:

| Unit | Reads | Writes | Network |
| --- | --- | --- | --- |
| `src/find-baseline.js` | token, base branch, `GITHUB_WORKFLOW_REF` | `run-id` | GitHub API |
| `src/render-gridmap.js` | a Breakdown File | an SVG, coverage outputs | none |
| `scripts/publish-image.sh` | an SVG, a personal token | `url` | GitHub uploads |
| `src/post-comment.js` | two Breakdown Files, image URL | `comment-id` | GitHub API |

The upload needs the network and a personal token ([ADR-0006](./0006-github-user-attachments.md)). If
rendering also uploaded, the renderer could no longer be tested offline. So the renderer takes a file
path and writes a file, and the URL reaches the comment as an environment variable.

The comment builder follows the same rule. It neither renders nor uploads, so the body is a pure function
of Breakdown Files, an outcome, and a URL. That lets the full posting path run end to end against a local
mock GitHub API. The real script, the real `fetch`, and the real request bodies are exercised and
asserted from the other side of a socket.

## Consequences

Units pass data through `$GITHUB_OUTPUT` and environment variables, not by importing state. This needs
more `action.yml` wiring than one script would, and the wiring isn't type-checked. A renamed step ID or
a dropped `shell:` fails only on a real runner. `test/action-yml.test.js` scans for these by
indentation.

The Coverage Gate runs with `continue-on-error: true`, and a final step fails the job. A comment that
explains why coverage dropped is more useful than a bare red X. A failed gate must not block the
Breakdown File upload, because today's Breakdown File is tomorrow's Baseline and skipping it breaks the
next run's comparison. The metadata-syntax docs support `continue-on-error` on composite steps.

## Untested paths

The gate, renderer, and comment have run against real repositories. The publish and cross-run artifact
paths haven't.

The split works because each of these two paths degrades instead of breaking. That also means a failure
produces no error, so don't trust either path on a green run alone.
