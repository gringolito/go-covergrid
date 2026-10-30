# Ship a GitHub Enterprise Server variant as a generated subdirectory action

GitHub Enterprise Server (GHES) doesn't run `actions/upload-artifact` or `actions/download-artifact` at
v4 or later. Both READMEs say GHES must use v3 (`v3.2.2-node20` for upload, `v3-node20` for download).
The github.com action stays on the latest artifact actions. GHES users get
`gringolito/go-covergrid/ghes@v1`, which differs in one pinned step.

## The baseline no longer uses download-artifact

Pinning download-artifact to v3 wouldn't have been enough. v3 takes only `name` and `path`. It has no
`run-id` or `github-token`, so it can't read another run's artifacts, and the Baseline always comes
from another run.

`src/fetch-baseline.js` now gets the Baseline itself, on both platforms:

1. `GET /repos/{owner}/{repo}/actions/workflows/{workflow}/runs`: the latest successful base-branch run.
2. `GET /repos/{owner}/{repo}/actions/runs/{id}/artifacts?name=…`: the breakdown artifact. The name is
   filtered again client-side, in case an older GHES ignores `name=`.
3. `GET /repos/{owner}/{repo}/actions/artifacts/{id}/zip`: the archive. The API answers with a redirect
   to blob storage. The redirect is followed by hand so the token never reaches the storage host.

`src/zip.js` reads the single file out of the archive with `zlib`. That keeps the zero-dependency rule
([ADR-0003](./0003-composite-action-zero-dependencies.md)) and doesn't assume self-hosted runners have
`unzip`. It supports stored and deflated entries and takes sizes from the central directory, because
streamed archives leave them zero in the local header. It doesn't support Zip64 or encryption, which a
breakdown artifact never uses.

This was checked against a real github.com artifact uploaded by `upload-artifact@v4+`. The extracted
file was byte-identical to `gh run download`'s.

## The upload still needs upload-artifact

A `run:` step never sees `ACTIONS_RUNTIME_TOKEN`, so the artifact upload can't be reimplemented over
REST the way the download was. It stays an action, and that action's version is the one thing the two
variants disagree on.

## Why a generated subdirectory, not a single action or a second tag line

- **One `action.yml` that picks the upload step with `if:`.** The runner resolves every nested `uses:`
  during job setup, including steps that `if:` will skip. On a GHES without GitHub Connect, or with the
  bundled local `actions/upload-artifact` taking precedence, the v7 SHA can't be resolved, so the job
  fails before any step runs.
- **A `-ghes` tag line.** This needs a release job that rewrites and retags, and a change to
  `update-moving-tags.yml`, whose `${TAG%%.*}` would turn `v1.4.0-ghes` into `v1`. It's more machinery
  than a subdirectory, for the same result.
- **`ghes/action.yml` in the same repository.** It shares tags, releases and `src/` with the main action.
  A composite action can't call a sibling composite (`./` resolves to the consumer's checkout), so the
  file is a copy. `scripts/build-ghes-action.js` generates it from `action.yml`: it repins the upload,
  and reaches shipped files through `${GITHUB_ACTION_PATH}/../`. `test/ghes-action.test.js` fails when
  the committed copy is stale.

## The Grid Map upload follows the server

`scripts/publish-image.sh` derives the uploads host from `GITHUB_API_URL`:

- an `api.` host becomes the matching `uploads.` host (github.com and GHE.com)
- any other API URL becomes `$GITHUB_SERVER_URL/api/uploads` (GHES)

It accepts only an asset URL on `GITHUB_SERVER_URL`'s host.

## Consequences

**Dependabot PRs that touch `action.yml` fail CI until the copy is regenerated.** Dependabot scans the
root `action.yml` but not `ghes/action.yml`, which is intended: the v3 pin must never be "upgraded". The
other pins, such as the Coverage Gate, still have to match. Run `node scripts/build-ghes-action.js` on
the Dependabot branch.

**The upload pin is v3.2.1-node20, not the newer v3.2.2-node20.** GHES serves `actions/upload-artifact`
from its bundled local copy, so a SHA pin resolves only on an instance that carries that commit.
`c24449f3` (v3.2.1-node20, September 2024) is where `v3-node20` points on github.com and on the GHES
we checked, so any instance bundling v3.2.1-node20 or later has it. `c6a3b2bd` (v3.2.2-node20, March
2026) only refreshes dependencies, and instances bundled before it shipped may not have it.

**The GHES variant hasn't run a workflow on a real GHES yet.** A read-only check on a GHES 3.21.6
instance found both candidate commits in its bundled `actions/upload-artifact`. The REST endpoints and the
artifact zip format are documented for GHES. The user-attachment upload endpoint isn't. If a GHES
doesn't offer it, the publish step warns and the comment is posted without the picture, as with a
missing token.

**GHES prerequisites this project can't remove:**

- `vladopajic/go-test-coverage` is a Docker action that pulls from `ghcr.io`. Runners need Linux,
  Docker, and egress to ghcr.io.
- Every `run:` step calls `node` from `PATH`.
- The instance needs GitHub Connect or actions-sync to reach third-party actions, this one included.
