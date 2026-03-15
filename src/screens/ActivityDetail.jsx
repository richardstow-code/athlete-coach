import GymLogger from '../components/GymLogger'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const Z = {
  bg: '#0a0a0a', surface: '#111111', border: 'rgba(255,255,255,0.08)',
  border2: 'rgba(255,255,255,0.14)', text: '#f0ede8', muted: '#888580',
  accent: '#e8ff47', accent2: '#47d4ff', red: '#ff5c5c', green: '#4dff91', amber: '#ffb347'
}

function fmtPace(secPerKm) {
  if (!secPerKm) return '—'
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')}`
}

function hrColor(hr) {
  if (!hr) return Z.muted
  if (hr < 125) return Z.accent2
  if (hr < 140) return Z.green
  if (hr < 158) return Z.amber
  if (hr < 172) return Z.red
  return '#ff2222'
}

function ZoneBar({ label, secs, total, color }) {
  const pct = total > 0 ? Math.round((secs / total) * 100) : 0
  const mins = Math.round(secs / 60)
  if (pct === 0) return null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: Z.muted, marginBottom: 3 }}>
        <span style={{ color }}>{label}</span>
        <span>{mins}m · {pct}%</span>
      </div>
      <div style={{ height: 6, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  )
}

export default function ActivityDetail({ stravaId, onBack }) {
  const [activity, setActivity] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('activities')
      .select('*')
      .eq('strava_id', stravaId)
      .single()
      .then(({ data }) => { setActivity(data); setLoading(false) })
  }, [stravaId])

  if (loading) return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20 }}>
      <div style={{ color: Z.muted, fontSize: 13 }}>Loading...</div>
    </div>
  )
  if (!activity) return null

  const rd = activity.raw_data || {}
  const splits = rd.splits || []
  const zones = rd.zones || {}
  const totalZoneSecs = Object.values(zones).reduce((s, v) => s + v, 0)
  const hasSplits = splits.length > 0 && !rd.summary_only
  const wt = rd.type || '—'
  const dateStr = activity.date ? new Date(activity.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : ''

  // Derive overall pace
  const overallPace = activity.distance_km && activity.duration_min
    ? fmtPace(Math.round((activity.duration_min * 60) / parseFloat(activity.distance_km)))
    : activity.pace_per_km || '—'

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontFamily: "'DM Mono', monospace" }}>
      {/* HEADER */}
      <div style={{ padding: '16px 20px 0', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>{dateStr}</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 4, color: Z.text }}>{activity.name}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(232,255,71,0.12)', color: Z.accent, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{activity.type}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.08)', color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{wt}</span>
        </div>
      </div>

      {/* STAT STRIP */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: Z.border, borderBottom: `1px solid ${Z.border}` }}>
        {[
          { val: parseFloat(activity.distance_km || 0).toFixed(1), lbl: 'km', color: Z.accent },
          { val: overallPace, lbl: '/km', color: Z.text },
          { val: activity.avg_hr ? Math.round(activity.avg_hr) : '—', lbl: 'avg HR', color: activity.avg_hr ? hrColor(activity.avg_hr) : Z.muted },
          { val: activity.elevation_m || 0, lbl: 'elev m', color: Z.accent2 },
        ].map((s, i) => (
          <div key={i} style={{ background: Z.bg, padding: '14px 12px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, lineHeight: 1, marginBottom: 3, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{s.lbl}</div>
          </div>
        ))}
      </div>

      {/* PER-KM SPLITS TABLE */}
      {hasSplits ? (
        <div style={{ padding: 20, borderBottom: `1px solid ${Z.border}` }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Per-km Splits</div>
          <div style={{ background: Z.surface, borderRadius: 10, border: `1px solid ${Z.border2}`, overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr', gap: 0, padding: '8px 12px', borderBottom: `1px solid ${Z.border}` }}>
              {['KM', 'PACE', 'HR', 'ELEV', ''].map((h, i) => (
                <div key={i} style={{ fontSize: 9, color: Z.muted, letterSpacing: '0.08em', textAlign: i > 0 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>
            {splits.map((s, i) => {
              const pace = fmtPace(s.pace)
              const isFirst = i === 0
              const prevPace = i > 0 ? splits[i - 1].pace : null
              const paceChange = prevPace && s.pace ? s.pace - prevPace : 0
              const paceArrow = paceChange > 15 ? '↑' : paceChange < -15 ? '↓' : ''
              const arrowColor = paceChange > 15 ? Z.red : Z.green
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 1fr 1fr 1fr', gap: 0, padding: '10px 12px', borderBottom: i < splits.length - 1 ? `1px solid ${Z.border}` : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: 12, color: Z.muted, fontWeight: 500 }}>{s.km}</div>
                  <div style={{ fontSize: 13, color: Z.text, textAlign: 'right', fontWeight: 500 }}>{pace}</div>
                  <div style={{ fontSize: 13, color: hrColor(s.hr), textAlign: 'right' }}>{s.hr || '—'}</div>
                  <div style={{ fontSize: 12, color: s.elev > 0 ? Z.amber : s.elev < 0 ? Z.green : Z.muted, textAlign: 'right' }}>
                    {s.elev > 0 ? '+' : ''}{s.elev || 0}m
                  </div>
                  <div style={{ fontSize: 12, color: arrowColor, textAlign: 'right' }}>{paceArrow}</div>
                </div>
              )
            })}
          </div>
          {/* Pace trend mini chart */}
          {splits.length > 2 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>Pace trend</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 40 }}>
                {(() => {
                  const paces = splits.map(s => s.pace).filter(Boolean)
                  const minP = Math.min(...paces)
                  const maxP = Math.max(...paces)
                  const range = maxP - minP || 1
                  return splits.map((s, i) => {
                    const h = s.pace ? Math.round(((s.pace - minP) / range) * 32) + 8 : 8
                    const col = s.pace < (minP + range * 0.33) ? Z.accent : s.pace < (minP + range * 0.66) ? Z.amber : Z.red
                    return <div key={i} style={{ flex: 1, height: h, borderRadius: '2px 2px 0 0', background: col, opacity: 0.8 }} />
                  })
                })()}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: Z.muted, marginTop: 2 }}>
                <span>km 1</span><span>km {splits.length}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 20, borderBottom: `1px solid ${Z.border}` }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Per-km Splits</div>
          <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16, fontSize: 13, color: Z.muted }}>
            Full splits available for new activities. This activity was backfilled from summary data.
          </div>
        </div>
      )}

      {/* HR ZONES */}
      {totalZoneSecs > 0 && (
        <div style={{ padding: 20, borderBottom: `1px solid ${Z.border}` }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Heart Rate Zones</div>
          <ZoneBar label="Z1 Recovery <125bpm" secs={zones.z1 || 0} total={totalZoneSecs} color={Z.accent2} />
          <ZoneBar label="Z2 Aerobic 125–140bpm" secs={zones.z2 || 0} total={totalZoneSecs} color={Z.green} />
          <ZoneBar label="Z3 Tempo 140–158bpm" secs={zones.z3 || 0} total={totalZoneSecs} color={Z.amber} />
          <ZoneBar label="Z4 Threshold 158–172bpm" secs={zones.z4 || 0} total={totalZoneSecs} color={Z.red} />
          <ZoneBar label="Z5 VO2max >172bpm" secs={zones.z5 || 0} total={totalZoneSecs} color="#ff2222" />
          {/* HR summary */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, padding: '10px 12px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border}` }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: hrColor(activity.avg_hr) }}>{activity.avg_hr ? Math.round(activity.avg_hr) : '—'}</div>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase' }}>Avg HR</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: Z.red }}>{activity.max_hr || '—'}</div>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase' }}>Max HR</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: Z.text }}>{activity.duration_min || '—'}</div>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase' }}>Minutes</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: Z.amber }}>{rd.calories || activity.calories || '—'}</div>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase' }}>Kcal</div>
            </div>
          </div>
        </div>
      )}

      {/* GYM LOGGER — shown for strength/weight training */}
      {(activity.type?.toLowerCase().includes('weight') || activity.type?.toLowerCase().includes('strength') || activity.type?.toLowerCase().includes('cross')) && (
        <div style={{ padding: 20, borderBottom: `1px solid ${Z.border}` }}>
          <GymLogger stravaId={activity.strava_id} activityDate={activity.date} />
        </div>
      )}

      {/* COACHING FEEDBACK */}
      <div style={{ padding: 20 }}>
        <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Coaching Feedback</div>
        <CoachingFeedback stravaId={stravaId} />
      </div>
    </div>
  )
}

