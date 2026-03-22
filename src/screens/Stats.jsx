import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import OnboardingHints from '../components/OnboardingHints'
import { useSettings } from '../lib/useSettings'
import { usePrimarySport } from '../lib/usePrimarySport'
import { usePullToRefresh } from '../lib/usePullToRefresh'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347',
}

// ── Helpers ──────────────────────────────────────────────────
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
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}
function getWeekBounds() {
  const start = new Date(); const dow = start.getDay()
  start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1)); start.setHours(0,0,0,0)
  const end = new Date(start); end.setDate(end.getDate() + 6); end.setHours(23,59,59,999)
  return { start, end }
}
// Estimated total training weeks before event by sport
function phaseWeeksForSport(sportCategory) {
  return { triathlon: 20, cycling: 16, running: 18, swimming: 12, hyrox: 12, strength: 10 }[sportCategory] || 12
}
// Consecutive weeks with at least 1 activity
function consistencyStreak(activities) {
  let streak = 0
  const now = new Date()
  for (let w = 0; w <= 52; w++) {
    const s = new Date(now); const dow = s.getDay()
    s.setDate(s.getDate() - (dow === 0 ? 6 : dow - 1) - w * 7); s.setHours(0,0,0,0)
    const e = new Date(s); e.setDate(e.getDate() + 6); e.setHours(23,59,59,999)
    const has = activities.some(a => { const d = new Date(a.date); return d >= s && d <= e })
    if (w === 0) { if (has) streak++; continue }
    if (!has) break
    streak++
  }
  return streak
}
// Plain-English lifecycle description
function lifecycleDesc(state, targetName, daysToTarget) {
  if (!state) return null
  const d = daysToTarget, t = targetName
  return ({
    planning:    "You're in the planning phase — setting goals and building your training baseline.",
    training:    t && d ? `You're in training — ${d} days to ${t}.` : "You're in training — stay consistent and trust the process.",
    taper:       t && d ? `Tapering — ${d} days to ${t}. Protect the work you've done.` : "Tapering — ease off the volume, stay sharp.",
    race_week:   `Race week${t ? ` — ${t} is this week` : ''}. Rest, prepare, and trust your training.`,
    recovery:    'Recovery phase — easy movement, rest, and reflection. The hard work is done.',
    what_next:   "What's next? Reflect on what you achieved and start thinking about your next goal.",
    maintenance: 'Maintenance — stay consistent, keep moving, no pressure to peak.',
  })[state] || `Current phase: ${state}.`
}

// ── Shared chart primitives ──────────────────────────────────
function PaceChart({ weeks, targetPaceSec }) {
  const withData = weeks.filter(w => w.paceSeconds != null)
  if (withData.length < 2) return (
    <div style={{ padding: '20px 0', textAlign: 'center', fontSize: 12, color: Z.muted }}>
      Needs 2+ weeks of run data
    </div>
  )
  const VW = 300, VH = 110, P = { l: 6, r: 8, t: 14, b: 18 }
  const iW = VW - P.l - P.r, iH = VH - P.t - P.b
  const allP = withData.map(w => w.paceSeconds)
  const minP = Math.min(...allP, targetPaceSec) - 20
  const maxP = Math.max(...allP, targetPaceSec) + 20
  const xOf = i => P.l + (i / (weeks.length - 1)) * iW
  const yOf = sec => P.t + ((sec - minP) / (maxP - minP)) * iH
  const tY = yOf(targetPaceSec)
  const segments = []; let seg = []
  weeks.forEach((w, i) => {
    if (w.paceSeconds != null) seg.push(`${xOf(i).toFixed(1)},${yOf(w.paceSeconds).toFixed(1)}`)
    else if (seg.length) { segments.push(seg); seg = [] }
  })
  if (seg.length) segments.push(seg)
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} style={{ width: '100%', overflow: 'visible' }}>
      <line x1={P.l} y1={tY} x2={VW-P.r} y2={tY} stroke={Z.accent} strokeWidth="0.8" strokeDasharray="4,3" opacity="0.8" />
      <text x={VW-P.r} y={tY-3} fill={Z.accent} fontSize="7" textAnchor="end" opacity="0.9">{fmtPaceSec(targetPaceSec)} target</text>
      {segments.map((s,i) => <polyline key={i} points={s.join(' ')} fill="none" stroke={Z.accent2} strokeWidth="1.5" strokeLinejoin="round" />)}
      {weeks.map((w,i) => w.paceSeconds == null ? null : (
        <g key={i}>
          <circle cx={xOf(i)} cy={yOf(w.paceSeconds)} r={w.isCurrent ? 4.5 : 3} fill={Z.accent2} opacity={w.isCurrent ? 1 : 0.65} />
          <text x={xOf(i)} y={yOf(w.paceSeconds)-6} textAnchor="middle" fill={Z.text} fontSize="6.5" opacity={w.isCurrent ? 1 : 0.55}>{fmtPaceSec(w.paceSeconds)}</text>
        </g>
      ))}
      {weeks.map((w,i) => (
        <text key={i} x={xOf(i)} y={VH-2} textAnchor="middle" fill={w.isCurrent ? Z.accent : Z.muted} fontSize="7.5" fontWeight={w.isCurrent ? '600' : '400'}>{w.label}</text>
      ))}
    </svg>
  )
}

