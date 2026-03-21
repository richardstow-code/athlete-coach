import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { inferAthleteContext } from '../lib/inferAthleteContext'

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID

const Z = {
  bg: '#0a0a0a', surface: '#111111',
  border2: 'rgba(255,255,255,0.14)', border: 'rgba(255,255,255,0.08)',
  text: '#f0ede8', muted: '#888580',
  accent: '#e8ff47', red: '#ff5c5c', amber: '#ffb347',
}

const GOAL_TILES = [
  { value: 'compete',          icon: '🏆', label: 'Compete',          desc: 'Race or perform at your best' },
  { value: 'complete_event',   icon: '🎯', label: 'Complete an event', desc: 'Finish the thing, whatever it takes' },
  { value: 'body_composition', icon: '⚖️', label: 'Body composition',  desc: 'Lose weight or build muscle' },
  { value: 'general_fitness',  icon: '❤️', label: 'General fitness',   desc: 'Feel better, move more' },
  { value: 'injury_recovery',  icon: '🩹', label: 'Injury recovery',   desc: 'Rebuild after a setback' },
]

const SPORT_CHIPS = [
  'running', 'cycling', 'swimming', 'triathlon', 'hyrox',
  'strength', 'yoga', 'rowing', 'padel', 'crossfit',
  'football', 'martial arts', 'climbing', 'other',
]

const TARGET_CONFIG = {
  compete:          { label: 'What are you competing in?',       placeholder: 'e.g. Berlin Marathon in September — aiming for sub-3 hours' },
  complete_event:   { label: "What's the event?",               placeholder: 'e.g. first triathlon in July, Ride London 100' },
  body_composition: { label: "What's your goal?",               placeholder: 'e.g. lose 8kg by summer, get to 85kg by December' },
  general_fitness:  { label: 'What does success look like?',     placeholder: 'e.g. run 3× per week consistently, complete a 5k' },
  injury_recovery:  { label: 'What are you recovering towards?', placeholder: 'e.g. return to running after knee surgery' },
}

const LEVELS = [
  { value: 'beginner',    label: 'Beginner',    desc: 'New to this, learning the ropes' },
  { value: 'returning',   label: 'Returning',   desc: 'Done it before, getting back into it' },
  { value: 'regular',     label: 'Regular',     desc: 'Train consistently, know what you\'re doing' },
  { value: 'competitive', label: 'Competitive', desc: 'Performance-focused, serious about results' },
]

// Steps: 1=goal, 2=strava, 3=sports, 4=target, 5=level
const TOTAL_STEPS = 5

function Dots({ step }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 36 }}>
      {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n => (
        <div key={n} style={{
          height: 4, borderRadius: 2, transition: 'all 0.25s',
          width: n === step ? 24 : 8,
          background: n < step ? 'rgba(232,255,71,0.35)' : n === step ? Z.accent : Z.border2,
        }} />
      ))}
    </div>
  )
}

