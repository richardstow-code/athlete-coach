import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/useSettings'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

// Phase definition — TODO: move to athlete_settings when multi-phase editing lands
const PHASE_START = new Date('2026-03-02') // Monday week 1 of Base Build
const PHASE_NAME  = 'Base Build'
const PHASE_WEEKS = 9

const PENDING = [
  { text: '5km time trial — week of 17 Mar (zone calibration)', warn: false },
  { text: 'Strength benchmark — squat 3RM, pull-up max, plank hold', warn: false },
  { text: 'Book physio for right shoulder — before end March', warn: true },
  { text: 'Ultra race decision — confirm or close door by end April', warn: false },
]

// ── Helpers ───────────────────────────────────────────────────
function fmtPaceSec(s) {
  if (!s || !isFinite(s)) return '—'
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}
function parsePaceStr(str) {
  if (!str) return null
  const [m, s] = str.split(':').map(Number)
  return m * 60 + (s || 0)
}
function parseTimeStr(t) {
  if (!t) return 0
  const parts = t.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}
function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-')
}
function getWeekBounds() {
  const start = new Date()
  const dow = start.getDay()
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1))
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

// ── SVG Pace Trend Chart ──────────────────────────────────────
function PaceChart({ weeks, targetPaceSec }) {
  const withData = weeks.filter(w => w.paceSeconds != null)
  if (withData.length < 2) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: Z.muted }}>
        Needs 2+ weeks of run data — check back soon
      </div>
    )
  }

  const VW = 300, VH = 110
  const P = { l: 6, r: 8, t: 14, b: 18 }
  const iW = VW - P.l - P.r
  const iH = VH - P.t - P.b

  const allP = withData.map(w => w.paceSeconds)
  const minP = Math.min(...allP, targetPaceSec) - 20
  const maxP = Math.max(...allP, targetPaceSec) + 20

  const xOf = i  => P.l + (i / (weeks.length - 1)) * iW
  // faster (lower seconds) = lower Y value = higher on screen
  const yOf = sec => P.t + ((sec - minP) / (maxP - minP)) * iH

  const targetY = yOf(targetPaceSec)

  // Build polyline segments, splitting on null weeks
  const segments = []
  let seg = []
  weeks.forEach((w, i) => {
    if (w.paceSeconds != null) {
      seg.push(`${xOf(i).toFixed(1)},${yOf(w.paceSeconds).toFixed(1)}`)
    } else if (seg.length) {
      segments.push(seg); seg = []
    }
  })
  if (seg.length) segments.push(seg)

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', overflow: 'visible' }}>
      {/* Target line */}
      <line x1={P.l} y1={targetY} x2={VW - P.r} y2={targetY}
        stroke={Z.accent} strokeWidth="0.8" strokeDasharray="4,3" opacity="0.8" />
      <text x={VW - P.r} y={targetY - 3} fill={Z.accent} fontSize="7" textAnchor="end" opacity="0.9">
        {fmtPaceSec(targetPaceSec)} target
      </text>

      {/* Trend lines */}
      {segments.map((s, i) => (
        <polyline key={i} points={s.join(' ')} fill="none" stroke={Z.accent2} strokeWidth="1.5" strokeLinejoin="round" />
      ))}

      {/* Dots + labels */}
      {weeks.map((w, i) => w.paceSeconds == null ? null : (
        <g key={i}>
          <circle cx={xOf(i)} cy={yOf(w.paceSeconds)} r={w.isCurrent ? 4.5 : 3}
            fill={Z.accent2} opacity={w.isCurrent ? 1 : 0.65} />
          <text x={xOf(i)} y={yOf(w.paceSeconds) - 6} textAnchor="middle"
            fill={Z.text} fontSize="6.5" opacity={w.isCurrent ? 1 : 0.55}>
            {fmtPaceSec(w.paceSeconds)}
          </text>
        </g>
      ))}

      {/* Week labels */}
      {weeks.map((w, i) => (
        <text key={i} x={xOf(i)} y={VH - 2} textAnchor="middle"
          fill={w.isCurrent ? Z.accent : Z.muted} fontSize="7.5"
          fontWeight={w.isCurrent ? '600' : '400'}>
          {w.label}
        </text>
      ))}
    </svg>
  )
}

