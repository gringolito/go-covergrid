'use strict'

// Guards the composite-action constraints that only bite at run time on a real runner:
// a missing `shell:`, a step id that no longer exists, a path that ships nowhere, a
// `post:` hook composite actions do not have. No YAML parser is available (zero runtime
// dependencies, ADR-0003), so this scans the structure by indentation. Crude, and enough.

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

// Slices one input's block, ending at the next key at the same indent, so a longer
// description cannot silently push the `default:` out of a fixed-size window.
function inputBlock(name) {
  const start = TEXT.indexOf(`  ${name}:`)
  assert.notStrictEqual(start, -1, `no input named ${name}`)
  const rest = TEXT.slice(start + `  ${name}:`.length)
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:$/m)
  return next === -1 ? rest : rest.slice(0, next)
}

test('publishing the grid map is on by default, with an opt-out', () => {
  assert.match(inputBlock('publish-image'), /default: 'true'/)
})

// The empty default is load bearing, not tidy: it is what makes Litterbox the behaviour for
// anyone who configures nothing, which is the premise ADR-0002 rests on.
test('the catbox userhash is optional and defaults to nothing', () => {
  const block = inputBlock('catbox-userhash')
  assert.match(block, /required: false/)
  assert.match(block, /default: ''/)
})

test('the userhash reaches the publish script through the environment, not the command line', () => {
  const publish = steps().find((b) => b.includes('id: publish'))
  assert.ok(publish, 'no step with id: publish')
  assert.match(publish.join('\n'), /CATBOX_USERHASH: \$\{\{ inputs\.catbox-userhash \}\}/)

  const runLine = publish.find((line) => line.startsWith('run:'))
  assert.ok(runLine, 'the publish step runs nothing')
  assert.ok(!runLine.includes('catbox-userhash'), 'an argument would be echoed in the job log')
})

// A push to the base branch runs the gate and the renderer, and has no comment to put the
// picture in. Publishing there would disclose the package tree for nobody to read (ADR-0002),
// and posting is pointless, so both are gated on the run carrying a pull request. The set of
// events has to stay the one src/pr-context.js recognises.
test('the run decides once whether it has a pull request', () => {
  const prepare = steps().find((b) => b.includes('id: prepare'))
  assert.ok(prepare, 'no step with id: prepare')

  const text = prepare.join('\n')
  assert.match(text, /github\.event_name == 'pull_request'/)
  assert.match(text, /github\.event_name == 'pull_request_target'/)
  assert.match(text, /github\.event\.issue\.pull_request/, 'issue_comment fires for pull requests too')
  assert.match(text, /echo "is-pull-request=/, 'the answer has to reach later steps as an output')
})

test('publishing and commenting both wait on that answer', () => {
  const gated = steps().filter((b) =>
    b.some((l) => l.startsWith('if:') && l.includes("steps.prepare.outputs.is-pull-request == 'true'")),
  )
  const names = gated.map((b) => b[0].replace('name: ', ''))
  for (const name of ['Publish the Grid Map', 'Post the pull request comment']) {
    assert.ok(names.includes(name), `"${name}" runs on a push, where there is no pull request`)
  }

  const publish = gated.find((b) => b.includes('id: publish'))
  assert.match(publish.join('\n'), /inputs\.publish-image == 'true'/, 'the opt-out still has to work')
})

test('the gate step tolerates failure so the comment is still posted', () => {
  const gate = steps().find((b) => b.includes('id: gate'))
  assert.ok(gate, 'no step with id: gate')
  assert.ok(gate.includes('continue-on-error: true'), 'the gate must not abort the remaining steps')
})
