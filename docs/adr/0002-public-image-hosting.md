# Publish the Grid Map image to public hosting, accepting the disclosure

GitHub's comment sanitizer strips inline `<svg>`, forbids `<style>` and `style=`, and allowlists URI
**schemes** on `img src` — so no `data:` URI either, whatever the payload. Every image that does render
is refetched by GitHub's camo proxy, which the docs state cannot reach *"a server that requires
authentication"*. An inline Grid Map therefore **requires an anonymously readable public URL**. No
configuration of GitHub avoids this, and job summaries behave identically to comments.

We publish to public hosting anyway, with the disclosure understood and accepted.

## Consequences

**The Grid Map is world-readable to anyone with the URL.** For private repos (the intended use case),
this discloses the package tree and coverage. The URL is unguessable but not secret — a deliberate
trade-off for an inline picture. Don't make the upload authenticated: it breaks camo and the image
stops rendering silently.

**Publishing is on by default for pull requests**, with a `publish-image: false` opt-out. Push runs
don't upload: no comment exists to hold the image, so uploading would disclose the package tree with
nothing shown. Opt-in was rejected: the Grid Map is the entire action, and a dark feature waiting for
README reading is a worse product. Since the default carries disclosure, two mitigations are mandatory:
a `::notice::` on every run naming the URL, and the disclosure in the README's first section.

## Requirements for any host and document

**The host must serve `image/*`.** Camo rejects other Content-Types. `scripts/publish-image.sh` checks
the returned Content-Type with a HEAD request before posting the comment, so a wrong type degrades to a
comment without an image rather than a broken embed. Maintain that guard — external hosts can change
without notice on our side.

**The document uses presentation attributes only.** No `<style>`, `<script>`, `xlink:href`, or external
references. Inside `<img>`, scripts don't execute and remote references don't load, so unsupported features
fail silently.

## The host: Letterbox (temporary retention)

A temporary host is the only option that requires no account. Permanent free hosts reject anonymous uploads
from GitHub Actions address ranges, and all accounts-free permanent services have closed to automation.
Any replacement needing no account is likely temporary as well.

**Temporary retention.** An open pull request re-uploads on each push, keeping the image current. Old
comments link to expired images — but the comment stores every number as plain text and captions the
image with its expiry, preventing this from appearing as a defect.

## The optional upgrade: accounts-based retention

An optional account-based upgrade switches to a permanent host. It carries three constraints:

- **It is a credential.** Read from environment, never a CLI argument, because composite action `run:`
  lines echo to the log. Never printed, even on failure.
- **It doesn't buy privacy.** Camo can't authenticate, so URLs are world-readable regardless. An account
  changes retention only, not visibility.
- **It remains optional.** Zero-configuration is the foundation. Soft requirements (warnings, degraded
  defaults) would undermine the choice.

## Why not embed the bytes?

Embedding images in comments doesn't work at any format. The sanitizer allowlists URI schemes, so `data:` is
rejected before payload inspection — PNG fails like SVG. The `<img>` survives with `src` deleted. A
comment character limit and rasterizer dependency add barriers to any future scheme-level workaround.
