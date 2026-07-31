'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { BANDS, CUTS, bandOf } = require('../src/gridmap/bands.js')

test('the boundaries are the conventional 50 / 70 / 85 / 95', () => {
  assert.deepStrictEqual(CUTS, [50, 70, 85, 95])
})

// Hex, not an RGB triple: these land straight in an SVG `fill` attribute.
test('there are five bands and every one has a colour, an ink and a label', () => {
  assert.strictEqual(BANDS.length, 5)
  for (const b of BANDS) {
    assert.match(b.col, /^#[0-9a-f]{6}$/)
    assert.match(b.ink, /^#[0-9a-f]{6}$/)
    assert.ok(b.label.length > 0)
  }
  assert.deepStrictEqual(
    BANDS.map((b) => b.label),
    ['<50%', '50-70%', '70-85%', '85-95%', '95%+'],
  )
})

test('a ratio lands in the band whose upper boundary it is below', () => {
  assert.strictEqual(bandOf(0).label, '<50%')
  assert.strictEqual(bandOf(49.9).label, '<50%')
  assert.strictEqual(bandOf(50).label, '50-70%')
  assert.strictEqual(bandOf(69.9).label, '50-70%')
  assert.strictEqual(bandOf(70).label, '70-85%')
  assert.strictEqual(bandOf(84.9).label, '70-85%')
  assert.strictEqual(bandOf(85).label, '85-95%')
  assert.strictEqual(bandOf(94.9).label, '85-95%')
  assert.strictEqual(bandOf(95).label, '95%+')
  assert.strictEqual(bandOf(100).label, '95%+')
})
