import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/useSettings'
import { buildSystemPrompt } from '../lib/coachingPrompt'

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const SESSION_CONTEXT = {
  run: {
    icon: '🏃',
    why: {
      Z2: "Zone 2 builds the aerobic engine — the foundation everything else runs on. At sub-140bpm your body runs primarily on fat oxidation, building mitochondrial density and cardiac efficiency. For sub-3:10, roughly 65-70% of all running volume needs to be Z2. It's not sexy but it's how you run a 4:30/km for 42km without blowing up at km 30.",
      Z4: "Threshold work raises your lactate threshold — the pace you can sustain before lactic acid accumulates faster than it clears. One quality session per week is optimal. More than that in base phase raises injury risk and blunts Z2 adaptation.",
    }
  },
  trail: { icon: '⛰️', why: { default: "Trail running builds running-specific strength — glutes, hips, ankles, proprioception — that road running doesn't touch. The elevation also builds cardiac reserve. Every metre of vert now makes the flat marathon feel easier." } },
  strength: { icon: '🏋️', why: { default: "Strength work in marathon training reduces injury risk, improves running economy, and adds power to your push-off. The compound lifts (squat, deadlift, hip thrust) directly target the muscle groups that produce force in running. Non-negotiable." } },
  rest: { icon: '😴', why: { default: "Adaptation happens during recovery, not training. Your muscles, connective tissue, and nervous system rebuild during rest. Skipping rest days doesn't build fitness — it delays it." } }
}

function OptionCard({ icon, title, desc, col }) {
  return (
    <div style={{ background: '#1a1a1a', border: `1px solid ${col}30`, borderRadius: 10, padding: 12, marginBottom: 8 }}>
      <div style={{ fontSize: 13, color: col, fontWeight: 600, marginBottom: 4 }}>{icon} {title}</div>
      <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5 }}>{desc}</div>
    </div>
  )
}

export default function SessionDetail({ session, onClose }) {
  const settings = useSettings()
  const [coaching, setCoaching] = useState(null)
  const [loadingCoach, setLoadingCoach] = useState(false)

  const ctx = SESSION_CONTEXT[session.session_type] || SESSION_CONTEXT.rest
  const zone = session.zone?.split('-')[0]?.trim()
  const whyText = ctx.why?.[zone] || ctx.why?.default || "This session is part of your structured base build phase."

  async function getAICoaching() {
    setLoadingCoach(true)
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5',
          max_tokens: 500,
          system: buildSystemPrompt(settings) + '\n\nTask: pre-session coaching brief. Keep each section to 1-2 sentences max.',
          messages: [{ role: 'user', content: `Give me a detailed coaching brief for this session:
Session: ${session.name}
Type: ${session.session_type}
Intensity: ${session.intensity}
Zone: ${session.zone || 'N/A'}
Duration: ${session.duration_min_low}-${session.duration_min_high} min
Notes: ${session.notes}
Location: ${session.location || 'N/A'}
${session.elevation_target_m > 0 ? `Elevation target: ${session.elevation_target_m}m` : ''}

Provide:
1. KEY FOCUS: One sentence on what to nail today
2. EXECUTION: Specific numbers — pace targets, HR caps, structure
3. PUSH HARDER: What to do if feeling strong
4. BACK OFF: What to do if tired/unwell
5. DONE RIGHT: How you'll know it was a good session

Keep each section to 1-2 sentences max.` }]
        })
      })
      const data = await resp.json()
      setCoaching(data.content[0].text)
    } catch(e) { setCoaching('Coach unavailable right now.') }
    setLoadingCoach(false)
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
              <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 800, color: Z.text }}>{ctx.icon} {session.name}</div>
              <div style={{ fontSize: 11, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 }}>
                {session.zone && `${session.zone} · `}{session.duration_min_low}-{session.duration_min_high} min · {session.intensity}
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

          {/* Quick options */}
          <OptionCard icon="✓" title="Feeling good — stay the course" desc={session.notes} col={Z.green} />
          <OptionCard icon="⚡" title="Feeling strong — push harder"
            desc={session.session_type === 'run' ? (session.zone?.includes('Z2') ? "Add 2 strides at the end (4×20sec at 5K effort). Don't change the main body — you'll need that aerobic work." : "Add one extra interval rep. Keep the same pace — more volume at quality, not faster.") : session.session_type === 'strength' ? "Add one extra working set to your primary lift. Add 2.5-5kg to your main compound." : "Push to the upper end of the duration window and target the higher elevation."}
            col={Z.accent} />
          <OptionCard icon="😴" title="Feeling tired — back off"
            desc={session.session_type === 'run' ? (session.zone?.includes('Z2') ? "Drop to pure Z1 (HR under 125). Cut 10-15 min from the session. Rest is better than junk miles." : "Convert to easy Z2 run at same duration. A quality session on tired legs is worse than no quality session.") : session.session_type === 'strength' ? "Reduce to 3 sets instead of 4. Drop weight by 10-15%. Focus on movement quality over load." : "Cut the session in half. Or rest completely — one missed session never ruined a training block."}
            col={Z.amber} />
          <OptionCard icon="🤒" title="Feeling unwell — skip it"
            desc="If you have a fever, body aches, or anything above the neck that's symptomatic — skip. Training when ill doesn't build fitness. It delays recovery and can extend illness from 3 days to 10."
            col={Z.red} />

          {/* AI coaching brief */}
          {!coaching && (
            <button onClick={getAICoaching} disabled={loadingCoach} style={{ width: '100%', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: '12px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: loadingCoach ? 'wait' : 'pointer', color: loadingCoach ? Z.muted : Z.text, marginTop: 8 }}>
              {loadingCoach ? '⏳ Getting coach brief...' : '→ Get personalised coaching brief'}
            </button>
          )}
          {coaching && (
            <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 14, marginTop: 8 }}>
              <div style={{ fontSize: 10, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Coach brief</div>
              {coaching.split('\n').filter(l => l.trim()).map((line, i) => (
                <div key={i} style={{ padding: '5px 0 5px 14px', position: 'relative', borderTop: i > 0 ? `1px solid ${Z.border}` : 'none', fontSize: 12, color: '#c8c5bf', lineHeight: 1.5 }}>
                  <span style={{ position: 'absolute', left: 0, top: 7, color: Z.accent, fontSize: 10 }}>→</span>
                  {line.replace(/^\d+\.\s*/, '').replace(/\*\*(.*?)\*\*/g, '$1')}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
