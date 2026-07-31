'use strict'

// SVG as string building, which needs no library (ADR-0003).
//
// Presentation attributes only: no <style>, no CSS, no <script>, nothing fetched from
// another host. The file has to survive being served from public hosting, proxied by
// GitHub's camo and rendered inside an <img>, where scripts do not run and external
// references do not load.

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/**
 * @param {string} value
 * @returns {string} safe to place in a text node
 */
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c])
}

function escapeAttr(value) {
  return escapeText(value)
}

function formatValue(value) {
  if (typeof value !== 'number') return escapeAttr(value)
  // Finer than a pixel at any plausible size, and keeps the treemap's divisions from
  // filling the document with 17-digit float noise.
  return String(Math.round(value * 100) / 100)
}

/**
 * @param {string} name
 * @param {Record<string, string | number | undefined | null>} attrs
 * @param {string} [children] already-escaped markup
 * @returns {string}
 */
function tag(name, attrs, children) {
  const rendered = Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${formatValue(value)}"`)
    .join('')

  return children === undefined ? `<${name}${rendered}/>` : `<${name}${rendered}>${children}</${name}>`
}

/**
 * @param {object} options
 * @param {number} options.width
 * @param {number} options.height
 * @param {string} options.title read by a screen reader in place of the picture
 * @param {string} options.children
 * @returns {string} a complete standalone SVG document
 */
function document({ width, height, title, children }) {
  const titleId = 'grid-map-title'

  return tag(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      height,
      viewBox: `0 0 ${formatValue(width)} ${formatValue(height)}`,
      role: 'img',
      'aria-labelledby': titleId,
    },
    tag('title', { id: titleId }, escapeText(title)) + children,
  )
}

/**
 * A minimal well-formedness check: balanced elements, quoted attributes, no stray markup.
 * Not a parser — enough to fail loudly if the renderer ever emits something a browser
 * would refuse, which is invisible in a string comparison.
 *
 * @param {string} markup
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function wellFormed(markup) {
  const stack = []
  const pattern = /<(\/?)([A-Za-z][A-Za-z0-9-]*)((?:\s+[A-Za-z:-]+="[^"<>]*")*)\s*(\/?)>/g
  let at = 0

  for (const match of markup.matchAll(pattern)) {
    if (match.index !== at) {
      const between = markup.slice(at, match.index)
      if (between.includes('<') || between.includes('>')) {
        return { ok: false, reason: `unescaped markup in text: ${JSON.stringify(between.slice(0, 40))}` }
      }
    }
    at = match.index + match[0].length

    const [, closing, name, , selfClosing] = match
    if (selfClosing) continue
    if (closing) {
      if (stack.pop() !== name) return { ok: false, reason: `unbalanced </${name}>` }
    } else {
      stack.push(name)
    }
  }

  const tail = markup.slice(at)
  if (tail.includes('<') || tail.includes('>')) {
    return { ok: false, reason: `trailing markup: ${JSON.stringify(tail.slice(0, 40))}` }
  }
  if (stack.length > 0) return { ok: false, reason: `unclosed <${stack[stack.length - 1]}>` }

  return { ok: true }
}

module.exports = { escapeText, escapeAttr, tag, document, wellFormed }
