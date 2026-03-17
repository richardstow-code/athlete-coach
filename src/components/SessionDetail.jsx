import { useState, useEffect } from 'react'
import { useSettings } from '../lib/useSettings'
import { buildSystemPrompt } from '../lib/coachingPrompt'

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const SESSION_ICON = { run: '🏃', trail: '⛰️', strength: '🏋️', rest: '😴' }

const WHY_TEXT = {
  run: {
    Z2: "Zone 2 builds the aerobic engine. At sub-140bpm your body runs on fat oxidation, building mitochondrial density and cardiac efficiency. For sub-3:10, ~65-70% of all volume needs to be Z2 — it's how you sustain 4:30/km for 42km.",
    Z4: "Threshold work raises the pace you can sustain before lactate accumulates faster than it clears. One quality session per week in base phase is optimal — more raises injury risk and blunts Z2 adaptation.",
    default: "Quality run session — part of your structured build toward Munich.",
  },
  trail: { default: "Trail builds running-specific strength — glutes, hips, ankles, proprioception — that road running doesn't touch. Every metre of vert now makes the flat marathon feel easier." },
  strength: { default: "Strength work reduces injury risk, improves running economy, and adds power to your push-off. The compound lifts directly target the muscles that produce force in running. Non-negotiable for a sub-3:10." },
  rest: { default: "Adaptation happens during recovery. Muscles, connective tissue, and nervous system rebuild at rest. Skipping rest doesn't build fitness — it delays it." },
}

