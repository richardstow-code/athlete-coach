import SessionDetail from '../components/SessionDetail'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/useSettings'
import { buildSystemPrompt, fetchAndBuildPrompt } from '../lib/coachingPrompt'

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY
const SB_URL = 'https://yjuhzmknabedjklsgbje.supabase.co'
const SB_KEY = 'sb_publishable_n2FICu9sGG3FTURxNPUwOw__bbpv_JY'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const typeColor = { run:'#e8ff47', trail:'#47d4ff', strength:'#ffb347', rest:'#888580' }
const typeIcon  = { run:'🏃', trail:'⛰️', strength:'🏋️', rest:'😴' }

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function daysUntil(d) {
  const diff = new Date(d) - new Date()
  return Math.ceil(diff / 86400000)
}
function fmtCountdown(days) {
  if (days < 0) return 'Past'
  if (days === 0) return 'Today!'
  if (days < 7) return `${days}d`
  const w = Math.floor(days / 7), r = days % 7
  if (days < 30) return `${w}w ${r}d`
  const m = Math.floor(days / 30), rd = days % 30
  return `${m}m ${rd}d`
}
function targetPace(timeStr, dist) {
  if (!timeStr || !dist) return null
  const [h, m, s] = timeStr.split(':').map(Number)
  const tot = (h || 0)*3600 + (m || 0)*60 + (s || 0)
  const spk = tot / dist
  return `${Math.floor(spk/60)}:${String(Math.round(spk%60)).padStart(2,'0')}/km`
}

