'use strict'

// Entry point: build the comment body and upsert it on the pull request.
//
// It neither renders nor uploads: the Grid Map arrives as an already published
// `IMAGE_URL` (ADR-0005).

const fs = require('node:fs')

const { parseBreakdown } = require('./breakdown.js')
const { MARKER, renderComment, renderUnavailableComment } = require('./comment.js')
const { createClient } = require('./github.js')
const { prNumberFrom, readContext } = require('./pr-context.js')
const { setOutput, notice, warning, error } = require('./workflow.js')

function readIfPresent(path) {
  if (!path || !fs.existsSync(path)) return null
  return parseBreakdown(fs.readFileSync(path, 'utf8'))
}

async function main() {
  const {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_API_URL,
    COVERAGE_OUTCOME,
    HAS_BASELINE,
    DIFF_THRESHOLD,
    BASE_BRANCH,
    CURRENT_BREAKDOWN_PATH,
    BASE_BREAKDOWN_PATH,
    IMAGE_URL,
    IMAGE_EXPIRES,
  } = process.env

  const prNumber = prNumberFrom(readContext())
  if (prNumber === null) {
    notice('Not running against a pull request; skipping the coverage comment.')
    return
  }

  const current = readIfPresent(CURRENT_BREAKDOWN_PATH)
  let body

  if (!current) {
    warning(`No breakdown file at "${CURRENT_BREAKDOWN_PATH}"; posting a fallback comment.`)
    body = renderUnavailableComment(CURRENT_BREAKDOWN_PATH)
  } else {
    const hasBaseline = HAS_BASELINE === 'true'
    const base = hasBaseline ? readIfPresent(BASE_BREAKDOWN_PATH) : null

    if (hasBaseline && !base) {
      warning(`Baseline was reported present but "${BASE_BREAKDOWN_PATH}" is missing; comparing against nothing.`)
    }

    body = renderComment({
      outcome: COVERAGE_OUTCOME,
      diffThreshold: parseFloat(DIFF_THRESHOLD),
      hasBaseline: hasBaseline && Boolean(base),
      baseBranch: BASE_BRANCH || 'main',
      current,
      base: base || [],
      prNumber,
      imageUrl: IMAGE_URL || null,
      imageExpiresIn: IMAGE_EXPIRES || null,
    })
  }

  const api = createClient({
    token: GITHUB_TOKEN,
    repository: GITHUB_REPOSITORY,
    apiUrl: GITHUB_API_URL || 'https://api.github.com',
  })
  const { id, action } = await api.upsertComment({ prNumber, marker: MARKER, body })

  setOutput('comment-id', id)
  notice(`Coverage comment ${action}: #${id}.`)
}

main().catch((err) => {
  // A 403 here is GitHub's "Resource not accessible by integration", and it is the likeliest
  // way a first install fails, so it gets the fix rather than a stack trace.
  if (err.status === 403) {
    error(
      'Cannot post the coverage comment: the job token is not allowed to write pull requests. ' +
        'Add this to the job (or the workflow) in your own repository:\n' +
        '    permissions:\n' +
        '      contents: read\n' +
        '      pull-requests: write\n' +
        '      actions: read\n' +
        'A repository whose default workflow permissions are read-only grants nothing without it, ' +
        'and `actions: read` is separately needed to find the baseline run. Note that a pull request ' +
        'from a fork gets a read-only token regardless, and no permissions block changes that.',
    )
    process.exit(1)
  }

  process.stderr.write(`${err.stack}\n`)
  process.exit(1)
})
