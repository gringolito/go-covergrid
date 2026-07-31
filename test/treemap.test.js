'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const { squarify } = require('../src/gridmap/treemap.js')
const { CANVAS_WIDTH, gridMapHeight } = require('../src/gridmap/index.js')
const { parseBreakdown, aggregateByPackage } = require('../src/breakdown.js')

const FIXTURES = path.join(__dirname, 'fixtures')

function fixturePackages(name) {
  const stats = parseBreakdown(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))
  return aggregateByPackage(stats).sort((a, b) => b.total - a.total)
}

const area = (t) => t.w * t.h
const aspect = (t) => Math.max(t.w / t.h, t.h / t.w)

test('no items lays out nothing', () => {
  assert.deepStrictEqual(squarify([], 0, 0, 100, 100), [])
})

test('a single item fills the whole rectangle', () => {
  const out = squarify([{ name: 'p', total: 5 }], 0, 0, 120, 60)
  assert.strictEqual(out.length, 1)
  assert.deepStrictEqual(
    { x: out[0].x, y: out[0].y, w: out[0].w, h: out[0].h },
    { x: 0, y: 0, w: 120, h: 60 },
  )
  assert.strictEqual(out[0].name, 'p')
})

test('two equal items split the long axis in half', () => {
  const out = squarify([{ total: 1 }, { total: 1 }], 0, 0, 200, 100)
  assert.strictEqual(out.length, 2)
  for (const t of out) assert.strictEqual(area(t), 100 * 100)
  assert.deepStrictEqual(
    out.map((t) => t.x),
    [0, 100],
  )
})

test('tiles tile the rectangle exactly: areas sum to it and none overlap', () => {
  const items = [{ total: 40 }, { total: 30 }, { total: 20 }, { total: 7 }, { total: 3 }]
  const out = squarify(items, 0, 0, 300, 200)

  const totalArea = out.reduce((s, t) => s + area(t), 0)
  assert.ok(Math.abs(totalArea - 300 * 200) < 1e-6, `total area ${totalArea}`)

  for (const t of out) {
    assert.ok(t.x >= -1e-9 && t.y >= -1e-9)
    assert.ok(t.x + t.w <= 300 + 1e-9 && t.y + t.h <= 200 + 1e-9)
  }
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]
      const b = out[j]
      const overlap =
        Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
        Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
      assert.ok(overlap < 1e-6, `tiles ${i} and ${j} overlap by ${overlap}`)
    }
  }
})

test('each tile area is proportional to its statement count', () => {
  const items = [{ total: 60 }, { total: 30 }, { total: 10 }]
  const out = squarify(items, 0, 0, 400, 250)
  const canvasArea = 400 * 250
  for (const t of out) {
    const expected = (t.total / 100) * canvasArea
    assert.ok(Math.abs(area(t) - expected) / expected < 1e-6, `${t.total}: ${area(t)} vs ${expected}`)
  }
})

test('offsets are honoured so the layout can be inset', () => {
  const out = squarify([{ total: 1 }, { total: 1 }], 30, 40, 200, 100)
  assert.deepStrictEqual(
    out.map((t) => [t.x, t.y]),
    [
      [30, 40],
      [130, 40],
    ],
  )
})

// ADR-0004 quotes these aspect-ratio ranges as its case for squarified over slice-and-dice.
// Dimensions come from the renderer's own constants: a hardcoded copy would keep passing
// after the canvas changed, while the ADR it guards went stale.
test('the 18 sample packages produce no slivers', () => {
  const out = squarify(fixturePackages('sample-breakdown.txt'), 0, 0, CANVAS_WIDTH, gridMapHeight(18))
  assert.strictEqual(out.length, 18)
  const ratios = out.map(aspect)
  assert.ok(Math.min(...ratios) >= 1, 'an aspect ratio below 1 means the max() is inverted')
  const worst = Math.max(...ratios)
  assert.ok(worst < 1.9, `worst aspect ratio ${worst.toFixed(2)}, ADR-0004 claims under 1.82`)
})

test('120 packages still produce usable aspect ratios', () => {
  const out = squarify(fixturePackages('big-breakdown.txt'), 0, 0, CANVAS_WIDTH, gridMapHeight(120))
  assert.strictEqual(out.length, 120)
  const worst = Math.max(...out.map(aspect))
  assert.ok(worst < 3, `worst aspect ratio ${worst.toFixed(2)}`)
})
