import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { savePostRunCheckin } from '../lib/injuryWorkflow'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

function hrColor(hr) {
  if (!hr) return Z.muted
  if (hr < 125) return Z.accent2
  if (hr < 140) return Z.green
  if (hr < 158) return Z.amber
  if (hr < 172) return Z.red
  return '#ff2222'
}

const FEEL_OPTIONS = [
  { value: 1, emoji: '💀', label: 'Destroyed' },
  { value: 2, emoji: '😓', label: 'Tough' },
  { value: 3, emoji: '😐', label: 'Okay' },
  { value: 4, emoji: '😊', label: 'Good' },
  { value: 5, emoji: '🔥', label: 'Felt great' },
]

export default function PostWorkoutPopup({ onDismiss, onViewDetail }) {
  const [activity, setActivity] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [visible, setVisible] = useState(false)

  // Check-in state
  const [sessionFeel, setSessionFeel] = useState(null)
  const [injuryChoice, setInjuryChoice] = useState(null) // null | 'good' | 'flag'
  const [injuryNotes, setInjuryNotes] = useState('')
  const [bodyLocation, setBodyLocation] = useState('')
  const [saving, setSaving] = useState(false)
  const [checkinResult, setCheckinResult] = useState(null) // null | { severity, message }

  useEffect(() => {
    async function checkLatest() {
      const fourHoursAgo = new Date(Date.now() - 4*60*60*1000).toISOString()
      const { data: acts } = await supabase
        .from('activities')
        .select('*')
        .gte('date', fourHoursAgo)
        .order('date', { ascending: false })
        .limit(1)

      if (!acts?.[0]) return
      const latest = acts[0]
      const alreadySeen = sessionStorage.getItem('seen_activity') === String(latest.strava_id)

      if (!alreadySeen) {
        setActivity(latest)
        const { data: mem } = await supabase
          .from('coaching_memory')
          .select('content, created_at')
          .eq('activity_id', latest.strava_id)
          .eq('category', 'activity_feedback')
          .order('created_at', { ascending: false })
          .limit(1)
        if (mem?.[0]) setFeedback(mem[0].content)
        setVisible(true)
      }
    }

    checkLatest()
    const interval = setInterval(checkLatest, 60000)
    return () => clearInterval(interval)
  }, [])

  async function handleSaveAndDismiss() {
    if (saving || !activity) { dismiss(); return }

    const hasFlag = injuryChoice === 'flag'
    // Only save if something was selected
    if (!sessionFeel && !hasFlag) { dismiss(); return }

    setSaving(true)
    try {
      const activitySummary = [
        activity.distance_km ? `${parseFloat(activity.distance_km).toFixed(1)}km` : null,
        activity.pace_per_km ? `${activity.pace_per_km}/km pace` : null,
        activity.duration_min ? `${Math.round(activity.duration_min)}min` : null,
        activity.avg_hr ? `avg HR ${Math.round(activity.avg_hr)}` : null,
      ].filter(Boolean).join(', ')

      const result = await savePostRunCheckin({
        activityId: activity.id,
        sessionFeel,
        hasInjuryFlag: hasFlag,
        athleteNotes: hasFlag ? injuryNotes || null : null,
        bodyLocation: hasFlag ? bodyLocation || null : null,
        activitySummary,
      })

      if (result.injuryFlagged) {
        const sev = result.severity
        const msg = sev === 'minor'
          ? "Noted — I'll check in tomorrow."
          : "Got it. I've assessed this and proposed some plan changes for your review."
        setCheckinResult({ severity: sev, message: msg })
        // Show message briefly then dismiss
        setTimeout(() => dismiss(), 3500)
      } else {
        dismiss()
      }
    } catch (e) {
      console.error('Check-in save failed:', e)
      dismiss()
    }
    setSaving(false)
  }

  function dismiss() {
    if (activity) sessionStorage.setItem('seen_activity', String(activity.strava_id))
    setVisible(false)
    onDismiss?.()
  }

  function viewDetail() {
    dismiss()
    onViewDetail?.(activity.strava_id)
  }

  if (!visible || !activity) return null

  const rd = activity.raw_data || {}
  const zones = rd.zones || {}
  const totalZoneSecs = Object.values(zones).reduce((s, v) => s + v, 0)
  const pace = activity.distance_km && activity.duration_min
    ? (() => { const s = Math.round((activity.duration_min * 60) / parseFloat(activity.distance_km)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` })()
    : activity.pace_per_km || '—'

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div onClick={dismiss} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />

      {/* Sheet */}
      <div style={{ position: 'relative', background: Z.bg, borderRadius: '16px 16px 0 0', border: `1px solid ${Z.border2}`, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: Z.border2 }} />
        </div>

        <div style={{ padding: '16px 20px 36px' }}>
          {/* Badge */}
          <div style={{ display: 'inline-block', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, background: 'rgba(232,255,71,0.15)', color: Z.accent, marginBottom: 12 }}>
            Workout complete
          </div>

          {/* Activity name */}
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, color: Z.text, marginBottom: 4 }}>{activity.name}</div>
          <div style={{ fontSize: 12, color: Z.muted, marginBottom: 20 }}>
            {new Date(activity.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, background: Z.border, borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
            {[
              { val: parseFloat(activity.distance_km || 0).toFixed(1), lbl: 'km', col: Z.accent },
              { val: pace, lbl: '/km', col: Z.text },
              { val: activity.avg_hr ? Math.round(activity.avg_hr) : '—', lbl: 'avg HR', col: activity.avg_hr ? hrColor(activity.avg_hr) : Z.muted },
              { val: activity.elevation_m || 0, lbl: 'elev m', col: Z.accent2 },
            ].map((s, i) => (
              <div key={i} style={{ background: Z.surface, padding: '12px 8px', textAlign: 'center' }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: s.col, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: 10, color: Z.muted, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.lbl}</div>
              </div>
            ))}
          </div>

          {/* Zone bars */}
          {totalZoneSecs > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>HR Zones</div>
              {[
                { z: 'z2', label: 'Z2 Aerobic', color: Z.green },
                { z: 'z3', label: 'Z3 Tempo', color: Z.amber },
                { z: 'z4', label: 'Z4 Threshold', color: Z.red },
              ].map(({ z, label, color }) => {
                const pct = zones[z] ? Math.round((zones[z] / totalZoneSecs) * 100) : 0
                if (pct === 0) return null
                return (
                  <div key={z} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span style={{ color }}>{label}</span><span style={{ color: Z.muted }}>{pct}%</span>
                    </div>
                    <div style={{ height: 5, background: '#1a1a1a', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Coaching feedback */}
          {feedback && (
            <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Coach feedback</div>
              {feedback.split('\n').filter(l => l.trim()).slice(0, 3).map((line, i) => (
                <div key={i} style={{ padding: '5px 0 5px 14px', position: 'relative', borderTop: i > 0 ? `1px solid ${Z.border}` : 'none', fontSize: 12, color: '#c8c5bf', lineHeight: 1.5 }}>
                  <span style={{ position: 'absolute', left: 0, top: 7, color: Z.accent, fontSize: 10 }}>→</span>
                  {line.replace(/^→\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '')}
                </div>
              ))}
            </div>
          )}

          {/* ── HOW DID IT FEEL? ── */}
          {!checkinResult && (
            <div style={{ background: Z.surface, border: `1px solid ${Z.border}`, borderRadius: 12, padding: '16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>How did it feel?</div>

              {/* Feel rating */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                {FEEL_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSessionFeel(sessionFeel === opt.value ? null : opt.value)}
                    style={{
                      minWidth: 44, minHeight: 44,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      background: sessionFeel === opt.value ? 'rgba(232,255,71,0.12)' : 'transparent',
                      border: sessionFeel === opt.value ? `1.5px solid ${Z.accent}` : '1.5px solid transparent',
                      borderRadius: 10, cursor: 'pointer', gap: 3, padding: '6px 4px',
                    }}
                  >
                    <span style={{ fontSize: 22, filter: sessionFeel && sessionFeel !== opt.value ? 'opacity(0.35)' : 'none' }}>{opt.emoji}</span>
                    <span style={{ fontSize: 9, color: sessionFeel === opt.value ? Z.accent : Z.muted, letterSpacing: '0.04em' }}>{opt.label}</span>
                  </button>
                ))}
              </div>

              {/* Injury flag */}
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 10 }}>Any pain, tightness or niggles to flag?</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: injuryChoice === 'flag' ? 12 : 0 }}>
                <button
                  onClick={() => setInjuryChoice(injuryChoice === 'good' ? null : 'good')}
                  style={{
                    flex: 1, padding: '9px', borderRadius: 8, cursor: 'pointer',
                    background: injuryChoice === 'good' ? 'rgba(77,255,145,0.12)' : 'rgba(255,255,255,0.04)',
                    border: injuryChoice === 'good' ? `1px solid ${Z.green}` : `1px solid ${Z.border}`,
                    color: injuryChoice === 'good' ? Z.green : Z.muted,
                    fontFamily: "'DM Mono', monospace", fontSize: 12,
                  }}
                >
                  All good 👍
                </button>
                <button
                  onClick={() => setInjuryChoice(injuryChoice === 'flag' ? null : 'flag')}
                  style={{
                    flex: 1, padding: '9px', borderRadius: 8, cursor: 'pointer',
                    background: injuryChoice === 'flag' ? 'rgba(255,179,71,0.12)' : 'rgba(255,255,255,0.04)',
                    border: injuryChoice === 'flag' ? `1px solid ${Z.amber}` : `1px solid ${Z.border}`,
                    color: injuryChoice === 'flag' ? Z.amber : Z.muted,
                    fontFamily: "'DM Mono', monospace", fontSize: 12,
                  }}
                >
                  Flag something ⚠️
                </button>
              </div>

              {/* Expanded injury form */}
              {injuryChoice === 'flag' && (
                <div style={{ marginTop: 12 }}>
                  <input
                    value={bodyLocation}
                    onChange={e => setBodyLocation(e.target.value)}
                    placeholder="Body location — e.g. left knee, right calf, lower back"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: '#161616', border: `1px solid ${Z.border2}`,
                      borderRadius: 8, padding: '10px 12px', marginBottom: 8,
                      color: Z.text, fontSize: 12, fontFamily: "'DM Mono', monospace", outline: 'none',
                    }}
                  />
                  <textarea
                    value={injuryNotes}
                    onChange={e => setInjuryNotes(e.target.value)}
                    placeholder="Describe it briefly — where, what it felt like, when it started."
                    rows={3}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: '#161616', border: `1px solid ${Z.border2}`,
                      borderRadius: 8, padding: '10px 12px',
                      color: Z.text, fontSize: 12, fontFamily: "'DM Mono', monospace",
                      resize: 'none', outline: 'none', lineHeight: 1.5,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Coach check-in result message */}
          {checkinResult && (
            <div style={{ background: checkinResult.severity === 'minor' ? 'rgba(77,255,145,0.08)' : 'rgba(255,179,71,0.08)', border: `1px solid ${checkinResult.severity === 'minor' ? 'rgba(77,255,145,0.3)' : 'rgba(255,179,71,0.3)'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: checkinResult.severity === 'minor' ? Z.green : Z.amber, lineHeight: 1.6 }}>
                {checkinResult.message}
              </div>
            </div>
          )}

          {/* Actions */}
          {!checkinResult && (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleSaveAndDismiss}
                disabled={saving}
                style={{ flex: 1, background: saving ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '12px', fontFamily: "'DM Mono', monospace", fontSize: 13, cursor: saving ? 'wait' : 'pointer', color: saving ? Z.muted : Z.bg, fontWeight: 500 }}
              >
                {saving ? 'Saving...' : 'Save check-in'}
              </button>
              <button
                onClick={viewDetail}
                style={{ flex: 1, background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '12px', fontFamily: "'DM Mono', monospace", fontSize: 13, cursor: 'pointer', color: Z.muted }}
              >
                Full breakdown →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
