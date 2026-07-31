'use strict'

// Breakdown File parsing and aggregation.
//
// A Breakdown File is vladopajic/go-test-coverage's machine-readable output: one line
// per Go source file, `path;totalStatements;coveredStatements`. It is the single source
// of every number this action reports. Nothing here parses a Coverage Profile — see
// docs/adr/0001-read-breakdown-files-not-the-profile.md for why that matters.
//
// The Gate's `report` output is human-formatted prose and must never be parsed.

/** @typedef {{ name: string, total: number, covered: number }} Stat */

/**
 * @param {string} text contents of a Breakdown File
 * @returns {Stat[]} one entry per Go source file, in file order
 */
function parseBreakdown(text) {
  const stats = []

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue

    const fields = line.split(';')
    const [name, total, covered] = fields
    if (fields.length !== 3 || !/^\d+$/.test(total) || !/^\d+$/.test(covered) || name.trim() === '') {
      throw new Error(`malformed breakdown line: ${JSON.stringify(raw)}`)
    }

    stats.push({ name: name.trim(), total: parseInt(total, 10), covered: parseInt(covered, 10) })
  }

  return stats
}

/**
 * A Package is everything before the last `/`, with no rollup of deeper paths into
 * shallower ones. Mirrors go-test-coverage's `packageForFile` so our Package names match
 * the names its own per-package threshold annotations use.
 *
 * @param {string} filename
 * @returns {string}
 */
function packageForFile(filename) {
  const i = filename.lastIndexOf('/')
  return i === -1 ? filename : filename.slice(0, i)
}

/**
 * @param {Stat[]} stats per-file entries
 * @returns {Stat[]} one entry per Package, in first-seen order
 */
function aggregateByPackage(stats) {
  const byPkg = new Map()

  for (const s of stats) {
    const name = packageForFile(s.name)
    const entry = byPkg.get(name) || { name, total: 0, covered: 0 }
    entry.total += s.total
    entry.covered += s.covered
    byPkg.set(name, entry)
  }

  return [...byPkg.values()]
}

/**
 * @param {Stat[]} list
 * @returns {{ total: number, covered: number }}
 */
function totalStats(list) {
  return list.reduce(
    (acc, s) => ({ total: acc.total + s.total, covered: acc.covered + s.covered }),
    { total: 0, covered: 0 },
  )
}

/**
 * Coverage Ratio as a percentage. Special-cased at the ends so a fully covered Package
 * reads exactly 100 rather than 99.99999999, matching go-test-coverage.
 *
 * @param {number} total
 * @param {number} covered
 * @returns {number} 0..100
 */
function coverageRatio(total, covered) {
  if (total === 0) return 0
  if (covered === total) return 100
  return (covered * 100) / total
}

function round1(n) {
  return Math.round(n * 10) / 10
}

function round2(n) {
  return Math.round(n * 100) / 100
}

/**
 * Entries whose uncovered Statement count moved since the Baseline, or that the Baseline
 * did not have at all.
 *
 * Mirrors go-test-coverage's `calculateStatsDiff`, including its quirk: an entry that is
 * now fully covered is excluded even if it previously had uncovered Statements. That is
 * upstream behaviour, replicated deliberately so our numbers agree with the Gate's.
 *
 * @param {Stat[]} current
 * @param {Stat[]} base
 * @returns {{ current: Stat, base: Stat | null }[]}
 */
function diffStats(current, base) {
  const baseByName = new Map(base.map((s) => [s.name, s]))
  const diffs = []

  for (const s of current) {
    const uncovered = s.total - s.covered
    if (uncovered === 0) continue

    const b = baseByName.get(s.name)
    if (!b) {
      diffs.push({ current: s, base: null })
    } else if (uncovered !== b.total - b.covered) {
      diffs.push({ current: s, base: b })
    }
  }

  return diffs
}

/**
 * Current total Coverage Ratio minus the Baseline's, to two decimals. Computed this way
 * so the number the comment shows matches the number the Gate's own diff threshold
 * compares against (`TotalPercentageDiff` upstream).
 *
 * @param {Stat[]} current
 * @param {Stat[]} base
 * @returns {number}
 */
function totalRatioDiff(current, base) {
  const c = totalStats(current)
  const b = totalStats(base)
  return round2(coverageRatio(c.total, c.covered) - coverageRatio(b.total, b.covered))
}

module.exports = {
  parseBreakdown,
  packageForFile,
  aggregateByPackage,
  totalStats,
  coverageRatio,
  diffStats,
  totalRatioDiff,
  round1,
  round2,
}
