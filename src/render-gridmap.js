'use strict'

// Entry point: Breakdown File in, Grid Map SVG on disk.
//
// It never uploads and never talks to the GitHub API, so it runs on a laptop (ADR-0002).
//
//   BREAKDOWN_PATH=coverage-breakdown.txt OUTPUT_PATH=grid-map.svg node src/render-gridmap.js

const fs = require('node:fs')

const { parseBreakdown } = require('./breakdown.js')
const { renderGridMap } = require('./gridmap/index.js')
const { setOutput, notice, warning } = require('./workflow.js')

function main() {
  const breakdownPath = process.env.BREAKDOWN_PATH || process.argv[2]
  const outputPath = process.env.OUTPUT_PATH || process.argv[3]

  if (!breakdownPath || !outputPath) {
    process.stderr.write('usage: BREAKDOWN_PATH=<file> OUTPUT_PATH=<file.svg> node src/render-gridmap.js\n')
    process.exit(2)
  }

  const stats = parseBreakdown(fs.readFileSync(breakdownPath, 'utf8'))
  const { svg, tiles, total } = renderGridMap({ stats })

  if (tiles.length === 0) {
    warning('The breakdown file described no packages with statements; the grid map will be empty.')
  }

  fs.writeFileSync(outputPath, svg)

  setOutput('total-coverage', total.ratio.toFixed(1))
  setOutput('total-statements', total.total)
  setOutput('covered-statements', total.covered)
  setOutput('package-count', tiles.length)
  setOutput('grid-map-path', outputPath)

  notice(
    `Grid Map rendered: ${tiles.length} packages, ${total.total} statements, ` +
      `${total.ratio.toFixed(1)}% covered, ${(svg.length / 1024).toFixed(1)} KB of SVG.`,
  )
}

main()
