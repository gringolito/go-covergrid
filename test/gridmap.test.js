'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const {
  CANVAS_WIDTH,
  BASE_HEIGHT,
  MAX_HEIGHT,
  LEGEND_H,
  MONOSPACE_STACK,
  gridMapHeight,
  commonPathPrefix,
  renderGridMap,
} = require('../src/gridmap/index.js')
const { wellFormed } = require('../src/gridmap/svg.js')
const { parseBreakdown } = require('../src/breakdown.js')

const FIXTURES = path.join(__dirname, 'fixtures')
const fixture = (name) => parseBreakdown(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))

const texts = (svg) => [...svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => ({ attrs: m[1], body: m[2] }))

// ADR-0004: the coordinate space is GitHub's comment content width, so a font-size in this
// source is the size the reader actually sees.
test('the canvas width is GitHub comment width, not an arbitrary larger number', () => {
  assert.strictEqual(CANVAS_WIDTH, 830)
})

test('height starts at 467 and grows with package count', () => {
  assert.strictEqual(BASE_HEIGHT, 467)
  assert.strictEqual(gridMapHeight(1), 467)
  assert.strictEqual(gridMapHeight(24), 467)
  assert.strictEqual(gridMapHeight(25), 473)
  assert.strictEqual(gridMapHeight(120), 1043)
  assert.ok(gridMapHeight(120) > gridMapHeight(60))
})

test('height is capped so a huge repository does not produce an unusable strip', () => {
  assert.strictEqual(gridMapHeight(10000), MAX_HEIGHT)
  assert.ok(MAX_HEIGHT / CANVAS_WIDTH <= 1.6, 'the picture must not become a ribbon')
})

test('commonPathPrefix returns the shared module path, ending at a slash', () => {
  assert.strictEqual(
    commonPathPrefix(['example.com/o/r/internal/a', 'example.com/o/r/internal/b', 'example.com/o/r/cmd']),
    'example.com/o/r/',
  )
})

test('commonPathPrefix is empty when packages share no leading path segment', () => {
  assert.strictEqual(commonPathPrefix(['alpha/a', 'beta/b']), '')
})

test('commonPathPrefix never swallows a whole package name', () => {
  assert.strictEqual(commonPathPrefix(['a/b']), '')
  assert.strictEqual(commonPathPrefix(['a/b', 'a/b/c']), 'a/')
})

test('the grid map has one tile per package, sized by statement count', () => {
  const { tiles } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  assert.strictEqual(tiles.length, 18)

  const biggest = tiles.reduce((a, b) => (a.total > b.total ? a : b))
  const smallest = tiles.reduce((a, b) => (a.total < b.total ? a : b))
  assert.ok(biggest.w * biggest.h > smallest.w * smallest.h)
})

test('the document is well-formed at both fixture sizes', () => {
  for (const name of ['sample-breakdown.txt', 'big-breakdown.txt']) {
    const { svg } = renderGridMap({ stats: fixture(name) })
    assert.deepStrictEqual(wellFormed(svg), { ok: true }, name)
  }
})

test('the viewBox is 830 wide and as tall as the package count demands', () => {
  const { svg } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  assert.match(svg, new RegExp(`viewBox="0 0 830 ${gridMapHeight(18) + LEGEND_H}"`))

  const big = renderGridMap({ stats: fixture('big-breakdown.txt') })
  assert.match(big.svg, new RegExp(`viewBox="0 0 830 ${gridMapHeight(120) + LEGEND_H}"`))
})

test('the reported total matches the breakdown file', () => {
  const { total } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  assert.strictEqual(total.total, 989)
  assert.strictEqual(total.ratio.toFixed(1), '76.8')
})

test('the title states the total, so a screen reader gets the headline number', () => {
  const { svg } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  assert.match(svg, /<title id="[^"]+">Coverage grid map: 76\.8% of 989 statements across 18 packages<\/title>/)
})

test('packages with no statements are left out of the layout', () => {
  const { tiles } = renderGridMap({
    stats: [
      { name: 'a/x.go', total: 10, covered: 5 },
      { name: 'b/y.go', total: 0, covered: 0 },
    ],
  })
  assert.deepStrictEqual(
    tiles.map((t) => t.name),
    ['a'],
  )
})

