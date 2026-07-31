'use strict'

// Renders the pull request comment body. Pure string building — no GitHub API calls, no
// filesystem, no network — so the whole comment can be diffed in tests.
//
// Ported from a proven coverage-comment script that predates this action. Two
// deliberate changes: the "Lines" row is labelled Stmts, because the go toolchain counts
// Statements and CONTEXT.md bans the word line; and the base branch name is a parameter
// rather than the literal "main".
//
// The Gate's own inline annotations already report absolute-threshold violations on the
// Files changed tab, so this does NOT re-derive go-test-coverage's three-way
// file/package/total pass-fail breakdown. The one failure mode with no inline-annotation
// equivalent is the diff-vs-baseline threshold, because there is no line to annotate, so
// that case is named explicitly with numbers.

const {
  aggregateByPackage,
  totalStats,
  coverageRatio,
  diffStats,
  totalRatioDiff,
  round1,
  round2,
} = require('./breakdown.js')

// How an existing comment is recognised and edited in place. Changing this string orphans
// every comment already posted with the old one: the next run will not find them, so it
// posts a second comment beside each and the stale ones stay forever. Safe to change only
// while nothing is deployed.
const MARKER = '<!-- go-covergrid:grid-map -->'
const HEADING = '## Coverage Report'
const BAR_WIDTH = 10

function bar(ratio) {
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(ratio / 10)))
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

function formatSignedPct(n, decimals) {
  return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`
}

function signedInt(n) {
  return `${n > 0 ? '+' : ''}${n}`
}

function padLeft(value, width) {
  const s = String(value)
  return s.length >= width ? s : ' '.repeat(width - s.length) + s
}

function padRight(value, width) {
  const s = String(value)
  return s.length >= width ? s : s + ' '.repeat(width - s.length)
}

function formatRow(entry, baseBranch) {
  const ratio = coverageRatio(entry.current.total, entry.current.covered)
  let emoji
  let delta

  if (entry.base) {
    const baseRatio = coverageRatio(entry.base.total, entry.base.covered)
    const d = round1(ratio - baseRatio)
    emoji = d > 0 ? '🟢' : d < 0 ? '🔴' : '⚪'
    delta = formatSignedPct(d, 1)
  } else {
    emoji = '🆕'
    delta = 'new'
  }

  return `| ${emoji} | \`${entry.current.name}\` | ${bar(ratio)} ${round1(ratio).toFixed(1)}% | ${delta} |`
}

// Without a Baseline every entry is new, so naming the base branch in the header would
// promise a comparison that did not happen.
function renderTableRows(entries, baseBranch, hasBaseline) {
  const sorted = [...entries].sort((a, b) => a.current.name.localeCompare(b.current.name))
  return [
    `| | Package/File | Coverage | ${hasBaseline ? `Δ vs ${baseBranch}` : 'Δ'} |`,
    '| --- | --- | --- | --- |',
    ...sorted.map((e) => formatRow(e, baseBranch)),
  ]
}

function summaryTotals(list) {
  const { total, covered } = totalStats(list)
  return { files: list.length, stmts: total, hits: covered, misses: total - covered }
}

/**
 * Codecov-style summary block. The caller fences it as ```diff so GitHub colours rows
 * prefixed `+ ` and `- `.
 *
 * No Partials row: a Breakdown File carries only per-file Statement totals, with no notion
 * of a partially covered line or branch, and `go tool cover` does not track that either.
 * Faking it would mean parsing a Coverage Profile — the second data path ADR-0001 forbids.
 */
function renderDiffSummary({ current, base, prNumber, baseBranch }) {
  const cur = summaryTotals(current)
  const bas = summaryTotals(base)
  const curPct = coverageRatio(cur.stmts, cur.hits)
  const basPct = coverageRatio(bas.stmts, bas.hits)
  const covDelta = round2(curPct - basPct)
  const prLabel = prNumber ? `#${prNumber}` : 'pr'

  const rows = [
    {
      sign: covDelta > 0 ? '+' : covDelta < 0 ? '-' : ' ',
      label: 'Coverage',
      base: `${round2(basPct).toFixed(2)}%`,
      pr: `${round2(curPct).toFixed(2)}%`,
      delta: formatSignedPct(covDelta, 2),
      ruleAfter: true,
    },
    { sign: ' ', label: 'Files', base: bas.files, pr: cur.files, delta: signedInt(cur.files - bas.files) },
    {
      sign: ' ',
      label: 'Stmts',
      base: bas.stmts,
      pr: cur.stmts,
      delta: signedInt(cur.stmts - bas.stmts),
      ruleAfter: true,
    },
    { sign: cur.hits >= bas.hits ? '+' : '-', label: 'Hits', base: bas.hits, pr: cur.hits, delta: signedInt(cur.hits - bas.hits) },
    {
      sign: cur.misses <= bas.misses ? '+' : '-',
      label: 'Misses',
      base: bas.misses,
      pr: cur.misses,
      delta: signedInt(cur.misses - bas.misses),
    },
  ]

  const widths = {
    label: Math.max(...rows.map((r) => r.label.length)),
    base: Math.max(baseBranch.length, ...rows.map((r) => String(r.base).length)),
    pr: Math.max(prLabel.length, ...rows.map((r) => String(r.pr).length)),
    delta: Math.max('+/-'.length, ...rows.map((r) => String(r.delta).length)),
  }
  const gap = '   '
  const bodyWidth =
    2 + widths.label + gap.length + widths.base + gap.length + widths.pr + gap.length + widths.delta
  const lineWidth = bodyWidth + 3 // room for the header row's trailing ' ##' bookend

  const line = (prefix, label, baseCol, pr, delta) =>
    padRight(
      `${prefix}${padRight(label, widths.label)}${gap}${padLeft(baseCol, widths.base)}${gap}${padLeft(pr, widths.pr)}${gap}${padLeft(delta, widths.delta)}`,
      lineWidth,
    )

  const rule = '='.repeat(lineWidth)
  const centred = (text) => {
    const pad = Math.max(0, lineWidth - 4 - text.length)
    const left = Math.floor(pad / 2)
    return `@@${' '.repeat(left)}${text}${' '.repeat(pad - left)}@@`
  }

  const lines = [
    centred('Coverage Diff'),
    `${line('##', '', baseBranch, prLabel, '+/-').slice(0, bodyWidth)} ##`,
    rule,
  ]
  for (const r of rows) {
    lines.push(line(`${r.sign} `, r.label, r.base, r.pr, r.delta))
    if (r.ruleAfter) lines.push(rule)
  }

  return lines.join('\n')
}

