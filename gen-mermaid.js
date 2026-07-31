'use strict'

// THROWAWAY PROBE TOOLING. Emits a Mermaid treemap from a Breakdown File, reusing the real
// band logic so the colours are exactly the ones the SVG renderer would choose. Here to find
// out whether Mermaid can carry the Grid Map at all; delete once that is decided.
//
//   node gen-mermaid.js <breakdown> <out.mmd> [flags...]
//
// Flags:
//   root        wrap the tiles in a "Coverage" section (tints its children — see probe 2)
//   pct         fold the coverage ratio into the label
//   opacity     add fill-opacity:1 to every classDef, to fight the washed-out fills
//   theme       prepend an init directive pinning the base theme
//   stroke=X    override the tile stroke colour

const fs = require('node:fs')
const { parseBreakdown, aggregateByPackage, coverageRatio, round1 } = require('./src/breakdown.js')
const { BANDS, bandOf } = require('./src/gridmap/bands.js')
const { commonPathPrefix } = require('./src/gridmap/index.js')

const [, , input, output, ...flags] = process.argv
const has = (f) => flags.includes(f)
const valueOf = (name, fallback) => {
  const hit = flags.find((f) => f.startsWith(`${name}=`))
  return hit ? hit.slice(name.length + 1) : fallback
}

const packages = aggregateByPackage(parseBreakdown(fs.readFileSync(input, 'utf8')))
  .map((p) => ({ ...p, ratio: coverageRatio(p.total, p.covered) }))
  .sort((a, b) => b.total - a.total)

const className = (band) => `b${BANDS.indexOf(band)}`
const lines = []

// Pinning the base theme stops GitHub's light/dark theme from compositing its own palette
// over the fills, which is one candidate explanation for the desaturation.
if (has('theme')) lines.push("%%{init: {'theme': 'base'}}%%")

lines.push('treemap-beta')

// A root section tints every tile beneath it: with one, an 83.3% package that should be
// yellow renders lavender. Without one, the classDef fills come through.
const indent = has('root') ? '    ' : ''
if (has('root')) lines.push('"Coverage"')

// Same prefix stripping the SVG does, so `example.com/acme/parcel/internal/rest` reads as
// `internal/rest`. Without it every label is dominated by the module path.
const prefix = commonPathPrefix(packages.map((p) => p.name))

for (const p of packages) {
  const band = bandOf(p.ratio)
  const short = p.name.startsWith(prefix) ? p.name.slice(prefix.length) : p.name
  const label = has('pct') ? `${short} ${round1(p.ratio).toFixed(1)}%` : short
  // The class goes AFTER the value: "Leaf": 20:::class1. A `:::` on its own line, which is
  // what the first probe did, parses as nothing and silently leaves every tile unstyled.
  lines.push(`${indent}"${label}": ${p.total}:::${className(band)}`)
}

lines.push('')
const stroke = valueOf('stroke', '#161b22')
for (const band of BANDS) {
  const parts = [`fill:${band.col}`]
  if (has('opacity')) parts.push('fill-opacity:1', 'opacity:1')
  parts.push(`color:${band.ink}`, `stroke:${stroke}`)
  lines.push(`classDef ${className(band)} ${parts.join(',')};`)
}

const text = lines.join('\n') + '\n'
fs.writeFileSync(output, text)
process.stdout.write(`${packages.length} packages, ${text.length} chars -> ${output}\n`)
