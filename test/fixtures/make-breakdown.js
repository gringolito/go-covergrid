'use strict'

// TEST TOOLING, NOT PART OF THE ACTION.
//
// Regenerates the breakdown fixtures from a coverage profile, standing in for
// go-test-coverage, which is not installed here. The action itself never parses a profile
// (ADR-0001): do not import this from src/, and do not grow it into a parser src/ relies on.
//
//   node test/fixtures/make-breakdown.js cover.out sample-breakdown.txt
//   node test/fixtures/make-breakdown.js big.out big-breakdown.txt
//
// Block identity is `file:startLine.startCol,endLine.endCol`, not `file:startLine:endLine`:
// one source line can hold two distinct blocks, so the coarser key silently drops some.

const fs = require('node:fs')
const path = require('node:path')

const [, , input, output] = process.argv
if (!input || !output) {
  process.stderr.write('usage: node make-breakdown.js <profile> <breakdown-file>\n')
  process.exit(2)
}

const blocks = new Map()
for (const raw of fs.readFileSync(input, 'utf8').split('\n')) {
  const m = /^(.*):(\d+)\.(\d+),(\d+)\.(\d+) (\d+) (\d+)$/.exec(raw.trim())
  if (!m) continue

  const key = `${m[1]}:${m[2]}.${m[3]},${m[4]}.${m[5]}`
  const statements = parseInt(m[6], 10)
  const hits = parseInt(m[7], 10)

  // -coverpkg=./... emits every block once per test binary. Sum the hits, count the
  // statements once.
  const seen = blocks.get(key)
  if (seen) seen.hits += hits
  else blocks.set(key, { file: m[1], statements, hits })
}

const files = new Map()
for (const block of blocks.values()) {
  const entry = files.get(block.file) || { total: 0, covered: 0 }
  entry.total += block.statements
  if (block.hits > 0) entry.covered += block.statements
  files.set(block.file, entry)
}

const names = [...files.keys()].sort()
const target = path.isAbsolute(output) ? output : path.join(__dirname, output)
fs.writeFileSync(target, names.map((n) => `${n};${files.get(n).total};${files.get(n).covered}`).join('\n') + '\n')

const packages = new Set(names.map((n) => n.slice(0, n.lastIndexOf('/'))))
let total = 0
let covered = 0
for (const entry of files.values()) {
  total += entry.total
  covered += entry.covered
}

process.stdout.write(
  `${target}: ${blocks.size} unique blocks, ${names.length} files, ${packages.size} packages, ` +
    `${total} statements, ${((100 * covered) / total).toFixed(1)}% covered\n`,
)