// ── Strength Workout Display ───────────────────────────────────
function StrengthWorkout({ workout, loading }) {
  if (loading) return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10, color: Z.amber, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Today's workout</div>
      <div style={{ fontSize: 12, color: Z.muted }}>⏳ Building your session...</div>
    </div>
  )
  if (!workout) return null

  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px 10px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: 10, color: Z.amber, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Today's workout</div>
        {workout.focus && <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, lineHeight: 1.4 }}>{workout.focus}</div>}
      </div>

      {workout.warmup && (
        <div style={{ padding: '8px 14px', borderBottom: `1px solid ${Z.border}`, display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, width: 56 }}>Warmup</div>
          <div style={{ fontSize: 12, color: '#c8c5bf', lineHeight: 1.4 }}>{workout.warmup}</div>
        </div>
      )}

      {(workout.exercises || []).map((ex, i) => (
        <div key={i} style={{ padding: '11px 14px', borderBottom: `1px solid ${Z.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: ex.cue ? 6 : 0 }}>
            <div style={{ fontSize: 13, color: Z.text, fontWeight: 600, flex: 1, marginRight: 8 }}>{ex.name}</div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
              <div style={{ background: '#1a1a1a', borderRadius: 5, padding: '3px 8px', fontSize: 11, color: Z.accent, fontWeight: 600 }}>
                {ex.sets}×{ex.reps}
              </div>
              {ex.weight && (
                <div style={{ background: '#1a1a1a', borderRadius: 5, padding: '3px 8px', fontSize: 11, color: Z.accent2 }}>
                  {ex.weight}
                </div>
              )}
            </div>
          </div>
          {ex.cue && <div style={{ fontSize: 11, color: Z.muted, lineHeight: 1.4 }}>{ex.cue}</div>}
          {ex.rest && <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>Rest: {ex.rest}</div>}
        </div>
      ))}

      {workout.cooldown && (
        <div style={{ padding: '8px 14px', display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0, width: 56 }}>Cooldown</div>
          <div style={{ fontSize: 12, color: '#c8c5bf', lineHeight: 1.4 }}>{workout.cooldown}</div>
        </div>
      )}
    </div>
  )
}

// ── Run Brief Display ─────────────────────────────────────────
function RunBrief({ brief, loading }) {
  if (loading) return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 10, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Session plan</div>
      <div style={{ fontSize: 12, color: Z.muted }}>⏳ Building your session...</div>
    </div>
  )
  if (!brief) return null

  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: 10, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Session plan</div>
      </div>
      {brief.split('\n').filter(l => l.trim()).map((line, i) => (
        <div key={i} style={{ padding: '8px 14px 8px 26px', position: 'relative', borderBottom: `1px solid ${Z.border}`, fontSize: 12, color: '#c8c5bf', lineHeight: 1.5 }}>
          <span style={{ position: 'absolute', left: 12, top: 10, color: Z.accent, fontSize: 10 }}>→</span>
          {line.replace(/^\d+\.\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1')}
        </div>
      ))}
    </div>
  )
}

export default function SessionDetail({ session, onClose }) {
  const settings = useSettings()
  const [coaching, setCoaching] = useState(null)
  const [loading, setLoading] = useState(true)

  const isStrength = session.session_type === 'strength'
  const icon = SESSION_ICON[session.session_type] || '📋'
  const zone = session.zone?.split('-')[0]?.trim()
  const whyMap = WHY_TEXT[session.session_type] || WHY_TEXT.rest
  const whyText = whyMap[zone] || whyMap.default

  useEffect(() => { fetchCoaching() }, [])

  async function fetchCoaching() {
    setLoading(true)
    try {
      const system = buildSystemPrompt(settings)

      if (isStrength) {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 900,
            system: system + '\n\nTask: generate a complete strength workout. Respond ONLY with valid JSON, no other text.',
            messages: [{ role: 'user', content: `Generate a complete strength session for:
Session: ${session.name}
Duration: ${session.duration_min_low}–${session.duration_min_high} min
Intensity: ${session.intensity}
Notes/focus: ${session.notes || 'general strength'}

Return JSON exactly:
{
  "focus": "one sentence on today's primary goal",
  "warmup": "specific warmup — movements and duration",
  "exercises": [
    {"name": "Exercise name", "sets": 3, "reps": "8-10", "weight": "RPE 7 or % of 1RM or kg suggestion", "rest": "90sec", "cue": "one coaching cue"}
  ],
  "cooldown": "specific cooldown"
}

Include 4-6 exercises relevant to marathon strength training. Use RPE or % 1RM for weight guidance, not absolute kg unless directly relevant.` }]
          })
        })
        const data = await resp.json()
        const raw = data.content[0].text.replace(/```json|```/g, '').trim()
        setCoaching({ type: 'strength', data: JSON.parse(raw) })
      } else {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 500,
            system: system + '\n\nTask: pre-session run brief. Be specific with numbers. No generic advice.',
            messages: [{ role: 'user', content: `Session brief for:
Session: ${session.name}
Type: ${session.session_type}
Zone: ${session.zone || 'N/A'}
Duration: ${session.duration_min_low}–${session.duration_min_high} min
Intensity: ${session.intensity}
Notes: ${session.notes || 'N/A'}
${session.location ? `Location: ${session.location}` : ''}
${session.elevation_target_m > 0 ? `Elevation target: ${session.elevation_target_m}m` : ''}

Provide 4 lines:
STRUCTURE: Warmup/main/cooldown breakdown with durations
PACING: Exact pace range and HR cap/target for this zone
KEY FOCUS: The one thing to nail today
DONE RIGHT: How you'll know it was a good session` }]
          })
        })
        const data = await resp.json()
        setCoaching({ type: 'run', data: data.content[0].text })
      }
    } catch(e) { console.error('SessionDetail coaching failed', e) }
    setLoading(false)
  }

  const dateStr = new Date(session.planned_date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ position: 'relative', background: Z.bg, borderRadius: '16px 16px 0 0', border: `1px solid ${Z.border2}`, maxHeight: '88vh', overflowY: 'auto' }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
          <div style={{ width: 36, height: 4, background: Z.border2, borderRadius: 2 }} />
        </div>

        <div style={{ padding: '14px 20px 32px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{dateStr}</div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, color: Z.text }}>{icon} {session.name}</div>
              <div style={{ fontSize: 11, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                {session.zone && `${session.zone} · `}{session.duration_min_low}–{session.duration_min_high} min · {session.intensity}
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 4 }}>×</button>
          </div>

          {/* Why this session */}
          <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 10, color: Z.accent2, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Why this session</div>
            <div style={{ fontSize: 13, color: '#c8c5bf', lineHeight: 1.6 }}>{whyText}</div>
          </div>

          {/* Location + elevation */}
          {(session.location || session.elevation_target_m > 0) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {session.location && (
                <div style={{ flex: 1, background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 3 }}>Location</div>
                  <div style={{ fontSize: 12, color: Z.text }}>{session.location}</div>
                </div>
              )}
              {session.elevation_target_m > 0 && (
                <div style={{ flex: 1, background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', marginBottom: 3 }}>Vert target</div>
                  <div style={{ fontSize: 12, color: Z.accent2 }}>⛰ {session.elevation_target_m}m</div>
                </div>
              )}
            </div>
          )}

          {/* Session plan — strength or run */}
          {isStrength
            ? <StrengthWorkout workout={coaching?.data} loading={loading} />
            : <RunBrief brief={coaching?.data} loading={loading} />
          }
        </div>
      </div>
    </div>
  )
}
