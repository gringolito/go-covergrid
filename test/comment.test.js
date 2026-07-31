'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { MARKER, renderComment, renderUnavailableComment, bar } = require('../src/comment.js')

const base = [
  { name: 'internal/rest/a.go', total: 100, covered: 80 },
  { name: 'internal/storage/b.go', total: 100, covered: 50 },
]
const current = [
  { name: 'internal/rest/a.go', total: 100, covered: 90 },
  { name: 'internal/storage/b.go', total: 100, covered: 50 },
  { name: 'internal/new/c.go', total: 50, covered: 10 },
]

function render(overrides = {}) {
  return renderComment({
    outcome: 'success',
    diffThreshold: -1,
    hasBaseline: true,
    baseBranch: 'main',
    current,
    base,
    prNumber: 31,
    imageUrl: 'https://litter.catbox.moe/abc123.svg',
    ...overrides,
  })
}

test('every comment carries the marker so it can be found and updated', () => {
  assert.ok(render().startsWith(MARKER))
  assert.ok(renderUnavailableComment().startsWith(MARKER))
})

// A pull request can collect comments from several tools, so the heading has to say which
// one this is rather than just "Coverage Report".
test('the heading names the action that posted the comment', () => {
  for (const body of [render(), renderUnavailableComment()]) {
    assert.match(body, /^## .*go-covergrid/m)
  }
})

test('bar draws ten cells scaled to the nearest tenth', () => {
  assert.strictEqual(bar(0), '░░░░░░░░░░')
  assert.strictEqual(bar(100), '██████████')
  assert.strictEqual(bar(76.8), '████████░░')
})

test('a passing gate reads as passed', () => {
  assert.match(render(), /✅ \*\*Coverage gate passed\*\*/)
})

test('a failing gate points at the inline annotations', () => {
  // diffThreshold well below the actual change, so the drop is not the likely cause.
  const body = render({ outcome: 'failure', diffThreshold: -20 })
  assert.match(body, /❌ \*\*Coverage gate failed\*\*/)
  assert.match(body, /inline annotations/)
})

// The one gate failure with no inline-annotation equivalent, so it is named with numbers.
test('a drop past the diff threshold is named explicitly', () => {
  const body = renderComment({
    outcome: 'failure',
    diffThreshold: -1,
    hasBaseline: true,
    baseBranch: 'main',
    current: [{ name: 'a/x.go', total: 100, covered: 50 }],
    base: [{ name: 'a/x.go', total: 100, covered: 90 }],
    prNumber: 1,
  })
  assert.match(body, /Coverage dropped 40\.00% vs main/)
  assert.match(body, /min allowed: -1\.00%/)
})

test('the total coverage line reports the current total and the delta', () => {
  // current 150/250 = 60%, base 130/200 = 65%
  assert.match(render(), /\*\*Total coverage:\*\* .* 60\.0% \(-5\.00% vs main\)/)
})

test('without a baseline the total has no delta and there is no diff summary', () => {
  const body = render({ hasBaseline: false, base: [] })
  assert.match(body, /\*\*Total coverage:\*\* .* 60\.0%$/m)
  assert.ok(!body.includes('Coverage Diff'))
  assert.ok(!body.includes('vs main'))
})

test('the base branch name is used rather than being hardcoded to main', () => {
  const body = render({ baseBranch: 'develop' })
  assert.match(body, /vs develop/)
  assert.ok(!body.includes('vs main'))
})

test('the diff summary block is fenced as a diff so GitHub colours the rows', () => {
  const body = render()
  const fence = body.split('```')[1]
  assert.ok(fence.startsWith('diff\n'), fence.slice(0, 20))
  assert.match(fence, /Coverage Diff/)
  assert.match(fence, /^- Coverage\s+65\.00%\s+60\.00%\s+-5\.00%/m)
  assert.match(fence, /^ {2}Files\s+2\s+3\s+\+1/m)
  assert.match(fence, /^\+ Hits\s+130\s+150\s+\+20/m)
  assert.match(fence, /^- Misses\s+70\s+100\s+\+30/m)
})

// The go toolchain counts Statements, and CONTEXT.md bans "line" for that reason. Codecov's
// own version of this block says "Lines", which would report the wrong unit here.
test('the diff summary counts statements, not lines', () => {
  const fence = render().split('```')[1]
  assert.match(fence, /^ {2}Stmts\s+200\s+250\s+\+50/m)
  assert.ok(!/lines/i.test(fence))
})

test('the grid map image is embedded when a published URL is available', () => {
  assert.match(render(), /!\[Coverage Grid Map\]\(https:\/\/litter\.catbox\.moe\/abc123\.svg\)/)
})

// The default host deletes the file after 72 hours, so an old comment shows a broken image.
// The caption is what stops that reading as a bug in this action.
test('an expiring image is captioned with how long it lasts', () => {
  const body = render({ imageExpiresIn: '72h' })
  assert.match(body, /expires 72h after the run/)
  assert.ok(body.indexOf('![Coverage Grid Map]') < body.indexOf('expires 72h'), 'caption follows the image')
})

test('no caption is added when the host does not expire the image', () => {
  const body = render({ imageExpiresIn: null })
  assert.match(body, /!\[Coverage Grid Map\]/)
  assert.ok(!body.includes('expires'))
})

test('with no published URL the comment says where the grid map went', () => {
  const body = render({ imageUrl: null })
  assert.ok(!body.includes('!['))
  assert.match(body, /grid map/i)
  assert.match(body, /publish-image/)
})

test('impacted packages are listed, with new ones flagged', () => {
  const body = render()
  const packages = body.slice(body.indexOf('### Impacted packages'))
  assert.match(packages, /🟢 \| `internal\/rest` \| .* 90\.0% \| \+10\.0% \|/)
  assert.match(packages, /🆕 \| `internal\/new` \| .* 20\.0% \| new \|/)
  assert.ok(!packages.includes('internal/storage'), 'an unchanged package is not impacted')
})

test('impacted files go in a collapsed section', () => {
  const body = render()
  assert.match(body, /<details>\n<summary>Impacted files<\/summary>/)
  assert.match(body, /`internal\/rest\/a\.go`/)
})

test('a run with nothing changed says so instead of showing empty tables', () => {
  const body = render({ current: base, base })
  assert.match(body, /_No coverage changes in this pull request\._/)
  assert.ok(!body.includes('Impacted packages'))
})

test('the fallback comment explains that coverage data could not be read', () => {
  const body = renderUnavailableComment('coverage-breakdown.txt')
  assert.match(body, /could not be read/i)
  assert.match(body, /coverage-breakdown\.txt/)
})