function CoachingFeedback({ stravaId }) {
  const [feedback, setFeedback] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('coaching_memory')
      .select('content, created_at')
      .eq('activity_id', stravaId)
      .eq('category', 'activity_feedback')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => { setFeedback(data?.[0]); setLoading(false) })
  }, [stravaId])

  if (loading) return <div style={{ color: Z.muted, fontSize: 13 }}>Loading feedback...</div>
  if (!feedback) return <div style={{ background: '#111', border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16, fontSize: 13, color: Z.muted }}>No coaching feedback yet for this activity.</div>

  return (
    <div style={{ background: '#111', border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 10, color: Z.accent, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        {new Date(feedback.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · AI Coach
      </div>
      {feedback.content.split('\n').filter(l => l.trim()).map((line, i) => (
        <div key={i} style={{ padding: '6px 0 6px 16px', position: 'relative', borderTop: i > 0 ? `1px solid ${Z.border}` : 'none', fontSize: 13, color: '#c8c5bf', lineHeight: 1.6 }}>
          <span style={{ position: 'absolute', left: 0, top: 8, color: line.includes('⚠') || line.toLowerCase().includes('warn') ? Z.amber : Z.accent, fontSize: 11 }}>→</span>
          {line.replace(/^→\s*/, '').replace(/^\•\s*/, '')}
        </div>
      ))}
    </div>
  )
}
