'use strict'

// Grid Map rendering: Breakdown File statistics in, an SVG document out.
//
// Pure by construction: no network, no GitHub API, no filesystem. Uploading lives in its
// own script so this stays testable without reaching the host (ADR-0002).

const { aggregateByPackage, totalStats, coverageRatio } = require('../breakdown.js')
const { escapeText, tag, document, wellFormed } = require('./svg.js')
const { BANDS, bandOf } = require('./bands.js')
const { squarify } = require('./treemap.js')

/**
 * GitHub's comment content column. The coordinate space is the display width, so a
 * font-size in this file is the size the reader sees (ADR-0004).
 */
const CANVAS_WIDTH = 830
const BASE_HEIGHT = 467
/** Beyond this the picture is a ribbon nobody scrolls; tiny Tiles are chips either way. */
const MAX_HEIGHT = 1245
/** Package count the base height comfortably labels. */
const ROOMY_PACKAGE_COUNT = 24
const HEIGHT_PER_EXTRA_PACKAGE = 6

const LEGEND_H = 32
const BACKGROUND = '#161b22'
const LEGEND_INK = '#c8d0d8'
/** Gutter between Tiles, applied on every side. */
const GAP = 2
/** Inner padding between a Tile's edge and its text. */
const PAD = 4

/**
 * Every glyph is measured as this fraction of the font size. True of every monospace font
 * worth naming, and `textLength` pins the result anyway, so a font that disagrees gets
 * squeezed to fit rather than overflowing.
 */
const ADVANCE_RATIO = 0.6
const MONOSPACE_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

const NAME_SIZE = 10
const COUNT_SIZE = 8
const PCT_MAX_SIZE = 28
const PCT_MIN_SIZE = 7
/** Below this a Tile has no room for a name above the percentage. */
const NAME_MIN_TILE_H = 26
const COUNT_MIN_TILE_H = 46

const textWidth = (s, size) => s.length * size * ADVANCE_RATIO

/**
 * Height grows with Package count: the width is fixed to the display column, so height is
 * the only way left to give every Tile more area (ADR-0004).
 *
 * @param {number} packageCount
 * @returns {number}
 */
function gridMapHeight(packageCount) {
  const extra = Math.max(0, packageCount - ROOMY_PACKAGE_COUNT) * HEIGHT_PER_EXTRA_PACKAGE
  return Math.min(MAX_HEIGHT, BASE_HEIGHT + extra)
}

/**
 * The path prefix every Package shares, truncated to a `/` boundary. Stripped from Tile
 * labels so `example.com/acme/parcel/internal/rest` reads as `internal/rest` and fits.
 * Derived rather than configured, so a consumer never has to declare their module path.
 *
 * @param {string[]} names
 * @returns {string} '' when there is nothing shared to strip
 */
function commonPathPrefix(names) {
  if (names.length < 2) return ''

  let prefix = names[0]
  for (const name of names.slice(1)) {
    let i = 0
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++
    prefix = prefix.slice(0, i)
    if (prefix === '') return ''
  }

  const cut = prefix.lastIndexOf('/')
  return cut === -1 ? '' : prefix.slice(0, cut + 1)
}

/**
 * One line of text, positioned by its top edge rather than its baseline.
 *
 * @param {string} content already-escaped text
 * @param {{ x: number, y: number, size: number, fill: string, anchor?: string, chars: number }} placement
 * @returns {string}
 */
function label(content, { x, y, size, fill, anchor, chars }) {
  return tag(
    'text',
    {
      x,
      // SVG positions text on its baseline. Cap height is about 0.7em for monospace, so
      // the baseline sits 0.8em below the intended top edge.
      y: y + size * 0.8,
      'font-size': size,
      fill,
      'text-anchor': anchor,
      // Pins the run to the width reserved for it, whatever font the reader's machine
      // resolves. Without it a wide fallback font spills out of the Tile.
      textLength: chars * size * ADVANCE_RATIO,
      lengthAdjust: 'spacingAndGlyphs',
    },
    content,
  )
}

/**
 * @param {object} options
 * @param {import('../breakdown.js').Stat[]} options.stats per-file Breakdown File entries
 * @returns {{ svg: string, tiles: object[], total: { total: number, covered: number, ratio: number } }}
 */
