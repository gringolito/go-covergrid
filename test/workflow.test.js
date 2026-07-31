'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  setOutput,
  notice,
  warning,
  error,
  escapeAnnotation,
  workflowFileFromRef,
} = require('../src/workflow.js')

test('the workflow file is derived from GITHUB_WORKFLOW_REF', () => {
  assert.strictEqual(
    workflowFileFromRef('acme/parcel/.github/workflows/ci.yml@refs/heads/main'),
    'ci.yml',
  )
  assert.strictEqual(
    workflowFileFromRef('acme/parcel/.github/workflows/coverage.yaml@refs/heads/main'),
    'coverage.yaml',
  )
})

// Branch names may contain '@', so the split has to take the first one. Getting this
// backwards yields a file name with half a ref glued to it, and the runs API then quietly
// matches nothing — which looks exactly like "no baseline yet".
test('a branch name containing @ does not corrupt the file name', () => {
  assert.strictEqual(
    workflowFileFromRef('acme/parcel/.github/workflows/ci.yml@refs/heads/feat/user@host'),
    'ci.yml',
  )
})

test('an absent or unrecognisable ref yields no file name rather than a guess', () => {
  assert.strictEqual(workflowFileFromRef(undefined), '')
  assert.strictEqual(workflowFileFromRef(''), '')
  assert.strictEqual(workflowFileFromRef('acme/parcel/.github/workflows/ci@refs/heads/main'), '')
  assert.strictEqual(workflowFileFromRef('nonsense'), '')
})

function withOutputFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gridmap-out-'))
  const file = path.join(dir, 'github_output')
  fs.writeFileSync(file, '')
  const saved = process.env.GITHUB_OUTPUT
  process.env.GITHUB_OUTPUT = file
  try {
    fn(file)
  } finally {
    if (saved === undefined) delete process.env.GITHUB_OUTPUT
    else process.env.GITHUB_OUTPUT = saved
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('setOutput appends a name=value line for a simple value', () => {
  withOutputFile((file) => {
    setOutput('total-coverage', '76.8')
    setOutput('package-count', 18)
    assert.strictEqual(fs.readFileSync(file, 'utf8'), 'total-coverage=76.8\npackage-count=18\n')
  })
})

// GITHUB_OUTPUT is line-oriented, so anything containing a newline needs the heredoc form
// or it corrupts the file for every later step.
test('setOutput uses the heredoc form for a multiline value', () => {
  withOutputFile((file) => {
    setOutput('body', 'one\ntwo')
    const written = fs.readFileSync(file, 'utf8')
    const [open, ...rest] = written.split('\n')
    const match = /^body<<(ghadelim_[0-9a-f]{32})$/.exec(open)
    assert.ok(match, `unexpected opening line: ${open}`)
    assert.deepStrictEqual(rest, ['one', 'two', match[1], ''])
  })
})

test('setOutput refuses a value that contains its own delimiter', () => {
  withOutputFile(() => {
    assert.throws(() => setOutput('body', 'x\nghadelim_'), /delimiter/i)
  })
})

test('setOutput is a no-op when GITHUB_OUTPUT is unset', () => {
  const saved = process.env.GITHUB_OUTPUT
  delete process.env.GITHUB_OUTPUT
  try {
    assert.doesNotThrow(() => setOutput('a', 'b'))
  } finally {
    if (saved !== undefined) process.env.GITHUB_OUTPUT = saved
  }
})

test('annotation messages have percent, carriage return and newline escaped', () => {
  assert.strictEqual(escapeAnnotation('100% done\r\nnext'), '100%25 done%0D%0Anext')
})

test('the annotation writers emit the workflow command on stdout', () => {
  const lines = []
  const saved = process.stdout.write
  process.stdout.write = (chunk) => {
    lines.push(String(chunk))
    return true
  }
  try {
    notice('published')
    warning('odd glyph')
    error('gate failed')
  } finally {
    process.stdout.write = saved
  }
  assert.deepStrictEqual(lines, ['::notice::published\n', '::warning::odd glyph\n', '::error::gate failed\n'])
})
