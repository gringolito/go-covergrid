'use strict'

// The two per-cent of `@actions/core` this action needs. `@actions/core` is an npm
// package and there are no runtime dependencies (ADR-0003), so step outputs are appended
// to `$GITHUB_OUTPUT` and annotations are written as raw workflow commands.

const fs = require('node:fs')
const crypto = require('node:crypto')

/**
 * @param {string} name
 * @param {string | number} value
 */
function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT
  if (!file) return // running outside Actions, e.g. a local render

  const text = String(value)

  if (!text.includes('\n')) {
    fs.appendFileSync(file, `${name}=${text}\n`)
    return
  }

  const delimiter = `ghadelim_${crypto.randomBytes(16).toString('hex')}`
  if (text.includes(delimiter) || text.includes('ghadelim_')) {
    throw new Error(`refusing to write output "${name}": value contains the heredoc delimiter`)
  }
  fs.appendFileSync(file, `${name}<<${delimiter}\n${text}\n${delimiter}\n`)
}

/**
 * Workflow commands are newline-terminated, so a message's own control characters have to
 * be percent-encoded or the command is truncated.
 *
 * @param {string} message
 * @returns {string}
 */
function escapeAnnotation(message) {
  return String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function annotate(level, message) {
  process.stdout.write(`::${level}::${escapeAnnotation(message)}\n`)
}

const notice = (message) => annotate('notice', message)
const warning = (message) => annotate('warning', message)
const error = (message) => annotate('error', message)

/**
 * The workflow file the current run belongs to. The runner sets `GITHUB_WORKFLOW_REF` to
 * `owner/repo/.github/workflows/ci.yml@refs/heads/main`. `GITHUB_WORKFLOW` would be easier
 * to reach for and is wrong: it holds the workflow's *display name*, which the runs API
 * does not accept.
 *
 * Split on the first `@` rather than the last: a branch name may contain one, and a
 * workflow file name realistically may not.
 *
 * @param {string | undefined} ref value of GITHUB_WORKFLOW_REF
 * @returns {string} '' when the ref is absent or doesn't name a YAML file
 */
function workflowFileFromRef(ref) {
  if (!ref) return ''

  const path = String(ref).split('@')[0]
  const file = path.slice(path.lastIndexOf('/') + 1)

  return file.endsWith('.yml') || file.endsWith('.yaml') ? file : ''
}

module.exports = { setOutput, notice, warning, error, escapeAnnotation, workflowFileFromRef }
