'use strict'

// The real upload needs a personal token and reaches GitHub, so `curl` is replaced with a shim
// on PATH that records what it was handed (arguments and stdin) and answers with whatever the
// test wants. Whether GitHub itself still behaves as measured is for CI to say (ADR-0006).

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const SCRIPT = path.join(__dirname, '..', 'scripts', 'publish-image.sh')

const ASSET = 'https://github.com/user-attachments/assets/a32058e0-f03b-4027-9dda-f0f718cc9393'
const TOKEN = 'ghp_sup3rs3cr3tt0k3n'

// Single quotes so embedded newlines reach the shim as newlines rather than as the
// two characters a JSON escape would produce.
function shellQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Runs the script against a fake curl.
 *
 * @param {object} opts
 * @param {string} [opts.reply] the response body the upload call writes to its --output file
 * @param {string} [opts.status] the HTTP status the upload call reports through --write-out
 * @param {string} [opts.stderr] what the upload call writes to stderr; `--retry` narrates
 *   every attempt it makes there, so a call that succeeds on its second try still says plenty
 * @param {number} [opts.exit] non-zero to simulate a call that never got an answer
 * @param {Record<string,string>} [opts.env] environment overriding the defaults below
 */
async function run({ reply = `{"url":"${ASSET}"}`, status = '201', stderr = '', exit = 0, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridmap-pub-'))
  const svg = path.join(dir, 'grid-map.svg')
  const outputFile = path.join(dir, 'github_output')
  const argLog = path.join(dir, 'curl-args')
  const stdinLog = path.join(dir, 'curl-stdin')
  fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
  fs.writeFileSync(outputFile, '')

  fs.writeFileSync(
    path.join(dir, 'curl'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >>"${argLog}"`,
      `cat >>"${stdinLog}"`,
      'out=""',
      'while [[ $# -gt 0 ]]; do',
      '  if [[ "$1" == --output ]]; then out="$2"; fi',
      '  shift',
      'done',
      `printf '%s' ${shellQuote(stderr)} >&2`,
      `[[ -n "$out" ]] && printf '%s' ${shellQuote(reply)} >"$out"`,
      `printf '%s' ${shellQuote(status)}`,
      `exit ${exit}`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  )

  try {
    const { stdout } = await execFileAsync('bash', [SCRIPT, svg], {
      env: {
        ...process.env,
        PATH: `${dir}${path.delimiter}${process.env.PATH}`,
        GITHUB_OUTPUT: outputFile,
        ATTACHMENT_TOKEN: TOKEN,
        REPOSITORY_ID: '1318677471',
        ...env,
      },
      encoding: 'utf8',
    })
    const outputs = Object.fromEntries(
      fs
        .readFileSync(outputFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)]),
    )
    const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
    return { stdout, outputs, args: read(argLog), stdin: read(stdinLog) }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('the script is executable shell', () => {
  const first = fs.readFileSync(SCRIPT, 'utf8').split('\n')[0]
  assert.strictEqual(first, '#!/usr/bin/env bash')
})

test('it uploads the SVG against the repository and publishes the asset URL', async () => {
  const { args, stdout, outputs } = await run()

  assert.match(args, /https:\/\/uploads\.github\.com\/user-attachments\/assets\?/)
  assert.match(args, /repository_id=1318677471/)
  assert.match(args, /content_type=image%2Fsvg%2Bxml/, 'an SVG labelled anything else renders as a broken image')
  assert.match(args, /--data-binary @.*grid-map\.svg/)
  assert.strictEqual(outputs.url, ASSET)
  assert.match(stdout, /^::notice::Grid map uploaded to https:\/\/github\.com\/user-attachments\/assets\//m)
  assert.ok(!stdout.includes('::warning::'))
})

// Composite `run:` lines are echoed to the job log and argv is visible to every process on the
// runner, so the token travels on stdin and is never printed.
test('the token is sent on stdin, never as an argument or in the log', async () => {
  const ok = await run()
  assert.match(ok.stdin, new RegExp(`^Authorization: Bearer ${TOKEN}$`, 'm'))
  assert.ok(!ok.args.includes(TOKEN), 'the token is on the command line')
  assert.ok(!ok.stdout.includes(TOKEN), 'the success notice leaks the token')

  const refused = await run({ status: '401', reply: '{"message":"Bad credentials"}' })
  assert.ok(!refused.stdout.includes(TOKEN), 'the failure warning leaks the token')
})

test('without a token it uploads nothing and says which input is missing', async () => {
  const { args, stdout, outputs } = await run({ env: { ATTACHMENT_TOKEN: '' } })
  assert.strictEqual(args, '', 'nothing may be sent without a token')
  assert.match(stdout, /^::warning::No attachment-token is set/m)
  assert.strictEqual(outputs.url, '')
})

test('without a repository id it uploads nothing', async () => {
  const { args, outputs } = await run({ env: { REPOSITORY_ID: '' } })
  assert.strictEqual(args, '')
  assert.strictEqual(outputs.url, '')
})

// GITHUB_TOKEN is the token people will try first, and the endpoint answers it with a bare
// 404 — the same answer a read-only personal token gets. The warning has to name the cause.
test('a 404 explains that the token needs a person with write access', async () => {
  const { stdout, outputs } = await run({ status: '404', reply: '{"message":"Not Found"}' })
  assert.match(stdout, /^::warning::GitHub refused the upload \(HTTP 404\)/m)
  assert.match(stdout, /write access/)
  assert.match(stdout, /GITHUB_TOKEN and GitHub App tokens are always refused/)
  assert.strictEqual(outputs.url, '')
})

test('a 401 says the token itself is bad', async () => {
  const { stdout, outputs } = await run({ status: '401', reply: '{"message":"Bad credentials"}' })
  assert.match(stdout, /^::warning::GitHub rejected attachment-token \(HTTP 401\)/m)
  assert.strictEqual(outputs.url, '')
})

test('any other refusal passes on what GitHub said, on one line', async () => {
  const { stdout, outputs } = await run({ status: '422', reply: '{\n  "message": "Validation Failed"\n}' })
  assert.match(stdout, /^::warning::GitHub refused the upload \(HTTP 422\): \{ "message": "Validation Failed" \}\./m)
  assert.strictEqual(outputs.url, '')
})

test('a 201 without an asset URL degrades instead of publishing garbage', async () => {
  const { stdout, outputs } = await run({ reply: '{"url":"https://evil.example/x.svg"}' })
  assert.match(stdout, /^::warning::Unexpected reply from the upload endpoint/m)
  assert.strictEqual(outputs.url, '')
})

// A retried call narrates the attempt it gave up on to stderr before the one that worked
// answers. That noise must not turn a good upload into a failure.
test('a retry that eventually succeeds is published', async () => {
  const { stdout, outputs } = await run({
    stderr: 'Warning: Problem (server 502). Will retry in 2 seconds. 3 retries left.\n',
  })
  assert.strictEqual(outputs.url, ASSET)
  assert.ok(!stdout.includes('::warning::'))
})

test('a call that never got an answer reports what curl said, on one line', async () => {
  const { stdout, outputs } = await run({
    exit: 28,
    status: '000',
    stderr: 'Warning: Problem (timeout).\ncurl: (28) Operation timed out after 120000 milliseconds\n',
  })
  assert.match(stdout, /^::warning::Grid map upload failed: Warning: Problem \(timeout\)\. curl: \(28\)/m)
  assert.strictEqual(outputs.url, '')
})

test('a missing grid map warns and yields an empty url, without failing the job', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridmap-pub-'))
  const outputFile = path.join(dir, 'github_output')
  fs.writeFileSync(outputFile, '')

  try {
    const { stdout } = await execFileAsync('bash', [SCRIPT, path.join(dir, 'absent.svg')], {
      env: { ...process.env, GITHUB_OUTPUT: outputFile, ATTACHMENT_TOKEN: TOKEN, REPOSITORY_ID: '1' },
      encoding: 'utf8',
    })
    assert.match(stdout, /^::warning::No grid map at .*absent\.svg; nothing to publish\./m)
    assert.strictEqual(fs.readFileSync(outputFile, 'utf8'), 'url=\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('it refuses to run without an argument rather than uploading nothing', async () => {
  await assert.rejects(() => execFileAsync('bash', [SCRIPT], { encoding: 'utf8' }), /usage/)
})
