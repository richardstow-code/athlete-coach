/**
 * Infers the current menstrual cycle phase.
 * Returns: 'menstrual' | 'follicular' | 'ovulatory' | 'luteal' | 'unknown'
 *
 * For irregular cycles, weights recent cycle_logs more heavily than estimates.
 * Returns 'unknown' whenever there is insufficient data — never guesses.
 */
export function inferCyclePhase(lastPeriodDate, avgCycleLength, isIrregular, recentLogs = []) {
  // User-reported log within the last 3 days takes priority
  const recentLog = recentLogs.find(l => {
    const days = Math.floor((new Date() - new Date(l.log_date)) / 86400000)
    return days <= 3 && l.phase_reported
  })

  if (isIrregular) {
    if (recentLog) return phaseFromReported(recentLog.phase_reported)
    // For irregular cycles without a recent log and no avg length, return unknown
    if (!lastPeriodDate || !avgCycleLength) return 'unknown'
    const days = daysSincePeriod(lastPeriodDate)
    if (days === null || days > 90) return 'unknown'
    return calcPhase(days, avgCycleLength)
  }

  // Regular cycle
  if (!lastPeriodDate) return 'unknown'
  const days = daysSincePeriod(lastPeriodDate)
  if (days === null || days < 0) return 'unknown'

  const cycleLen = avgCycleLength || 28
  if (days > cycleLen * 2.5) return 'unknown' // stale data

  if (recentLog) return phaseFromReported(recentLog.phase_reported)

  return calcPhase(days, cycleLen)
}

export function daysSincePeriod(lastPeriodDate) {
  if (!lastPeriodDate) return null
  const days = Math.floor((new Date() - new Date(lastPeriodDate)) / 86400000)
  return days >= 0 ? days : null
}

function calcPhase(daysSinceStart, cycleLength) {
  const day = (daysSinceStart % cycleLength) + 1 // 1-indexed day in cycle
  if (day <= 5)                    return 'menstrual'
  if (day >= 12 && day <= 16)      return 'ovulatory'
  if (day <= 13)                   return 'follicular'
  return 'luteal'
}

function phaseFromReported(reported) {
  return {
    menstruating: 'menstrual',
    pms:          'luteal',
    high_energy:  'follicular',
    low_energy:   'luteal',
    feeling_good: 'follicular',
    other:        'unknown',
  }[reported] || 'unknown'
}
