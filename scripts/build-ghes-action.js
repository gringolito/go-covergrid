'use strict'

// Writes ghes/action.yml, the GitHub Enterprise Server variant of action.yml (ADR-0007).
//
// GHES runs only actions/upload-artifact@v3, so the variant is action.yml with that one
// step repinned and every shipped path reached one directory up. It is generated so the two
// cannot drift; .github/workflows/ghes-action.yml fails a pull request whose copy is stale.
//
//   node scripts/build-ghes-action.js

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'action.yml')
const TARGET = path.join(ROOT, 'ghes', 'action.yml')

// GHES resolves this against its bundled copy of actions/upload-artifact, so the pin must be
// a commit older instances carry: v3.2.1-node20, where `v3-node20` points on github.com and GHES.
const GHES_UPLOAD_ARTIFACT = 'actions/upload-artifact@c24449f33cd45d4826c6702db7e49f7cdb9b551d # v3.2.1-node20'

const ARTIFACT_ACTION = /^(\s*(?:-\s+)?)uses: actions\/(upload|download)-artifact@.*$/gm

const HEADER = [
  '# GENERATED from action.yml by scripts/build-ghes-action.js. Do not edit by hand.',
  '# The GitHub Enterprise Server variant of go-covergrid (ADR-0007).',
  '',
].join('\n')

/**
 * @param {string} text the contents of action.yml
 * @returns {string} the contents of ghes/action.yml
 */
function ghesAction(text) {
  const artifactActions = [...text.matchAll(ARTIFACT_ACTION)]
  if (artifactActions.length !== 1 || artifactActions[0][2] !== 'upload') {
    throw new Error('action.yml must use actions/upload-artifact exactly once and actions/download-artifact never')
  }

  const bare = text.match(/\$GITHUB_ACTION_PATH\b/g)
  if (bare) throw new Error('action.yml must spell $GITHUB_ACTION_PATH as ${GITHUB_ACTION_PATH}')

  const body = text
    .replace(/^name: (.+)$/m, 'name: $1-ghes')
    .replace(ARTIFACT_ACTION, `$1uses: ${GHES_UPLOAD_ARTIFACT}`)
    .replaceAll('${GITHUB_ACTION_PATH}/', '${GITHUB_ACTION_PATH}/../')

  return HEADER + body
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true })
  fs.writeFileSync(TARGET, ghesAction(fs.readFileSync(SOURCE, 'utf8')))
}

module.exports = { ghesAction, SOURCE, TARGET, GHES_UPLOAD_ARTIFACT }
