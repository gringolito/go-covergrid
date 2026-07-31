'use strict'

// Which pull request, if any, this run belongs to.
//
// `@actions/github` would hand over a parsed context; with no dependencies (ADR-0003) the
// event payload is read from `$GITHUB_EVENT_PATH` instead.

const fs = require('node:fs')

/**
 * @param {{ eventName?: string, payload?: any }} context
 * @returns {number | null} null when the run is not attached to a pull request
 */
function prNumberFrom(context) {
  const payload = context && context.payload
  if (!payload) return null

  if (payload.pull_request && typeof payload.pull_request.number === 'number') {
    return payload.pull_request.number
  }

  // issue_comment fires for pull requests too, but only PR issues carry `pull_request`.
  if (payload.issue && payload.issue.pull_request && typeof payload.issue.number === 'number') {
    return payload.issue.number
  }

  return null
}

/** @returns {{ eventName: string | undefined, payload: any }} */
function readContext(env = process.env) {
  const path = env.GITHUB_EVENT_PATH
  let payload = null

  if (path) {
    try {
      payload = JSON.parse(fs.readFileSync(path, 'utf8'))
    } catch {
      payload = null
    }
  }

  return { eventName: env.GITHUB_EVENT_NAME, payload }
}

module.exports = { prNumberFrom, readContext }
