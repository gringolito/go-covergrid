# Upload the Grid Map as a GitHub user attachment

Supersedes the host choice in [ADR-0002](./0002-public-image-hosting.md). Its sanitizer findings still
hold: no inline `<svg>`, no `data:` URIs, presentation attributes only.

The action uploads the Grid Map to `POST https://uploads.github.com/user-attachments/assets`. This is
the endpoint behind drag-and-drop in the GitHub UI and behind `gh`'s `--attach` flag. The comment embeds
the `https://github.com/user-attachments/assets/<uuid>` URL it returns. Litterbox and Catbox are gone.

## Why

ADR-0002 assumed every image in a comment goes through camo, so it needed an anonymous public URL. That
holds for third-party URLs but not for GitHub's own attachments. GitHub serves those through
`private-user-images.githubusercontent.com` with a JWT signed per page view, and it decides who can see
them by who can read the repository. We measured this on this repository:

- A fresh upload answers `404` to an anonymous request, even in a public repository. Once a comment
  references it, anonymous requests get a `302` to the file.
- For private and internal repositories, GitHub
  [documents](https://github.blog/changelog/2023-05-09-more-secure-private-attachments) that only people
  with access to the repository can view attachments.

This removes the disclosure ADR-0002 accepted, and the 72-hour expiry. It also removes the third-party
host, which had become unreliable.

## Consequences

**It needs a personal token.** The endpoint answers `404` to `GITHUB_TOKEN` and to GitHub App
installation tokens, whatever their permissions. We measured this on draft PR #11, and GitHub
[confirmed it is intended](https://github.com/cli/cli/issues/14309). It also answers `404` to a personal
token whose owner lacks write access ([cli/cli#14302](https://github.com/cli/cli/issues/14302)). A
fine-grained token scoped to the repository needs only "Pull requests: Read and write", which the
maintainer verified on another repository. A classic token needs `repo`. The action therefore takes an
`attachment-token` input, and the upload is attributed to that token's owner. Only the upload uses it.
The comment is still posted with `github-token`, and the picture renders in a comment authored by
`github-actions[bot]`.

**No token, no picture.** Without `attachment-token`, the publish step doesn't run, and the comment
explains how to enable the picture. There is no fallback host. A fallback would put private coverage on
a public URL whenever the token is missing, expired, or refused.

**The token is a credential.** It reaches the script through the environment, because composite `run:`
lines are echoed to the log. It reaches `curl` on stdin, so it never appears in argv. It is never
printed, even on failure.

**The endpoint has no REST documentation.** `gh` depends on it, so silent removal is less likely. Every
failure still degrades to a comment without the picture instead of a failed job. The warnings
distinguish a `401` (bad token) from a `404` (no write access, or not a personal token).

**No Content-Type check.** ADR-0002 checked the host's Content-Type because camo refuses non-image
types. GitHub serves the attachment with the `content_type` we upload with. The redirect target is a
pre-signed S3 `GET` URL that answers `HEAD` with `403`, so the check can't work and was removed.

**Unreferenced uploads.** Every pull request run uploads a new asset. Earlier assets stay attached to
older comment revisions or to nothing. GitHub has no API to delete them, and only people who can read
the repository can see them.

**Fork pull requests** get no secrets, so they get no picture. They also get no comment, because their
`GITHUB_TOKEN` is read-only.
