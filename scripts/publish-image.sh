#!/usr/bin/env bash
# Publishes the Grid Map SVG to Catbox and writes `url` to $GITHUB_OUTPUT.
#
# Anonymous POST, no account and no secret, which is why Catbox wins over Cloudinary and
# ImgBB — see docs/adr/0002-public-image-hosting.md. Never point this at
# litter.catbox.moe: that subdomain expires files after 72 hours and every historical pull
# request comment would rot into a broken image.
#
# curl rather than a Node HTTP client, per ADR-0003.
#
# An upload failure is a warning, not an error. The comment still carries every number;
# only the picture is missing.
set -uo pipefail

svg="${1:?usage: publish-image.sh <file.svg>}"

fail_soft() {
  printf '::warning::%s\n' "$1"
  printf 'url=\n' >>"$GITHUB_OUTPUT"
  exit 0
}

if [[ ! -f "$svg" ]]; then
  fail_soft "No grid map at ${svg}; nothing to publish."
fi

if ! response=$(curl --silent --show-error --fail \
  --retry 3 --retry-delay 2 --max-time 120 \
  --form reqtype=fileupload \
  --form "fileToUpload=@${svg}" \
  https://catbox.moe/user/api.php 2>&1); then
  fail_soft "Grid map upload failed: ${response}. The comment will be posted without the image."
fi

# Only files.catbox.moe serves uploads with an image Content-Type. Anything else in the
# response body is an error page, not a URL.
if [[ "$response" != https://files.catbox.moe/* ]]; then
  fail_soft "Unexpected response from Catbox: ${response}. The comment will be posted without the image."
fi

# LOAD BEARING, and the one thing CI has to confirm. GitHub's camo proxy serves `image/*`
# and refuses everything else, and whether Catbox labels a .svg upload `image/svg+xml` or
# `application/octet-stream` cannot be checked from the development network — catbox.moe
# does not resolve there. An octet-stream would make the image silently fail to render, so
# the type is verified here and a wrong one degrades to a comment with no image rather than
# a comment with a broken one.
if ! content_type=$(curl --silent --show-error --fail --location --head \
  --max-time 30 --write-out '%{content_type}' --output /dev/null "$response" 2>&1); then
  fail_soft "Could not read the Content-Type of ${response}: ${content_type}. The comment will be posted without the image."
fi

case "$content_type" in
  image/*) ;;
  *)
    fail_soft "Catbox served ${response} as '${content_type}' rather than an image type. GitHub's camo proxy would refuse it, so the comment will be posted without the image. This is the assumption ADR-0002 records as unverified."
    ;;
esac

printf 'url=%s\n' "$response" >>"$GITHUB_OUTPUT"
printf 'content-type=%s\n' "$content_type" >>"$GITHUB_OUTPUT"

# ADR-0002 requires this notice on every run: publishing is on by default, so the
# disclosure has to be visible to someone who never read the README.
printf '::notice::Grid map published at %s (%s) — this URL is public and world-readable by anyone who has it, including the package tree and per-package coverage of a private repository. Set publish-image: false to opt out.\n' "$response" "$content_type"
