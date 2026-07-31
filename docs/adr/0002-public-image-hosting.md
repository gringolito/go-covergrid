# Publish the Grid Map image to public hosting, accepting the disclosure

GitHub's comment sanitizer strips inline `<svg>` elements, forbids `<style>` and `style=`, and limits
`img src` to `http`/`https`/relative, so no `data:` URI either. The picture therefore has to be an
`<img src>` pointing at an external URL. Every inline image is refetched by GitHub's camo proxy, which
the docs state cannot reach *"a server that requires authentication"*. An inline Grid Map consequently
**requires an anonymously readable public URL**. No configuration of GitHub avoids this.

We are publishing to public hosting anyway, with the disclosure understood and accepted.

## Consequences

**The Grid Map is world-readable to anyone holding the URL.** For a private repository — the case this
action was designed against — that publishes the internal package tree (`internal/authflow`,
`internal/basket`, `internal/tariff/customs`) and each package's coverage. The URL is unguessable, not
secret; it appears in the PR comment and in camo's cache. This is a deliberate trade-off for an inline
picture, not an oversight. Do not "fix" it by making the upload authenticated, which breaks camo and
makes the image silently stop rendering.

Two constraints follow for choosing a host, both non-negotiable:

- It must serve an **`image/*` Content-Type**. Camo rejects every other type, so any host returning
  `application/octet-stream` (most S3-backed and download-oriented services) cannot work. This is the
  whole reason SVGs in GitHub *release assets* don't embed, and it is a Content-Type problem rather than
  anything SVG-specific: `img.shields.io` serves `image/svg+xml`, is camo-proxied, and renders in
  READMEs, issues and comments everywhere. Camo proxies SVG fine. Only inline `<svg>` markup in a
  comment body is stripped, which is a separate mechanism.
- The URL must be **permanent**, because PR comments outlive retention windows. A host that expires
  files turns every historical comment into a broken image.

Publishing is **on by default**, with a `publish-image: false` opt-out. Opt-in was considered and
rejected: nobody should publish their package tree by accident, but the Grid Map is the entire purpose
of the action, and a headline feature that stays dark until you read the README is a worse product.

Because the default carries the disclosure, two mitigations are not optional:

- Emit a `::notice::` on **every** run naming the published URL, so the behaviour is visible in the log
  of anyone who never read the README.
- State the disclosure in the README's first section, not in an inputs table halfway down.

## The chosen host: Catbox

Anonymous `POST` to `https://catbox.moe/user/api.php` with `reqtype=fileupload`, which needs no
account and no secret — the reason it wins over Cloudinary and ImgBB, whose keys every adopter of
this action would otherwise have to provision.

Do **not** use `litter.catbox.moe`; that subdomain expires files after 72 hours.

Unverified, and worth revisiting: Catbox's terms could not be read from the development network, so
whether they sanction automated uploads is unknown. Catbox is also volunteer-run, which makes
long-term availability a real risk for comments that outlive it.

## The document the renderer emits

Presentation attributes only. No `<style>`, no `<script>`, no `xlink:href`, no external references of
any kind. It renders inside an `<img>`, where scripts do not run and remote references do not load, so
a document needing any of those would fail silently rather than loudly.

## The one thing CI must confirm

**Whether Catbox serves a `.svg` upload as `image/svg+xml` or as `application/octet-stream` is
unverified and cannot be tested from the development network.** `catbox.moe` does not resolve there, so
nothing has been uploaded. If it comes back as `octet-stream`, camo refuses it and the image silently
fails to render in every comment.

`scripts/publish-image.sh` therefore issues a `HEAD` against the returned URL and checks the
Content-Type is `image/*` before handing the URL to the comment. A wrong type degrades to a comment
with no image, which is a legible outcome, rather than a comment with a broken one. That guard is load
bearing precisely because the assumption behind it is untested.

## Development constraint

`catbox.moe` does not resolve on the corporate network — `dig` returns nothing and the proxy times out
on the apex domain, though `files.catbox.moe` resolves. The upload path therefore cannot be exercised
locally, only in CI. Keep rendering entirely separable from uploading, so the renderer stays testable
offline by writing a file to disk.
