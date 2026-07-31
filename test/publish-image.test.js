'use strict'

// Only the paths that never reach the network are exercised. The upload itself cannot be
// tested here at all — catbox.moe does not resolve on the development network, which is
// exactly why publishing lives in its own script (ADR-0002). Whether Catbox is reachable, and
// whether it serves a .svg upload as image/svg+xml, is confirmed in CI and not on a laptop.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const SCRIPT = path.join(__dirname, '..', 'scripts', 'publish-image.sh')

test('the script is executable shell', () => {
  const first = fs.readFileSync(SCRIPT, 'utf8').split('\n')[0]
  assert.strictEqual(first, '#!/usr/bin/env bash')
})

test('it never points at litter.catbox.moe, which expires files after 72 hours', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8')
  assert.ok(!/https:\/\/litter\.catbox\.moe/.test(text))
  assert.match(text, /https:\/\/catbox\.moe\/user\/api\.php/)
})

// Camo serves image/* and refuses everything else, and whether Catbox labels a .svg upload
// image/svg+xml or application/octet-stream is the one assumption ADR-0002 records as
// unverified. The guard cannot be exercised here — it only runs after a real upload — so
// what is checked is that it exists and that a non-image type takes the degrade path.
test('the published URL is only used after its Content-Type is confirmed to be an image', () => {
  const text = fs.readFileSync(SCRIPT, 'utf8')

  assert.match(text, /--head/, 'the Content-Type must be read back from the served URL')
  assert.match(text, /%\{content_type\}/)

  const guard = text.slice(text.indexOf('case "$content_type"'))
  assert.match(guard, /image\/\*\)\s*;;/, 'image/* must be the accepting branch')
  assert.match(guard, /fail_soft/, 'anything else must degrade to a comment with no image')

  // The URL must not be written before the type has been checked.
  assert.ok(
    text.indexOf('case "$content_type"') < text.indexOf("printf 'url=%s\\n'"),
    'the url output is written before the Content-Type guard runs',
  )
})

test('a missing grid map warns and yields an empty url, without failing the job', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridmap-pub-'))
  const outputFile = path.join(dir, 'github_output')
  fs.writeFileSync(outputFile, '')

  try {
    const { stdout } = await execFileAsync('bash', [SCRIPT, path.join(dir, 'absent.svg')], {
      env: { ...process.env, GITHUB_OUTPUT: outputFile },
      encoding: 'utf8',
    })
    assert.match(stdout, /^::warning::No grid map at .*absent\.svg; nothing to publish\.$/m)
    assert.strictEqual(fs.readFileSync(outputFile, 'utf8'), 'url=\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('it refuses to run without an argument rather than uploading nothing', async () => {
  await assert.rejects(() => execFileAsync('bash', [SCRIPT], { encoding: 'utf8' }), /usage/)
})
