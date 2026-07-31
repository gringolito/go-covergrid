'use strict'

// Coverage Bands: the five fixed ranges a Coverage Ratio falls into, and the only thing
// that determines a Tile's colour.
//
// The boundaries are conventional and not configurable. They are deliberately not fitted
// to any repository's distribution: a project whose Packages all reach the top Band should
// render as a solid block of green, because that is the true picture (ADR-0004).

/** Upper boundaries of the first four Bands, in percent. */
const CUTS = [50, 70, 85, 95]

/** ColorBrewer RdYlGn-5. */
const COLS = ['#d73027', '#fc8d59', '#fee08b', '#91cf60', '#1a9850']

/** Text colour drawn on each Band, chosen for contrast against that Band's fill. */
const INKS = ['#ffffff', '#3c1e14', '#503c0a', '#19370f', '#ffffff']

const BANDS = COLS.map((col, i) => ({
  max: i < CUTS.length ? CUTS[i] : Infinity,
  col,
  ink: INKS[i],
  label:
    i === 0
      ? `<${CUTS[0]}%`
      : i === COLS.length - 1
        ? `${CUTS[CUTS.length - 1]}%+`
        : `${CUTS[i - 1]}-${CUTS[i]}%`,
}))

/**
 * @param {number} ratio Coverage Ratio, 0..100
 * @returns {typeof BANDS[number]}
 */
function bandOf(ratio) {
  return BANDS.find((b) => ratio < b.max) || BANDS[BANDS.length - 1]
}

module.exports = { BANDS, CUTS, bandOf }
