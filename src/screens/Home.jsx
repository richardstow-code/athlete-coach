import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import OnboardingHints from '../components/OnboardingHints'
import { getActiveInjuryFollowUps, handleFollowUpResponse } from '../lib/injuryWorkflow'
import { useSettings } from '../lib/useSettings'
import { usePrimarySport } from '../lib/usePrimarySport'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { runBackfill } from '../lib/stravaBackfill'
import { callClaude } from '../lib/claudeProxy'
import { buildSystemPrompt } from '../lib/coachingPrompt'
import { buildContext, formatContext } from '../lib/buildContext'

const TZ = 'Europe/Vienna'

function viennaDate(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toLocaleDateString('en-CA', { timeZone: TZ })
}
function viennaHour() {
  // h23 guarantees 0–23 (avoids the "24" edge case at midnight in some engines)
  return parseInt(
    new Date().toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }),
    10
  )
}

const S = {
  page: { overflowY: 'auto', height: '100%' },
  hero: { padding: '24px 20px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  label: { fontSize: '11px', color: '#888580', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px' },
  greeting: { fontFamily: 'Syne, sans-serif', fontSize: '28px', fontWeight: 800, lineHeight: 1.1, marginBottom: '4px' },
  date: { fontSize: '12px', color: '#888580', marginBottom: '20px' },
  statStrip: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.08)', borderTop: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  statCell: { background: '#0a0a0a', padding: '14px 16px', textAlign: 'center' },
  statVal: { fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 700, lineHeight: 1, marginBottom: '3px' },
  statLbl: { fontSize: '10px', color: '#888580', letterSpacing: '0.06em', textTransform: 'uppercase' },
  section: { padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' },
  sectionTitle: { fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#888580' },
  card: { background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '16px' },
  badge: { display: 'inline-block', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px', background: 'rgba(232,255,71,0.12)', color: '#e8ff47', marginBottom: '12px' },
  actRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  actIcon: { width: '36px', height: '36px', borderRadius: '8px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 },
  zoneWrap: { marginBottom: '16px' },
  zoneLabel: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: '#888580' },
  zoneTrack: { height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' },
}

const CHECKIN_MSGS = [
  "You've got a session today. Shoes on?",
  "Training day. Your future self is watching.",
  "Today's session won't run itself.",
  "Are you going to do the thing? You're going to do the thing.",
  "Session reminder: the hardest part is starting.",
  "Coach here. Session on the plan. You know what to do.",
  "Today has a workout in it. That's already a win — just show up.",
]

const READINESS_COLOR = { 'Good to go': '#e8ff47', 'Manageable': '#f0ede8', 'Take it easy': '#ffb347' }
const SESSION_ICON = { run: '🏃', trail: '⛰️', strength: '🏋️', rest: '😴', bike: '🚴' }

function activityIcon(type) {
  const t = type?.toLowerCase() || ''
  if (t.includes('run')) return '🏃'
  if (t.includes('weight') || t.includes('strength')) return '💪'
  return '🚴'
}

// ── Standalone components (defined outside Home to avoid remount on re-render) ──

function ZoneBar({ label, pct, color, value }) {
  return (
    <div style={S.zoneWrap}>
      <div style={S.zoneLabel}>
        <span style={{ color }}>{label}</span>
        <span>{value}</span>
      </div>
      <div style={S.zoneTrack}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '3px', transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function ActivityRow({ activity, onActivityClick }) {
  const hrColor = (activity.avg_hr > 158) ? '#ff5c5c' : (activity.avg_hr > 140) ? '#ffb347' : '#4dff91'
  const paceStr = activity.pace_per_km || (activity.distance_km && activity.duration_min
    ? `${Math.floor(activity.duration_min / activity.distance_km)}:${String(Math.round((activity.duration_min / activity.distance_km % 1) * 60)).padStart(2, '0')}`
    : '—')
  const dateStr = activity.date
    ? new Date(activity.date.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
    : ''
  return (
    <div
      onClick={() => onActivityClick && onActivityClick(activity.strava_id)}
      style={{ ...S.actRow, cursor: onActivityClick ? 'pointer' : 'default' }}
    >
      <div style={S.actIcon}>{activityIcon(activity.type)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: '#f0ede8', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activity.name}</div>
        <div style={{ fontSize: '11px', color: '#888580' }}>
          {dateStr}{activity.distance_km ? ` · ${parseFloat(activity.distance_km).toFixed(1)}km` : ''}{activity.elevation_m ? ` · ${activity.elevation_m}m elev` : ''}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 600 }}>{paceStr}</div>
        {activity.avg_hr && <div style={{ fontSize: '11px', color: hrColor, marginTop: '2px' }}>HR {Math.round(activity.avg_hr)}</div>}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function Home({ onActivityClick, onOpenSettings }) {
  const settings = useSettings()
  const { primarySport } = usePrimarySport()

  const [activities, setActivities] = useState([])
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todayNutrition, setTodayNutrition] = useState({ kcal: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0, logged: false })
  const [todayNutritionEntries, setTodayNutritionEntries] = useState([])
  const [statFilter, setStatFilter] = useState('All')
  const [backfillStatus, setBackfillStatus] = useState(null)
  const [todayScheduledSessions, setTodayScheduledSessions] = useState([])
  const [tomorrowSession, setTomorrowSession] = useState(null)
  const [checkinDismissed, setCheckinDismissed] = useState(false)
  const [goalPromptDismissed, setGoalPromptDismissed] = useState(false)
  const [readinessNote, setReadinessNote] = useState(null) // { rating, note, date }
  const [generatingReadiness, setGeneratingReadiness] = useState(false)
  const [refreshedBriefing, setRefreshedBriefing] = useState(null) // { text, time }
  const [generatingBriefing, setGeneratingBriefing] = useState(false)
  const [injuryFollowUps, setInjuryFollowUps] = useState([])
  const [injuryFollowUpResults, setInjuryFollowUpResults] = useState({}) // reportId → 'resolved'|'improving'|'worse'
  const [injuryWorseNotes, setInjuryWorseNotes] = useState({}) // reportId → string
  const [injuryWorseExpanded, setInjuryWorseExpanded] = useState({}) // reportId → bool
  const backfillCheckRef = useRef(false)
  const readinessTriggeredRef = useRef(false)

  const load = useCallback(async () => {
    const todayStr = viennaDate()
    const tomorrowStr = viennaDate(86400000)

    const dismissKey = `checkin_dismissed_${todayStr}`
    if (localStorage.getItem(dismissKey)) setCheckinDismissed(true)

    const cachedReadiness = localStorage.getItem(`readiness_note_${todayStr}`)
    if (cachedReadiness) {
      try { setReadinessNote(JSON.parse(cachedReadiness)) } catch (e) { /* ignore */ }
    }

    const [{ data: acts }, { data: brief }, { data: nutri }, { data: allSess }] = await Promise.all([
      supabase.from('activities').select('*').order('date', { ascending: false }).limit(20),
      supabase.from('daily_briefings').select('id, date, briefing_text, created_at').eq('date', todayStr).maybeSingle(),
      supabase.from('nutrition_logs')
        .select('id,calories,protein_g,carbs_g,fat_g,meal_type,meal_name,alcohol_units,logged_at')
        .eq('date', todayStr).order('logged_at', { ascending: true }),
      supabase.from('scheduled_sessions')
        .select('id,session_type,name,zone,duration_min_low,duration_min_high,status,planned_date')
        .gte('planned_date', todayStr).lte('planned_date', tomorrowStr).order('planned_date'),
    ])

    if (acts) setActivities(acts)
    if (brief) setBriefing(brief)

    if (nutri) {
      const food = nutri.filter(n => n.meal_type !== 'alcohol')
      setTodayNutritionEntries(nutri)
      setTodayNutrition({
        kcal: food.reduce((s, n) => s + (n.calories || 0), 0),
        protein: Math.round(food.reduce((s, n) => s + parseFloat(n.protein_g || 0), 0)),
        carbs: Math.round(food.reduce((s, n) => s + parseFloat(n.carbs_g || 0), 0)),
        fat: Math.round(food.reduce((s, n) => s + parseFloat(n.fat_g || 0), 0)),
        alcohol: nutri.filter(n => n.meal_type === 'alcohol').reduce((s, n) => s + parseFloat(n.alcohol_units || 0), 0),
        logged: nutri.length > 0,
      })
    }

    if (allSess) {
      setTodayScheduledSessions(allSess.filter(s => s.planned_date === todayStr))
      setTomorrowSession(allSess.find(s => s.planned_date === tomorrowStr) || null)
    }

    setLoading(false)

    // Load injury follow-ups (non-blocking, after main load)
    getActiveInjuryFollowUps().then(reports => setInjuryFollowUps(reports || [])).catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-backfill on first load if no activities
  useEffect(() => {
    if (backfillCheckRef.current) return
    backfillCheckRef.current = true
    async function checkAndBackfill() {
      const { count } = await supabase.from('activities').select('*', { count: 'exact', head: true })
      if (count === 0) {
        setBackfillStatus('syncing')
        const result = await runBackfill()
        if (result.error) {
          setBackfillStatus('error')
          setTimeout(() => setBackfillStatus(null), 5000)
        } else {
          setBackfillStatus('done')
          load()
          setTimeout(() => setBackfillStatus(null), 3000)
        }
      }
    }
    checkAndBackfill()
  }, [load])

  // Auto-trigger evening readiness note once per day after 8pm
  const hour = viennaHour()
  const isEvening = hour >= 20
  useEffect(() => {
    if (!isEvening) return
    if (readinessTriggeredRef.current) return
    if (readinessNote) return
    if (loading) return
    readinessTriggeredRef.current = true
    generateReadinessNote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEvening, loading, readinessNote])

  async function generateReadinessNote() {
    if (generatingReadiness) return
    setGeneratingReadiness(true)
    try {
      const ctx = await buildContext()
      const contextBlock = formatContext(ctx)
      const todayStr = viennaDate()
      const data = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: buildSystemPrompt(settings),
        messages: [{
          role: 'user',
          content: `${contextBlock}\n\nGive a brief evening readiness assessment based on today's training and nutrition. Respond in JSON only: {"rating":"Good to go|Manageable|Take it easy","note":"One or two sentences. Be specific about what you see in today's data."}`,
        }],
      })
      const rawText = data.content?.[0]?.text || ''
      let parsed = null
      try {
        let cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim()
        if (!cleaned.startsWith('{')) { const m = cleaned.match(/\{[\s\S]*\}/); if (m) cleaned = m[0] }
        parsed = JSON.parse(cleaned)
      } catch (e) { /* ignore */ }
      if (parsed?.rating && parsed?.note) {
        const note = { rating: parsed.rating, note: parsed.note, date: todayStr }
        setReadinessNote(note)
        localStorage.setItem(`readiness_note_${todayStr}`, JSON.stringify(note))
      }
    } catch (e) {
      console.error('readiness note failed:', e)
    }
    setGeneratingReadiness(false)
  }

  async function refreshBriefing() {
    if (generatingBriefing) return
    setGeneratingBriefing(true)
    try {
      const ctx = await buildContext()
      const contextBlock = formatContext(ctx)
      const todayLabel = new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' })
      const data = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: buildSystemPrompt(settings),
        messages: [{
          role: 'user',
          content: `${contextBlock}\n\nGive an updated coaching briefing for ${todayLabel}. Write 3-4 bullet points starting with → covering what matters most right now. Be specific and direct. Plain text only, no markdown.`,
        }],
      })
      const text = data.content?.[0]?.text || ''
      if (text) {
        const time = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
        setRefreshedBriefing({ text, time })
        // Persist to daily_briefings so it survives a session refresh
        const todayStr = viennaDate()
        const { data: { user } } = await supabase.auth.getUser()
        supabase.from('daily_briefings')
          .upsert({ date: todayStr, briefing_text: text, user_id: user?.id }, { onConflict: 'date' })
          .then(() => {})
          .catch(e => console.warn('briefing upsert failed:', e))
      }
    } catch (e) {
      console.error('briefing refresh failed:', e)
    }
    setGeneratingBriefing(false)
  }

  async function dismissGoalPrompt() {
    setGoalPromptDismissed(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('athlete_settings')
          .update({ last_goal_prompt_date: viennaDate() })
          .eq('user_id', user.id)
      }
    } catch (e) {
      console.warn('Could not update last_goal_prompt_date:', e)
    }
  }

  async function handleCheckinAction() {
    const todayStr = viennaDate()
    localStorage.setItem(`checkin_dismissed_${todayStr}`, '1')
    setCheckinDismissed(true)
    const sess = todayScheduledSessions.find(s => s.status === 'planned')
    if (sess?.id) {
      const now = new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
      try {
        await supabase.from('scheduled_sessions').update({ planned_start_time: now }).eq('id', sess.id)
      } catch (e) {
        console.warn('planned_start_time update failed:', e)
      }
    }
  }

  function dismissCheckin() {
    localStorage.setItem(`checkin_dismissed_${viennaDate()}`, '1')
    setCheckinDismissed(true)
  }

  const { containerRef, pullDistance, refreshing } = usePullToRefresh(load)

  // ── Week stats ────────────────────────────────────────────
  const weekStart = new Date()
  const _dow = weekStart.getDay()
  weekStart.setDate(weekStart.getDate() - (_dow === 0 ? 6 : _dow - 1))
  weekStart.setHours(0, 0, 0, 0)
  const weekActs = activities.filter(a => new Date(a.date?.slice(0, 10) + 'T12:00:00') >= weekStart)
  const isRunAct    = a => a.type?.toLowerCase().includes('run')
  const isBikeAct   = a => a.type?.toLowerCase().includes('ride') || a.type?.toLowerCase().includes('cycl') || a.type?.toLowerCase().includes('bike')
  const isStrengthAct = a => a.type?.toLowerCase().includes('weight') || a.type?.toLowerCase().includes('strength') || a.type?.toLowerCase().includes('workout')
  const filteredActs = statFilter === 'Runs' ? weekActs.filter(isRunAct)
    : statFilter === 'Bike' ? weekActs.filter(isBikeAct)
    : statFilter === 'Strength' ? weekActs.filter(isStrengthAct)
    : weekActs
  const weekKm       = filteredActs.reduce((s, a) => s + (parseFloat(a.distance_km) || 0), 0)
  const weekElev     = filteredActs.reduce((s, a) => s + (parseFloat(a.elevation_m) || 0), 0)
  const weekSessions = filteredActs.length
  const weekStrength = weekActs.filter(isStrengthAct).length

  // ── Derived values ────────────────────────────────────────
  const todayStr       = viennaDate()
  const todayActivities = activities.filter(a => a.date?.slice(0, 10) === todayStr)
  const todayActivity   = todayActivities.length > 0

  const isMorning   = hour < 11
  const isAfternoon = hour >= 11 && hour < 20

  const headingDate = new Date().toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const targetDate  = primarySport?.target_date ? new Date(primarySport.target_date) : null
  const daysToRace  = targetDate ? Math.ceil((targetDate - new Date()) / (1000 * 60 * 60 * 24)) : null
  const eventLabel  = primarySport?.current_goal_raw || null
  const lastRun     = activities.find(a => a.type?.toLowerCase().includes('run'))

  // Check-in: first planned session, no activity yet, before 8pm, not dismissed
  const todaySession = todayScheduledSessions.find(s => s.status === 'planned') || null
  const showCheckin  = todaySession && !todayActivity && hour < 20 && !checkinDismissed
  const checkinMsg   = CHECKIN_MSGS[new Date().getDay() % CHECKIN_MSGS.length]

  // Goal prompt
  const races           = settings.races || []
  const lastGoalPrompt  = settings.last_goal_prompt_date
  const daysSincePrompt = lastGoalPrompt
    ? Math.floor((Date.now() - new Date(lastGoalPrompt).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity
  const showGoalPrompt = !goalPromptDismissed && races.length === 0 && daysSincePrompt >= 90 && settings.lifecycle_state != null

  // Active briefing: refreshed state overrides DB; detect stale (not from today)
  const activeBriefingText = refreshedBriefing?.text || briefing?.briefing_text
  const briefingIsToday = briefing?.date === viennaDate()
  const briefingDateLabel = refreshedBriefing
    ? `Updated · ${refreshedBriefing.time}`
    : briefing
      ? briefingIsToday
        ? `Today · ${new Date(briefing.created_at).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })}`
        : new Date(briefing.date || briefing.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      : null
  const briefingIsStale = !refreshedBriefing && briefing && !briefingIsToday

  // ── Injury follow-up handler ─────────────────────────────────────────────────
  async function handleInjuryFollowUp(reportId, feelingBetter) {
    setInjuryFollowUpResults(prev => ({ ...prev, [reportId]: feelingBetter }))
    await handleFollowUpResponse({ injuryReportId: reportId, feelingBetter })
    // Remove from list after a brief delay
    setTimeout(() => {
      setInjuryFollowUps(prev => prev.filter(r => r.id !== reportId))
    }, 2000)
  }

  // ── Inline render helpers (called as functions, not <Components/>) ──────────

  function renderInjuryFollowUpCards() {
    if (injuryFollowUps.length === 0) return null
    return injuryFollowUps.map(report => {
      const result = injuryFollowUpResults[report.id]
      const isWorse = injuryWorseExpanded[report.id]

      // Parse followUpMessage from claude_assessment JSON
      let followUpMsg = 'How is it feeling today?'
      try {
        const parsed = JSON.parse(report.claude_assessment || '{}')
        if (parsed.followUpMessage) followUpMsg = parsed.followUpMessage
      } catch { /* use default */ }

      return (
        <div key={report.id} style={{ margin: '0 20px 12px', background: 'rgba(255,179,71,0.06)', border: '1px solid rgba(255,179,71,0.3)', borderRadius: 12, padding: '14px 16px', fontFamily: "'DM Mono', monospace" }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 14 }}>⚠️</span>
            <div style={{ fontSize: 10, color: '#ffb347', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>Injury check-in</div>
          </div>
          {report.body_location && (
            <div style={{ fontSize: 12, color: '#f0ede8', fontWeight: 500, marginBottom: 4 }}>{report.body_location}</div>
          )}
          <div style={{ fontSize: 12, color: '#888580', lineHeight: 1.5, marginBottom: 12 }}>{followUpMsg}</div>

          {result ? (
            <div style={{ fontSize: 12, color: result === 'resolved' ? '#4dff91' : result === 'improving' ? '#47d4ff' : '#ffb347' }}>
              {result === 'resolved' ? '✓ Marked as resolved' : result === 'improving' ? '✓ Got it — checking in again next week' : '✓ Noted — coach will review'}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => handleInjuryFollowUp(report.id, 'resolved')}
                  style={{ flex: 1, minWidth: 0, padding: '8px 6px', borderRadius: 8, border: '1px solid rgba(77,255,145,0.3)', background: 'rgba(77,255,145,0.06)', color: '#4dff91', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                  Resolved ✅
                </button>
                <button onClick={() => handleInjuryFollowUp(report.id, 'improving')}
                  style={{ flex: 1, minWidth: 0, padding: '8px 6px', borderRadius: 8, border: '1px solid rgba(71,212,255,0.3)', background: 'rgba(71,212,255,0.06)', color: '#47d4ff', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                  Improving 📈
                </button>
                <button onClick={() => setInjuryWorseExpanded(prev => ({ ...prev, [report.id]: !prev[report.id] }))}
                  style={{ flex: 1, minWidth: 0, padding: '8px 6px', borderRadius: 8, border: '1px solid rgba(255,92,92,0.3)', background: 'rgba(255,92,92,0.06)', color: '#ff5c5c', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                  Still sore ⬇️
                </button>
              </div>
              {isWorse && (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    value={injuryWorseNotes[report.id] || ''}
                    onChange={e => setInjuryWorseNotes(prev => ({ ...prev, [report.id]: e.target.value }))}
                    placeholder="Any notes? (optional)"
                    rows={2}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#161616', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '8px 10px', color: '#f0ede8', fontSize: 11, fontFamily: "'DM Mono', monospace", resize: 'none', outline: 'none', marginBottom: 8 }}
                  />
                  <button onClick={() => handleInjuryFollowUp(report.id, 'worse')}
                    style={{ width: '100%', padding: '8px', borderRadius: 8, border: 'none', background: '#ff5c5c', color: '#0a0a0a', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                    Submit
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )
    })
  }

  function renderBriefingLines(text) {
    return text.split('\n').filter(l => l.trim()).map((line, i) => {
      const isHeader = line.startsWith('#')
      const clean = line.replace(/^#+\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^→\s*/, '')
      return (
        <div key={i} style={{ padding: '5px 0 5px 16px', position: 'relative', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
          <span style={{ position: 'absolute', left: 0, color: line.includes('⚠') ? '#ffb347' : '#e8ff47', fontSize: '11px', top: '7px' }}>→</span>
          <span style={{ color: isHeader ? '#e8ff47' : '#c8c5bf', fontWeight: isHeader ? 600 : 400 }}>{clean}</span>
        </div>
      )
    })
  }

  function renderBriefingSection(secondary = false) {
    return (
      <div style={{ ...S.section, ...(secondary ? { paddingTop: 12, paddingBottom: 12 } : {}) }}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>{secondary ? "This morning's briefing" : "Today's Briefing"}</div>
          <button
            onClick={refreshBriefing}
            disabled={generatingBriefing}
            style={{ background: 'none', border: 'none', cursor: generatingBriefing ? 'default' : 'pointer', color: generatingBriefing ? '#555' : '#e8ff47', fontSize: '11px', fontFamily: "'DM Mono', monospace", padding: 0 }}
          >
            {generatingBriefing ? '⟳ Refreshing...' : '↻ Refresh'}
          </button>
        </div>
        <div style={{ ...S.card, ...(secondary ? { background: 'transparent', border: '1px solid rgba(255,255,255,0.08)' } : {}) }}>
          {loading ? (
            <div style={{ color: '#888580', fontSize: '13px' }}>Loading briefing...</div>
          ) : activeBriefingText ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {briefingDateLabel && (
                  <div style={{ ...S.badge, marginBottom: 0, color: briefingIsStale ? '#888580' : '#e8ff47', background: briefingIsStale ? 'rgba(255,255,255,0.06)' : 'rgba(232,255,71,0.12)' }}>
                    {briefingIsStale ? `Last updated ${briefingDateLabel}` : briefingDateLabel}
                  </div>
                )}
                {briefingIsStale && (
                  <button onClick={refreshBriefing} disabled={generatingBriefing} style={{ fontSize: 11, color: '#e8ff47', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0 }}>
                    Tap to refresh →
                  </button>
                )}
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.7, color: briefingIsStale ? '#666' : '#c8c5bf' }}>
                {renderBriefingLines(activeBriefingText)}
              </div>
            </>
          ) : (
            <div style={{ color: '#888580', fontSize: '13px' }}>
              No briefing yet.{' '}
              <button onClick={refreshBriefing} disabled={generatingBriefing} style={{ color: '#e8ff47', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'DM Mono', monospace", fontSize: 13, padding: 0 }}>
                Generate one →
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderTodaySessionsList() {
    if (todayScheduledSessions.length === 0) return null
    return (
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>Today's Sessions</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {todayScheduledSessions.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#111111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}>
              <span style={{ fontSize: 18 }}>{SESSION_ICON[s.session_type] || '📋'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#f0ede8' }}>{s.name}</div>
                {s.zone && (
                  <div style={{ fontSize: 11, color: '#888580' }}>
                    {s.zone}{s.duration_min_low ? ` · ${s.duration_min_low}${s.duration_min_high !== s.duration_min_low ? `–${s.duration_min_high}` : ''}min` : ''}
                  </div>
                )}
              </div>
              {s.status === 'completed' && <span style={{ fontSize: 11, color: '#4dff91' }}>✓ Done</span>}
            </div>
          ))}
          {tomorrowSession && (
            <div style={{ fontSize: 11, color: '#555', paddingTop: 4 }}>Tomorrow: {tomorrowSession.name}</div>
          )}
        </div>
      </div>
    )
  }

  function renderTodaySoFar() {
    const proteinTarget = 150
    const kcalTarget = 2800
    let statusLine = 'Nothing logged yet'
    if (todayActivity && todayNutrition.logged) statusLine = 'Session done + fuelled ✓'
    else if (todayActivity) statusLine = 'Session done — log some food'
    else if (todayNutrition.logged) statusLine = 'Fuelled up — session still pending'

    return (
      <div style={{ margin: '12px 20px 0', padding: '16px', background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12 }}>
        <div style={{ fontSize: 10, color: '#888580', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Today so far</div>

        {todayScheduledSessions.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {todayScheduledSessions.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: s.status === 'completed' ? '#4dff91' : '#888580' }}>
                  {s.status === 'completed' ? '✓' : '○'}
                </span>
                <span style={{ fontSize: 12, color: s.status === 'completed' ? '#f0ede8' : '#888580' }}>{s.name}</span>
              </div>
            ))}
          </div>
        )}

        {todayNutrition.logged && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888580', marginBottom: 4 }}>
              <span>Protein {todayNutrition.protein}g / {proteinTarget}g</span>
              <span>{todayNutrition.kcal} kcal</span>
            </div>
            <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2, marginBottom: 3 }}>
              <div style={{ height: '100%', width: `${Math.min(100, (todayNutrition.protein / proteinTarget) * 100)}%`, background: '#47d4ff', borderRadius: 2, transition: 'width 0.4s' }} />
            </div>
            <div style={{ height: 4, background: '#1a1a1a', borderRadius: 2 }}>
              <div style={{ height: '100%', width: `${Math.min(100, (todayNutrition.kcal / kcalTarget) * 100)}%`, background: '#e8ff47', borderRadius: 2, transition: 'width 0.4s' }} />
            </div>
          </div>
        )}

        <div style={{ fontSize: 11, color: '#888580', fontStyle: 'italic' }}>{statusLine}</div>
      </div>
    )
  }

  function renderLiveFeed() {
    if (todayActivities.length === 0 && todayNutritionEntries.length === 0) return null
    return (
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>Today's Feed</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {todayActivities.map(a => (
            <div
              key={a.id}
              onClick={() => onActivityClick && onActivityClick(a.strava_id)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: '#111111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, cursor: onActivityClick ? 'pointer' : 'default' }}
            >
              <span style={{ fontSize: 18 }}>{activityIcon(a.type)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#f0ede8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</div>
                <div style={{ fontSize: 11, color: '#888580' }}>
                  {a.distance_km ? `${parseFloat(a.distance_km).toFixed(1)}km` : ''}{a.duration_min ? ` · ${Math.round(a.duration_min)}min` : ''}{a.avg_hr ? ` · HR ${Math.round(a.avg_hr)}` : ''}
                </div>
              </div>
              <span style={{ fontSize: 11, color: '#4dff91' }}>✓</span>
            </div>
          ))}
          {todayNutritionEntries.filter(n => n.meal_type !== 'alcohol').map(n => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}>
              <span style={{ fontSize: 16 }}>🍽</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#f0ede8' }}>{n.meal_name || 'Meal'}</div>
                <div style={{ fontSize: 11, color: '#888580' }}>
                  {n.calories ? `${n.calories} kcal` : ''}{n.protein_g ? ` · ${parseFloat(n.protein_g).toFixed(0)}g protein` : ''}
                </div>
              </div>
            </div>
          ))}
          {todayNutritionEntries.filter(n => n.meal_type === 'alcohol').map(n => (
            <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,183,71,0.15)', borderRadius: 8 }}>
              <span style={{ fontSize: 16 }}>🍺</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#f0ede8' }}>{n.meal_name || 'Alcohol'}</div>
                <div style={{ fontSize: 11, color: '#ffb347' }}>{n.alcohol_units} units</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function renderDaySummary() {
    const proteinTarget = 150
    const kcalTarget = 2800
    return (
      <div style={{ margin: '12px 20px 0', padding: '16px', background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12 }}>
        <div style={{ fontSize: 10, color: '#888580', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 14 }}>Day summary</div>

        {/* Sessions done/not done */}
        {(todayScheduledSessions.length > 0 || todayActivities.length > 0) ? (
          <div style={{ marginBottom: 14 }}>
            {todayScheduledSessions.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 13, color: s.status === 'completed' ? '#4dff91' : '#ff5c5c' }}>
                  {s.status === 'completed' ? '✓' : '✗'}
                </span>
                <span style={{ fontSize: 13, color: '#f0ede8' }}>{s.name}</span>
              </div>
            ))}
            {/* Unplanned activities */}
            {todayScheduledSessions.length === 0 && todayActivities.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 13, color: '#4dff91' }}>✓</span>
                <span style={{ fontSize: 13, color: '#f0ede8' }}>{a.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#888580', marginBottom: 14 }}>Rest day — no sessions planned</div>
        )}

        {/* Nutrition grid */}
        {todayNutrition.logged && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
            {[
              { val: todayNutrition.kcal, lbl: 'kcal', numVal: todayNutrition.kcal, target: kcalTarget, col: '#e8ff47' },
              { val: `${todayNutrition.protein}g`, lbl: 'protein', numVal: todayNutrition.protein, target: proteinTarget, col: '#47d4ff' },
              { val: `${todayNutrition.carbs}g`, lbl: 'carbs', col: '#4dff91' },
            ].map(({ val, lbl, numVal, target, col }) => (
              <div key={lbl} style={{ background: '#1a1a1a', borderRadius: 8, padding: '10px 10px 8px' }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '18px', fontWeight: 700, color: col, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: '10px', color: '#888580', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 3 }}>{lbl}</div>
                {target != null && (
                  <div style={{ height: 2, background: '#333', borderRadius: 1, marginTop: 6 }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (numVal / target) * 100)}%`, background: col, borderRadius: 1 }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {todayNutrition.alcohol > 0 && (
          <div style={{ fontSize: 12, color: '#ffb347', marginBottom: 10 }}>🍺 {todayNutrition.alcohol.toFixed(1)} alcohol units today</div>
        )}

        {/* Readiness note */}
        {generatingReadiness && (
          <div style={{ fontSize: 12, color: '#888580', fontStyle: 'italic', marginTop: 4 }}>Assessing readiness...</div>
        )}
        {!generatingReadiness && readinessNote && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ fontSize: 10, color: '#888580', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Tomorrow's readiness</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: READINESS_COLOR[readinessNote.rating] || '#f0ede8', marginBottom: 4 }}>{readinessNote.rating}</div>
            <div style={{ fontSize: 12, color: '#888580', lineHeight: 1.5 }}>{readinessNote.note}</div>
          </div>
        )}
        {!generatingReadiness && !readinessNote && (
          <button
            onClick={generateReadinessNote}
            style={{ marginTop: 10, background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 6, padding: '6px 12px', fontSize: 11, color: '#888580', cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}
          >
            Generate readiness note
          </button>
        )}
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={S.page}>

      {/* PULL-TO-REFRESH */}
      {(pullDistance > 0 || refreshing) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: Math.max(pullDistance, refreshing ? 48 : 0), overflow: 'hidden', transition: refreshing ? 'none' : 'height 0.1s', color: '#888580', fontSize: '12px', letterSpacing: '0.06em' }}>
          {refreshing ? 'Refreshing...' : pullDistance > 72 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}

      <OnboardingHints
        hintId="home_briefing"
        title="Your daily briefing"
        body="Your AI coach generates a personalised briefing each morning based on your recent training. Tap 'Refresh' any time to get an updated view. Pull down to reload today's activity and nutrition data."
        position="bottom"
      />

      {/* BACKFILL STATUS */}
      {backfillStatus && (
        <div style={{ padding: '8px 20px', fontSize: 11, letterSpacing: '0.06em', color: backfillStatus === 'error' ? '#ff5c5c' : '#e8ff47', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {backfillStatus === 'syncing' && '⟳ Syncing Strava history...'}
          {backfillStatus === 'done' && '✓ Strava history synced'}
          {backfillStatus === 'error' && '⚠ Strava sync failed — check Settings'}
        </div>
      )}

      {/* GOAL PROMPT */}
      {showGoalPrompt && (
        <div style={{ margin: '12px 20px 0', padding: '14px 16px', background: 'rgba(232,255,71,0.06)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: 12 }}>
          <div style={{ fontSize: 10, color: '#e8ff47', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Your goals</div>
          <div style={{ fontSize: 14, color: '#f0ede8', fontWeight: 600, marginBottom: 4 }}>No races or events set</div>
          <div style={{ fontSize: 12, color: '#888580', lineHeight: 1.5, marginBottom: 12 }}>Having a goal helps your coach give you more focused, relevant advice. What are you training for?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { dismissGoalPrompt(); onOpenSettings?.() }} style={{ flex: 1, background: '#e8ff47', border: 'none', borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#0a0a0a', fontWeight: 600 }}>Set a goal</button>
            <button onClick={dismissGoalPrompt} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 7, padding: '9px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#888580' }}>Not now</button>
          </div>
        </div>
      )}

      {/* HERO */}
      <div style={S.hero}>
        <div style={S.label}>{headingDate}</div>
        <div style={S.greeting}>
          {primarySport?.lifecycle_state
            ? primarySport.lifecycle_state.charAt(0).toUpperCase() + primarySport.lifecycle_state.slice(1).replace('_', ' ')
            : 'Welcome'}
        </div>
        {(eventLabel || daysToRace) && (
          <div style={S.date}>{eventLabel || 'Your goal'}{daysToRace !== null ? ` · ${daysToRace} days` : ''}</div>
        )}
      </div>

      {/* INJURY FOLLOW-UP CARDS */}
      {renderInjuryFollowUpCards()}

      {/* CHECK-IN CARD (morning + afternoon only) */}
      {!isEvening && showCheckin && (
        <div style={{ margin: '12px 20px 0', padding: '14px 16px', background: '#111111', border: '1px solid rgba(232,255,71,0.2)', borderRadius: 12, position: 'relative' }}>
          <button onClick={dismissCheckin} style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', color: '#888580', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          <div style={{ fontSize: 10, color: '#e8ff47', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            {SESSION_ICON[todaySession.session_type] || '📋'} Today's session
          </div>
          <div style={{ fontSize: 13, color: '#f0ede8', fontWeight: 500, marginBottom: 2 }}>{todaySession.name}</div>
          {todaySession.zone && (
            <div style={{ fontSize: 11, color: '#888580', marginBottom: 8 }}>
              {todaySession.zone}{todaySession.duration_min_low ? ` · ${todaySession.duration_min_low}${todaySession.duration_min_high !== todaySession.duration_min_low ? `–${todaySession.duration_min_high}` : ''}min` : ''}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#888580', lineHeight: 1.5, marginBottom: 12 }}>{checkinMsg}</div>
          <button onClick={handleCheckinAction} style={{ background: '#e8ff47', border: 'none', borderRadius: 7, padding: '8px 16px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#0a0a0a', fontWeight: 600 }}>I'm on it →</button>
        </div>
      )}

      {/* ── MORNING LAYOUT ── */}
      {isMorning && (
        <>
          {renderBriefingSection(false)}
          {renderTodaySessionsList()}
        </>
      )}

      {/* ── AFTERNOON LAYOUT ── */}
      {isAfternoon && (
        <>
          {renderTodaySoFar()}
          {renderBriefingSection(true)}
          {renderLiveFeed()}
        </>
      )}

      {/* ── EVENING LAYOUT ── */}
      {isEvening && (
        <>
          {renderDaySummary()}
          {renderLiveFeed()}
        </>
      )}

      {/* STAT FILTER + STRIP */}
      <div style={{ display: 'flex', gap: '6px', padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', overflowX: 'auto' }}>
        {['All', 'Runs', 'Bike', 'Strength'].map(f => (
          <button key={f} onClick={() => setStatFilter(f)} style={{ background: statFilter === f ? '#e8ff47' : 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '20px', padding: '4px 12px', fontSize: '11px', fontFamily: "'DM Mono', monospace", cursor: 'pointer', color: statFilter === f ? '#0a0a0a' : '#888580', whiteSpace: 'nowrap', fontWeight: statFilter === f ? 600 : 400 }}>{f}</button>
        ))}
      </div>
      <div style={S.statStrip}>
        <div style={S.statCell}>
          <div style={{ ...S.statVal, color: '#e8ff47' }}>{weekKm > 0 ? weekKm.toFixed(1) : weekSessions}</div>
          <div style={S.statLbl}>{weekKm > 0 ? 'km this wk' : 'sessions'}</div>
        </div>
        <div style={S.statCell}>
          <div style={{ ...S.statVal, color: '#47d4ff' }}>{Math.round(weekElev)}</div>
          <div style={S.statLbl}>elev (m)</div>
        </div>
        <div style={S.statCell}>
          <div style={{ ...S.statVal, color: '#4dff91' }}>{weekStrength}</div>
          <div style={S.statLbl}>strength</div>
        </div>
        <div style={S.statCell}>
          <div style={{ ...S.statVal, color: '#ffb347' }}>—</div>
          <div style={S.statLbl}>HRV</div>
        </div>
      </div>

      {/* RECENT ACTIVITIES (non-today) */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>Recent Activities</div>
          <div style={{ fontSize: '11px', color: '#e8ff47' }}>from Strava</div>
        </div>
        {loading ? (
          <div style={{ color: '#888580', fontSize: '13px' }}>Loading activities...</div>
        ) : activities.filter(a => a.date?.slice(0, 10) !== todayStr).length > 0 ? (
          activities.filter(a => a.date?.slice(0, 10) !== todayStr).slice(0, 4).map((a, i) => (
            <ActivityRow key={a.id || i} activity={a} onActivityClick={onActivityClick} />
          ))
        ) : (
          <div style={{ color: '#888580', fontSize: '13px' }}>No recent activities — run workflow to sync from Strava.</div>
        )}
      </div>

      {/* HR ZONES */}
      {lastRun && (
        <div style={S.section}>
          <div style={S.sectionHeader}>
            <div style={S.sectionTitle}>HR Zones · Last Run</div>
          </div>
          <ZoneBar label="Z2 Aerobic" pct={52} color="#47d4ff" value="52%" />
          <ZoneBar label="Z3 Tempo" pct={31} color="#ffb347" value="31%" />
          <ZoneBar label="Z4 Threshold" pct={17} color="#ff5c5c" value="17%" />
        </div>
      )}

      {/* BRIEFING (de-emphasised, evening only) */}
      {isEvening && renderBriefingSection(true)}

    </div>
  )
}
