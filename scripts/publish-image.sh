#!/usr/bin/env bash
# Uploads the Grid Map SVG as a GitHub user attachment and writes `url` to $GITHUB_OUTPUT.
#
# The upload endpoint takes only a token that belongs to a person with write access to the
# repository. GITHUB_TOKEN and GitHub App installation tokens get a 404 (ADR-0006).

set -uo pipefail

svg="${1:?usage: publish-image.sh <file.svg>}"
token="${ATTACHMENT_TOKEN:-}"
repository_id="${REPOSITORY_ID:-}"

# `--retry` logs every attempt it abandons on stderr, so stderr goes to its own file and is
# read only when the exit status says the call failed.
curl_stderr="$(mktemp)"
reply="$(mktemp)"
trap 'rm -f "$curl_stderr" "$reply"' EXIT

# A GitHub annotation is a single line, so a multi-line complaint is collapsed rather than
# truncated at the first newline.
one_line() {
  tr '\n' ' ' <"$1" | sed -e 's/[[:space:]]\{2,\}/ /g' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

fail_soft() {
  printf '::warning::%s The comment will be posted without the image.\n' "$1"
  printf 'url=\n' >>"$GITHUB_OUTPUT"
  exit 0
}

if [[ ! -f "$svg" ]]; then
  fail_soft "No grid map at ${svg}; nothing to publish."
fi
if [[ -z "$token" ]]; then
  fail_soft 'No attachment-token is set, so the grid map cannot be uploaded.'
fi
if [[ -z "$repository_id" ]]; then
  fail_soft 'The event payload carries no repository id to upload the grid map against.'
fi

# The token goes in through stdin, never argv, so no process listing on the runner shows it.
if ! status=$(curl --silent --show-error \
  --retry 3 --retry-delay 2 --max-time 120 \
  --request POST \
  --header @- \
  --header 'Accept: application/vnd.github+json' \
  --header 'Content-Type: application/octet-stream' \
  --data-binary "@${svg}" \
  --output "$reply" \
  --write-out '%{http_code}' \
  "https://uploads.github.com/user-attachments/assets?name=grid-map.svg&content_type=image%2Fsvg%2Bxml&repository_id=${repository_id}" \
  2>"$curl_stderr" <<<"Authorization: Bearer ${token}"); then
  fail_soft "Grid map upload failed: $(one_line "$curl_stderr")."
fi

case "$status" in
  201) ;;
  401)
    fail_soft 'GitHub rejected attachment-token (HTTP 401). It is invalid, expired or revoked.'
    ;;
  404)
    # The endpoint answers 404, not 403, when the token cannot write to the repository.
    fail_soft 'GitHub refused the upload (HTTP 404). attachment-token must be a personal access token whose owner has write access to this repository, and a fine-grained one needs "Pull requests: Read and write" on it; GITHUB_TOKEN and GitHub App tokens are always refused.'
    ;;
  *)
    fail_soft "GitHub refused the upload (HTTP ${status}): $(one_line "$reply")."
    ;;
esac

# Anything but an HTTPS asset URL on github.com would embed something we did not upload.
if ! url=$(node -e '
  const { url } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))
  const parsed = new URL(url)
  if (parsed.protocol !== "https:" || parsed.host !== "github.com" ||
      !/^\/user-attachments\/assets\/[^/]+$/.test(parsed.pathname) || parsed.search || parsed.hash) {
    process.exit(1)
  }
  process.stdout.write(parsed.href)
' "$reply" 2>/dev/null); then
  fail_soft "Unexpected reply from the upload endpoint: $(one_line "$reply")."
fi

printf 'url=%s\n' "$url" >>"$GITHUB_OUTPUT"
printf '::notice::Grid map uploaded to %s. GitHub shows it to whoever can read this repository.\n' "$url"
