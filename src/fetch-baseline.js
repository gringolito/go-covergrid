'use strict'

// Entry point: fetch the Baseline from the base branch's latest successful run.
//
// Writes `path`: the extracted Breakdown File, or empty when there is no Baseline, which is
// the normal state on a repository's first run. Any failure becomes a warning and an empty
// `path`, because losing the comparison is better than failing the job.
//
// This goes through the REST API rather than actions/download-artifact: GitHub Enterprise
// Server only runs download-artifact@v3, which cannot read another run's artifacts (ADR-0007).

const fs = require('node:fs')
const path = require('node:path')
const { createClient } = require('./github.js')
const { readSoleFile } = require('./zip.js')
const { setOutput, warning, workflowFileFromRef } = require('./workflow.js')

async function main() {
  const {
    GITHUB_TOKEN,
    GITHUB_REPOSITORY,
    GITHUB_API_URL,
    GITHUB_WORKFLOW_REF,
    BASE_BRANCH,
    BREAKDOWN_ARTIFACT,
    BASELINE_PATH,
  } = process.env

  let baselinePath = ''

  try {
    if (!GITHUB_TOKEN) throw new Error('no github-token was supplied')
    if (!BREAKDOWN_ARTIFACT || !BASELINE_PATH) throw new Error('BREAKDOWN_ARTIFACT and BASELINE_PATH are required')

    // Always this run's own workflow: no other workflow uploads the breakdown artifact.
    const workflow = workflowFileFromRef(GITHUB_WORKFLOW_REF)
    if (!workflow) {
      throw new Error(`GITHUB_WORKFLOW_REF is absent or unparseable ("${GITHUB_WORKFLOW_REF ?? ''}")`)
    }

    const api = createClient({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      apiUrl: GITHUB_API_URL || 'https://api.github.com',
    })

    const run = await api.latestSuccessfulRunId({ workflow, branch: BASE_BRANCH })
    if (run === null) {
      warning(
        `No successful "${workflow}" run found on ${BASE_BRANCH}; this run has no baseline to compare against.`,
      )
      return
    }

    const artifact = await api.artifactId({ runId: run, name: BREAKDOWN_ARTIFACT })
    if (artifact === null) {
      warning(
        `Run ${run} on ${BASE_BRANCH} has no unexpired "${BREAKDOWN_ARTIFACT}" artifact; this run has no baseline to compare against.`,
      )
      return
    }

    const { data } = readSoleFile(await api.downloadArtifact(artifact))
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true })
    fs.writeFileSync(BASELINE_PATH, data)
    baselinePath = BASELINE_PATH
  } catch (err) {
    const hint =
      err.status === 403
        ? ' The token cannot read this repository\'s workflow runs or artifacts; add `actions: read` to the job\'s permissions.'
        : ''
    warning(`Baseline fetch failed (${err.message}); continuing without a baseline.${hint}`)
  } finally {
    setOutput('path', baselinePath)
  }
}

main()
