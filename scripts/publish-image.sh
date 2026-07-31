#!/usr/bin/env bash
# Publishes the Grid Map SVG and writes `url`, `expires` and `content-type` to $GITHUB_OUTPUT.
#
# Litterbox is the default because it needs no account and no secret, and it is the only
# anonymous host left standing. The userhash lifts that 72-hour limit for anyone willing to hold
# a Catbox account.

set -uo pipefail

svg="${1:?usage: publish-image.sh <file.svg>}"
userhash="${CATBOX_USERHASH:-}"

fail_soft() {
  printf '::warning::%s\n' "$1"
  {
    printf 'url=\n'
    printf 'expires=\n'
  } >>"$GITHUB_OUTPUT"
  exit 0
}

if [[ ! -f "$svg" ]]; then
  fail_soft "No grid map at ${svg}; nothing to publish."
fi

if [[ -n "$userhash" ]]; then
  backend='Catbox'
  endpoint='https://catbox.moe/user/api.php'
  retention=''
  upload_form=(--form "userhash=${userhash}")
  url_prefix='https://files.catbox.moe/'
else
  backend='Litterbox'
  endpoint='https://litterbox.catbox.moe/resources/internals/api.php'
  retention='72h'
  upload_form=(--form "time=${retention}")
  url_prefix='https://litter'
fi

if ! response=$(curl --silent --show-error --fail \
  --retry 3 --retry-delay 2 --max-time 120 \
  --form reqtype=fileupload \
  "${upload_form[@]}" \
  --form "fileToUpload=@${svg}" \
  "$endpoint" 2>&1); then
  fail_soft "Grid map upload failed: ${response}. The comment will be posted without the image."
fi

if [[ "$response" != "$url_prefix"* ]]; then
  hint=''
  if [[ -n "$userhash" ]]; then
    hint=' Check the catbox-userhash input — an unrecognised hash is refused here.'
  fi
  fail_soft "Unexpected response from ${backend}: ${response}.${hint} The comment will be posted without the image."
fi

# Keep this check: camo serves image/* and refuses everything else, so a host that labels the
# upload application/octet-stream would give every comment a broken image (ADR-0002).
if ! content_type=$(curl --silent --show-error --fail --location --head \
  --max-time 30 --write-out '%{content_type}' --output /dev/null "$response" 2>&1); then
  fail_soft "Could not read the Content-Type of ${response}: ${content_type}. The comment will be posted without the image."
fi

case "$content_type" in
  image/*) ;;
  *)
    fail_soft "${backend} served ${response} as '${content_type}' rather than an image type. GitHub's camo proxy would refuse it, so the comment will be posted without the image."
    ;;
esac

{
  printf 'url=%s\n' "$response"
  printf 'expires=%s\n' "$retention"
  printf 'content-type=%s\n' "$content_type"
} >>"$GITHUB_OUTPUT"

if [[ -n "$retention" ]]; then
  lifetime="It expires ${retention} after this run."
else
  lifetime='It does not expire.'
fi

printf '::notice::Grid map published at %s (%s) — this URL is public and world-readable by anyone who has it, including the package tree and per-package coverage of a private repository. %s Set publish-image: false to opt out.\n' \
  "$response" "$content_type" "$lifetime"
