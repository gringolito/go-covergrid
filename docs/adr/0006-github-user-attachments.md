# Upload the Grid Map as a GitHub user attachment

Supersedes the host choice in [ADR-0002](./0002-public-image-hosting.md). Its sanitizer findings still
hold: no inline `<svg>`, no `data:` URIs, presentation attributes only.

The Grid Map is uploaded to `POST https://uploads.github.com/user-attachments/assets`, the endpoint
behind drag-and-drop in the GitHub UI and behind `gh`'s `--attach` flag. The comment embeds the
`https://github.com/user-attachments/assets/<uuid>` URL it returns. Litterbox and Catbox are gone.

## Why

ADR-0002 assumed every image in a comment goes through camo, so it needed an anonymous public URL.
That holds for third-party URLs, not for GitHub's own attachments. GitHub renders those through
`private-user-images.githubusercontent.com` with a JWT signed per page view, and decides who sees
them by who can read the repository. Measured on this repository:

- A fresh upload answers `404` to an anonymous request, even here, in a public repository. Once a
  comment references it, anonymous requests get a `302` to the file.
- For private and internal repositories, GitHub
  [documents](https://github.blog/changelog/2023-05-09-more-secure-private-attachments) that only
  people with access to the repository can view attachments.

That removes the disclosure ADR-0002 accepted, and the 72-hour expiry with it. It also removes the
third-party host, which had become unreliable.

## Consequences

**It needs a personal token.** The endpoint refuses `GITHUB_TOKEN` and GitHub App installation tokens
with `404`, whatever their permissions. We measured this on draft PR #11, and GitHub
[confirmed it as intended](https://github.com/cli/cli/issues/14309). It also answers `404` to a
personal token whose owner lacks write access ([cli/cli#14302](https://github.com/cli/cli/issues/14302)).
A fine-grained token scoped to the repository needs only "Pull requests: Read and write", which the
maintainer verified on another repository; a classic token needs `repo`. So the action takes an
`attachment-token` input, and the upload is attributed to that token's owner.
Only the upload uses it. The comment is still posted with `github-token`, and the picture renders in
a comment authored by `github-actions[bot]`.

**No token, no picture.** Without `attachment-token` the publish step does not run, and the comment
says how to turn the picture on. There is no fallback host: a fallback would put private coverage
back on a public URL whenever the token is missing, expired or refused.

**The token is a credential.** It reaches the script through the environment, because composite
`run:` lines are echoed to the log. It reaches `curl` on stdin, so it never appears in argv. It is
never printed, including on failure.

**The endpoint has no REST documentation.** `gh` depends on it, which makes a silent removal less
likely, but every failure still degrades to a comment without the picture rather than a failed job.
The warnings tell a `401` (bad token) apart from a `404` (no write access, or not a personal token).

**No Content-Type check.** ADR-0002 checked the host's Content-Type because camo refuses non-image
types. GitHub serves the attachment with the `content_type` we upload with, and the redirect target
is a pre-signed S3 `GET` URL that answers `HEAD` with `403`, so the check is gone.

**Unreferenced uploads.** Every pull request run uploads a new asset. Earlier ones stay attached to
older comment revisions or to nothing. GitHub offers no API to delete them, and they are only
visible to people who can read the repository.

**Fork pull requests** get no secrets, so they get no picture. They already got no comment, because
their `GITHUB_TOKEN` is read-only.
