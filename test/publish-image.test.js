'use strict'

// The real upload cannot be exercised here — the catbox.moe domains do not resolve on the
// development network, which is why publishing lives in its own script (ADR-0002). So
// `curl` is replaced with a shim on PATH that records the arguments it was handed and
// answers with whatever the test wants. Everything is covered except whether the host
// itself behaves as measured, which only CI can say.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const SCRIPT = path.join(__dirname, '..', 'scripts', 'publish-image.sh')

/**
 * Runs the script against a fake curl.
 *
 * @param {object} opts
 * @param {string} [opts.uploadReply] what the upload call prints — a URL, or an error page
 * @param {string} [opts.contentType] what the HEAD call reports
 * @param {number} [opts.uploadExit] non-zero to simulate a failed upload
 * @param {Record<string,string>} [opts.env] extra environment, e.g. CATBOX_USERHASH
 */
async function run({
  uploadReply = 'https://litter.catbox.moe/abc123.svg',
  contentType = 'image/svg+xml',
  uploadExit = 0,
  env = {},
} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridmap-pub-'))
  const svg = path.join(dir, 'grid-map.svg')
  const outputFile = path.join(dir, 'github_output')
  const argLog = path.join(dir, 'curl-args')
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  fs.writeFileSync(outputFile, '')

  // Every invocation appends its own arguments, so a test can assert on the upload call and
  // the HEAD call separately. `--head` is what distinguishes them.
  fs.writeFileSync(
    path.join(dir, 'curl'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >>"${argLog}"`,
      'for arg in "$@"; do',
      `  if [[ "$arg" == --head ]]; then printf '%s' "${contentType}"; exit 0; fi`,
      'done',
      `printf '%s' "${uploadReply}"`,
      `exit ${uploadExit}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  )

  try {
    const { stdout } = await execFileAsync('bash', [SCRIPT, svg], {
      env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}`, GITHUB_OUTPUT: outputFile, ...env },
      encoding: 'utf8',
    })
    const outputs = Object.fromEntries(
      fs
        .readFileSync(outputFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]),
    )
    const calls = fs.existsSync(argLog) ? fs.readFileSync(argLog, 'utf8').trim().split('\n') : []
    return { stdout, outputs, upload: calls[0] || '', calls }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('the script is executable shell', () => {
  const first = fs.readFileSync(SCRIPT, 'utf8').split('\n')[0]
  assert.strictEqual(first, '#!/usr/bin/env bash')
})

test('with no userhash it uploads anonymously to Litterbox for the longest window on offer', async () => {
  const { upload, outputs } = await run()

  assert.match(upload, /https:\/\/litterbox\.catbox\.moe\/resources\/internals\/api\.php/)
  assert.match(upload, /time=72h/)
  assert.ok(!upload.includes('userhash'), 'nothing is sent that the adopter did not configure')
  assert.strictEqual(outputs.url, 'https://litter.catbox.moe/abc123.svg')
  assert.strictEqual(outputs.expires, '72h')
})

test('a userhash switches to permanent Catbox and reports no expiry', async () => {
  const { upload, outputs } = await run({
    env: { CATBOX_USERHASH: 'deadbeefcafe0123456789' },
    uploadReply: 'https://files.catbox.moe/zzz999.svg',
  })

  assert.match(upload, /https:\/\/catbox\.moe\/user\/api\.php/)
  assert.match(upload, /userhash=deadbeefcafe0123456789/)
  assert.ok(!upload.includes('time='), 'Catbox takes no retention argument')
  assert.strictEqual(outputs.url, 'https://files.catbox.moe/zzz999.svg')
  assert.strictEqual(outputs.expires, '', 'an empty expiry is what suppresses the comment caption')
})

// The distinction the whole feature rests on: the hash is optional, and an empty one must
// behave exactly like an absent one rather than uploading `userhash=` to the wrong endpoint.
test('an empty userhash is the same as no userhash', async () => {
  const { upload, outputs } = await run({ env: { CATBOX_USERHASH: '' } })
  assert.match(upload, /litterbox\.catbox\.moe/)
  assert.strictEqual(outputs.expires, '72h')
})

test('the userhash never appears in the log, on success or on failure', async () => {
  const hash = 'sup3rs3cr3tuserhash00'

  const ok = await run({ env: { CATBOX_USERHASH: hash }, uploadReply: 'https://files.catbox.moe/a.svg' })
  assert.ok(!ok.stdout.includes(hash), 'the success notice leaks the credential')

  const refused = await run({ env: { CATBOX_USERHASH: hash }, uploadReply: 'Invalid userhash' })
  assert.ok(!refused.stdout.includes(hash), 'the failure warning leaks the credential')
  assert.match(refused.stdout, /Check the catbox-userhash input/, 'a refused hash should say so')
})

test('a reply that is not a URL on the expected host degrades instead of being published', async () => {
  const { stdout, outputs } = await run({ uploadReply: '<html>503 Service Unavailable</html>' })
  assert.match(stdout, /^::warning::Unexpected response from Litterbox/m)
  assert.strictEqual(outputs.url, '')
  assert.strictEqual(outputs.expires, '')
})

// Camo serves image/* and refuses everything else, so a host that labels a .svg upload
// application/octet-stream would give every comment a broken image rather than no image.
test('a non-image Content-Type degrades to a comment with no image', async () => {
  const { stdout, outputs } = await run({ contentType: 'text/plain' })
  assert.match(stdout, /rather than an image type/)
  assert.match(stdout, /camo proxy would refuse it/)
  assert.strictEqual(outputs.url, '')
})

test('the Content-Type is read back from the URL that was actually returned', async () => {
  const { calls } = await run({ uploadReply: 'https://litter.catbox.moe/xyz.svg' })
  assert.strictEqual(calls.length, 2, 'upload, then HEAD')
  assert.match(calls[1], /--head/)
  assert.match(calls[1], /https:\/\/litter\.catbox\.moe\/xyz\.svg/)
})

test('a failed upload warns and yields an empty url, without failing the job', async () => {
  const { stdout, outputs } = await run({ uploadExit: 22, uploadReply: 'curl: (22) error 503' })
  assert.match(stdout, /^::warning::Grid map upload failed/m)
  assert.strictEqual(outputs.url, '')
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
    assert.strictEqual(fs.readFileSync(outputFile, 'utf8'), 'url=\nexpires=\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the published URL carries the public disclosure notice on every run', async () => {
  const { stdout } = await run()
  assert.match(stdout, /^::notice::Grid map published at /m)
  assert.match(stdout, /world-readable/)
  assert.match(stdout, /It expires 72h after this run\./)

  const permanent = await run({
    env: { CATBOX_USERHASH: 'h' },
    uploadReply: 'https://files.catbox.moe/a.svg',
  })
  assert.match(permanent.stdout, /world-readable/, 'a userhash does not make the URL private')
  assert.match(permanent.stdout, /It does not expire\./)
})

test('it refuses to run without an argument rather than uploading nothing', async () => {
  await assert.rejects(() => execFileAsync('bash', [SCRIPT], { encoding: 'utf8' }), /usage/)
})
