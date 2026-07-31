'use strict'

// Entry point: find the run whose artifacts hold the Baseline.
//
// Writes `run-id` — empty when the base branch has no successful run yet, which is the
// normal state on a repository's first run. A lookup failure is downgraded to a warning
// and an empty run id, because losing the comparison is much better than failing the job.

const { createClient } = require('./github.js')
const { setOutput, warning } = require('./workflow.js')

async function main() {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, WORKFLOW, BASE_BRANCH } = process.env

  try {
    if (!GITHUB_TOKEN) throw new Error('no github-token was supplied')

    const api = createClient({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      apiUrl: GITHUB_API_URL || 'https://api.github.com',
    })

    const runId = await api.latestSuccessfulRunId({ workflow: WORKFLOW, branch: BASE_BRANCH })

    if (runId === null) {
      warning(
        `No successful "${WORKFLOW}" run found on ${BASE_BRANCH}; this run has no baseline to compare against.`,
      )
      setOutput('run-id', '')
      return
    }

    setOutput('run-id', runId)
  } catch (err) {
    warning(`Baseline lookup failed (${err.message}); continuing without a baseline.`)
    setOutput('run-id', '')
  }
}

main()
