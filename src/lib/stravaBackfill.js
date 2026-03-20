import { supabase } from './supabase'
import { callClaude } from './claudeProxy'

/**
 * runBackfill — calls the strava-sync edge function (handles token refresh,
 * pagination, 90-day window) then generates a baseline analysis via Claude.
 * Returns { activitiesImported: number, error: string|null }
 */
export async function runBackfill() {
  try {
    const sessionRes = await supabase.auth.getSession()
    const jwt = sessionRes.data?.session?.access_token
    if (!jwt) return { activitiesImported: 0, error: 'Not authenticated' }

    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-sync`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_KEY,
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({}), // manual mode defaults to 90-day window
      }
    )

    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { error: text } }

    if (!res.ok || data?.error) {
      return { activitiesImported: 0, error: data?.error || `HTTP ${res.status}` }
    }

    const activitiesImported = data?.synced ?? 0

    // Generate baseline analysis in the background after a successful sync
    if (activitiesImported > 0) {
      generateBaselineAnalysis().catch(e =>
        console.warn('Baseline analysis failed:', e)
      )
    }

    return { activitiesImported, error: null }
  } catch (e) {
    return { activitiesImported: 0, error: e.message }
  }
}

/**
 * generateBaselineAnalysis — fetches the last 90 days of activities from
 * Supabase, builds a plain-text training summary, calls Claude to produce
 * a baseline analysis, and writes it to coaching_memory.
 */
export async function generateBaselineAnalysis() {
  const ninetyDaysAgo = new Date()
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
  const after = ninetyDaysAgo.toISOString().slice(0, 10)

  const { data: activities } = await supabase
    .from('activities')
    .select('type, distance_km, duration_min, avg_hr, elevation_m, date')
    .gte('date', after)

  if (!activities?.length) return

  const summary = buildActivitySummary(activities)

  const data = await callClaude({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system:
      "You are a running coach analysing an athlete's recent training history to establish a baseline. Be direct and specific. Focus on: weekly volume patterns, typical effort levels, elevation habits, and any notable consistency or gaps. Keep the analysis under 200 words.",
    messages: [{ role: 'user', content: summary }],
  })

  const analysisText = data?.content?.[0]?.text || ''
  if (!analysisText) return

  const { data: { user } } = await supabase.auth.getUser()

  await supabase.from('coaching_memory').insert({
    user_id: user?.id,
    source: 'backfill',
    category: 'baseline_analysis',
    content: analysisText,
    date: new Date().toISOString().slice(0, 10),
    type: 'analysis',
  })
}

function buildActivitySummary(activities) {
  const runs = activities.filter(a => a.type?.toLowerCase().includes('run'))
  const strength = activities.filter(a =>
    a.type?.toLowerCase().includes('weight') || a.type?.toLowerCase().includes('strength')
  )

  const weeksInRange = 13 // ~90 days / 7
  const avgRunsPerWeek = (runs.length / weeksInRange).toFixed(1)

  const totalKm = runs.reduce((s, a) => s + parseFloat(a.distance_km || 0), 0)
  const avgWeeklyKm = (totalKm / weeksInRange).toFixed(1)

  // Pace range from duration_min and distance_km
  const paceRuns = runs.filter(a => a.distance_km && a.duration_min)
  let paceRange = '—'
  if (paceRuns.length > 0) {
    const paces = paceRuns.map(
      a => parseFloat(a.duration_min) / parseFloat(a.distance_km)
    )
    const minPace = Math.min(...paces)
    const maxPace = Math.max(...paces)
    const fmt = p =>
      `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, '0')}`
    paceRange = `${fmt(minPace)}–${fmt(maxPace)}/km`
  }

  const hrRuns = runs.filter(a => a.avg_hr)
  const avgHR =
    hrRuns.length > 0
      ? Math.round(hrRuns.reduce((s, a) => s + parseFloat(a.avg_hr), 0) / hrRuns.length)
      : null

  const totalElev = activities.reduce((s, a) => s + parseFloat(a.elevation_m || 0), 0)
  const avgWeeklyElev = Math.round(totalElev / weeksInRange)

  return [
    'Training summary (last 90 days):',
    `- Total activities: ${activities.length} (${runs.length} runs, ${strength.length} strength, ${activities.length - runs.length - strength.length} other)`,
    `- Runs per week: ${avgRunsPerWeek} avg`,
    `- Weekly distance: ${avgWeeklyKm}km avg`,
    `- Pace range: ${paceRange}`,
    avgHR ? `- Average HR (runs): ${avgHR}bpm` : null,
    `- Weekly elevation: ${avgWeeklyElev}m avg`,
  ].filter(Boolean).join('\n')
}
