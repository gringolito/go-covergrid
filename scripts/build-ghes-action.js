'use strict'

// Writes ghes/action.yml, the GitHub Enterprise Server variant of action.yml (ADR-0007).
//
// GHES runs only actions/upload-artifact@v3, so the variant is action.yml with that one
// step repinned and every shipped path reached one directory up. It is generated so the two
// cannot drift; test/ghes-action.test.js fails when the committed copy is stale.
//
//   node scripts/build-ghes-action.js

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SOURCE = path.join(ROOT, 'action.yml')
const TARGET = path.join(ROOT, 'ghes', 'action.yml')

const GHES_UPLOAD_ARTIFACT = 'actions/upload-artifact@c6a3b2bd78b3985e4b2f15397fec357f0fd808de # v3.2.2-node20'

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
  const artifactActions = [...text.matchAll(/^\s*(?:- )?uses: actions\/(upload|download)-artifact@.*$/gm)]
  if (artifactActions.length !== 1 || artifactActions[0][1] !== 'upload') {
    throw new Error('action.yml must use actions/upload-artifact exactly once and actions/download-artifact never')
  }

  const bare = text.match(/\$GITHUB_ACTION_PATH\b/g)
  if (bare) throw new Error('action.yml must spell $GITHUB_ACTION_PATH as ${GITHUB_ACTION_PATH}')

  const body = text
    .replace(/^name: (.+)$/m, 'name: $1-ghes')
    .replace(/^(\s*)uses: actions\/upload-artifact@.*$/m, `$1uses: ${GHES_UPLOAD_ARTIFACT}`)
    .replaceAll('${GITHUB_ACTION_PATH}/', '${GITHUB_ACTION_PATH}/../')

  return HEADER + body
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(TARGET), { recursive: true })
  fs.writeFileSync(TARGET, ghesAction(fs.readFileSync(SOURCE, 'utf8')))
}

module.exports = { ghesAction, SOURCE, TARGET, GHES_UPLOAD_ARTIFACT }
