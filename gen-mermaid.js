'use strict'

// THROWAWAY PROBE TOOLING. Emits a Mermaid treemap from a Breakdown File, reusing the real
// band logic so the colours are exactly the ones the SVG renderer would choose. Here to find
// out whether Mermaid can carry the Grid Map at all; delete once that is decided.
//
//   node gen-mermaid.js <breakdown> <out.mmd> [root|no-root] [name|with-pct]

const fs = require('node:fs')
const { parseBreakdown, aggregateByPackage, coverageRatio, round1 } = require('./src/breakdown.js')
const { BANDS, bandOf } = require('./src/gridmap/bands.js')
const { commonPathPrefix } = require('./src/gridmap/index.js')

const [, , input, output, rootMode = 'root', labelMode = 'name'] = process.argv

const packages = aggregateByPackage(parseBreakdown(fs.readFileSync(input, 'utf8')))
  .map((p) => ({ ...p, ratio: coverageRatio(p.total, p.covered) }))
  .sort((a, b) => b.total - a.total)

const className = (band) => `b${BANDS.indexOf(band)}`
const lines = ['treemap-beta']

// A treemap needs a root section in the documented examples. Whether it needs one — the
// header strip it draws costs vertical space for no information — is one of the questions.
const indent = rootMode === 'no-root' ? '' : '    '
if (rootMode !== 'no-root') lines.push('"Coverage"')

// Same prefix stripping the SVG does, so `example.com/acme/parcel/internal/rest` reads as
// `internal/rest`. Without it every label is dominated by the module path.
const prefix = commonPathPrefix(packages.map((p) => p.name))

for (const p of packages) {
  const band = bandOf(p.ratio)
  const short = p.name.startsWith(prefix) ? p.name.slice(prefix.length) : p.name
  const label = labelMode === 'with-pct' ? `${short} ${round1(p.ratio).toFixed(1)}%` : short
  // The class goes AFTER the value: "Leaf": 20:::class1. A `:::` on its own line, which is
  // what the first probe did, parses as nothing and silently leaves every tile unstyled.
  lines.push(`${indent}"${label}": ${p.total}:::${className(band)}`)
}

lines.push('')
for (const band of BANDS) {
  lines.push(`classDef ${className(band)} fill:${band.col},color:${band.ink},stroke:#161b22;`)
}

const text = lines.join('\n') + '\n'
fs.writeFileSync(output, text)
process.stdout.write(`${packages.length} packages, ${text.length} chars -> ${output}\n`)
