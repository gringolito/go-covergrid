# Publish the Grid Map image to public hosting, accepting the disclosure

> [!IMPORTANT]
> Superseded by [ADR-0006](./0006-github-user-attachments.md), which hosts the Grid Map on GitHub. The
> sanitizer findings and the document requirements below still apply. The host and the disclosure
> don't.

GitHub's comment sanitizer strips inline `<svg>`, forbids `<style>` and `style=`, and allowlists URI
**schemes** on `img src`. That rules out `data:` URIs whatever the payload. GitHub's camo proxy refetches
every image that does render, and its docs say it can't reach *"a server that requires authentication"*.
An inline Grid Map therefore **needs an anonymously readable public URL**. No GitHub setting avoids
this, and job summaries behave the same as comments.

We publish to public hosting anyway and accept the disclosure.

## Consequences

**Anyone with the URL can read the Grid Map.** For private repos, the intended use case, this discloses
the package tree and coverage. The URL is unguessable but not secret. We accept this to get an inline
picture. Don't make the upload authenticated. Camo can't authenticate, so the image would stop
rendering with no error.

**Publishing is on by default for pull requests**, with a `publish-image: false` opt-out. Push runs
don't upload, because no comment exists to hold the image and the upload would disclose the package
tree for nothing. We rejected opt-in because the Grid Map is the point of the action, and a feature that
stays off until the user reads the README is a worse product. The default carries a disclosure, so two
mitigations are mandatory: a `::notice::` on every run naming the URL, and the disclosure in the
README's first section.

## Requirements for any host and document

**The host must serve `image/*`.** Camo rejects other Content-Types. Before posting the comment,
`scripts/publish-image.sh` sends a HEAD request and checks the returned Content-Type. A wrong type then
produces a comment without an image instead of a broken embed. Keep that check, because an external host
can change behavior without notice.

**The document uses presentation attributes only.** No `<style>`, `<script>`, `xlink:href`, or external
references. Inside `<img>`, scripts don't run and remote references don't load, so unsupported features
fail silently.

## The host: Litterbox (temporary retention)

A temporary host is the only option that needs no account. Permanent free hosts reject anonymous uploads
from GitHub Actions address ranges, and every permanent service that needed no account has closed to
automation. Any replacement with no account is likely temporary too.

**Temporary retention.** An open pull request re-uploads on each push, so its image stays current. Old
comments link to expired images. The comment stores every number as plain text and captions the image
with its expiry, so an expired image doesn't look like a bug.

## The optional upgrade: accounts-based retention

An optional account-based upgrade switches to a permanent host. It has three constraints:

- **It is a credential.** Read it from the environment, never a CLI argument, because composite action
  `run:` lines echo to the log. Never print it, even on failure.
- **It doesn't buy privacy.** Camo can't authenticate, so URLs are world-readable regardless. An account
  changes retention only, not visibility.
- **It stays optional.** Zero configuration is the baseline. Warnings or degraded defaults for users
  without an account would break that.

## Why not embed the bytes?

Embedding images in comments fails for every format. The sanitizer allowlists URI schemes, so it rejects
`data:` before it looks at the payload. PNG fails the same way as SVG, and the `<img>` survives with
`src` deleted. A comment character limit and a rasterizer dependency would add further problems to any
future workaround.
