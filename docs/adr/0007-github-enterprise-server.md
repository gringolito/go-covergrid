# Ship a GitHub Enterprise Server variant as a generated subdirectory action

Amends the upload host in [ADR-0006](./0006-github-user-attachments.md).

GitHub Enterprise Server (GHES) runs the artifact actions only at v3. The main action stays on the
latest. GHES users take `gringolito/go-covergrid/ghes@v1`, which differs in one pinned step.

## Decision

**The Baseline is fetched over REST on both platforms.** `download-artifact@v3` can't read another
run's artifacts, and the Baseline always comes from one. `src/fetch-baseline.js` lists the run's
artifacts, downloads the zip, and follows the storage redirect without the token. `src/zip.js`
extracts the file with `zlib`, which keeps [ADR-0003](./0003-composite-action-zero-dependencies.md)
and doesn't depend on `unzip`.

**The upload stays an action.** `run:` steps don't get `ACTIONS_RUNTIME_TOKEN`, so the upload can't
move to REST. Its version is the only difference between the variants.

**`ghes/action.yml` is generated.** `scripts/build-ghes-action.js` builds it from `action.yml`. It
repins the upload and reaches shipped files through `${GITHUB_ACTION_PATH}/../`.
`.github/workflows/ghes-action.yml` fails a pull request whose committed copy is stale.

**The upload pin is `c24449f3` (v3.2.1-node20).** GHES resolves the pin against its bundled copy of
`actions/upload-artifact`. This is the commit `v3-node20` points to. v3.2.2-node20 (March 2026) is a
security backport of its dependencies for GHES, but older instances may not bundle it. The step
uploads one file this action wrote, so we take compatibility over the backport.

**The Grid Map upload follows the server.** If the API is `api.<server host>` (github.com, GHE.com),
the upload goes to `uploads.<server host>`. Otherwise it goes to `<server>/api/uploads`. Only asset
URLs on the server's host are accepted.

## Rejected

- **One `action.yml` that picks the upload step with `if:`.** The runner resolves every nested `uses:`
  at job setup, even for skipped steps. Whether the v7 pin resolves depends on each instance's copy of
  `actions/upload-artifact`. Where the copy has it, v7 fails only when run, with
  `GHESNotSupportedError`. Where it doesn't, the job fails before any step runs.
- **A `-ghes` tag line.** It needs a release job to rewrite and retag. `update-moving-tags.yml` would
  also turn `v1.4.0-ghes` into `v1`.
- **A hand-maintained copy.** A composite can't call a sibling composite, so the file must be a copy,
  and an unchecked copy drifts.

## Consequences

- Dependabot doesn't scan `ghes/`, so it never bumps the v3 pin. Its PRs that touch `action.yml` fail
  CI until someone runs `node scripts/build-ghes-action.js`.
- GHES may not offer the user-attachment endpoint. In that case the comment is posted without the
  picture.
- GHES runners need Linux with Docker and egress to `ghcr.io` for the Coverage Gate, and `node` on
  `PATH`. The instance needs GitHub Connect or actions-sync.
