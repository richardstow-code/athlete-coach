/**
 * Classifies a race by its elevation profile.
 * @param {number|null} elevationM  Total elevation gain in metres
 * @param {number|null} distanceKm  Race distance in km
 * @returns {'flat'|'rolling'|'hilly'|'mountainous'}
 */
export function classifyElevation(elevationM, distanceKm) {
  if (!elevationM || elevationM === 0 || !distanceKm || distanceKm === 0) return 'flat'
  const gainPerKm = elevationM / distanceKm
  if (gainPerKm < 5)  return 'flat'         // e.g. <210m for a marathon
  if (gainPerKm < 15) return 'rolling'       // e.g. 210–630m for a marathon
  if (gainPerKm < 30) return 'hilly'         // e.g. 630–1260m for a marathon
  return 'mountainous'                        // e.g. >1260m for a marathon
}

/**
 * Weekly elevation targets (base phase → peak phase) in metres per week,
 * and a one-line coaching label for each classification.
 */
export const ELEVATION_TARGETS = {
  flat:        { base: [100, 300],  peak: [100, 300],   label: 'flat — pace and volume are the priority; elevation is incidental' },
  rolling:     { base: [200, 500],  peak: [400, 600],   label: 'rolling — include rolling terrain; 200–500m/week is sufficient' },
  hilly:       { base: [400, 700],  peak: [800, 1200],  label: 'hilly — elevation is significant; build progressively with hill sessions' },
  mountainous: { base: [600, 1000], peak: [1500, 2500], label: 'mountainous — elevation is the primary challenge; back-to-back elevation days required' },
}

/**
 * Returns the elevation target range string for the given classification and phase.
 * phase: 'base' | 'peak'  (defaults to 'base')
 */
export function elevationTargetRange(classification, phase = 'base') {
  const t = ELEVATION_TARGETS[classification] || ELEVATION_TARGETS.flat
  const range = t[phase] || t.base
  return `${range[0]}–${range[1]}m/week`
}