function renderGridMap({ stats }) {
  const packages = aggregateByPackage(stats)
  const totals = totalStats(packages)
  const total = { ...totals, ratio: coverageRatio(totals.total, totals.covered) }

  const items = packages
    .filter((p) => p.total > 0)
    .map((p) => ({ ...p, ratio: coverageRatio(p.total, p.covered) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))

  const mapH = gridMapHeight(items.length)
  const height = mapH + LEGEND_H
  const tiles = squarify(items, 0, 0, CANVAS_WIDTH, mapH)
  const prefix = commonPathPrefix(items.map((t) => t.name))

  const body =
    tag('rect', { x: 0, y: 0, width: CANVAS_WIDTH, height, fill: BACKGROUND }) +
    tag(
      'g',
      { 'font-family': MONOSPACE_STACK },
      tiles.map((tile, i) => drawTile(tile, i, prefix)).join('') + drawLegend(mapH, total),
    )

  const title =
    `Coverage grid map: ${total.ratio.toFixed(1)}% of ${total.total} statements ` +
    `across ${items.length} package${items.length === 1 ? '' : 's'}`

  const svg = document({ width: CANVAS_WIDTH, height, title, children: body })

  const check = wellFormed(svg)
  if (!check.ok) throw new Error(`the renderer produced malformed SVG: ${check.reason}`)

  return { svg, tiles, total }
}

function drawTile(tile, index, prefix) {
  const band = bandOf(tile.ratio)
  const x = tile.x + GAP
  const y = tile.y + GAP
  const w = tile.w - GAP * 2
  const h = tile.h - GAP * 2
  if (w < 2 || h < 2) return ''

  const fill = tag('rect', { x, y, width: w, height: h, fill: band.col })
  const inner = w - PAD * 2
  if (inner <= 0) return fill

  const short = tile.name.startsWith(prefix) ? tile.name.slice(prefix.length) : tile.name
  const base = short.slice(short.lastIndexOf('/') + 1)

  // Full path if it fits, else the last segment, else no name at all. A Tile too small to
  // label stays a bare colour chip, which is fine: it is small because it holds few
  // Statements, so the layout has already ranked it (ADR-0004).
  let name = ''
  if (h > NAME_MIN_TILE_H) {
    if (textWidth(short, NAME_SIZE) <= inner) name = short
    else if (textWidth(base, NAME_SIZE) <= inner) name = base
  }

  const count = `${tile.total} stmt`
  const showCount = h > COUNT_MIN_TILE_H && textWidth(count, COUNT_SIZE) <= inner

  // The name and the count claim their bands before the percentage is sized, so a large
  // percentage cannot grow through either on a Tile just tall enough for both.
  const topUsed = name === '' ? PAD : NAME_SIZE + PAD * 2
  const bottomUsed = showCount ? COUNT_SIZE + PAD * 2 : PAD
  const availH = h - topUsed - bottomUsed

  const parts = []
  if (name !== '') {
    parts.push(
      label(escapeText(name), {
        x: x + PAD,
        y: y + PAD,
        size: NAME_SIZE,
        fill: band.ink,
        chars: name.length,
      }),
    )
  }

  // The Coverage Ratio gets the largest size that fits what is left.
  const pct = `${tile.ratio.toFixed(1)}%`
  const pctSize = Math.floor(Math.min(inner / (ADVANCE_RATIO * pct.length), availH, PCT_MAX_SIZE))

  if (pctSize >= PCT_MIN_SIZE) {
    parts.push(
      label(pct, {
        x: x + w / 2,
        y: y + topUsed + (availH - pctSize) / 2,
        size: pctSize,
        fill: band.ink,
        anchor: 'middle',
        chars: pct.length,
      }),
    )
  }

  if (showCount) {
    parts.push(
      label(count, {
        x: x + PAD,
        y: y + h - PAD - COUNT_SIZE,
        size: COUNT_SIZE,
        fill: band.ink,
        chars: count.length,
      }),
    )
  }

  if (parts.length === 0) return fill

  // Belt and braces over textLength: a font with unexpected vertical metrics still cannot
  // paint outside its own Tile.
  const clipId = `t${index}`
  return (
    fill +
    tag('clipPath', { id: clipId }, tag('rect', { x, y, width: w, height: h })) +
    tag('g', { 'clip-path': `url(#${clipId})` }, parts.join(''))
  )
}

function drawLegend(mapH, total) {
  const y = mapH + 10
  const swatch = 11
  const size = COUNT_SIZE + 1
  let x = PAD + 2
  const parts = []

  for (const band of BANDS) {
    parts.push(tag('rect', { x, y, width: swatch, height: swatch, fill: band.col }))
    parts.push(
      label(escapeText(band.label), {
        x: x + swatch + 5,
        y: y + 1,
        size,
        fill: LEGEND_INK,
        chars: band.label.length,
      }),
    )
    x += swatch + 5 + textWidth(band.label, size) + 16
  }

  const summary = `total ${total.ratio.toFixed(1)}% of ${total.total} stmt`
  parts.push(
    label(summary, {
      x: CANVAS_WIDTH - PAD - 2,
      y: y + 1,
      size,
      fill: LEGEND_INK,
      anchor: 'end',
      chars: summary.length,
    }),
  )

  return parts.join('')
}

module.exports = {
  CANVAS_WIDTH,
  BASE_HEIGHT,
  MAX_HEIGHT,
  LEGEND_H,
  MONOSPACE_STACK,
  ADVANCE_RATIO,
  gridMapHeight,
  commonPathPrefix,
  renderGridMap,
}
