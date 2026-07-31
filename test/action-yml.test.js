'use strict'

// Guards the composite-action constraints that only bite at run time on a real runner:
// a missing `shell:`, a step id that no longer exists, a path that ships nowhere, a
// `post:` hook composite actions do not have. No YAML parser is available (zero runtime
// dependencies, ADR-0003), so this scans the file's structure by indentation — crude, but
// it catches every mistake that has actually cost a release.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const TEXT = fs.readFileSync(path.join(ROOT, 'action.yml'), 'utf8')
const LINES = TEXT.split('\n')

/** Splits `runs.steps` into blocks, each block being the lines of one step. */
function steps() {
  const start = LINES.findIndex((l) => l === '  steps:')
  assert.ok(start > 0, 'runs.steps not found')

  const blocks = []
  for (const line of LINES.slice(start + 1)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (/^ {4}- /.test(line)) blocks.push([line.replace(/^ {4}- /, '')])
    else if (blocks.length > 0) blocks[blocks.length - 1].push(line.replace(/^ {6}/, ''))
  }
  return blocks
}

const keysOf = (block) =>
  block.filter((l) => /^[a-z][a-z0-9-]*:/.test(l)).map((l) => l.slice(0, l.indexOf(':')))

test('it declares itself a composite action', () => {
  assert.match(TEXT, /^ {2}using: composite$/m)
})

// Composite actions have no cleanup hook, so nothing may rely on teardown (ADR-0003).
test('there is no post hook, because composite actions do not have one', () => {
  assert.ok(!/^ {2}post:/m.test(TEXT))
  assert.ok(!/^ {2}post-if:/m.test(TEXT))
})

test('every run step declares a shell', () => {
  for (const block of steps()) {
    const keys = keysOf(block)
    if (!keys.includes('run')) continue
    assert.ok(keys.includes('shell'), `step "${block[0]}" runs a command with no shell:`)
  }
})

test('no step both uses an action and runs a command', () => {
  for (const block of steps()) {
    const keys = keysOf(block)
    assert.ok(!(keys.includes('run') && keys.includes('uses')), `step "${block[0]}" has both run and uses`)
  }
})

test('every referenced step id is declared by some step', () => {
  const declared = new Set()
  for (const block of steps()) {
    const id = block.find((l) => l.startsWith('id: '))
    if (id) declared.add(id.slice(4).trim())
  }

  const referenced = [...TEXT.matchAll(/steps\.([A-Za-z0-9_-]+)\./g)].map((m) => m[1])
  assert.ok(referenced.length > 0)
  for (const id of new Set(referenced)) {
    assert.ok(declared.has(id), `steps.${id} is referenced but no step declares that id`)
  }
})

test('every referenced input is declared', () => {
  const declared = new Set(
    [...TEXT.slice(0, TEXT.indexOf('outputs:')).matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]),
  )
  const referenced = new Set([...TEXT.matchAll(/inputs\.([a-z0-9-]+)/g)].map((m) => m[1]))
  assert.ok(referenced.size > 0)
  for (const name of referenced) {
    assert.ok(declared.has(name), `inputs.${name} is referenced but not declared`)
  }
})

// The working directory belongs to the consumer's checkout, so shipped files are only
// reachable through $GITHUB_ACTION_PATH (ADR-0003).
test('every shipped file reached through GITHUB_ACTION_PATH exists', () => {
  const referenced = [...TEXT.matchAll(/\$\{?GITHUB_ACTION_PATH\}?\/([A-Za-z0-9_./-]+)/g)].map((m) => m[1])
  assert.ok(referenced.length >= 3, 'expected the action to invoke shipped scripts')
  for (const rel of new Set(referenced)) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} is invoked but not shipped`)
  }
})

test('no node script is invoked by a relative path', () => {
  for (const block of steps()) {
    for (const line of block) {
      if (!/^\s*(run:|node )/.test(line) && !line.includes('node ')) continue
      assert.ok(
        !/node ["']?(?:\.\/|src\/)/.test(line),
        `"${line.trim()}" reaches a shipped file without $GITHUB_ACTION_PATH`,
      )
    }
  }
})

// Third-party actions must be pinned to a full commit SHA, not a moving tag.
test('every third-party action is pinned to a 40-character SHA', () => {
  const uses = [...TEXT.matchAll(/^\s*uses: (\S+)/gm)].map((m) => m[1])
  assert.ok(uses.length >= 3)
  for (const ref of uses) {
    assert.match(ref, /@[0-9a-f]{40}$/, `${ref} is not pinned to a commit SHA`)
  }
})

test('every declared output is wired to a step output', () => {
  const outputsBlock = TEXT.slice(TEXT.indexOf('\noutputs:'), TEXT.indexOf('\nruns:'))
  const names = [...outputsBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1])
  const values = [...outputsBlock.matchAll(/^ {4}value: (.+)$/gm)].map((m) => m[1])
  assert.strictEqual(names.length, values.length, 'an output has no value:')
  for (const value of values) assert.match(value, /\$\{\{ steps\./)
})

test('publishing the grid map is on by default, with an opt-out', () => {
  const block = TEXT.slice(TEXT.indexOf('  publish-image:'))
  assert.match(block.slice(0, 600), /default: 'true'/)
})

test('the gate step tolerates failure so the comment is still posted', () => {
  const gate = steps().find((b) => b.includes('id: gate'))
  assert.ok(gate, 'no step with id: gate')
  assert.ok(gate.includes('continue-on-error: true'), 'the gate must not abort the remaining steps')
})
