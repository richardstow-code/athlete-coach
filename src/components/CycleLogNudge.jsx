import { useState } from 'react'
import { supabase } from '../lib/supabase'

const Z = {
  bg: '#0a0a0a', surface: '#111111',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#f0ede8', muted: '#888580', accent: '#e8ff47', accent2: '#47d4ff',
}

const PHASE_OPTIONS = [
  { value: 'feeling_good', label: 'Feeling good' },
  { value: 'high_energy',  label: 'High energy' },
  { value: 'low_energy',   label: 'Low energy' },
  { value: 'pms',          label: 'PMS' },
  { value: 'menstruating', label: 'Period' },
  { value: 'other',        label: 'Other' },
]

const INTENSITY_OPTIONS = [
  { value: 'maintain', label: 'Normal plan' },
  { value: 'reduce',   label: 'Go easier' },
  { value: 'rest',     label: 'Rest day' },
]

export default function CycleLogNudge({ onDismiss }) {
  const [expanded, setExpanded] = useState(false)
  const [phase, setPhase] = useState(null)
  const [intensity, setIntensity] = useState(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!phase || submitting) return
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('cycle_logs').upsert({
          user_id: user.id,
          log_date: new Date().toISOString().slice(0, 10),
          phase_reported: phase,
          override_intensity: intensity || null,
          notes: notes.trim() || null,
        }, { onConflict: 'user_id,log_date' })
      }
    } catch { /* non-fatal */ }
    onDismiss()
  }

  function handleSkip() {
    onDismiss()
  }

  if (!expanded) {
    return (
      <div style={{
        padding: '8px 16px', background: Z.surface,
        borderBottom: `1px solid ${Z.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: Z.muted }}>How are you feeling today?</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setExpanded(true)} style={{
            background: 'none', border: `1px solid ${Z.border2}`,
            borderRadius: 20, padding: '4px 10px', fontSize: 11,
            color: Z.accent, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
          }}>
            Log
          </button>
          <button onClick={handleSkip} style={{
            background: 'none', border: 'none', color: Z.muted,
            fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
          }}>
            skip
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '12px 16px 14px', background: Z.surface,
      borderBottom: `1px solid ${Z.border2}`, flexShrink: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
          How are you feeling today?
        </span>
        <button onClick={handleSkip} style={{
          background: 'none', border: 'none', color: Z.muted,
          fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0,
        }}>skip</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: phase ? 10 : 0 }}>
        {PHASE_OPTIONS.map(o => (
          <button key={o.value} onClick={() => setPhase(phase === o.value ? null : o.value)} style={{
            padding: '5px 12px', borderRadius: 20, fontSize: 11,
            border: `1px solid ${phase === o.value ? Z.accent : Z.border2}`,
            background: phase === o.value ? 'rgba(232,255,71,0.1)' : 'transparent',
            color: phase === o.value ? Z.accent : Z.muted,
            cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s',
          }}>
            {o.label}
          </button>
        ))}
      </div>

      {phase && (
        <>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: Z.muted, marginBottom: 6, letterSpacing: '0.04em' }}>
              Training intensity today? (optional)
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {INTENSITY_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setIntensity(intensity === o.value ? null : o.value)} style={{
                  padding: '5px 12px', borderRadius: 20, fontSize: 11,
                  border: `1px solid ${intensity === o.value ? Z.accent2 : Z.border2}`,
                  background: intensity === o.value ? 'rgba(71,212,255,0.1)' : 'transparent',
                  color: intensity === o.value ? Z.accent2 : Z.muted,
                  cursor: 'pointer', fontFamily: "'DM Mono', monospace", transition: 'all 0.15s',
                }}>
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Anything else? (optional)"
              rows={1}
              style={{
                flex: 1, background: Z.bg, border: `1px solid ${Z.border2}`,
                borderRadius: 8, padding: '7px 10px', color: Z.text,
                fontFamily: "'DM Mono', monospace", fontSize: 12,
                resize: 'none', outline: 'none', minHeight: 32, maxHeight: 80, lineHeight: 1.4,
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                width: 32, height: 32,
                background: !submitting ? Z.accent : '#1a1a1a',
                border: 'none', borderRadius: 8,
                cursor: !submitting ? 'pointer' : 'default',
                fontSize: 13, color: Z.bg, flexShrink: 0,
              }}
            >
              {submitting ? '…' : '↑'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
