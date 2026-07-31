'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { escapeText, escapeAttr, tag, document, wellFormed } = require('../src/gridmap/svg.js')

test('text content has the five XML entities escaped', () => {
  assert.strictEqual(escapeText('a & b'), 'a &amp; b')
  assert.strictEqual(escapeText('<script>'), '&lt;script&gt;')
  assert.strictEqual(escapeText(`"'`), '&quot;&#39;')
})

// A Package name comes from a Breakdown File, which comes from a repository's own paths.
// It is not attacker-controlled in any interesting way, but it lands in a document served
// from public hosting, so it gets escaped like anything else.
test('a package name that looks like markup cannot break out of a text node', () => {
  const svg = tag('text', { x: 0 }, escapeText('pkg</text><script>alert(1)</script>'))
  assert.ok(!svg.includes('<script>'))
  assert.ok(svg.includes('&lt;script&gt;'))
})

test('attribute values are escaped', () => {
  assert.strictEqual(escapeAttr('a"b'), 'a&quot;b')
  assert.strictEqual(escapeAttr('a<b'), 'a&lt;b')
})

test('tag renders a self-closing element when it has no children', () => {
  assert.strictEqual(tag('rect', { x: 1, y: 2, fill: '#fff' }), '<rect x="1" y="2" fill="#fff"/>')
})

test('tag renders an open and close pair when it has children', () => {
  assert.strictEqual(tag('g', { opacity: 1 }, 'inner'), '<g opacity="1">inner</g>')
})

test('undefined and null attributes are dropped rather than rendered as "undefined"', () => {
  assert.strictEqual(tag('rect', { x: 0, fill: undefined, stroke: null }), '<rect x="0"/>')
})

test('numeric attributes are trimmed to two decimals so the output is not noise', () => {
  assert.strictEqual(tag('rect', { x: 1 / 3, y: 2, width: 10.5 }), '<rect x="0.33" y="2" width="10.5"/>')
})

test('the document declares the SVG namespace and a viewBox matching its size', () => {
  const svg = document({ width: 830, height: 500, title: 'hello', children: '' })
  assert.match(svg, /^<svg /)
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /viewBox="0 0 830 500"/)
  assert.match(svg, /width="830"/)
  assert.match(svg, /height="500"/)
  assert.ok(svg.endsWith('</svg>'))
})

// Rendered inside an <img>, so a screen reader has only the title and the comment's alt
// text to work with.
test('the document carries a title and is labelled as an image', () => {
  const svg = document({ width: 10, height: 10, title: 'Coverage 76.8%', children: '' })
  assert.match(svg, /role="img"/)
  assert.match(svg, /<title id="([a-z0-9-]+)">Coverage 76\.8%<\/title>/)
  const id = /<title id="([a-z0-9-]+)">/.exec(svg)[1]
  assert.match(svg, new RegExp(`aria-labelledby="${id}"`))
})

test('the document title is escaped', () => {
  assert.match(document({ width: 1, height: 1, title: 'a & b', children: '' }), /<title id="[^"]+">a &amp; b<\/title>/)
})

test('wellFormed accepts balanced markup and rejects everything else', () => {
  assert.deepStrictEqual(wellFormed('<a><b/></a>'), { ok: true })
  assert.strictEqual(wellFormed('<a><b></a>').ok, false)
  assert.strictEqual(wellFormed('<a></a></a>').ok, false)
  assert.strictEqual(wellFormed('<a x=1/>').ok, false)
})
