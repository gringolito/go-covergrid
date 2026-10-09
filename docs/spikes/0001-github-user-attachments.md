# Spike 0001: Host the Grid Map as a GitHub user attachment

## Question

Can the action upload the Grid Map through GitHub's undocumented
`uploads.github.com/user-attachments/assets` endpoint and embed it in the pull request comment,
in place of Litterbox and Catbox? If so, does it remove the costs ADR-0002 accepts: a world-readable
URL for private repositories, a 72-hour lifetime, and a dependency on a third-party host?

## Sources

- Ben Sheldon, [How to programmatically upload attachments to GitHub Issues, Pull Requests, and
  Comments](https://island94.org/2026/08/programmatically-upload-attachments-to-github-issues-pull-requests-comments),
  2026-08-03. Describes the endpoint with a `gh auth token` bearer token.
- Intercom's
  [`attach-github-assets` upload script](https://github.com/intercom/2x-skills/blob/59213af0a2db9321ef10355ff24e9bd619151b6b/plugins/pr-tools/skills/attach-github-assets/scripts/upload.sh),
  which lists `image/svg+xml` among the accepted types.
- [`sudosubin/gh-attach`](https://github.com/sudosubin/gh-attach), a `gh` extension around the same
  endpoint, which shows other people relying on it.

## Prototypes

All against this repository (public, id `1318677471`), uploading `docs/example-grid-map.svg`.

1. `curl` from a workstation with the maintainer's `gh` OAuth token (scopes `repo`, `workflow`,
   `gist`, `project`, `read:org`).
2. A throwaway workflow on draft PR #11, uploading with `GITHUB_TOKEN`. One run had
   `contents: read`, `pull-requests: write` and `issues: write`. A second run used
   `contents: write`. Both tried the `Bearer` and `token` authorization schemes.
3. The second run also posted a comment as `github-actions[bot]` embedding an asset that the
   maintainer's token had uploaded.

PR #11 is closed and its branch is deleted.

## Findings

**A user token works and SVG is accepted.** The upload returned `201` with
`{"url":"https://github.com/user-attachments/assets/<uuid>"}`. The asset is served with
`response-content-type=image/svg+xml`, so the Grid Map needs no rasterizing.

**`GITHUB_TOKEN` does not work.** Every attempt returned `404 Not Found`, with both authorization
schemes and with both permission sets. The endpoint creates *user* attachments. An installation
token has no user, so I expect a GitHub App installation token to fail the same way [INFERENCE,
not tested].

**The uploader and the commenter can be different identities.** The bot posted a comment
embedding an asset uploaded with the maintainer's token, and the image rendered. So only the
upload needs the personal token. Posting can stay on `GITHUB_TOKEN`, and the comment keeps
`github-actions[bot]` as its author.

**GitHub serves the image itself, not camo.** In the rendered `body_html`, `src` points to
`private-user-images.githubusercontent.com/...?jwt=...`, a URL GitHub signs per page view with
a short-lived token. This is the path ADR-0002 says doesn't exist ("camo cannot reach a server
that requires authentication"). ADR-0002 is right about third-party URLs. GitHub-hosted
attachments bypass camo entirely.

**Access follows the content that references the asset.** A fresh upload answered anonymous
requests with `404`, even though the repository is public. After a comment referenced it, the
same URL answered anonymously with a `302` to S3. For private and internal repositories, GitHub
documents that only people with access to the repository can view attachments
([changelog, 2023-05-09](https://github.blog/changelog/2023-05-09-more-secure-private-attachments),
[attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)).
I did not test a private repository, because that needs a repository outside this one. If GitHub
applies the same rule to API uploads, the disclosure ADR-0002 accepts goes away and a private
repository's package tree stays private.

**No expiry.** Attachments live as long as GitHub keeps them. The 72-hour Litterbox limit, and the
expiry caption the comment carries because of it, would no longer apply.

## Costs and risks

- **It needs a personal credential.** The secret is a PAT or OAuth token belonging to a real
  person. Uploads are attributed to that account and stop working when the person loses access
  to the repository or leaves the organisation. This breaks ADR-0002's zero-configuration
  default, so it can't replace Litterbox outright.
- **The endpoint is undocumented.** GitHub can change or close it without notice, as the article's
  own title ("for now") admits. The action must keep degrading to a comment without an image, as
  it does today when a host misbehaves.
- **Fine-grained PATs are untested.** I tested only a classic-style OAuth token with `repo`. The
  minimum fine-grained permission (probably `contents: write` or `issues: write` on the target
  repository) is unknown.
- **Fork pull requests get no secrets.** This is no regression. Fork runs already can't post the
  comment with a read-only `GITHUB_TOKEN`.
- **Orphaned uploads.** Every push uploads a new asset. Assets that never reach a comment stay
  private and unreachable. I found no way to delete them through the API.

## Recommendation

Adopt it as an optional host, chosen over Litterbox and Catbox whenever an upload token is
configured. Keep Litterbox as the zero-configuration default.

For private repositories this is the only option found so far that both renders inline and keeps
coverage data private, which is the main reason to build it. Before relying on that claim in the
README, confirm it on a private repository.

Write a new ADR that supersedes the host sections of ADR-0002. The disclosure notice must
then depend on the host: no world-readable warning for GitHub attachments on a private
repository, and the existing warning for everything else.

## Follow-on items

1. **Verify attachment privacy on a private repository.** Upload with a user token, reference the
   asset in a bot comment, and confirm that an anonymous request and a request from a user without
   access both fail. Also find the minimum fine-grained PAT permission. This gates item 2's privacy
   claims.
2. **Add a GitHub-attachment host to `publish-image.sh`.** Add a new `attachment-token` input,
   read from the environment and never echoed. Resolve the repository id from
   `github.event.repository.id`. Keep the Content-Type check, done as an authenticated HEAD because
   unreferenced assets answer `404` anonymously. Emit no `expires`. Fall back to Litterbox when the
   upload fails, with a warning.
3. **ADR superseding ADR-0002's host choice,** plus README and `::notice::` wording that depends on
   the host and on repository visibility.