// ── Change Approval Modal ─────────────────────────────────────
function ChangeApprovalModal({ changes, onApprove, onReject, onClose }) {
  const [loadingId, setLoadingId] = useState(null)
  const typeColors = { reschedule: Z.amber, intensity_adjust: Z.accent2, rest_day: Z.green, skip: Z.muted, trip: Z.accent }
  const typeLabels = { reschedule: 'Reschedule', intensity_adjust: 'Intensity adjust', rest_day: 'Rest day', skip: 'Skip session', trip: 'Trip' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)' }} />
      <div style={{ position: 'relative', background: Z.bg, borderRadius: '16px 16px 0 0', border: `1px solid ${Z.border2}`, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: Z.border2, borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 20px 12px', flexShrink: 0, borderBottom: `1px solid ${Z.border}` }}>
          <div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 800 }}>Coach Proposals</div>
            <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
              {changes.length > 0 ? `${changes.length} adjustment${changes.length > 1 ? 's' : ''} to review` : 'All proposals reviewed'}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
        </div>

        {/* Proposals */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 32px' }}>
          {changes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '28px 0', fontSize: 13, color: Z.muted }}>
              All done — schedule updated.
            </div>
          ) : changes.map(c => {
            const col = typeColors[c.change_type] || Z.accent
            const isLoading = loadingId === c.id
            return (
              <div key={c.id} style={{ background: Z.surface, border: `1px solid ${col}35`, borderRadius: 12, padding: 16, marginBottom: 12 }}>
                {/* Type badge */}
                <div style={{ display: 'inline-block', fontSize: 9, color: col, border: `1px solid ${col}50`, borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                  {typeLabels[c.change_type] || c.change_type}
                </div>

                {/* Title */}
                <div style={{ fontSize: 15, fontWeight: 600, color: Z.text, marginBottom: 6, lineHeight: 1.3 }}>{c.title}</div>

                {/* Reasoning */}
                <div style={{ fontSize: 12, color: '#a8a5a0', lineHeight: 1.6, marginBottom: 10 }}>{c.reasoning}</div>

                {/* Change details */}
                {(c.new_date || c.new_notes || c.new_intensity) && (
                  <div style={{ background: '#161616', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
                    {c.new_date && (
                      <div style={{ fontSize: 11, color: col, marginBottom: c.new_notes || c.new_intensity ? 4 : 0 }}>
                        → {new Date(c.new_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                      </div>
                    )}
                    {c.new_intensity && (
                      <div style={{ fontSize: 11, color: Z.muted, marginBottom: c.new_notes ? 4 : 0 }}>Intensity: {c.new_intensity}</div>
                    )}
                    {c.new_notes && (
                      <div style={{ fontSize: 11, color: Z.muted }}>{c.new_notes}</div>
                    )}
                  </div>
                )}

                {/* Race impact */}
                {c.context?.race_impact && (
                  <div style={{ borderLeft: `2px solid ${Z.accent2}`, paddingLeft: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 10, color: Z.accent2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Munich impact</div>
                    <div style={{ fontSize: 12, color: '#a8a5a0', lineHeight: 1.5 }}>{c.context.race_impact}</div>
                  </div>
                )}

                {/* Approve / Reject */}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={isLoading} onClick={async () => { setLoadingId(c.id); await onApprove(c.id); setLoadingId(null) }}
                    style={{ flex: 1, background: isLoading ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: isLoading ? 'wait' : 'pointer', color: isLoading ? Z.muted : Z.bg, fontWeight: 600 }}>
                    {isLoading ? '...' : '✓ Approve'}
                  </button>
                  <button disabled={isLoading} onClick={async () => { setLoadingId(c.id); await onReject(c.id); setLoadingId(null) }}
                    style={{ flex: 1, background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: isLoading ? 'wait' : 'pointer', color: Z.muted }}>
                    ✕ Reject
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Mismatch Prompt ───────────────────────────────────────────
function MismatchPrompt({ analysis, loading, onAdjust, onDismiss }) {
  if (loading) return (
    <div style={{ margin: '0 20px 12px', background: 'rgba(255,179,71,0.07)', border: '1px solid rgba(255,179,71,0.25)', borderRadius: 10, padding: '11px 14px' }}>
      <div style={{ fontSize: 12, color: Z.amber }}>⏳ Coach reviewing today's workout...</div>
    </div>
  )
  if (!analysis) return null
  return (
    <div style={{ margin: '0 20px 12px', background: 'rgba(255,179,71,0.07)', border: '1px solid rgba(255,179,71,0.30)', borderRadius: 10, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: Z.amber, fontWeight: 600 }}>⚡ Today's workout differs from plan</div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 16, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 13, color: Z.text, lineHeight: 1.5, marginBottom: 10 }}>{analysis.summary}</div>
      {analysis.what_changed && (
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '8px 12px', marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>What changed</div>
          <div style={{ fontSize: 12, color: '#c8c5bf', lineHeight: 1.5 }}>{analysis.what_changed}</div>
        </div>
      )}
      {analysis.week_impact && (
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Week impact</div>
          <div style={{ fontSize: 12, color: '#c8c5bf', lineHeight: 1.5 }}>{analysis.week_impact}</div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onAdjust} style={{ flex: 1, background: Z.amber, border: 'none', borderRadius: 8, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.bg, fontWeight: 600 }}>
          Adjust plan
        </button>
        <button onClick={onDismiss} style={{ flex: 1, background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
          Keep as is
        </button>
      </div>
    </div>
  )
}

// ── Change Card ──────────────────────────────────────────────
function ChangeCard({ change, onApprove, onReject }) {
  const [loading, setLoading] = useState(false)
  const typeColors = { reschedule: Z.amber, intensity_adjust: Z.accent2, rest_day: Z.green, skip: Z.muted, trip: Z.accent }
  const col = typeColors[change.change_type] || Z.accent

  return (
    <div style={{ background: Z.surface, border: `1px solid ${col}40`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: col, marginTop: 5, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: Z.text, fontWeight: 600, marginBottom: 3 }}>{change.title}</div>
          <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5 }}>{change.reasoning}</div>
          {change.new_date && (
            <div style={{ fontSize: 11, color: col, marginTop: 6 }}>
              → Proposed date: {new Date(change.new_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>
          )}
          {change.new_notes && (
            <div style={{ fontSize: 11, color: Z.muted, marginTop: 3 }}>Note: {change.new_notes}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button disabled={loading} onClick={async () => { setLoading(true); await onApprove(change.id); setLoading(false) }}
          style={{ flex: 1, background: Z.accent, border: 'none', borderRadius: 8, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.bg, fontWeight: 600 }}>
          ✓ Approve
        </button>
        <button disabled={loading} onClick={async () => { setLoading(true); await onReject(change.id); setLoading(false) }}
          style={{ flex: 1, background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
          ✕ Reject
        </button>
      </div>
    </div>
  )
}

// ── Session Row ───────────────────────────────────────────────
function SessionRow({ session, activity, isToday, onActivityClick, onSessionClick }) {
  const col = typeColor[session.session_type] || Z.muted
  const done = session.status === 'completed' || !!activity
  const skipped = session.status === 'skipped'
  const isPast = new Date(session.planned_date) < new Date() && !isToday

  return (
    <div onClick={() => onSessionClick?.(session)} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: `1px solid ${Z.border}`, opacity: skipped ? 0.5 : 1, cursor: 'pointer' }}>
      <div style={{ width: 38, flexShrink: 0, textAlign: 'center', paddingTop: 2 }}>
        <div style={{ fontSize: 10, color: isToday ? Z.accent : Z.muted, fontWeight: isToday ? 600 : 400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {new Date(session.planned_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' })}
        </div>
        <div style={{ fontSize: 12, color: Z.muted, marginTop: 1 }}>
          {new Date(session.planned_date + 'T12:00:00').getDate()}
        </div>
        <div style={{ fontSize: 18, marginTop: 2 }}>{typeIcon[session.session_type] || '📋'}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: isToday ? Z.text : done ? Z.muted : Z.text, fontWeight: 500, textDecoration: skipped ? 'line-through' : 'none' }}>
              {session.name}
            </div>
            {session.zone && (
              <div style={{ fontSize: 10, color: col, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
                {session.zone} · {session.duration_min_low}{session.duration_min_high !== session.duration_min_low ? `-${session.duration_min_high}` : ''} min
              </div>
            )}
            <div style={{ fontSize: 11, color: '#6b6865', marginTop: 3, lineHeight: 1.4 }}>{session.notes}</div>
          </div>
          {/* Status indicator */}
          <div style={{ width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginLeft: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
            background: done ? 'rgba(77,255,145,0.15)' : isPast && !done ? 'rgba(255,92,92,0.1)' : 'transparent',
            border: `2px solid ${done ? Z.green : isPast && !done ? Z.red : Z.border2}`,
            color: done ? Z.green : isPast && !done ? Z.red : 'transparent' }}>
            {done ? '✓' : isPast && !done ? '!' : ''}
          </div>
        </div>
        {/* Completed activity link */}
        {activity && (
          <div onClick={(e) => { e.stopPropagation(); onActivityClick?.(activity.strava_id) }} style={{ marginTop: 8, display: 'inline-flex', gap: 8, background: 'rgba(77,255,145,0.08)', border: '1px solid rgba(77,255,145,0.2)', borderRadius: 6, padding: '5px 10px', cursor: 'pointer', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: Z.green }}>✓ {activity.name}</span>
            <span style={{ fontSize: 11, color: Z.muted }}>{parseFloat(activity.distance_km||0).toFixed(1)}km · HR {Math.round(activity.avg_hr||0)} →</span>
          </div>
        )}
        {/* Elevation target */}
        {session.elevation_target_m > 0 && (
          <div style={{ fontSize: 11, color: Z.accent2, marginTop: 4 }}>⛰ Target: {session.elevation_target_m}m elev</div>
        )}
      </div>
    </div>
  )
}

// ── Proactive Change Input ────────────────────────────────────
function ProactiveChange({ onSubmit }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    if (!text.trim()) return
    setLoading(true)
    setError(null)
    try {
      await onSubmit(text)
      setText('')
      setOpen(false)
    } catch(e) {
      setError('Something went wrong — try again.')
    }
    setLoading(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ width: '100%', background: 'none', border: `1px dashed ${Z.border2}`, borderRadius: 10, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, color: Z.muted, cursor: 'pointer', textAlign: 'left' }}>
      + Tell coach about changes to your schedule...
    </button>
  )

  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>What's changing? Be specific — schedule, workout done, anything.</div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="e.g. Did an easy 35min run instead of the Z4 intervals — legs were dead. Or: work trip Mon–Wed, Tuesday session missed." style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '8px 10px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
      {error && <div style={{ fontSize: 11, color: Z.red, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          disabled={loading || !text.trim()}
          onMouseDown={e => e.preventDefault()}
          onClick={submit}
          style={{ flex: 1, background: loading ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: loading ? 'wait' : 'pointer', color: Z.bg, fontWeight: 600 }}>
          {loading ? '⏳ Thinking...' : '→ Ask coach'}
        </button>
        <button onMouseDown={e => e.preventDefault()} onClick={() => setOpen(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Race Card ─────────────────────────────────────────────────
function RaceCard({ race }) {
  const days = daysUntil(race.date)
  const pace = targetPace(race.target, parseFloat(race.distance))
  const col = days < 14 ? Z.red : days < 60 ? Z.amber : Z.green
  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 700, color: Z.text }}>{race.name}</div>
          <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>{race.date} · {race.distance}km</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, color: col, lineHeight: 1 }}>{fmtCountdown(days)}</div>
          <div style={{ fontSize: 10, color: Z.muted }}>to go</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 2 }}>Target</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: Z.accent }}>{race.target}</div>
        </div>
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 2 }}>Pace</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: Z.accent2 }}>{pace || '—'}</div>
        </div>
      </div>
    </div>
  )
}

// ── Main Plan Screen ──────────────────────────────────────────
export default function Plan({ onActivityClick }) {
  const settings = useSettings()
  const [sessions, setSessions] = useState([])
  const [activities, setActivities] = useState([])
  const [changes, setChanges] = useState([])
  const [showApprovalModal, setShowApprovalModal] = useState(false)
  const [weekOffset, setWeekOffset] = useState(0)
  const [weekStats, setWeekStats] = useState({ km: 0, elev: 0, runs: 0, strength: 0 })
  const [mismatch, setMismatch] = useState(null)
  const [mismatchLoading, setMismatchLoading] = useState(false)
  const mismatchRef = useRef(false)
  const [selectedSession, setSelectedSession] = useState(null)
  const today = localDateStr(new Date())

  // Week date range
  const weekStart = (() => {
    const d = new Date()
    const dow = d.getDay()
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1) + (weekOffset * 7))
    d.setHours(0,0,0,0)
    return d
  })()
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  weekEnd.setHours(23,59,59,999)

  useEffect(() => {
    const ws = localDateStr(weekStart)
    const we = localDateStr(weekEnd)

    Promise.all([
      supabase.from('scheduled_sessions').select('*').gte('planned_date', ws).lte('planned_date', we).order('planned_date'),
      supabase.from('activities').select('*').gte('date', ws).lte('date', we).order('date'),
      supabase.from('schedule_changes').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
    ]).then(([{data: sess}, {data: acts}, {data: chg}]) => {
      setSessions(sess || [])
      setActivities(acts || [])
      setChanges(chg || [])
      // Stats
      const runs = (acts || []).filter(a => a.type?.toLowerCase().includes('run'))
      setWeekStats({
        km: runs.reduce((s, a) => s + parseFloat(a.distance_km || 0), 0),
        elev: runs.reduce((s, a) => s + parseFloat(a.elevation_m || 0), 0),
        runs: runs.length,
        strength: (acts || []).filter(a => a.type?.toLowerCase().includes('weight')).length,
      })
    })
  }, [weekOffset])

  // Mismatch detection — runs once on mount when current week data is loaded
  useEffect(() => {
    if (weekOffset !== 0) return
    if (mismatchRef.current) return
    if (sessions.length === 0 && activities.length === 0) return
    mismatchRef.current = true
    const todaysSessions = sessions.filter(s => s.planned_date === today)
    const todaysActs = activities.filter(a => a.date?.slice(0,10) === today)
    checkForMismatch(todaysSessions, todaysActs, sessions)
  }, [sessions, activities])

  async function checkForMismatch(todaysSessions, todaysActs, allSessions) {
    const storageKey = `mismatch_v2_${today}`
    if (sessionStorage.getItem(storageKey)) return
    const nonRest = todaysSessions.filter(s => s.session_type !== 'rest')
    if (nonRest.length === 0 || todaysActs.length === 0) return

    const typeMap = { run: ['run','trailrun','trail'], trail: ['trail','trailrun','run'], strength: ['weighttraining','strength'] }

    let isMismatch = false
    for (const s of nonRest) {
      const types = typeMap[s.session_type] || []
      const matchedAct = todaysActs.find(a => types.some(t => a.type?.toLowerCase().includes(t)))

      // Type mismatch — did a completely different activity
      if (!matchedAct) { isMismatch = true; break }

      // Duration mismatch — did less than 75% of planned minimum
      if (s.duration_min_low && matchedAct.duration_sec) {
        if ((matchedAct.duration_sec / 60) < s.duration_min_low * 0.75) { isMismatch = true; break }
      }

      // Intensity mismatch — planned hard (Z4/Z5/threshold) but HR was low, or vice versa
      if (s.zone && matchedAct.avg_hr) {
        const plannedHard = /Z[45]|threshold|tempo/i.test(s.zone + ' ' + (s.intensity || ''))
        const plannedEasy = /Z[12]/i.test(s.zone)
        if (plannedHard && matchedAct.avg_hr < 148) { isMismatch = true; break }
        if (plannedEasy && matchedAct.avg_hr > 158) { isMismatch = true; break }
      }
    }

    if (!isMismatch) { sessionStorage.setItem(storageKey, 'none'); return }
    sessionStorage.setItem(storageKey, 'detected')
    setMismatchLoading(true)
    try {
      const systemPrompt = await fetchAndBuildPrompt(supabase)
      const planned = nonRest.map(s =>
        `${s.name} (${s.session_type}, zone: ${s.zone || 'N/A'}, intensity: ${s.intensity || 'N/A'}, planned: ${s.duration_min_low}–${s.duration_min_high}min)`
      ).join('; ')
      const actual = todaysActs.map(a =>
        `${a.name} (${a.type}, ${parseFloat(a.distance_km||0).toFixed(1)}km, ${a.duration_sec ? Math.round(a.duration_sec/60)+'min' : 'N/A'}, avg HR ${Math.round(a.avg_hr||0)}, elev ${Math.round(a.elevation_m||0)}m)`
      ).join('; ')
      const upcoming = allSessions.filter(s => s.planned_date > today).slice(0, 5).map(s => `${s.planned_date}: ${s.name} (${s.session_type}, ${s.zone || s.intensity})`).join('\n')
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 600,
          system: systemPrompt + '\n\nTask: analyse a training mismatch. Respond ONLY with valid JSON: {"summary": "one sentence", "what_changed": "what was planned vs what actually happened, including intensity and duration differences", "week_impact": "how this affects the rest of the week and Munich prep", "proposals": [{"title": "...", "reasoning": "...", "change_type": "reschedule|skip|intensity_adjust|rest_day", "original_date": "YYYY-MM-DD or null", "new_date": "YYYY-MM-DD or null", "new_notes": "string or null", "new_intensity": "string or null", "race_impact": "one sentence"}]}',
          messages: [{ role: 'user', content: `Planned today: ${planned}\nActual done: ${actual}\n\nUpcoming sessions this week:\n${upcoming}\n\nAnalyse the mismatch — consider type, intensity (HR vs zone), and duration differences. Propose adjustments if needed.` }]
        })
      })
      const data = await resp.json()
      const raw = data.content[0].text.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(raw)
      setMismatch(parsed)
    } catch(e) { console.error('Mismatch check failed', e) }
    setMismatchLoading(false)
  }

  async function applyMismatchProposals() {
    if (!mismatch?.proposals?.length) return
    for (const p of mismatch.proposals) {
      let origId = null
      if (p.original_date) {
        const match = sessions.find(s => s.planned_date === p.original_date)
        origId = match?.id || null
      }
      await supabase.from('schedule_changes').insert({
        status: 'pending',
        change_type: p.change_type,
        title: p.title,
        reasoning: p.reasoning,
        proposed_by: 'coach',
        original_session_id: origId,
        new_date: p.new_date || null,
        new_notes: p.new_notes || null,
        new_intensity: p.new_intensity || null,
        context: { race_impact: p.race_impact || null },
      })
    }
    const { data: newChanges } = await supabase.from('schedule_changes').select('*').eq('status', 'pending').order('created_at', { ascending: false })
    setChanges(newChanges || [])
    setMismatch(null)
    setShowApprovalModal(true)
  }

  // Match activity to session by date + type
  function matchActivity(session) {
    const typeMap = { run: ['run','trailrun','trail'], trail: ['trail','trailrun','run'], strength: ['weighttraining','strength'], rest: [] }
    const types = typeMap[session.session_type] || []
    return activities.find(a => {
      const aDate = a.date?.slice(0,10)
      return aDate === session.planned_date && types.some(t => a.type?.toLowerCase().includes(t))
    })
  }

  async function approveChange(changeId) {
    const change = changes.find(c => c.id === changeId)
    // Apply the change to scheduled_sessions if it has an original session
    if (change.original_session_id) {
      const update = {}
      if (change.new_date) update.planned_date = change.new_date
      if (change.new_name) update.name = change.new_name
      if (change.new_notes) update.notes = change.new_notes
      if (change.new_intensity) update.intensity = change.new_intensity
      if (change.new_duration_low) update.duration_min_low = change.new_duration_low
      if (change.new_duration_high) update.duration_min_high = change.new_duration_high
      if (Object.keys(update).length > 0) {
        await supabase.from('scheduled_sessions').update(update).eq('id', change.original_session_id)
      }
    }
    // If it's a new session proposal, insert it
    if (change.change_type === 'add_session' && change.context?.new_session) {
      await supabase.from('scheduled_sessions').insert(change.context.new_session)
    }
    await supabase.from('schedule_changes').update({ status: 'approved', resolved_at: new Date().toISOString(), resolved_by: 'athlete' }).eq('id', changeId)
    setChanges(prev => prev.filter(c => c.id !== changeId))
  }

  async function rejectChange(changeId) {
    await supabase.from('schedule_changes').update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: 'athlete' }).eq('id', changeId)
    setChanges(prev => prev.filter(c => c.id !== changeId))
  }

  // Modal-aware wrappers — auto-close when last proposal is resolved
  async function modalApprove(id) {
    await approveChange(id)
    if (changes.length <= 1) setShowApprovalModal(false)
  }
  async function modalReject(id) {
    await rejectChange(id)
    if (changes.length <= 1) setShowApprovalModal(false)
  }

  async function handleProactiveChange(text) {
    const upcomingSess = sessions.map(s => `${s.planned_date} (${new Date(s.planned_date + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'short'})}): ${s.name} — ${s.notes || ''}`).join('\n')

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: buildSystemPrompt(settings) + '\n\nTask: propose schedule adjustments for the change described. Respond ONLY with valid JSON, no other text: {"proposals": [{"title": "...", "reasoning": "...", "change_type": "reschedule|skip|intensity_adjust|rest_day", "original_date": "YYYY-MM-DD or null", "new_date": "YYYY-MM-DD or null", "new_notes": "string or null", "new_intensity": "string or null", "race_impact": "one sentence on how this affects Munich preparation"}]}',
        messages: [{ role: 'user', content: `Athlete says: "${text}"\n\nCurrent week schedule:\n${upcomingSess}\n\nPropose schedule changes to accommodate this.` }]
      })
    })
    const data = await resp.json()
    const raw = data.content[0].text.replace(/```json|```/g, '').trim()
    try {
      const parsed = JSON.parse(raw)
      for (const p of parsed.proposals || []) {
        let origId = null
        if (p.original_date) {
          const match = sessions.find(s => s.planned_date === p.original_date)
          origId = match?.id || null
        }
        await supabase.from('schedule_changes').insert({
          status: 'pending',
          change_type: p.change_type,
          title: p.title,
          reasoning: p.reasoning,
          proposed_by: 'coach',
          original_session_id: origId,
          new_date: p.new_date || null,
          new_notes: p.new_notes || null,
          new_intensity: p.new_intensity || null,
          context: { race_impact: p.race_impact || null },
        })
      }
      const { data: newChanges } = await supabase.from('schedule_changes').select('*').eq('status', 'pending').order('created_at', { ascending: false })
      setChanges(newChanges || [])
      setShowApprovalModal(true)
    } catch(e) { console.error('Parse error', e); throw e }
  }

  const races = settings.races || []
  const weekLabel = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const plannedRuns = sessions.filter(s => s.session_type === 'run' || s.session_type === 'trail').length
  const plannedStrength = sessions.filter(s => s.session_type === 'strength').length

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontFamily: "'DM Mono', monospace" }}>

      {/* RACES */}
      <div style={{ padding: '14px 20px 0' }}>
        {races.length > 0
          ? races.sort((a,b) => new Date(a.date) - new Date(b.date)).map((r,i) => <RaceCard key={i} race={r} />)
          : <RaceCard race={{ name: 'Munich Marathon', date: '2026-10-12', distance: '42.2', target: '3:10:00' }} />
        }
        {races.length === 0 && <div style={{ fontSize: 11, color: Z.muted, marginTop: -4, marginBottom: 10 }}>Add your races in Settings 👤</div>}
      </div>

      {/* MISMATCH PROMPT */}
      {(mismatchLoading || mismatch) && weekOffset === 0 && (
        <MismatchPrompt
          analysis={mismatch}
          loading={mismatchLoading}
          onAdjust={applyMismatchProposals}
          onDismiss={() => setMismatch(null)}
        />
      )}

      {/* PENDING CHANGES — tap to open approval modal */}
      {changes.length > 0 && (
        <div style={{ padding: '0 20px 4px' }}>
          <button onClick={() => setShowApprovalModal(true)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,92,92,0.07)', border: '1px solid rgba(255,92,92,0.25)', borderRadius: 10, padding: '11px 14px', cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: Z.red, display: 'inline-block', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: Z.text, fontWeight: 500 }}>
                {changes.length} coach proposal{changes.length > 1 ? 's' : ''} pending
              </span>
            </div>
            <span style={{ fontSize: 11, color: Z.muted }}>Review →</span>
          </button>
        </div>
      )}

      {/* PROACTIVE CHANGE INPUT */}
      <div style={{ padding: '0 20px 12px' }}>
        <ProactiveChange onSubmit={handleProactiveChange} />
      </div>

      {/* WEEK NAV */}
      <div style={{ padding: '10px 20px', borderTop: `1px solid ${Z.border}`, borderBottom: `1px solid ${Z.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '4px 12px', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>← prev</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: Z.text, fontWeight: 500 }}>{weekLabel}</div>
          <div style={{ fontSize: 10, color: Z.muted, marginTop: 1 }}>{weekStats.runs}/{plannedRuns} runs · {weekStats.km.toFixed(1)}km · {weekStats.elev}m elev</div>
        </div>
        <button onClick={() => setWeekOffset(w => Math.min(4, w + 1))} disabled={weekOffset >= 4} style={{ background: 'none', border: `1px solid ${weekOffset >= 4 ? Z.border : Z.border2}`, borderRadius: 6, padding: '4px 12px', color: weekOffset >= 4 ? '#333' : Z.muted, fontSize: 11, cursor: weekOffset >= 4 ? 'default' : 'pointer', fontFamily: "'DM Mono', monospace" }}>next →</button>
      </div>

      {/* PROGRESS BARS */}
      <div style={{ padding: '10px 20px', borderBottom: `1px solid ${Z.border}` }}>
        {[
          { label: 'Runs', val: weekStats.runs, target: plannedRuns, col: Z.accent },
          { label: 'km', val: Math.round(weekStats.km), target: 32, col: Z.accent2 },
          { label: 'Strength', val: weekStats.strength, target: plannedStrength || 2, col: Z.amber },
        ].map(({ label, val, target, col }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
            <div style={{ width: 56, fontSize: 10, color: Z.muted, textAlign: 'right', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
            <div style={{ flex: 1, height: 4, background: '#1a1a1a', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, target > 0 ? Math.round((val/target)*100) : 0)}%`, background: col, borderRadius: 2, transition: 'width 0.4s' }} />
            </div>
            <div style={{ fontSize: 11, color: col, width: 36, flexShrink: 0, textAlign: 'right' }}>{val}/{target}</div>
          </div>
        ))}
      </div>

      {/* SESSION LIST */}
      <div style={{ padding: '0 20px 32px' }}>
        {sessions.length === 0 ? (
          <div style={{ padding: '20px 0', color: Z.muted, fontSize: 13 }}>No sessions scheduled for this week.</div>
        ) : sessions.map(s => (
          <SessionRow key={s.id} session={s} activity={matchActivity(s)} isToday={s.planned_date === today} onActivityClick={onActivityClick} onSessionClick={matchActivity(s) ? undefined : setSelectedSession} />
        ))}
      </div>

      {/* SESSION DETAIL */}
      {selectedSession && <SessionDetail session={selectedSession} onClose={() => setSelectedSession(null)} />}

      {/* CHANGE APPROVAL MODAL */}
      {showApprovalModal && (
        <ChangeApprovalModal
          changes={changes}
          onApprove={modalApprove}
          onReject={modalReject}
          onClose={() => setShowApprovalModal(false)}
        />
      )}
    </div>
  )
}
