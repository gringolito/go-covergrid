# Publish the Grid Map image to public hosting, accepting the disclosure

GitHub's comment sanitizer strips inline `<svg>`, forbids `<style>` and `style=`, and allowlists URI
**schemes** on `img src` — so no `data:` URI either, whatever the payload. Every image that does render
is refetched by GitHub's camo proxy, which the docs state cannot reach *"a server that requires
authentication"*. An inline Grid Map therefore **requires an anonymously readable public URL**. No
configuration of GitHub avoids this, and job summaries behave identically to comments.

We publish to public hosting anyway, with the disclosure understood and accepted.

## Consequences

**The Grid Map is world-readable to anyone holding the URL.** For a private repository — the case this
action was designed against — that publishes the internal package tree and each package's coverage. The
URL is unguessable, not secret. This is a deliberate trade-off for an inline picture. Do not "fix" it by
making the upload authenticated: that breaks camo and the image silently stops rendering.

Publishing is **on by default**, with a `publish-image: false` opt-out. Opt-in was rejected because the
Grid Map is the entire purpose of the action, and a headline feature that stays dark until you read the
README is a worse product. Because the default carries the disclosure, two mitigations are not optional:
a `::notice::` on **every** run naming the published URL, and the disclosure in the README's first
section rather than an inputs table halfway down.

## Two rules any host and any document must satisfy

**The host must serve `image/*`.** Camo rejects every other Content-Type, so a host answering
`application/octet-stream` cannot work — this is why SVGs in GitHub *release assets* don't embed, and it
is a Content-Type problem rather than anything SVG-specific. `img.shields.io` serves `image/svg+xml`
through camo and renders everywhere. `scripts/publish-image.sh` therefore issues a `HEAD` against the
returned URL and checks the type before handing it to the comment, so a wrong type degrades to a comment
with no image rather than a comment with a broken one. Keep that guard: the hosts measured correct today
are someone else's servers and nothing on our side would notice them changing.

**The document uses presentation attributes only.** No `<style>`, no `<script>`, no `xlink:href`, no
external references. It renders inside an `<img>`, where scripts do not run and remote references do not
load, so a document needing any of those fails silently rather than loudly.

## The host: Litterbox, at 72 hours

Anonymous `POST` to `https://litterbox.catbox.moe/resources/internals/api.php` with
`reqtype=fileupload` and `time=72h` (the longest offered), measured serving `image/svg+xml` from a
runner.

Litterbox is not the best host. It is the only remaining one that asks nothing of an adopter, and asking
nothing is the premise this action is built on. Permanent Catbox answers `412 Invalid uploader` to an
anonymous upload from an Actions address range, and the anonymous permanent hosts that might have
replaced it have closed to automation. Expect any replacement that needs no account to be temporary, and
to have been probed recently rather than once.

**Seventy-two hours is the price, paid in one place.** An open pull request re-uploads on every push, so
an active branch always shows a current picture. The archive is what breaks: an old comment gets a dead
image link. Two things keep that from reading as a defect — the comment carries every number as plain
text, and it captions the image with its own expiry.

## The optional upgrade: `catbox-userhash`

A Catbox userhash switches to `https://catbox.moe/user/api.php`, drops `time`, and adds `userhash`. The
`expires` output comes back empty, which suppresses the comment's caption. Absent or empty behaves
exactly like no input at all, asserted in `test/publish-image.test.js` rather than left to inspection.

Three properties this deliberately has:

- **It is a credential.** Read from `$CATBOX_USERHASH`, never an argument, because a composite action's
  `run:` line is echoed in the log. Never printed, including on failure paths.
- **It does not buy privacy.** Camo cannot authenticate, so the URL is world-readable either way. A
  userhash changes retention and nothing else. There is no way to make the picture private.
- **It stays genuinely optional.** The zero-configuration path is the premise the hosting decision was
  made on. A userhash that became a soft requirement — a warning nagging for one, a degraded default —
  would give away what Litterbox was chosen to protect.

Unmeasured: whether Catbox's `412` refuses anonymous uploads or blocks the address range outright. If
the latter, this path soft-fails every run and the answer is a different permanent host, not a different
hash.

## Do not try to embed the bytes

Carrying the picture inside the comment has been measured and does not work at any format. The
sanitizer allowlists schemes, so `data:` is rejected before anything inspects the payload — PNG buys
nothing that SVG failed at. Verify in one command, no CI run needed:

```bash
gh api --method POST /markdown -f mode=gfm -f context=OWNER/REPO \
  -f text='![x](data:image/png;base64,iVBORw0KGgo...)'
```

The `<img>` survives with its `src` deleted outright. Behind that sit a 65,536-character comment body
limit and a rasterizer dependency, so a future workaround at the scheme level still has two walls left.

Two hosts not worth re-evaluating: **ImgBB** rejects SVG by design (Chevereto, because SVG is XML that
can carry script), and **FreeSVG.org** has a read-only API and CC0 licensing that would file the package
tree in a searchable public-domain catalogue.