test('an empty breakdown renders a document rather than throwing', () => {
  const { svg, tiles, total } = renderGridMap({ stats: [] })
  assert.strictEqual(tiles.length, 0)
  assert.strictEqual(total.total, 0)
  assert.deepStrictEqual(wellFormed(svg), { ok: true })
})

// The font resolves on the reader's machine, so its metrics are unknown here. textLength
// pins the rendered width whatever font wins, which is the only way a label cannot spill
// out of its Tile.
test('every text element pins its own width', () => {
  for (const name of ['sample-breakdown.txt', 'big-breakdown.txt']) {
    const { svg } = renderGridMap({ stats: fixture(name) })
    const all = texts(svg)
    assert.ok(all.length > 0, name)
    for (const { attrs, body } of all) {
      assert.match(attrs, /textLength="[0-9.]+"/, `${body} in ${name} has no textLength`)
      assert.match(attrs, /lengthAdjust="spacingAndGlyphs"/, `${body} in ${name} has no lengthAdjust`)
    }
  }
})

test('a monospace stack is declared once, and nothing overrides it', () => {
  const { svg } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  assert.ok(MONOSPACE_STACK.includes('ui-monospace'))
  assert.ok(MONOSPACE_STACK.endsWith('monospace'))
  assert.strictEqual(svg.split('font-family=').length - 1, 1, 'font-family belongs on one group')
})

test('no text is wider than the tile it sits in', () => {
  const { svg, tiles } = renderGridMap({ stats: fixture('big-breakdown.txt') })
  const widest = Math.max(...tiles.map((t) => t.w))
  for (const { attrs } of texts(svg)) {
    const length = Number(/textLength="([0-9.]+)"/.exec(attrs)[1])
    assert.ok(length <= widest, `a text run of ${length} exceeds the widest tile ${widest}`)
  }
})

test('a package path is clipped to its own tile, so nothing can bleed into a neighbour', () => {
  const { svg, tiles } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  const clips = [...svg.matchAll(/<clipPath id="([^"]+)">/g)].map((m) => m[1])
  assert.ok(clips.length > 0)
  assert.strictEqual(new Set(clips).size, clips.length, 'clip path ids must be unique')
  for (const id of clips) assert.ok(svg.includes(`clip-path="url(#${id})"`), `${id} is declared but unused`)
  assert.ok(clips.length <= tiles.length)
})

