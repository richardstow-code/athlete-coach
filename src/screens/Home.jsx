import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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

export default function Home({ onActivityClick }) {
  const [activities, setActivities] = useState([])
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: acts }, { data: brief }] = await Promise.all([
        supabase.from('activities').select('*').order('date', { ascending: false }).limit(5),
        supabase.from('daily_briefings').select('id, date, briefing_text, created_at').order('created_at', { ascending: false }).limit(1),
      ])
      if (acts) setActivities(acts)
      if (brief && brief[0]) setBriefing(brief[0])
      setLoading(false)
    }
    load()
  }, [])

  // Calculate this week's stats (week starts Monday)
  const weekStart = new Date()
  const _day = weekStart.getDay() // 0=Sun, 1=Mon...
  const _daysFromMon = _day === 0 ? 6 : _day - 1
  weekStart.setDate(weekStart.getDate() - _daysFromMon)
  weekStart.setHours(0, 0, 0, 0)
  const weekActs = activities.filter(a => new Date(a.date) >= weekStart)
  const weekKm = weekActs.reduce((s, a) => s + (parseFloat(a.distance_km) || 0), 0)
  const weekElev = weekActs.reduce((s, a) => s + (parseFloat(a.elevation_m) || 0), 0)
  const weekStrength = weekActs.filter(a => a.type?.toLowerCase().includes('weight')).length

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const raceDate = new Date('2026-10-12')
  const daysToRace = Math.ceil((raceDate - new Date()) / (1000 * 60 * 60 * 24))

  // Last run for zone bars
  const lastRun = activities.find(a => a.type?.toLowerCase().includes('run'))

  return (
    <div style={S.page}>
      <div style={S.hero}>
        <div style={S.label}>{today}</div>
        <div style={S.greeting}>Week 2<br />Base Build</div>
        <div style={S.date}>Munich Marathon · {daysToRace} days</div>
      </div>

      <div style={S.statStrip}>
        <div style={S.statCell}>
          <div style={{ ...S.statVal, color: '#e8ff47' }}>{weekKm.toFixed(1)}</div>
          <div style={S.statLbl}>km this wk</div>
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