const inp = {
  background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8,
  padding: '12px 14px', color: Z.text, fontFamily: "'DM Mono', monospace",
  fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box',
}
const ta = { ...inp, resize: 'none', lineHeight: 1.65, minHeight: 90 }
const primaryBtn = (enabled = true) => ({
  width: '100%', background: Z.accent, border: 'none', borderRadius: 10,
  padding: '15px', fontFamily: "'DM Mono', monospace", fontSize: 14,
  fontWeight: 700, color: Z.bg, cursor: enabled ? 'pointer' : 'default',
  opacity: enabled ? 1 : 0.35, marginTop: 24,
})
const backBtn = {
  background: 'none', border: 'none', color: Z.muted, cursor: 'pointer',
  fontFamily: "'DM Mono', monospace", fontSize: 12,
  padding: '10px 0', display: 'block', margin: '6px auto 0',
}
const logoStyle = {
  fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17,
  color: Z.accent, letterSpacing: '-0.5px',
}
const h1 = {
  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 22,
  lineHeight: 1.2, color: Z.text, marginBottom: 6,
}
const sub = { fontSize: 13, color: Z.muted, marginBottom: 24, lineHeight: 1.6 }

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1)
  const [goalType, setGoalType]           = useState(null)
  const [sports, setSports]               = useState([]) // [{ sport_raw, priority, current_goal_raw }]
  const [sportInput, setSportInput]       = useState('')
  const [targetRaw, setTargetRaw]         = useState('')
  const [levelIndex, setLevelIndex]       = useState(1)   // default: 'returning'
  const [error, setError]                 = useState(null)

  function addSport(raw) {
    const trimmed = raw.trim()
    if (!trimmed || sports.find(s => s.sport_raw.toLowerCase() === trimmed.toLowerCase())) return
    const isFirst = sports.length === 0
    setSports(prev => [...prev, { sport_raw: trimmed, priority: isFirst ? 'primary' : 'supporting', current_goal_raw: '' }])
    setSportInput('')
  }

  function updateSport(index, field, value) {
    setSports(prev => prev.map((s, i) => {
      if (i !== index) {
        if (field === 'priority' && value === 'primary') return { ...s, priority: 'supporting' }
        return s
      }
      return { ...s, [field]: value }
    }))
  }

  function removeSport(index) {
    setSports(prev => {
      const next = prev.filter((_, i) => i !== index)
      if (prev[index].priority === 'primary' && next.length > 0) {
        next[0] = { ...next[0], priority: 'primary' }
      }
      return next
    })
  }

  function connectStrava() {
    const redirectUri = window.location.origin
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&approval_prompt=auto&scope=activity:read_all`
    window.location.href = url
  }

  async function handleSkip() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('athlete_settings').upsert(
        { user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    } catch { /* non-fatal */ }
    onComplete()
  }

  async function handleComplete() {
    setStep('submitting')
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // 1. Write raw inputs collected across steps
      await supabase.from('athlete_settings').upsert({
        user_id:       user.id,
        goal_type:     goalType,
        current_level: LEVELS[levelIndex].value,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id' })

      // 2. Insert sports into athlete_sports
      if (sports.length > 0) {
        await supabase.from('athlete_sports').insert(
          sports.map(s => ({
            user_id: user.id,
            sport_raw: s.sport_raw,
            priority: s.priority,
            current_goal_raw: s.current_goal_raw || null,
            lifecycle_state: 'planning',
          }))
        )
      }

      // 3. AI inference — non-fatal
      try {
        await inferAthleteContext({
          sports: sports.map(s => ({ sport_raw: s.sport_raw, current_goal_raw: s.current_goal_raw || null })),
          health_notes_raw: null,
          benchmark_raw:    null,
        })
      } catch { /* non-fatal */ }

      // 4. Finalise athlete_settings
      await supabase.from('athlete_settings').upsert({
        user_id:    user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })

      console.log('[Onboarding] Save result: success')

      // 5. Kick off historical Strava sync in background (non-blocking)
      supabase.functions.invoke('strava-sync', {
        body: { after: Math.floor((Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000) },
      }).catch(() => { /* non-fatal — user may not have Strava connected yet */ })

      onComplete()
    } catch (err) {
      console.log('[Onboarding] Save result:', null, err)
      setError(err.message || 'Something went wrong. Try again.')
      setStep(5)
    }
  }

  const shell = {
    height: '100dvh', display: 'flex', flexDirection: 'column',
    background: Z.bg, color: Z.text, fontFamily: "'DM Mono', monospace",
    maxWidth: 430, margin: '0 auto',
  }
  const body = {
    flex: 1, overflowY: 'auto', padding: '32px 24px 32px',
    display: 'flex', flexDirection: 'column',
  }

  // ── Submitting ────────────────────────────────────────────────────────────
  if (step === 'submitting') return (
    <div style={{ ...shell, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
      <div style={logoStyle}>COACH</div>
      <div style={{ fontSize: 12, color: Z.muted }}>Setting up your profile…</div>
    </div>
  )

  // ── Step 1: Goal type ─────────────────────────────────────────────────────
  if (step === 1) return (
    <div style={shell}>
      <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
      <div style={body}>
        <Dots step={1} />
        <div style={h1}>What's your main goal?</div>
        <div style={sub}>This shapes how your coach thinks and talks to you.</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {GOAL_TILES.map(tile => {
            const on = goalType === tile.value
            return (
              <button key={tile.value} onClick={() => setGoalType(tile.value)} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '13px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                background: on ? 'rgba(232,255,71,0.07)' : Z.surface,
                border: `1px solid ${on ? Z.accent : Z.border2}`,
                width: '100%', transition: 'all 0.12s',
              }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{tile.icon}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: on ? Z.accent : Z.text, fontFamily: "'DM Mono', monospace" }}>{tile.label}</div>
                  <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>{tile.desc}</div>
                </div>
              </button>
            )
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button style={primaryBtn(!!goalType)} onClick={() => goalType && setStep(2)}>Next →</button>
        <button style={backBtn} onClick={handleSkip}>Skip for now</button>
      </div>
    </div>
  )

  // ── Step 2: Connect Strava ────────────────────────────────────────────────
  if (step === 2) return (
    <div style={shell}>
      <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
      <div style={body}>
        <Dots step={2} />
        <div style={h1}>Connect Strava</div>
        <div style={sub}>
          Connecting Strava lets us instantly pull in your training history and start coaching you from day one.
          We'll analyse your recent runs and generate your first coaching insights automatically.
        </div>

        <div style={{
          background: Z.surface, border: `1px solid ${Z.border2}`,
          borderRadius: 12, padding: '20px 18px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🔗</div>
          <div style={{ fontSize: 13, color: Z.text, fontWeight: 600, marginBottom: 8 }}>
            Sync your training history
          </div>
          <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.6, marginBottom: 0 }}>
            We'll pull in your last 60 days of activities — runs, rides, swims — so your coaching starts with real data, not guesses.
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {STRAVA_CLIENT_ID ? (
          <button style={primaryBtn()} onClick={connectStrava}>
            Connect Strava
          </button>
        ) : (
          <button style={{ ...primaryBtn(false) }} disabled>
            Connect Strava
          </button>
        )}
        <button style={backBtn} onClick={() => setStep(3)}>I'll connect later →</button>
        <button style={{ ...backBtn, marginTop: 4 }} onClick={() => setStep(1)}>← Back</button>
      </div>
    </div>
  )

  // ── Step 3: Sports (multi-sport) ──────────────────────────────────────────
  if (step === 3) return (
    <div style={shell}>
      <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
      <div style={body}>
        <Dots step={3} />
        <div style={h1}>What do you train for?</div>
        <div style={sub}>
          Tell us which sports you train for. We'll tailor your coaching, plans, and briefings around your goals.
        </div>

        {/* Text input + Add button */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input
            style={{ ...inp, fontSize: 13, flex: 1 }}
            placeholder="e.g. Running, Cycling, Triathlon..."
            value={sportInput}
            onChange={e => setSportInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addSport(sportInput) }}
            autoFocus
          />
          <button
            onClick={() => addSport(sportInput)}
            style={{
              background: Z.accent, border: 'none', borderRadius: 8,
              padding: '0 14px', fontFamily: "'DM Mono', monospace",
              fontSize: 12, fontWeight: 700, color: Z.bg, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Add
          </button>
        </div>

        {/* Hint text */}
        <div style={{ fontSize: 11, color: Z.muted, marginBottom: 14 }}>
          Type a sport above, or pick from popular options below:
        </div>

        {/* Chip suggestions */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 20 }}>
          {SPORT_CHIPS.map(chip => {
            const already = sports.some(s => s.sport_raw.toLowerCase() === chip)
            return (
              <button key={chip} onClick={() => already ? removeSport(sports.findIndex(s => s.sport_raw.toLowerCase() === chip)) : addSport(chip)} style={{
                padding: '5px 11px', borderRadius: 20, cursor: 'pointer',
                background: already ? 'rgba(232,255,71,0.12)' : 'transparent',
                border: `1px solid ${already ? Z.accent : Z.border2}`,
                color: already ? Z.accent : Z.muted,
                fontFamily: "'DM Mono', monospace", fontSize: 12,
                transition: 'all 0.12s',
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                {chip}
                {already && <span style={{ fontSize: 14, lineHeight: 1 }}>×</span>}
              </button>
            )
          })}
        </div>

        {/* Added sport cards */}
        {sports.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 }}>
            {sports.map((sport, i) => (
              <div key={i} style={{
                background: Z.surface, border: `1px solid ${Z.border2}`,
                borderRadius: 10, padding: '12px 14px',
              }}>
                {/* Sport name + remove */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 13, color: Z.text, fontWeight: 600 }}>{sport.sport_raw}</div>
                  <button
                    onClick={() => removeSport(i)}
                    style={{ background: 'none', border: 'none', color: Z.muted, cursor: 'pointer', fontSize: 16, padding: '0 0 0 8px', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </div>

                {/* Priority pills */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: Z.muted, marginRight: 4 }}>Priority:</span>
                  {['primary', 'supporting', 'recovery'].map(p => (
                    <button
                      key={p}
                      onClick={() => updateSport(i, 'priority', p)}
                      style={{
                        padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                        background: sport.priority === p ? (p === 'primary' ? Z.accent : 'rgba(255,255,255,0.08)') : 'transparent',
                        border: `1px solid ${sport.priority === p ? (p === 'primary' ? Z.accent : Z.border2) : Z.border}`,
                        color: sport.priority === p ? (p === 'primary' ? Z.bg : Z.text) : Z.muted,
                        fontFamily: "'DM Mono', monospace", fontSize: 11,
                        fontWeight: sport.priority === p ? 600 : 400,
                        transition: 'all 0.12s',
                      }}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Goal input */}
                <input
                  style={{ ...inp, fontSize: 12 }}
                  placeholder="Goal (optional): e.g. sub 3:10 marathon in October"
                  value={sport.current_goal_raw}
                  onChange={e => updateSport(i, 'current_goal_raw', e.target.value)}
                />
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button style={primaryBtn(sports.length > 0)} onClick={() => sports.length > 0 && setStep(4)}>Next →</button>
        <button style={backBtn} onClick={() => setStep(2)}>← Back</button>
      </div>
    </div>
  )

  // ── Step 4: Target ────────────────────────────────────────────────────────
  if (step === 4) {
    const cfg = TARGET_CONFIG[goalType] || { label: "What are you working towards?", placeholder: 'Describe your goal…' }

    return (
      <div style={shell}>
        <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
        <div style={body}>
          <Dots step={4} />
          <div style={h1}>{cfg.label}</div>
          <div style={sub}>The more detail the better — events, dates, times, all of it.</div>
          <textarea
            style={{ ...ta }}
            placeholder={cfg.placeholder}
            value={targetRaw}
            onChange={e => setTargetRaw(e.target.value)}
            autoFocus
          />
          <div style={{ flex: 1 }} />
          <button style={primaryBtn(!!targetRaw.trim())} onClick={() => targetRaw.trim() && setStep(5)}>Next →</button>
          <button style={backBtn} onClick={() => setStep(3)}>← Back</button>
        </div>
      </div>
    )
  }

  // ── Step 5: Level slider ──────────────────────────────────────────────────
  const level = LEVELS[levelIndex]
  return (
    <div style={shell}>
      <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
      <div style={body}>
        <Dots step={5} />
        <div style={h1}>How would you describe your level?</div>
        <div style={sub}>Your coach calibrates training load and expectations around this.</div>

        {/* Tick labels */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          {LEVELS.map((l, i) => (
            <span key={l.value} style={{
              fontSize: 10, letterSpacing: '0.04em', textAlign: 'center', flex: 1,
              color: i === levelIndex ? Z.accent : Z.muted,
              fontWeight: i === levelIndex ? 600 : 400,
              transition: 'color 0.15s',
            }}>
              {l.label.toUpperCase()}
            </span>
          ))}
        </div>

        <input
          type="range" min={0} max={3} step={1} value={levelIndex}
          onChange={e => setLevelIndex(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: Z.accent, cursor: 'pointer', marginBottom: 28 }}
        />

        {/* Selected level card */}
        <div style={{
          padding: '18px 20px', background: Z.surface,
          borderRadius: 10, border: `1px solid ${Z.border2}`, textAlign: 'center', marginBottom: 16,
        }}>
          <div style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16,
            color: Z.accent, marginBottom: 8,
          }}>
            {level.label}
          </div>
          <div style={{ fontSize: 13, color: Z.muted, lineHeight: 1.55 }}>
            {level.desc}
          </div>
        </div>

        {/* Profile completion nudge */}
        <div style={{
          background: 'rgba(71,212,255,0.06)', border: '1px solid rgba(71,212,255,0.18)',
          borderRadius: 10, padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>✨</span>
          <div style={{ fontSize: 12, color: '#a0d8ef', lineHeight: 1.6 }}>
            The more you share, the smarter your coaching gets. You can add your age, weight, target race, and training preferences in Settings any time — it takes 2 minutes and makes a big difference.
          </div>
        </div>

        {error && (
          <div style={{ marginTop: 16, fontSize: 12, color: Z.red, textAlign: 'center', lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button style={primaryBtn()} onClick={handleComplete}>Let's go →</button>
        <button style={backBtn} onClick={() => setStep(4)}>← Back</button>
      </div>
    </div>
  )
}
