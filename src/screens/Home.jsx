import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/useSettings'
import { usePrimarySport } from '../lib/usePrimarySport'
import { usePullToRefresh } from '../lib/usePullToRefresh'
import { runBackfill } from '../lib/stravaBackfill'

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
  briefingCard: { background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '16px' },
  badge: { display: 'inline-block', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: '4px', background: 'rgba(232,255,71,0.12)', color: '#e8ff47', marginBottom: '12px' },
  points: { listStyle: 'none', margin: 0, padding: 0 },
  actRow: { display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  actIcon: { width: '36px', height: '36px', borderRadius: '8px', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0 },
  zoneWrap: { marginBottom: '16px' },
  zoneLabel: { display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: '#888580' },
  zoneTrack: { height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' },
}

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
  const isRun = activity.type?.toLowerCase().includes('run')
  const isStrength = activity.type?.toLowerCase().includes('weight') || activity.type?.toLowerCase().includes('strength')
  const icon = isRun ? '🏃' : isStrength ? '💪' : '🚴'
  const hrColor = activity.avg_hr > 158 ? '#ff5c5c' : activity.avg_hr > 140 ? '#ffb347' : '#4dff91'
  const paceStr = activity.pace_per_km || (activity.distance_km && activity.duration_min
    ? `${Math.floor(activity.duration_min / activity.distance_km)}:${String(Math.round((activity.duration_min / activity.distance_km % 1) * 60)).padStart(2, '0')}`
    : '—')
  const dateStr = activity.date ? new Date(activity.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : ''

  return (
    <div onClick={() => onActivityClick && onActivityClick(activity.strava_id)} style={{ ...S.actRow, borderBottom: '1px solid rgba(255,255,255,0.08)', cursor: onActivityClick ? 'pointer' : 'default' }}>
      <div style={S.actIcon}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500, color: '#f0ede8', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activity.name}</div>
        <div style={{ fontSize: '11px', color: '#888580' }}>{dateStr} · {activity.distance_km ? `${parseFloat(activity.distance_km).toFixed(1)}km` : ''}{activity.elevation_m ? ` · ${activity.elevation_m}m elev` : ''}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '15px', fontWeight: 600 }}>{paceStr}</div>
        {activity.avg_hr && <div style={{ fontSize: '11px', color: hrColor, marginTop: '2px' }}>HR {Math.round(activity.avg_hr)}</div>}
      </div>
    </div>
  )
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

