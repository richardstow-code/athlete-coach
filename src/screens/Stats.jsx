import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

function ZoneBar({ label, pct, color, value, warn }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px', color: '#888580' }}>
        <span>{label}</span>
        <span style={{ color: warn ? '#ffb347' : color }}>{value}{warn ? ' ⚠' : ''}</span>
      </div>
      <div style={{ height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: warn ? '#ffb347' : color, borderRadius: '3px', transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function WeekBar({ label, km, max, isCurrentWeek }) {
  const pct = max > 0 ? (km / max) * 100 : 0
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', height: '100%', justifyContent: 'flex-end' }}>
      <div style={{ width: '100%', borderRadius: '3px 3px 0 0', background: isCurrentWeek ? '#e8ff47' : (km > 0 ? '#1a1a1a' : '#141414'), height: `${Math.max(pct, 3)}%`, borderTop: km > 0 && !isCurrentWeek ? '2px solid #47d4ff' : 'none', minHeight: '4px', transition: 'height 0.4s ease' }} />
      <div style={{ fontSize: '10px', color: '#888580', letterSpacing: '0.04em' }}>{label}</div>
    </div>
  )
}

const PENDING = [
  { text: '5km time trial — week of 17 Mar (zone calibration)', warn: false },
  { text: 'Strength benchmark — squat 3RM, pull-up max, plank hold', warn: false },
  { text: 'Book physio for right shoulder — before end March', warn: true },
  { text: 'Ultra race decision — confirm or close door by end April', warn: false },
]

export default function Stats() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('activities').select('*').order('date', { ascending: false }).limit(30)
      .then(({ data }) => { if (data) setActivities(data); setLoading(false) })
  }, [])

  // Build weekly buckets aligned to Monday
  const now = new Date()
  const weeks = []
  for (let w = 5; w >= 0; w--) {
    const start = new Date(now)
    const sd = start.getDay()
    start.setDate(start.getDate() - (sd === 0 ? 6 : sd - 1) - (w * 7))
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    const wActs = activities.filter(a => { const d = new Date(a.date); return d >= start && d <= end })
    const km = wActs.reduce((s, a) => s + (parseFloat(a.distance_km) || 0), 0)
    weeks.push({ label: `W${6 - w}`, km: parseFloat(km.toFixed(1)), isCurrent: w === 0 })
  }
  const maxKm = Math.max(...weeks.map(w => w.km), 40)

  const weekStart = new Date()
  const _sd = weekStart.getDay()
  weekStart.setDate(weekStart.getDate() - (_sd === 0 ? 6 : _sd - 1))
  weekStart.setHours(0, 0, 0, 0)
  const weekActs = activities.filter(a => new Date(a.date) >= weekStart)
  const weekKm = weekActs.reduce((s, a) => s + (parseFloat(a.distance_km) || 0), 0)
  const weekElev = weekActs.reduce((s, a) => s + (parseFloat(a.elevation_m) || 0), 0)
  const weekStrength = weekActs.filter(a => a.type?.toLowerCase().includes('weight')).length

  const raceDate = new Date('2026-10-12')
  const daysToRace = Math.ceil((raceDate - now) / (1000 * 60 * 60 * 24))

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>

      {/* WEEKLY VOLUME */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '11px', color: '#888580', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>Weekly Volume · km</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '6px', height: '100px', paddingBottom: '24px' }}>
          {weeks.map((w, i) => <WeekBar key={i} label={w.label} km={w.km} max={maxKm} isCurrentWeek={w.isCurrent} />)}
        </div>
      </div>

      {/* PHASE TARGETS */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '11px', color: '#888580', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>This Week vs Targets</div>
        <ZoneBar label="Weekly km (target 28–35)" pct={(weekKm / 35) * 100} color="#e8ff47" value={`${weekKm.toFixed(1)}km`} />
        <ZoneBar label="Elevation m (target 100–200m)" pct={(weekElev / 200) * 100} color="#e8ff47" value={`${Math.round(weekElev)}m`} warn={weekElev > 200} />
        <ZoneBar label="Strength sessions (min 2)" pct={(weekStrength / 2) * 100} color="#4dff91" value={`${weekStrength} sessions`} />
      </div>

      {/* SEASON STATS */}
      <div style={{ padding: '20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ fontSize: '11px', color: '#888580', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>Season</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(255,255,255,0.08)' }}>
          {[
            { val: '2', lbl: 'Wks done', color: '#e8ff47' },
            { val: '7', lbl: 'Phase left', color: '#f0ede8' },
            { val: daysToRace, lbl: 'Race days', color: '#47d4ff' },
            { val: '⏳', lbl: 'TT pending', color: '#ffb347' },
          ].map((s, i) => (
            <div key={i} style={{ background: '#0a0a0a', padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '22px', fontWeight: 700, lineHeight: 1, marginBottom: '3px', color: s.color }}>{s.val}</div>
              <div style={{ fontSize: '10px', color: '#888580', letterSpacing: '0.06em', textTransform: 'uppercase' }}>{s.lbl}</div>
            </div>
          ))}
        </div>
      </div>

      {/* PENDING ACTIONS */}
      <div style={{ padding: '20px' }}>
        <div style={{ fontSize: '11px', color: '#888580', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '14px' }}>Pending Actions</div>
        <div style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '16px' }}>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {PENDING.map((p, i) => (
              <li key={i} style={{ padding: '6px 0 6px 16px', position: 'relative', borderTop: i > 0 ? '1px solid rgba(255,255,255,0.08)' : 'none', lineHeight: 1.6, color: '#c8c5bf', fontSize: '13px' }}>
                <span style={{ position: 'absolute', left: 0, color: p.warn ? '#ffb347' : '#e8ff47', fontSize: '11px', top: '8px' }}>{p.warn ? '⚠' : '→'}</span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
