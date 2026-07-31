'use strict'

// Flat squarified treemap (Bruls / Huizing / van Wijk). One Tile per Package, area
// proportional to Statement count, no nesting.
//
// Flat is a decision, not a simplification: a Package is everything before the last `/`
// with no rollup, so `internal/tariff` and `internal/tariff/courier` are unrelated
// neighbours (ADR-0004).

/**
 * @template {{ total: number }} T
 * @param {T[]} items descending by `total`; each must have total > 0
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @returns {(T & { x: number, y: number, w: number, h: number })[]} one Tile per item, in input order
 */
function squarify(items, x, y, w, h) {
  const out = []
  layout(items, x, y, w, h, out)
  return out
}

function sum(items) {
  return items.reduce((s, t) => s + t.total, 0)
}

function layout(items, x, y, w, h, out) {
  if (items.length === 0) return
  if (items.length === 1) {
    out.push({ ...items[0], x, y, w, h })
    return
  }

  const total = sum(items)

  // Find the prefix of items that, laid out as one row along the short axis, has the
  // best worst-case aspect ratio.
  let best = null
  for (let i = 1; i < items.length; i++) {
    const head = items.slice(0, i)
    const a = sum(head)
    const frac = a / total
    const rowW = w >= h ? w * frac : w
    const rowH = w >= h ? h : h * frac

    let worst = 0
    for (const t of head) {
      const share = t.total / a
      const tw = w >= h ? rowW : rowW * share
      const th = w >= h ? rowH * share : rowH
      worst = Math.max(worst, Math.max(tw / th, th / tw))
    }
    if (!best || worst < best.worst) best = { worst, i }
  }

  const { i } = best
  const frac = sum(items.slice(0, i)) / total

  if (w >= h) {
    layout(items.slice(0, i), x, y, w * frac, h, out)
    layout(items.slice(i), x + w * frac, y, w * (1 - frac), h, out)
  } else {
    layout(items.slice(0, i), x, y, w, h * frac, out)
    layout(items.slice(i), x, y + h * frac, w, h * (1 - frac), out)
  }
}

module.exports = { squarify }
