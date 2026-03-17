import SessionDetail from '../components/SessionDetail'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/useSettings'

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

  async function submit() {
    if (!text.trim()) return
    setLoading(true)
    await onSubmit(text)
    setText('')
    setOpen(false)
    setLoading(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ width: '100%', background: 'none', border: `1px dashed ${Z.border2}`, borderRadius: 10, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, color: Z.muted, cursor: 'pointer', textAlign: 'left' }}>
      + Tell coach about changes to your schedule...
    </button>
  )

  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>What's changing? Be specific.</div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} placeholder="e.g. I have a work trip Monday to Wednesday, back Thursday evening. Tuesday's quality session will be missed." style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '8px 10px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={loading || !text.trim()} onClick={submit} style={{ flex: 1, background: loading ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: loading ? 'wait' : 'pointer', color: Z.bg, fontWeight: 600 }}>
          {loading ? '⏳ Thinking...' : '→ Ask coach'}
        </button>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '9px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
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
  const [weekOffset, setWeekOffset] = useState(0)
  const [weekStats, setWeekStats] = useState({ km: 0, elev: 0, runs: 0, strength: 0 })
  const today = new Date().toISOString().slice(0, 10)

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

  async function handleProactiveChange(text) {
    // Get upcoming week sessions for context
    const upcomingSess = sessions.map(s => `${s.planned_date} (${new Date(s.planned_date + 'T12:00:00').toLocaleDateString('en-GB', {weekday:'short'})}): ${s.name} — ${s.notes || ''}`).join('\n')

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
        system: 'You are a running coach managing a training schedule for a Munich Marathon athlete (target sub-3:10, base build phase). Given a schedule change request, propose specific adjustments. Respond ONLY with valid JSON: {"proposals": [{"title": "...", "reasoning": "...", "change_type": "reschedule|skip|intensity_adjust|rest_day", "original_date": "YYYY-MM-DD or null", "new_date": "YYYY-MM-DD or null", "new_notes": "string or null", "new_intensity": "string or null"}]}',
        messages: [{ role: 'user', content: `Athlete says: "${text}"\n\nCurrent week schedule:\n${upcomingSess}\n\nPropose schedule changes to accommodate this.` }]
      })
    })
    const data = await resp.json()
    const raw = data.content[0].text.replace(/```json|```/g, '').trim()
    try {
      const parsed = JSON.parse(raw)
      for (const p of parsed.proposals || []) {
        // Find matching session if original_date given
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
        })
      }
      // Refresh
      const { data: newChanges } = await supabase.from('schedule_changes').select('*').eq('status', 'pending').order('created_at', { ascending: false })
      setChanges(newChanges || [])
    } catch(e) { console.error('Parse error', e) }
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

      {/* PENDING CHANGES */}
      {changes.length > 0 && (
        <div style={{ padding: '0 20px', marginBottom: 4 }}>
          <div style={{ fontSize: 11, color: Z.red, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: Z.red, display: 'inline-block' }} />
            {changes.length} coach proposal{changes.length > 1 ? 's' : ''} pending
          </div>
          {changes.map(c => <ChangeCard key={c.id} change={c} onApprove={approveChange} onReject={rejectChange} />)}
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
          <SessionRow key={s.id} session={s} activity={matchActivity(s)} isToday={s.planned_date === today} onActivityClick={onActivityClick} />
        ))}
      </div>
    </div>
  )
}
