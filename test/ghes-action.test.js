'use strict'

// ghes/action.yml is a build product of action.yml (ADR-0007); the GHES action workflow fails
// a pull request whose committed copy is stale. These check what the generator makes of the
// current action.yml: no artifact action GitHub Enterprise Server cannot run, and no shipped
// file reached from inside ghes/.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { ghesAction, SOURCE, TARGET, GHES_UPLOAD_ARTIFACT } = require('../scripts/build-ghes-action.js')

const SOURCE_TEXT = fs.readFileSync(SOURCE, 'utf8')

test('the GHES action uploads with upload-artifact v3 and downloads with no artifact action', () => {
  const generated = ghesAction(SOURCE_TEXT)
  const artifactActions = [...generated.matchAll(/uses: (actions\/\S+-artifact@\S+.*)$/gm)].map((m) => m[1])
  assert.deepStrictEqual(artifactActions, [GHES_UPLOAD_ARTIFACT])
  assert.match(GHES_UPLOAD_ARTIFACT, /@[0-9a-f]{40} # v3\./)
  const indent = (text) => /^( *)(?:- )?uses: actions\/upload-artifact@/m.exec(text)[1]
  assert.strictEqual(indent(generated), indent(SOURCE_TEXT), 'the repinned upload moved out of its step')
})

// GITHUB_ACTION_PATH is ghes/ for this variant, so the shipped files are one level up.
test('every shipped file the GHES action invokes exists relative to ghes/', () => {
  const generated = ghesAction(SOURCE_TEXT)
  const referenced = [...generated.matchAll(/\$\{?GITHUB_ACTION_PATH\}?\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1])
  assert.ok(referenced.length >= 4)
  for (const rel of new Set(referenced)) {
    assert.ok(rel.startsWith('../'), `${rel} would look inside ghes/`)
    assert.ok(fs.existsSync(path.join(path.dirname(TARGET), rel)), `${rel} is invoked but not shipped`)
  }
})

test('an action.yml that still downloads artifacts cannot be turned into a GHES action', () => {
  const withDownload = SOURCE_TEXT.replace(
    '    - name: Run the coverage gate',
    '    - uses: actions/download-artifact@0000000000000000000000000000000000000000 # v8\n    - name: Run the coverage gate',
  )
  assert.throws(() => ghesAction(withDownload), /download-artifact never/)
})