function VolumeBars({ weeks, unit = 'km' }) {
  const maxVal = Math.max(...weeks.map(w => w.val || 0), 1)
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 64 }}>
      {weeks.map((w, i) => {
        const barH = w.val > 0 ? Math.max((w.val / maxVal) * 100, 4) : 0
        return (
          <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3, height:'100%', justifyContent:'flex-end' }}>
            {w.val > 0 && <div style={{ fontSize: 7.5, color: w.isCurrent ? Z.accent : Z.muted, lineHeight: 1 }}>{Math.round(w.val)}</div>}
            <div style={{ width:'100%', height:`${barH}%`, minHeight: w.val > 0 ? 3 : 0, background: w.isCurrent ? Z.accent : (w.val > 0 ? '#1e1e1e' : '#141414'), borderTop: w.val > 0 && !w.isCurrent ? `1.5px solid ${Z.accent2}` : 'none', borderRadius:'2px 2px 0 0', transition:'height 0.4s' }} />
            <div style={{ fontSize: 7.5, color: w.isCurrent ? Z.accent : Z.muted }}>{w.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function StatCard({ label, value, sub, col }) {
  return (
    <div style={{ flex: 1, background: '#161616', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 28, fontWeight: 800, color: col || Z.accent }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function ProgressBar({ pct, col }) {
  return (
    <div style={{ height: 5, background: '#1a1a1a', borderRadius: 3 }}>
      <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, background: col || Z.accent, borderRadius: 3, transition: 'width 0.5s' }} />
    </div>
  )
}

function TargetBar({ label, numVal, displayVal, target, col, warn }) {
  const pct = Math.min(100, target > 0 ? (numVal / target) * 100 : 0)
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: Z.muted, marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ color: warn ? Z.amber : col }}>{displayVal}{warn ? ' ⚠' : ''}</span>
      </div>
      <ProgressBar pct={pct} col={warn ? Z.amber : col} />
    </div>
  )
}

function SessionList({ sessions, weekActs }) {
  const nonRest = sessions.filter(s => s.session_type !== 'rest')
  if (nonRest.length === 0) return <div style={{ color: Z.muted, fontSize: 13 }}>No sessions scheduled this week.</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {nonRest.map(s => {
        const done = s.status === 'completed' || weekActs.some(a => a.date?.slice(0,10) === s.planned_date)
        const missed = new Date(s.planned_date) < new Date() && !done
        return (
          <div key={s.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', background:Z.surface, borderRadius:8, border:`1px solid ${done ? 'rgba(77,255,145,0.2)' : missed ? 'rgba(255,92,92,0.15)' : Z.border2}`, opacity: missed ? 0.55 : 1 }}>
            <div style={{ width:22, height:22, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, border:`1.5px solid ${done ? Z.green : missed ? Z.red : Z.border2}`, color: done ? Z.green : missed ? Z.red : 'transparent' }}>
              {done ? '✓' : missed ? '!' : ''}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize:12, color: done ? Z.muted : Z.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
              <div style={{ fontSize:10, color:Z.muted, marginTop:1 }}>
                {new Date(s.planned_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
                {s.zone ? ` · ${s.zone}` : ''}{s.duration_min_low ? ` · ${s.duration_min_low}–${s.duration_min_high}min` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LifecycleBanner({ state, text }) {
  if (!state || !text) return null
  const LABELS = { planning:'Planning', training:'Training', taper:'Taper', race_week:'Race Week', recovery:'Recovery', what_next:'What Next', maintenance:'Maintenance' }
  return (
    <div style={{ background:Z.surface, border:`1px solid ${Z.border2}`, borderRadius:10, padding:'14px 16px', marginBottom: 0 }}>
      <div style={{ fontSize:10, color:Z.accent, textTransform:'uppercase', letterSpacing:'0.1em', fontWeight:600, marginBottom:6 }}>
        {LABELS[state] || state}
      </div>
      <div style={{ fontSize:13, color:Z.text, lineHeight:1.55 }}>{text}</div>
    </div>
  )
}

// ── MACRO view branches ───────────────────────────────────────

function MacroCompete({ settings, activities, chartWeeks }) {
  const sc = settings.sport_category
  const isRunning = sc === 'running' || settings.sport === 'running'
  const targetDate = settings.target_date
  const targetName = settings.target_event_name || 'Event'
  const daysToTarget = targetDate ? Math.ceil((new Date(targetDate) - new Date()) / 86400000) : null

  // Parse target pace from target_metric for running (e.g. "sub 3:10:00 marathon")
  let targetPaceSec = null
  if (isRunning && settings.target_metric) {
    const match = settings.target_metric.match(/(\d+):(\d{2}):(\d{2})/)
    if (match) {
      const secs = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3])
      // Derive distance from event name heuristic
      const nm = (targetName + settings.target_metric).toLowerCase()
      const dist = nm.includes('half') ? 21.095 : nm.includes('5k') ? 5 : nm.includes('10k') ? 10 : 42.195
      targetPaceSec = secs / dist
    }
  }

  const sixMonthsAgo = new Date(); sixMonthsAgo.setMonth(sixMonthsAgo.getMonth()-6)
  const seasonKm = activities
    .filter(a => new Date(a.date) >= sixMonthsAgo && (isRunning ? a.type?.toLowerCase().includes('run') : true))
    .reduce((s, a) => s + parseFloat(a.distance_km || 0), 0)

  const countdownColor = daysToTarget < 30 ? Z.red : daysToTarget < 90 ? Z.amber : Z.accent

  return (
    <>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12 }}>
          <div>
            <div style={{ fontSize:10, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>Target</div>
            <div style={{ fontFamily:'Syne, sans-serif', fontSize:16, fontWeight:700 }}>{targetName}</div>
            {targetDate && <div style={{ fontSize:11, color:Z.muted, marginTop:2 }}>{targetDate}</div>}
            {settings.target_metric && <div style={{ fontSize:11, color:Z.accent, marginTop:4 }}>{settings.target_metric}</div>}
          </div>
          {daysToTarget != null && daysToTarget > 0 && (
            <div style={{ textAlign:'right', flexShrink:0, marginLeft:12 }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:36, fontWeight:800, lineHeight:1, color:countdownColor }}>{daysToTarget}</div>
              <div style={{ fontSize:10, color:Z.muted }}>days to go</div>
            </div>
          )}
        </div>
        <div style={{ display:'grid', gridTemplateColumns: targetPaceSec ? '1fr 1fr' : '1fr', gap:8 }}>
          {targetPaceSec && (
            <StatCard label="Target pace" value={`${fmtPaceSec(targetPaceSec)}/km`} col={Z.accent} />
          )}
          <StatCard label="6-month volume" value={`${Math.round(seasonKm)}km`} col={Z.accent2} />
        </div>
      </div>

      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
          {isRunning ? 'Avg run pace · 8 weeks' : 'Weekly volume · 8 weeks'}
        </div>
        {isRunning && targetPaceSec ? (
          <>
            <PaceChart weeks={chartWeeks} targetPaceSec={targetPaceSec} />
            <div style={{ fontSize:10, color:'#444', marginTop:6, lineHeight:1.4 }}>
              Faster = higher on chart. Dots trend up as pace approaches the target line.
            </div>
          </>
        ) : (
          <VolumeBars weeks={chartWeeks.map(w => ({ ...w, val: w.km }))} />
        )}
      </div>
    </>
  )
}

function MacroBodyComp({ settings, activities, chartWeeks }) {
  const streak = consistencyStreak(activities)
  const weight = settings.current_weight_kg
  return (
    <>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ display:'flex', gap:8 }}>
          <StatCard label="Consistency streak" value={`${streak}w`} sub="consecutive weeks active" col={Z.accent} />
          {weight && <StatCard label="Last recorded weight" value={`${weight}kg`} sub="from check-in" col={Z.accent2} />}
        </div>
      </div>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
          Weekly activity count · 8 weeks
        </div>
        <VolumeBars weeks={chartWeeks.map(w => ({ ...w, val: w.sessionCount }))} unit="sessions" />
        <div style={{ fontSize:10, color:'#444', marginTop:8, lineHeight:1.4 }}>
          Consistent weeks drive body composition change more than any single session.
        </div>
      </div>
    </>
  )
}

function MacroFitness({ activities, chartWeeks, isRunning }) {
  const streak = consistencyStreak(activities)
  return (
    <>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ display:'flex', gap:8 }}>
          <StatCard label="Consistency streak" value={`${streak}w`} sub="consecutive weeks active" col={Z.accent} />
          <StatCard label="Total sessions" value={activities.length} sub="logged activities" col={Z.accent2} />
        </div>
      </div>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
          {isRunning ? 'Weekly volume · km (8 weeks)' : 'Weekly sessions (8 weeks)'}
        </div>
        <VolumeBars weeks={chartWeeks.map(w => ({ ...w, val: isRunning ? w.km : w.sessionCount }))} unit={isRunning ? 'km' : 'sessions'} />
      </div>
    </>
  )
}

function MacroRecovery({ activities, chartWeeks, phaseSessions }) {
  const now = localDateStr(new Date())
  const past = phaseSessions.filter(s => s.session_type !== 'rest' && s.planned_date <= now)
  const completed = past.filter(s =>
    s.status === 'completed' || activities.some(a => a.date?.slice(0,10) === s.planned_date)
  ).length
  const compliancePct = past.length > 0 ? Math.round((completed / past.length) * 100) : null
  const complianceCol = compliancePct >= 80 ? Z.green : compliancePct >= 60 ? Z.amber : Z.red

  // Weeks since earliest scheduled session (proxy for return-to-training date)
  const sorted = [...phaseSessions].sort((a,b) => a.planned_date.localeCompare(b.planned_date))
  const firstDate = sorted[0]?.planned_date
  const weeksSince = firstDate ? Math.floor((new Date() - new Date(firstDate)) / (7*86400000)) : null

  return (
    <>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ display:'flex', gap:8 }}>
          {weeksSince != null && <StatCard label="Weeks since return" value={`${weeksSince}w`} col={Z.accent} />}
          {compliancePct != null && (
            <StatCard label="Session compliance" value={`${compliancePct}%`} sub={`${completed}/${past.length} done`} col={complianceCol} />
          )}
        </div>
      </div>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>
          Weekly activity count · 8 weeks
        </div>
        <VolumeBars weeks={chartWeeks.map(w => ({ ...w, val: w.sessionCount }))} unit="sessions" />
      </div>
    </>
  )
}

// ── MICRO view branches ───────────────────────────────────────

function MicroEvent({ settings, activities, weekSessions, weekActs, phaseSessions }) {
  const now = new Date()
  const today = localDateStr(now)
  const targetDate = settings.target_date
  const state = settings.lifecycle_state

  // Phase progress
  let phasePct = null, phaseWeekLabel = null, phaseName = null
  if (targetDate) {
    const pw = phaseWeeksForSport(settings.sport_category)
    const phaseStart = new Date(targetDate); phaseStart.setDate(phaseStart.getDate() - pw*7)
    if (state === 'training') {
      const totalMs = new Date(targetDate) - phaseStart
      const elapsedMs = now - phaseStart

      if (elapsedMs >= 0) {
        // Inside the formal plan window
        phasePct = (elapsedMs / totalMs) * 100
        const currentWeek = Math.max(1, Math.ceil(elapsedMs / (7*86400000)))
        phaseWeekLabel = `Wk ${currentWeek} / ${pw}`
        phaseName = 'Training phase'
      } else {
        // Before the formal plan — count from the earliest scheduled session (the actual plan start)
        const sorted = [...phaseSessions].sort((a, b) => a.planned_date.localeCompare(b.planned_date))
        const firstSessionDate = sorted[0]?.planned_date
        const trainingStart = firstSessionDate ? new Date(firstSessionDate) : null
        // Find the Monday of that week so week boundaries align
        if (trainingStart) {
          const dow = trainingStart.getDay()
          trainingStart.setDate(trainingStart.getDate() - (dow === 0 ? 6 : dow - 1))
          trainingStart.setHours(0, 0, 0, 0)
        }
        const weeksIn = trainingStart ? Math.max(1, Math.ceil((now - trainingStart) / (7*86400000))) : 1
        const weeksToPhase = Math.ceil(-elapsedMs / (7*86400000))
        phasePct = Math.max(0, ((pw - weeksToPhase) / pw) * 100)
        phaseWeekLabel = `Base Wk ${weeksIn} · plan in ${weeksToPhase}w`
        phaseName = 'Base building'
      }
    } else if (state === 'taper') {
      phasePct = 88; phaseWeekLabel = 'Tapering'; phaseName = 'Taper'
    } else if (state === 'race_week') {
      phasePct = 97; phaseWeekLabel = 'Race week'; phaseName = 'Race week'
    }
  }

  // Phase session compliance
  const pastPhaseSess = phaseSessions.filter(s => s.session_type !== 'rest' && s.planned_date <= today)
  const phaseCompleted = pastPhaseSess.filter(s =>
    s.status === 'completed' || activities.some(a => a.date?.slice(0,10) === s.planned_date)
  ).length

  // This week
  const nonRest = weekSessions.filter(s => s.session_type !== 'rest')
  const weekDone = nonRest.filter(s =>
    s.status === 'completed' || weekActs.some(a => a.date?.slice(0,10) === s.planned_date)
  ).length

  return (
    <>
      {phasePct != null && (
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
          <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>{phaseName}</div>
          <div style={{ background:Z.surface, border:`1px solid ${Z.border2}`, borderRadius:10, padding:'14px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
              <div style={{ fontFamily:'Syne, sans-serif', fontSize:15, fontWeight:700 }}>{phaseName}</div>
              <div style={{ fontSize:11, color:Z.muted }}>{phaseWeekLabel}</div>
            </div>
            <ProgressBar pct={phasePct} />
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:10, color:Z.muted }}>
              <span>Start</span><span>{Math.round(Math.min(100, phasePct))}% complete</span><span>Event</span>
            </div>
          </div>
        </div>
      )}

      {pastPhaseSess.length > 0 && (
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
            <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em' }}>Phase sessions</div>
            <div style={{ fontSize:12, color: phaseCompleted === pastPhaseSess.length ? Z.green : Z.accent }}>
              {phaseCompleted}/{pastPhaseSess.length} done
            </div>
          </div>
          <ProgressBar pct={pastPhaseSess.length > 0 ? (phaseCompleted/pastPhaseSess.length)*100 : 0} />
          <div style={{ fontSize:10, color:Z.muted, marginTop:5 }}>Scheduled sessions completed since phase start</div>
        </div>
      )}

      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
          <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em' }}>This week</div>
          <div style={{ fontSize:12, color: weekDone === nonRest.length && nonRest.length > 0 ? Z.green : Z.accent }}>
            {weekDone}/{nonRest.length} done
          </div>
        </div>
        <SessionList sessions={weekSessions} weekActs={weekActs} />
      </div>
    </>
  )
}

function MicroLifestyle({ settings, weekSessions, weekActs, nutritionLogs }) {
  const nonRest = weekSessions.filter(s => s.session_type !== 'rest')
  const sessCompleted = nonRest.filter(s =>
    s.status === 'completed' || weekActs.some(a => a.date?.slice(0,10) === s.planned_date)
  ).length
  const nutDays = new Set(nutritionLogs.map(n => n.date)).size
  const targetDays = settings.training_days_per_week || nonRest.length || 3
  const sleep = settings.sleep_hours_typical
  const sleepCol = sleep >= 7 ? Z.green : sleep >= 6 ? Z.amber : Z.red

  return (
    <>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>This week's targets</div>
        <TargetBar label={`Sessions (target ${targetDays}/wk)`} numVal={sessCompleted} displayVal={`${sessCompleted} done`} target={targetDays} col={Z.accent} />
        <TargetBar label="Nutrition days logged (target 7)" numVal={nutDays} displayVal={`${nutDays} days`} target={7} col={Z.green} />
        {sleep && (
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'8px 0', borderTop:`1px solid ${Z.border}`, marginTop:4 }}>
            <span style={{ color:Z.muted }}>Typical sleep</span>
            <span style={{ color:sleepCol }}>{sleep}h/night</span>
          </div>
        )}
      </div>
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${Z.border}` }}>
        <div style={{ fontSize:11, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>This week's sessions</div>
        <SessionList sessions={weekSessions} weekActs={weekActs} />
      </div>
    </>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function Progress({ onActivityClick }) {
  const settings  = useSettings()
  const { primarySport } = usePrimarySport()
  // Merge primarySport fields over settings so sub-components keep working
  const mergedSettings = {
    ...settings,
    sport_category:     primarySport?.sport_category     ?? settings.sport_category,
    sport:              primarySport?.sport_raw          ?? settings.sport,
    target_date:        primarySport?.target_date        ?? settings.target_date,
    target_event_name:  primarySport?.current_goal_raw   ?? settings.target_event_name,
    target_metric:      primarySport?.target_metric      ?? settings.target_metric,
    lifecycle_state:    primarySport?.lifecycle_state    ?? settings.lifecycle_state,
  }
  const [activities,    setActivities]    = useState([])
  const [weekSessions,  setWeekSessions]  = useState([])
  const [phaseSessions, setPhaseSessions] = useState([])
  const [nutritionLogs, setNutritionLogs] = useState([])
  const [loading,       setLoading]       = useState(true)
  const [view,          setView]          = useState('macro')
  const [hasStrava,     setHasStrava]     = useState(null)

  const loadStats = useCallback(async () => {
    const { start, end } = getWeekBounds()
    const weekStartStr = localDateStr(start)
    const weekEndStr   = localDateStr(end)

    const pw = phaseWeeksForSport(mergedSettings.sport_category)
    // Look back from race minus pw weeks OR 12 months ago, whichever is earlier —
    // so phaseSessions includes base-build sessions before the formal 18-week window
    const phaseStartStr = mergedSettings.target_date
      ? (() => {
          const fromRace = new Date(mergedSettings.target_date); fromRace.setDate(fromRace.getDate() - pw*7)
          const twelveMonthsAgo = new Date(); twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
          return localDateStr(fromRace < twelveMonthsAgo ? fromRace : twelveMonthsAgo)
        })()
      : (() => { const d = new Date(); d.setMonth(d.getMonth()-4); return localDateStr(d) })()

    const [{ data: acts }, { data: wSess }, { data: pSess }, { data: nLogs }, { data: stravaToken }] = await Promise.all([
      supabase.from('activities').select('*').order('date', { ascending: false }).limit(200),
      supabase.from('scheduled_sessions').select('*').gte('planned_date', weekStartStr).lte('planned_date', weekEndStr).order('planned_date'),
      supabase.from('scheduled_sessions').select('*').gte('planned_date', phaseStartStr).order('planned_date'),
      supabase.from('nutrition_logs').select('date').gte('date', weekStartStr).lte('date', weekEndStr),
      supabase.from('strava_tokens').select('athlete_id').maybeSingle(),
    ])
    setActivities(acts || [])
    setWeekSessions(wSess || [])
    setPhaseSessions(pSess || [])
    setNutritionLogs(nLogs || [])
    setHasStrava(!!stravaToken)
    setLoading(false)
  }, [primarySport?.target_date, primarySport?.sport_category]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadStats() }, [loadStats])

  const { containerRef: statsContainerRef, pullDistance: statsPullDist, refreshing: statsRefreshing } = usePullToRefresh(loadStats)

  const now = new Date()
  const { start: weekStart } = getWeekBounds()
  const goalType  = mergedSettings.goal_type
  const isEvent   = goalType === 'compete' || goalType === 'complete_event'
  const isBodyComp = goalType === 'body_composition'
  const isRecovery = goalType === 'injury_recovery'
  const isRunning = mergedSettings.sport_category === 'running' || mergedSettings.sport === 'running'

  // 8-week chart data
  const chartWeeks = []
  for (let w = 7; w >= 0; w--) {
    const s = new Date(now); const dow = s.getDay()
    s.setDate(s.getDate() - (dow === 0 ? 6 : dow - 1) - w*7); s.setHours(0,0,0,0)
    const e = new Date(s); e.setDate(e.getDate()+6); e.setHours(23,59,59,999)
    const wActs = activities.filter(a => { const d = new Date(a.date); return d >= s && d <= e })
    const runActs = isRunning ? wActs.filter(a => a.type?.toLowerCase().includes('run') && parseFloat(a.distance_km) >= 3) : []
    const paces = runActs.filter(a => a.pace_per_km).map(a => parsePaceStr(a.pace_per_km)).filter(Boolean)
    const avgPace = paces.length > 0 ? paces.reduce((a,b) => a+b, 0) / paces.length : null
    const km = parseFloat(wActs.reduce((s, a) => s + parseFloat(a.distance_km || 0), 0).toFixed(1))
    chartWeeks.push({ label: `W${8-w}`, paceSeconds: avgPace, km, sessionCount: wActs.length, isCurrent: w === 0 })
  }

  const weekActs = activities.filter(a => new Date(a.date) >= weekStart)

  // Lifecycle banner
  const targetName = mergedSettings.target_event_name || (mergedSettings.target_metric ? 'your goal' : null)
  const daysToTarget = mergedSettings.target_date ? Math.ceil((new Date(mergedSettings.target_date) - now) / 86400000) : null
  const bannerText = lifecycleDesc(mergedSettings.lifecycle_state, targetName, daysToTarget)

  // PBs — use all activities or sport-filtered
  const pbSource = isRunning ? activities.filter(a => a.type?.toLowerCase().includes('run')) : activities
  const pbLongest = pbSource.reduce((b, a) => parseFloat(a.distance_km) > parseFloat(b?.distance_km || 0) ? a : b, null)
  const pbFastest = pbSource.filter(a => parseFloat(a.distance_km) >= 5 && a.pace_per_km)
    .reduce((b, a) => (parsePaceStr(a.pace_per_km)||Infinity) < (parsePaceStr(b?.pace_per_km)||Infinity) ? a : b, null)
  const pbElev = pbSource.reduce((b, a) => parseFloat(a.elevation_m) > parseFloat(b?.elevation_m||0) ? a : b, null)

  return (
    <div ref={statsContainerRef} data-testid="progress-screen" style={{ overflowY:'auto', height:'100%', fontFamily:"'DM Mono', monospace" }}>
      {(statsPullDist > 0 || statsRefreshing) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: Math.max(statsPullDist, statsRefreshing ? 48 : 0), overflow: 'hidden', color: '#888580', fontSize: '12px', letterSpacing: '0.06em' }}>
          {statsRefreshing ? 'Refreshing...' : statsPullDist > 72 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}

      <OnboardingHints
        hintId="progress_views"
        title="Macro and micro views"
        body="Toggle between Macro (monthly volume by goal type) and Micro (event-specific phase compliance). Personal bests are tracked automatically from your activity data."
        position="bottom"
      />

      {/* HEADER + TOGGLE */}
      <div style={{ padding:'14px 20px', borderBottom:`1px solid ${Z.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontFamily:'Syne, sans-serif', fontSize:18, fontWeight:700 }}>Progress</div>
        <div style={{ display:'flex', background:'#161616', borderRadius:8, padding:2 }}>
          {['macro','micro'].map(v => (
            <button key={v} onClick={() => setView(v)} {...(v === 'micro' ? { 'data-testid': 'progress-micro-toggle' } : {})} style={{
              padding:'5px 16px', borderRadius:6, border:'none',
              background: view === v ? Z.accent : 'none',
              color: view === v ? Z.bg : Z.muted,
              fontSize:11, cursor:'pointer', fontFamily:"'DM Mono', monospace",
              fontWeight: view === v ? 600 : 400, textTransform:'uppercase',
              letterSpacing:'0.04em', transition:'all 0.15s',
            }}>{v}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding:40, textAlign:'center', color:Z.muted, fontSize:13 }}>Loading…</div>
      ) : activities.length === 0 ? (
        <div style={{ padding:'40px 24px', textAlign:'center' }}>
          <div style={{ fontSize:32, marginBottom:16 }}>📊</div>
          <div style={{ fontSize:14, color:Z.text, fontWeight:600, marginBottom:8 }}>No activity data yet</div>
          <div style={{ fontSize:13, color:Z.muted, lineHeight:1.6, marginBottom:24 }}>
            {hasStrava === false
              ? 'Connect Strava to automatically import your training, or log a workout manually to get started.'
              : 'Your activities will appear here once synced.'}
          </div>
          {hasStrava === false && (
            <div style={{ fontSize:12, color:Z.accent2, border:`1px solid rgba(71,212,255,0.3)`, borderRadius:8, padding:'8px 16px', display:'inline-block' }}>
              Connect Strava in Settings → Connections
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ── MACRO ── */}
          {view === 'macro' && (
            <>
              {isEvent    && <MacroCompete  settings={mergedSettings} activities={activities} chartWeeks={chartWeeks} />}
              {isBodyComp && <MacroBodyComp settings={mergedSettings} activities={activities} chartWeeks={chartWeeks} />}
              {isRecovery && <MacroRecovery activities={activities} chartWeeks={chartWeeks} phaseSessions={phaseSessions} />}
              {!isEvent && !isBodyComp && !isRecovery && <MacroFitness activities={activities} chartWeeks={chartWeeks} isRunning={isRunning} />}
            </>
          )}

          {/* ── MICRO ── */}
          {view === 'micro' && (
            <>
              {/* Lifecycle banner — always shown */}
              {bannerText && (
                <div style={{ padding:'12px 20px' }}>
                  <LifecycleBanner state={mergedSettings.lifecycle_state} text={bannerText} />
                </div>
              )}
              {isEvent
                ? <MicroEvent settings={mergedSettings} activities={activities} weekSessions={weekSessions} weekActs={weekActs} phaseSessions={phaseSessions} />
                : <MicroLifestyle settings={mergedSettings} weekSessions={weekSessions} weekActs={weekActs} nutritionLogs={nutritionLogs} />
              }
            </>
          )}

          {/* PBs — always shown */}
          <div style={{ padding:'20px', borderBottom:`1px solid ${Z.border}` }}>
            <div style={{ fontSize:11, color:Z.muted, letterSpacing:'0.08em', textTransform:'uppercase', marginBottom:14 }}>Personal Bests</div>
            {pbSource.length === 0 ? (
              <div style={{ color:Z.muted, fontSize:13 }}>No activities logged yet.</div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  pbLongest && { label:'Longest session', val:`${parseFloat(pbLongest.distance_km).toFixed(1)}km`, sub:pbLongest.name, id:pbLongest.strava_id, col:Z.accent },
                  pbFastest && { label:'Fastest pace (5km+)', val:`${pbFastest.pace_per_km}/km`, sub:`${parseFloat(pbFastest.distance_km).toFixed(1)}km · ${pbFastest.name}`, id:pbFastest.strava_id, col:Z.green },
                  pbElev    && { label:'Most elevation', val:`${Math.round(pbElev.elevation_m)}m`, sub:pbElev.name, id:pbElev.strava_id, col:Z.accent2 },
                ].filter(Boolean).map((pb, i) => (
                  <div key={i} onClick={() => pb.id && onActivityClick?.(pb.id)}
                    style={{ display:'flex', justifyContent:'space-between', alignItems:'center', background:Z.surface, border:`1px solid ${Z.border2}`, borderRadius:10, padding:'12px 14px', cursor: pb.id ? 'pointer' : 'default' }}>
                    <div style={{ minWidth:0, flex:1 }}>
                      <div style={{ fontSize:10, color:Z.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{pb.label}</div>
                      <div style={{ fontSize:12, color:Z.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{pb.sub}</div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0, marginLeft:12 }}>
                      <div style={{ fontFamily:'Syne, sans-serif', fontSize:20, fontWeight:700, color:pb.col }}>{pb.val}</div>
                      {pb.id && <span style={{ color:Z.muted, fontSize:12 }}>→</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