// Every one of these would either be stripped by GitHub, refuse to load inside an <img>,
// or leak a request to a third party.
test('the document has no style, no script and no external references', () => {
  const { svg } = renderGridMap({ stats: fixture('big-breakdown.txt') })
  assert.ok(!/<style/i.test(svg))
  assert.ok(!/<script/i.test(svg))
  assert.ok(!/\bon[a-z]+=/i.test(svg))
  assert.ok(!/xlink:href/i.test(svg))
  assert.ok(!/<image\b/i.test(svg))

  const urls = [...svg.matchAll(/https?:\/\/[^"' )]+/g)].map((m) => m[0])
  assert.deepStrictEqual([...new Set(urls)], ['http://www.w3.org/2000/svg'])
})

test('a package name containing markup is escaped in the output', () => {
  const { svg } = renderGridMap({ stats: [{ name: 'a<b>&c/x.go', total: 100, covered: 50 }] })
  assert.ok(!svg.includes('<b>'))
  assert.ok(svg.includes('a&lt;b&gt;&amp;c'))
  assert.deepStrictEqual(wellFormed(svg), { ok: true })
})

// ADR-0004 keeps this: a Tile too small to label is a bare colour chip, not an aggregate.
test('the smallest tiles are colour chips and the biggest carry a percentage', () => {
  const { svg, tiles } = renderGridMap({ stats: fixture('big-breakdown.txt') })
  const labelled = texts(svg).length
  assert.ok(labelled < tiles.length * 3, 'not every tile can carry all three labels')
  assert.ok(labelled > tiles.length, 'most tiles should carry at least a percentage')
})

// ADR-0004 quotes these counts as its evidence that the layout labels what matters. They
// move whenever the canvas width, a font size or a padding does, so they are asserted here:
// the ADR's figures are only trustworthy while something checks them.
test('the sample fixture labels the number of packages ADR-0004 claims', () => {
  const stats = fixture('sample-breakdown.txt')
  const { svg, tiles } = renderGridMap({ stats })
  const prefix = commonPathPrefix(tiles.map((t) => t.name))
  const drawn = new Set(texts(svg).map((t) => t.body))

  let fullPath = 0
  let lastSegment = 0
  let unnamed = 0
  for (const tile of tiles) {
    const short = tile.name.startsWith(prefix) ? tile.name.slice(prefix.length) : tile.name
    if (drawn.has(short)) fullPath++
    else if (drawn.has(short.slice(short.lastIndexOf('/') + 1))) lastSegment++
    else unnamed++
  }

  assert.deepStrictEqual({ fullPath, lastSegment, unnamed }, { fullPath: 13, lastSegment: 4, unnamed: 1 })

  const percentages = texts(svg).filter((t) => /^\d+\.\d%$/.test(t.body)).length
  assert.strictEqual(percentages, tiles.length, 'every tile carries its coverage ratio')
})

test('the 120-package fixture gets a percentage onto the count ADR-0004 claims', () => {
  const { svg, tiles } = renderGridMap({ stats: fixture('big-breakdown.txt') })
  assert.strictEqual(tiles.length, 120)
  const percentages = texts(svg).filter((t) => /^\d+\.\d%$/.test(t.body)).length
  assert.strictEqual(percentages, 112, 'the other 8 are chips too small for a number')
})

/** Text runs grouped per Tile, as vertical extents reconstructed from the output. */
function tileTextBoxes(svg) {
  return [...svg.matchAll(/<g clip-path="url\(#t\d+\)">(.*?)<\/g>/g)].map((group) =>
    [...group[1].matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].map((m) => {
      const size = Number(/font-size="([0-9.]+)"/.exec(m[1])[1])
      const baseline = Number(/\by="([0-9.]+)"/.exec(m[1])[1])
      return { body: m[2], top: baseline - size * 0.8, bottom: baseline + size * 0.2 }
    }),
  )
}

// The failure this catches is a Tile just tall enough for a statement count centring its
// percentage over the whole remaining height, so the two run into each other. Invisible in
// every other assertion here, and obvious the moment the SVG is rasterised.
test('no two text runs in the same tile overlap vertically', () => {
  for (const name of ['sample-breakdown.txt', 'big-breakdown.txt']) {
    const { svg } = renderGridMap({ stats: fixture(name) })
    const groups = tileTextBoxes(svg)
    assert.ok(groups.length > 0, name)

    for (const runs of groups) {
      const sorted = [...runs].sort((a, b) => a.top - b.top)
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(
          sorted[i].top >= sorted[i - 1].bottom,
          `in ${name}, "${sorted[i - 1].body}" (to ${sorted[i - 1].bottom.toFixed(1)}) ` +
            `overlaps "${sorted[i].body}" (from ${sorted[i].top.toFixed(1)})`,
        )
      }
    }
  }
})

test('every text run stays inside its own tile', () => {
  const { svg } = renderGridMap({ stats: fixture('big-breakdown.txt') })
  const clips = [...svg.matchAll(/<clipPath id="t\d+"><rect [^>]*\by="([0-9.]+)"[^>]*\bheight="([0-9.]+)"[^>]*\/><\/clipPath>/g)]
  const boxes = tileTextBoxes(svg)
  assert.strictEqual(clips.length, boxes.length)

  clips.forEach((clip, i) => {
    const top = Number(clip[1])
    const bottom = top + Number(clip[2])
    for (const run of boxes[i]) {
      assert.ok(run.top >= top - 0.5, `"${run.body}" starts above its tile`)
      assert.ok(run.bottom <= bottom + 0.5, `"${run.body}" ends below its tile`)
    }
  })
})

test('the legend names all five bands and the total', () => {
  const { svg } = renderGridMap({ stats: fixture('sample-breakdown.txt') })
  const bodies = texts(svg).map((t) => t.body)
  for (const label of ['&lt;50%', '50-70%', '70-85%', '85-95%', '95%+']) {
    assert.ok(bodies.includes(label), `legend is missing ${label}`)
  }
  assert.ok(bodies.some((b) => b === 'total 76.8% of 989 stmt'))
})