function gateStatusLine({ outcome, diffThreshold, hasBaseline, totalDiff, baseBranch }) {
  const isLikelyDiffFailure =
    outcome === 'failure' &&
    hasBaseline &&
    Number.isFinite(diffThreshold) &&
    totalDiff !== null &&
    totalDiff < diffThreshold

  if (isLikelyDiffFailure) {
    return (
      `❌ **Coverage dropped ${Math.abs(totalDiff).toFixed(2)}% vs ${baseBranch}** ` +
      `(min allowed: ${diffThreshold.toFixed(2)}%)`
    )
  }

  if (outcome === 'failure') {
    return '❌ **Coverage gate failed** — see inline annotations on the Files changed tab for details.'
  }

  return '✅ **Coverage gate passed**'
}

/**
 * The Grid Map, or an explanation of its absence. Publishing is on by default, so a
 * missing image is worth a sentence rather than a silent gap (ADR-0002).
 */
function gridMapSection(imageUrl) {
  if (imageUrl) return `![Coverage Grid Map](${imageUrl})`
  return '_Grid map not published for this run (`publish-image` is off, or the upload failed — check the job log)._'
}

/**
 * @param {object} args
 * @param {string} args.outcome the Coverage Gate step outcome, 'success' or 'failure'
 * @param {number} args.diffThreshold minimum allowed total change, in percentage points
 * @param {boolean} args.hasBaseline whether a Baseline Breakdown File was retrieved
 * @param {string} args.baseBranch
 * @param {import('./breakdown.js').Stat[]} args.current
 * @param {import('./breakdown.js').Stat[]} args.base
 * @param {number | undefined} args.prNumber
 * @param {string | null} args.imageUrl published Grid Map URL, or null
 * @returns {string} markdown
 */
function renderComment({
  outcome,
  diffThreshold,
  hasBaseline,
  baseBranch = 'main',
  current,
  base,
  prNumber,
  imageUrl,
}) {
  const currentPkgs = aggregateByPackage(current)
  const basePkgs = aggregateByPackage(base)
  const impactedPkgs = diffStats(currentPkgs, basePkgs)
  const impactedFiles = diffStats(current, base)

  const total = totalStats(current)
  const totalPct = coverageRatio(total.total, total.covered)
  const totalDiff = hasBaseline ? totalRatioDiff(current, base) : null

  const sections = [
    MARKER,
    HEADING,
    '',
    gateStatusLine({ outcome, diffThreshold, hasBaseline, totalDiff, baseBranch }),
    '',
    `**Total coverage:** ${bar(totalPct)} ${round1(totalPct).toFixed(1)}%` +
      (totalDiff === null ? '' : ` (${formatSignedPct(totalDiff, 2)} vs ${baseBranch})`),
    '',
    gridMapSection(imageUrl),
    '',
  ]

  if (hasBaseline) {
    sections.push(
      ['```diff', renderDiffSummary({ current, base, prNumber, baseBranch }), '```', ''].join('\n'),
    )
  }

  if (impactedPkgs.length === 0 && impactedFiles.length === 0) {
    sections.push('_No coverage changes in this pull request._')
  } else {
    if (impactedPkgs.length > 0) {
      sections.push(['### Impacted packages', '', ...renderTableRows(impactedPkgs, baseBranch, hasBaseline), ''].join('\n'))
    }
    if (impactedFiles.length > 0) {
      sections.push(
        [
          '<details>',
          '<summary>Impacted files</summary>',
          '',
          ...renderTableRows(impactedFiles, baseBranch, hasBaseline),
          '',
          '</details>',
        ].join('\n'),
      )
    }
  }

  return sections.join('\n').trimEnd() + '\n'
}

/**
 * Posted when the Breakdown File is missing, so the comment does not silently vanish on
 * the one run where something went wrong.
 *
 * @param {string} [breakdownPath]
 * @returns {string} markdown
 */
function renderUnavailableComment(breakdownPath) {
  return (
    [
      MARKER,
      HEADING,
      '',
      '⚠️ **Coverage data could not be read for this run.**' +
        (breakdownPath ? ` No breakdown file at \`${breakdownPath}\`.` : ''),
      '',
      'Check this job\'s log: the coverage gate step may have failed before writing its breakdown file.',
    ].join('\n') + '\n'
  )
}

module.exports = { MARKER, HEADING, renderComment, renderUnavailableComment, bar, renderDiffSummary }