// ── Volume bars ───────────────────────────────────────────────
function VolumeBars({ weeks }) {
  const maxKm = Math.max(...weeks.map(w => w.km), 35)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 64 }}>
      {weeks.map((w, i) => {
        const barH = maxKm > 0 && w.km > 0 ? Math.max((w.km / maxKm) * 100, 4) : 0
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, height: '100%', justifyContent: 'flex-end' }}>
            {w.km > 0 && (
              <div style={{ fontSize: 7.5, color: w.isCurrent ? Z.accent : Z.muted, lineHeight: 1 }}>
                {Math.round(w.km)}
              </div>
            )}
            <div style={{
              width: '100%', height: `${barH}%`, minHeight: w.km > 0 ? 3 : 0,
              background: w.isCurrent ? Z.accent : (w.km > 0 ? '#1e1e1e' : '#141414'),
              borderTop: w.km > 0 && !w.isCurrent ? `1.5px solid ${Z.accent2}` : 'none',
              borderRadius: '2px 2px 0 0', transition: 'height 0.4s',
            }} />
            <div style={{ fontSize: 7.5, color: w.isCurrent ? Z.accent : Z.muted }}>
              {w.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Phase progress ────────────────────────────────────────────
function PhaseProgress({ name, week, totalWeeks }) {
  const pct = Math.min(100, (week / totalWeeks) * 100)
  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 700, color: Z.text }}>{name}</div>
        <div style={{ fontSize: 11, color: Z.muted }}>Wk {week} / {totalWeeks}</div>
      </div>
      <div style={{ height: 6, background: '#1a1a1a', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: Z.accent, borderRadius: 3, transition: 'width 0.6s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: Z.muted }}>
        <span>Wk 1</span>
        <span>{Math.round(pct)}% complete</span>
        <span>Wk {totalWeeks}</span>
      </div>
    </div>
  )
}

// ── Session list (this week) ──────────────────────────────────
function SessionList({ sessions, weekActs }) {
  const typeIcon = { run: '🏃', trail: '⛰️', strength: '🏋️', rest: '😴' }
  const typeMap  = { run: ['run','trailrun'], trail: ['trail','trailrun','run'], strength: ['weighttraining','strength'], rest: [] }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sessions.filter(s => s.session_type !== 'rest').map(s => {
        const types   = typeMap[s.session_type] || []
        const done    = s.status === 'completed' || weekActs.some(a =>
          a.date?.slice(0, 10) === s.planned_date && types.some(t => a.type?.toLowerCase().includes(t)))
        const missed  = new Date(s.planned_date) < new Date() && !done
        return (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', background: Z.surface, borderRadius: 8,
            border: `1px solid ${done ? 'rgba(77,255,145,0.2)' : missed ? 'rgba(255,92,92,0.15)' : Z.border2}`,
            opacity: missed ? 0.55 : 1,
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11,
              background: done ? 'rgba(77,255,145,0.1)' : 'transparent',
              border: `1.5px solid ${done ? Z.green : missed ? Z.red : Z.border2}`,
              color: done ? Z.green : missed ? Z.red : 'transparent',
            }}>
              {done ? '✓' : missed ? '!' : ''}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: done ? Z.muted : Z.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {typeIcon[s.session_type]} {s.name}
              </div>
              <div style={{ fontSize: 10, color: Z.muted, marginTop: 1 }}>
                {new Date(s.planned_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                {s.zone ? ` · ${s.zone}` : ''}
                {s.duration_min_low ? ` · ${s.duration_min_low}–${s.duration_min_high}min` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Target bar ────────────────────────────────────────────────
function TargetBar({ label, numVal, displayVal, target, col, warn }) {
  const pct = Math.min(100, target > 0 ? (numVal / target) * 100 : 0)
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: Z.muted, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: warn ? Z.amber : col }}>{displayVal}{warn ? ' ⚠' : ''}</span>
      </div>
      <div style={{ height: 5, background: '#1a1a1a', borderRadius: 3 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: warn ? Z.amber : col, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function Progress({ onActivityClick }) {
  const settings   = useSettings()
  const [activities,   setActivities]   = useState([])
  const [weekSessions, setWeekSessions] = useState([])
  const [loading,      setLoading]      = useState(true)
  const [view,         setView]         = useState('macro')

  useEffect(() => {
    const { start, end } = getWeekBounds()
    Promise.all([
      supabase.from('activities').select('*').order('date', { ascending: false }).limit(100),
      supabase.from('scheduled_sessions').select('*')
        .gte('planned_date', localDateStr(start))
        .lte('planned_date', localDateStr(end))
        .order('planned_date'),
    ]).then(([{ data: acts }, { data: sessions }]) => {
      setActivities(acts || [])
      setWeekSessions(sessions || [])
      setLoading(false)
    })
  }, [])

  const now = new Date()

  // Primary race
  const primaryRace = settings.races?.length > 0
    ? [...settings.races].sort((a, b) => new Date(a.date) - new Date(b.date))[0]
    : { name: 'Munich Marathon', date: '2026-10-12', distance: '42.2', target: '3:10:00' }
  const daysToRace    = Math.ceil((new Date(primaryRace.date) - now) / 86400000)
  const targetPaceSec = parseTimeStr(primaryRace.target) / parseFloat(primaryRace.distance || 42.2)

  // 8-week chart data
  const chartWeeks = []
  for (let w = 7; w >= 0; w--) {
    const start = new Date(now)
    const sd = start.getDay()
    start.setDate(start.getDate() - (sd === 0 ? 6 : sd - 1) - w * 7)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999)

    const wRuns = activities.filter(a => {
      const d = new Date(a.date)
      return a.type?.toLowerCase().includes('run') && parseFloat(a.distance_km) >= 3 && d >= start && d <= end
    })
    const paces   = wRuns.filter(a => a.pace_per_km).map(a => parsePaceStr(a.pace_per_km)).filter(Boolean)
    const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : null
    const km      = parseFloat(wRuns.reduce((s, a) => s + parseFloat(a.distance_km || 0), 0).toFixed(1))

    chartWeeks.push({ label: `W${8 - w}`, paceSeconds: avgPace, km, isCurrent: w === 0 })
  }

  // This week stats
  const { start: weekStart } = getWeekBounds()
  const weekActs     = activities.filter(a => new Date(a.date) >= weekStart)
  const weekKm       = weekActs.reduce((s, a) => s + parseFloat(a.distance_km || 0), 0)
  const weekElev     = weekActs.reduce((s, a) => s + parseFloat(a.elevation_m || 0), 0)
  const weekStrength = weekActs.filter(a => a.type?.toLowerCase().includes('weight')).length

  // Phase
  const phaseWeek = Math.max(1, Math.min(PHASE_WEEKS, Math.ceil((now - PHASE_START) / (7 * 86400000))))

  // Season total km (from phase start)
  const seasonKm = activities
    .filter(a => a.type?.toLowerCase().includes('run') && new Date(a.date) >= PHASE_START)
    .reduce((s, a) => s + parseFloat(a.distance_km || 0), 0)

  // Sessions this week
  const typeMap = { run: ['run','trailrun'], trail: ['trail','trailrun','run'], strength: ['weighttraining','strength'], rest: [] }
  const nonRestSessions = weekSessions.filter(s => s.session_type !== 'rest')
  const sessCompleted   = nonRestSessions.filter(s => {
    const types = typeMap[s.session_type] || []
    return s.status === 'completed' || weekActs.some(a =>
      a.date?.slice(0, 10) === s.planned_date && types.some(t => a.type?.toLowerCase().includes(t)))
  }).length

  // PBs
  const runActs  = activities.filter(a => a.type?.toLowerCase().includes('run'))
  const pbLongest = runActs.reduce((b, a) => parseFloat(a.distance_km) > parseFloat(b?.distance_km || 0) ? a : b, null)
  const pbFastest = runActs.filter(a => parseFloat(a.distance_km) >= 5 && a.pace_per_km)
    .reduce((b, a) => (parsePaceStr(a.pace_per_km) || Infinity) < (parsePaceStr(b?.pace_per_km) || Infinity) ? a : b, null)
  const pbElev    = runActs.reduce((b, a) => parseFloat(a.elevation_m) > parseFloat(b?.elevation_m || 0) ? a : b, null)

  return (
    <div style={{ overflowY: 'auto', height: '100%', fontFamily: "'DM Mono', monospace" }}>

      {/* HEADER + TOGGLE */}
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${Z.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700 }}>Progress</div>
        <div style={{ display: 'flex', background: '#161616', borderRadius: 8, padding: 2 }}>
          {['macro', 'micro'].map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '5px 16px', borderRadius: 6, border: 'none',
              background: view === v ? Z.accent : 'none',
              color: view === v ? Z.bg : Z.muted,
              fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
              fontWeight: view === v ? 600 : 400, textTransform: 'uppercase',
              letterSpacing: '0.04em', transition: 'all 0.15s',
            }}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── MACRO VIEW ── */}
      {view === 'macro' && (
        <>
          {/* Race target */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Target race</div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 700 }}>{primaryRace.name}</div>
                <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>{primaryRace.date} · {primaryRace.distance}km</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 28, fontWeight: 800, lineHeight: 1, color: daysToRace < 60 ? Z.red : daysToRace < 120 ? Z.amber : Z.accent }}>
                  {daysToRace}
                </div>
                <div style={{ fontSize: 10, color: Z.muted }}>days to go</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: '#161616', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 2 }}>Target pace</div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: Z.accent }}>{fmtPaceSec(targetPaceSec)}/km</div>
              </div>
              <div style={{ background: '#161616', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 2 }}>Phase km</div>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: Z.accent2 }}>{Math.round(seasonKm)}km</div>
              </div>
            </div>
          </div>

          {/* Pace trajectory */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
            <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Avg run pace · 8 weeks
            </div>
            <PaceChart weeks={chartWeeks} targetPaceSec={targetPaceSec} />
            <div style={{ fontSize: 10, color: '#444', marginTop: 6, lineHeight: 1.4 }}>
              Faster = higher. Dots trend up as training pace approaches the target line.
            </div>
          </div>

          {/* Volume */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
            <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Weekly volume · km
            </div>
            <VolumeBars weeks={chartWeeks} />
          </div>
        </>
      )}

      {/* ── MICRO VIEW ── */}
      {view === 'micro' && (
        <>
          {/* Phase */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
            <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Training phase</div>
            <PhaseProgress name={PHASE_NAME} week={phaseWeek} totalWeeks={PHASE_WEEKS} />
          </div>

          {/* This week sessions */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>This week</div>
              <div style={{ fontSize: 12, color: sessCompleted === nonRestSessions.length && nonRestSessions.length > 0 ? Z.green : Z.accent }}>
                {sessCompleted}/{nonRestSessions.length} done
              </div>
            </div>
            {loading ? (
              <div style={{ color: Z.muted, fontSize: 13 }}>Loading...</div>
            ) : nonRestSessions.length === 0 ? (
              <div style={{ color: Z.muted, fontSize: 13 }}>No sessions scheduled this week.</div>
            ) : (
              <SessionList sessions={weekSessions} weekActs={weekActs} />
            )}
          </div>

          {/* Weekly targets */}
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
            <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>vs targets</div>
            <TargetBar label="km (target 28–35)" numVal={weekKm} displayVal={`${weekKm.toFixed(1)}km`} target={35} col={Z.accent} />
            <TargetBar label="elevation (target 100–200m)" numVal={weekElev} displayVal={`${Math.round(weekElev)}m`} target={200} col={Z.accent} warn={weekElev > 200} />
            <TargetBar label="strength sessions (min 2)" numVal={weekStrength} displayVal={`${weekStrength} sessions`} target={2} col={Z.green} />
          </div>
        </>
      )}

      {/* PERSONAL BESTS — always shown */}
      <div style={{ padding: '20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: '11px', color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>Personal Bests</div>
        {loading ? (
          <div style={{ color: Z.muted, fontSize: 13 }}>Loading...</div>
        ) : runActs.length === 0 ? (
          <div style={{ color: Z.muted, fontSize: 13 }}>No run activities yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              pbLongest && { label: 'Longest Run',        val: `${parseFloat(pbLongest.distance_km).toFixed(1)}km`, sub: pbLongest.name, id: pbLongest.strava_id, col: Z.accent },
              pbFastest && { label: 'Fastest Pace (5km+)', val: `${pbFastest.pace_per_km}/km`, sub: `${parseFloat(pbFastest.distance_km).toFixed(1)}km · ${pbFastest.name}`, id: pbFastest.strava_id, col: Z.green },
              pbElev    && { label: 'Most Elevation',      val: `${Math.round(pbElev.elevation_m)}m`, sub: pbElev.name, id: pbElev.strava_id, col: Z.accent2 },
            ].filter(Boolean).map((pb, i) => (
              <div key={i} onClick={() => pb.id && onActivityClick?.(pb.id)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: '12px 14px', cursor: pb.id ? 'pointer' : 'default' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{pb.label}</div>
                  <div style={{ fontSize: 12, color: Z.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pb.sub}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12 }}>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, color: pb.col }}>{pb.val}</div>
                  {pb.id && <span style={{ color: Z.muted, fontSize: 12 }}>→</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PENDING ACTIONS — always shown */}
      <div style={{ padding: '20px' }}>
        <div style={{ fontSize: '11px', color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>Pending Actions</div>
        <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16 }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {PENDING.map((p, i) => (
              <li key={i} style={{ padding: '6px 0 6px 16px', position: 'relative', borderTop: i > 0 ? `1px solid ${Z.border}` : 'none', lineHeight: 1.6, color: '#c8c5bf', fontSize: 13 }}>
                <span style={{ position: 'absolute', left: 0, top: 8, color: p.warn ? Z.amber : Z.accent, fontSize: 11 }}>{p.warn ? '⚠' : '→'}</span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      </div>

    </div>
  )
}
