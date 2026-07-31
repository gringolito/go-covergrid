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

module.exports = { setOutput, notice, warning, error, escapeAnnotation }