export default function Home({ onActivityClick, onOpenSettings }) {
  const settings = useSettings()
  const { primarySport } = usePrimarySport()
  const [activities, setActivities] = useState([])
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [todayNutrition, setTodayNutrition] = useState({ kcal: 0, protein: 0, logged: false })
  const [statFilter, setStatFilter] = useState('All')
  const [backfillStatus, setBackfillStatus] = useState(null) // null | 'syncing' | 'done' | 'error'
  const [todaySession, setTodaySession] = useState(null)
  const [checkinDismissed, setCheckinDismissed] = useState(false)
  const [goalPromptDismissed, setGoalPromptDismissed] = useState(false)
  const backfillCheckRef = useRef(false)

  const load = useCallback(async () => {
    const todayStr = new Date().toLocaleDateString('en-CA')
    const dismissKey = `checkin_dismissed_${todayStr}`
    if (localStorage.getItem(dismissKey)) setCheckinDismissed(true)
    const [{ data: acts }, { data: brief }, { data: nutri }, { data: todaySess }] = await Promise.all([
      supabase.from('activities').select('*').order('date', { ascending: false }).limit(20),
      supabase.from('daily_briefings').select('id, date, briefing_text, created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('nutrition_logs').select('calories,protein_g,meal_type').eq('date', todayStr),
      supabase.from('scheduled_sessions').select('id,session_type,name,zone,duration_min_low,duration_min_high').eq('planned_date', todayStr).eq('status', 'planned').maybeSingle(),
    ])
    if (acts) setActivities(acts)
    if (brief && brief[0]) setBriefing(brief[0])
    if (nutri) {
      const food = nutri.filter(n => n.meal_type !== 'alcohol')
      setTodayNutrition({
        kcal: food.reduce((s, n) => s + (n.calories || 0), 0),
        protein: Math.round(food.reduce((s, n) => s + parseFloat(n.protein_g || 0), 0)),
        logged: nutri.length > 0,
      })
    }
    setTodaySession(todaySess || null)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-backfill: if user has no activities, silently sync Strava history
  useEffect(() => {
    if (backfillCheckRef.current) return
    backfillCheckRef.current = true

    async function checkAndBackfill() {
      const { count } = await supabase
        .from('activities')
        .select('*', { count: 'exact', head: true })
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

  async function dismissGoalPrompt() {
    setGoalPromptDismissed(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('athlete_settings')
          .update({ last_goal_prompt_date: new Date().toISOString().slice(0, 10) })
          .eq('user_id', user.id)
      }
    } catch (e) {
      console.warn('Could not update last_goal_prompt_date:', e)
    }
  }

  async function handleCheckinAction() {
    const todayStr = new Date().toISOString().slice(0, 10)
    localStorage.setItem(`checkin_dismissed_${todayStr}`, '1')
    setCheckinDismissed(true)
    if (todaySession?.id) {
      const now = new Date().toTimeString().slice(0, 5)
      try {
        await supabase.from('scheduled_sessions').update({ planned_start_time: now }).eq('id', todaySession.id)
      } catch (e) {
        console.warn('planned_start_time not available yet (run schema migration):', e)
      }
    }
  }

  function dismissCheckin() {
    const todayStr = new Date().toISOString().slice(0, 10)
    localStorage.setItem(`checkin_dismissed_${todayStr}`, '1')
    setCheckinDismissed(true)
  }

  const { containerRef, pullDistance, refreshing } = usePullToRefresh(load)

  // Calculate this week's stats (week starts Monday)
  const weekStart = new Date()
  const _day = weekStart.getDay() // 0=Sun, 1=Mon...
  const _daysFromMon = _day === 0 ? 6 : _day - 1
  weekStart.setDate(weekStart.getDate() - _daysFromMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekActs = activities.filter(a => new Date(a.date) >= weekStart)
  const isRun = a => a.type?.toLowerCase().includes('run')
  const isBike = a => a.type?.toLowerCase().includes('ride') || a.type?.toLowerCase().includes('cycl') || a.type?.toLowerCase().includes('bike')
  const isStrengthAct = a => a.type?.toLowerCase().includes('weight') || a.type?.toLowerCase().includes('strength') || a.type?.toLowerCase().includes('workout')
  const filteredActs = statFilter === 'All' ? weekActs
    : statFilter === 'Runs' ? weekActs.filter(isRun)
    : statFilter === 'Bike' ? weekActs.filter(isBike)
    : weekActs.filter(isStrengthAct)
  const weekKm = filteredActs.reduce((s, a) => s + (parseFloat(a.distance_km) || 0), 0)
  const weekElev = filteredActs.reduce((s, a) => s + (parseFloat(a.elevation_m) || 0), 0)
  const weekSessions = filteredActs.length
  const weekStrength = weekActs.filter(isStrengthAct).length

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const targetDate = primarySport?.target_date ? new Date(primarySport.target_date) : null
  const daysToRace = targetDate ? Math.ceil((targetDate - new Date()) / (1000 * 60 * 60 * 24)) : null
  const eventLabel = primarySport?.current_goal_raw || null

  // Last run for zone bars
  const lastRun = activities.find(a => a.type?.toLowerCase().includes('run'))

  // Check-in card: session today, no activity today, before 18:00, not dismissed
  // Use local date (en-CA returns YYYY-MM-DD) to correctly match Strava's local activity dates
  const todayStr = new Date().toLocaleDateString('en-CA')
  const todayActivityExists = activities.some(a => a.date === todayStr)
  const currentHour = new Date().getHours()
  const showCheckin = todaySession && !todayActivityExists && currentHour < 18 && !checkinDismissed
  const checkinMsg = CHECKIN_MSGS[new Date().getDay() % CHECKIN_MSGS.length]
  const sessionTypeIcon = { run: '🏃', trail: '⛰️', strength: '🏋️', rest: '😴' }

  // Quarterly goal prompt: no races, not dismissed, >90 days since last prompt
  const races = settings.races || []
  const lastGoalPrompt = settings.last_goal_prompt_date
  const daysSincePrompt = lastGoalPrompt
    ? Math.floor((Date.now() - new Date(lastGoalPrompt).getTime()) / (1000 * 60 * 60 * 24))
    : Infinity
  const showGoalPrompt = !goalPromptDismissed && races.length === 0 && daysSincePrompt >= 90 && settings.lifecycle_state != null

  return (
    <div ref={containerRef} style={S.page}>
      {/* PULL-TO-REFRESH INDICATOR */}
      {(pullDistance > 0 || refreshing) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: Math.max(pullDistance, refreshing ? 48 : 0), overflow: 'hidden', transition: refreshing ? 'none' : 'height 0.1s', color: '#888580', fontSize: '12px', letterSpacing: '0.06em' }}>
          {refreshing ? 'Refreshing...' : pullDistance > 72 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}

      {/* BACKFILL STATUS INDICATOR */}
      {backfillStatus && (
        <div style={{ padding: '8px 20px', fontSize: 11, letterSpacing: '0.06em', color: backfillStatus === 'error' ? '#ff5c5c' : '#e8ff47', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          {backfillStatus === 'syncing' && '⟳ Syncing Strava history...'}
          {backfillStatus === 'done' && '✓ Strava history synced'}
          {backfillStatus === 'error' && '⚠ Strava sync failed — check Settings'}
        </div>
      )}
      {/* QUARTERLY GOAL PROMPT */}
      {showGoalPrompt && (
        <div style={{ margin: '12px 20px 0', padding: '14px 16px', background: 'rgba(232,255,71,0.06)', border: '1px solid rgba(232,255,71,0.2)', borderRadius: 12 }}>
          <div style={{ fontSize: 10, color: '#e8ff47', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Your goals</div>
          <div style={{ fontSize: 14, color: '#f0ede8', fontWeight: 600, marginBottom: 4 }}>No races or events set</div>
          <div style={{ fontSize: 12, color: '#888580', lineHeight: 1.5, marginBottom: 12 }}>Having a goal helps your coach give you more focused, relevant advice. What are you training for?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { dismissGoalPrompt(); onOpenSettings?.() }}
              style={{ flex: 1, background: '#e8ff47', border: 'none', borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#0a0a0a', fontWeight: 600 }}
            >
              Set a goal
            </button>
            <button
              onClick={dismissGoalPrompt}
              style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 7, padding: '9px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#888580' }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* DAILY CHECK-IN CARD */}
      {showCheckin && (
        <div style={{ margin: '12px 20px 0', padding: '14px 16px', background: '#111111', border: '1px solid rgba(232,255,71,0.2)', borderRadius: 12, position: 'relative' }}>
          <button onClick={dismissCheckin} style={{ position: 'absolute', top: 10, right: 12, background: 'none', border: 'none', color: '#888580', fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>×</button>
          <div style={{ fontSize: 10, color: '#e8ff47', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
            {sessionTypeIcon[todaySession.session_type] || '📋'} Today's session
          </div>
          <div style={{ fontSize: 13, color: '#f0ede8', fontWeight: 500, marginBottom: 2 }}>{todaySession.name}</div>
          {todaySession.zone && (
            <div style={{ fontSize: 11, color: '#888580', marginBottom: 8 }}>
              {todaySession.zone}{todaySession.duration_min_low ? ` · ${todaySession.duration_min_low}${todaySession.duration_min_high !== todaySession.duration_min_low ? `–${todaySession.duration_min_high}` : ''}min` : ''}
            </div>
          )}
          <div style={{ fontSize: 12, color: '#888580', lineHeight: 1.5, marginBottom: 12 }}>{checkinMsg}</div>
          <button
            onClick={handleCheckinAction}
            style={{ background: '#e8ff47', border: 'none', borderRadius: 7, padding: '8px 16px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#0a0a0a', fontWeight: 600 }}
          >
            I'm on it →
          </button>
        </div>
      )}

      <div style={S.hero}>
        <div style={S.label}>{today}</div>
        <div style={S.greeting}>
          {primarySport?.lifecycle_state
            ? primarySport.lifecycle_state.charAt(0).toUpperCase() + primarySport.lifecycle_state.slice(1).replace('_', ' ')
            : 'Welcome'}
        </div>
        {(eventLabel || daysToRace) && (
          <div style={S.date}>
            {eventLabel || 'Your goal'}{daysToRace !== null ? ` · ${daysToRace} days` : ''}
          </div>
        )}
      </div>

      {/* STAT FILTER PILLS */}
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

      {/* BRIEFING */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>Today's Briefing</div>
          <div style={{ fontSize: '11px', color: '#e8ff47' }}>06:30 auto</div>
        </div>
        <div style={S.briefingCard}>
          {loading ? (
            <div style={{ color: '#888580', fontSize: '13px' }}>Loading briefing...</div>
          ) : briefing ? (
            <>
              <div style={S.badge}>{new Date(briefing.date || briefing.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · AI Generated</div>
              <div style={{ fontSize: '13px', lineHeight: 1.7, color: '#c8c5bf' }}>
                {briefing.briefing_text.split('\n').filter(l => l.trim()).map((line, i) => {
                  const isHeader = line.startsWith('#')
                  const clean = line.replace(/^#+\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1')
                  return (
                    <div key={i} style={{ padding: '5px 0 5px 16px', position: 'relative', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none' }}>
                      <span style={{ position: 'absolute', left: 0, color: line.includes('⚠') || line.includes('Urgent') ? '#ffb347' : '#e8ff47', fontSize: '11px', top: '7px' }}>→</span>
                      <span style={{ color: isHeader ? '#e8ff47' : '#c8c5bf', fontWeight: isHeader ? 600 : 400 }}>{clean}</span>
                    </div>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <div style={S.badge}>Fri 13 Mar · Static</div>
              <ul style={S.points}>
                {[
                  { text: <><strong style={{ color: '#f0ede8' }}>Zone 2 is clicking.</strong> HR 143 at 5:44/km on Wednesday — first clean Z2 run. Protect that discipline today.</>, warn: false },
                  { text: <><strong style={{ color: '#f0ede8' }}>Elevation debt cleared.</strong> Trail session yesterday: 326m. Weekly target within range.</>, warn: false },
                  { text: <><strong style={{ color: '#f0ede8' }}>Sunday: Long run</strong> 75–85min Salzach south. 5:30–6:00/km strictly Z2. HR ceiling 145bpm.</>, warn: false },
                  { text: <><strong style={{ color: '#f0ede8' }}>⚠ 5km time trial pending</strong> — schedule week of 17 Mar on a fresh day. Zones need calibrating.</>, warn: true },
                ].map((p, i) => (
                  <li key={i} style={{ padding: '6px 0 6px 16px', position: 'relative', borderTop: '1px solid rgba(255,255,255,0.08)', lineHeight: 1.6, color: '#c8c5bf', fontSize: '13px' }}>
                    <span style={{ position: 'absolute', left: 0, color: p.warn ? '#ffb347' : '#e8ff47', fontSize: '11px', top: '8px' }}>{p.warn ? '⚠' : '→'}</span>
                    {p.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* NUTRITION SNAPSHOT */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>Today's Fuel</div>
          <div style={{ fontSize: '11px', color: '#888580' }}></div>
        </div>
        {!todayNutrition.logged ? (
          <div style={{ color: '#888580', fontSize: '13px' }}>Nothing logged yet today.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[
              { val: todayNutrition.kcal, lbl: 'kcal logged', target: null, col: '#e8ff47' },
              { val: `${todayNutrition.protein}g`, lbl: 'protein', target: null, numVal: todayNutrition.protein, col: '#47d4ff' },
            ].map(({ val, lbl, target, numVal, col }) => (
              <div key={lbl} style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '12px 14px' }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 700, lineHeight: 1, color: col }}>{val}</div>
                <div style={{ fontSize: '10px', color: '#888580', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '4px 0 6px' }}>{lbl}</div>
                {target != null && (
                  <div style={{ height: '3px', background: '#1a1a1a', borderRadius: '2px' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, ((numVal ?? val) / target) * 100)}%`, background: col, borderRadius: '2px', transition: 'width 0.4s' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RECENT ACTIVITIES */}
      <div style={S.section}>
        <div style={S.sectionHeader}>
          <div style={S.sectionTitle}>Recent Activities</div>
          <div style={{ fontSize: '11px', color: '#e8ff47' }}>from Strava</div>
        </div>
        {loading ? (
          <div style={{ color: '#888580', fontSize: '13px' }}>Loading activities...</div>
        ) : activities.length > 0 ? (
          activities.slice(0, 4).map((a, i) => <ActivityRow key={a.id || i} activity={a} onActivityClick={onActivityClick} />)
        ) : (
          <div style={{ color: '#888580', fontSize: '13px' }}>No activities yet — run workflow to sync from Strava.</div>
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
    </div>
  )
}
