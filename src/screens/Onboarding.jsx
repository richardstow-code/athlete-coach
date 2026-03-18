import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { inferAthleteContext } from '../lib/inferAthleteContext'

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

function hasDateHint(text) {
  if (!text || text.length < 4) return false
  return /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}[\/\-]\d{1,2}|\b20\d{2}\b/i.test(text)
}

function Dots({ step }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 36 }}>
      {[1, 2, 3, 4].map(n => (
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
  const [goalType, setGoalType]       = useState(null)
  const [sportRaw, setSportRaw]       = useState('')
  const [targetRaw, setTargetRaw]     = useState('')
  const [confirmedDate, setConfirmedDate] = useState('')
  const [levelIndex, setLevelIndex]   = useState(1)   // default: 'returning'
  const [error, setError]             = useState(null)

  async function handleSkip() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('athlete_settings').upsert(
        { user_id: user.id, lifecycle_state: 'planning', updated_at: new Date().toISOString() },
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
        sport_raw:     sportRaw  || null,
        target_raw:    targetRaw || null,
        current_level: LEVELS[levelIndex].value,
        updated_at:    new Date().toISOString(),
      }, { onConflict: 'user_id' })

      // 2. AI inference — writes sport_category, target_event_name, target_date,
      //    target_metric, benchmark_value, has_injury, current_level back to DB.
      //    Non-fatal: onboarding continues if this fails.
      try {
        await inferAthleteContext({
          sport_raw:        sportRaw  || null,
          target_raw:       targetRaw || null,
          benchmark_raw:    null,
          health_notes_raw: null,
        })
      } catch { /* non-fatal */ }

      // 3. Finalise: lifecycle_state + user-confirmed date (overrides inferred)
      const final = {
        user_id:         user.id,
        lifecycle_state: 'planning',
        updated_at:      new Date().toISOString(),
      }
      if (confirmedDate) final.target_date = confirmedDate

      await supabase.from('athlete_settings').upsert(final, { onConflict: 'user_id' })
      onComplete()
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.')
      setStep(4)
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

  // ── Step 2: Sport ─────────────────────────────────────────────────────────
  if (step === 2) return (
    <div style={shell}>
      <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
      <div style={body}>
        <Dots step={2} />
        <div style={h1}>What's your sport?</div>
        <div style={sub}>Describe it in your own words, or pick a suggestion.</div>
        <input
          style={{ ...inp, fontSize: 14, marginBottom: 14 }}
          placeholder="e.g. marathon running, olympic weightlifting…"
          value={sportRaw}
          onChange={e => setSportRaw(e.target.value)}
          autoFocus
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 4 }}>
          {SPORT_CHIPS.map(chip => {
            const on = sportRaw.toLowerCase().trim() === chip
            return (
              <button key={chip} onClick={() => setSportRaw(chip)} style={{
                padding: '5px 11px', borderRadius: 20, cursor: 'pointer',
                background: on ? Z.accent : 'transparent',
                border: `1px solid ${on ? Z.accent : Z.border2}`,
                color: on ? Z.bg : Z.muted,
                fontFamily: "'DM Mono', monospace", fontSize: 12,
                transition: 'all 0.12s',
              }}>
                {chip}
              </button>
            )
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button style={primaryBtn(!!sportRaw.trim())} onClick={() => sportRaw.trim() && setStep(3)}>Next →</button>
        <button style={backBtn} onClick={() => setStep(1)}>← Back</button>
      </div>
    </div>
  )

  // ── Step 3: Target ────────────────────────────────────────────────────────
  if (step === 3) {
    const cfg = TARGET_CONFIG[goalType] || { label: "What are you working towards?", placeholder: 'Describe your goal…' }
    const showDatePicker = hasDateHint(targetRaw)

    return (
      <div style={shell}>
        <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
        <div style={body}>
          <Dots step={3} />
          <div style={h1}>{cfg.label}</div>
          <div style={sub}>The more detail the better — events, dates, times, all of it.</div>
          <textarea
            style={{ ...ta, marginBottom: showDatePicker ? 10 : 0 }}
            placeholder={cfg.placeholder}
            value={targetRaw}
            onChange={e => {
              setTargetRaw(e.target.value)
              if (!e.target.value) setConfirmedDate('')
            }}
            autoFocus
          />
          {showDatePicker && (
            <div>
              <div style={{ fontSize: 11, color: Z.amber, marginBottom: 6, marginTop: 2 }}>
                ↑ Date detected — confirm or adjust:
              </div>
              <input
                type="date"
                style={inp}
                value={confirmedDate}
                onChange={e => setConfirmedDate(e.target.value)}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button style={primaryBtn(!!targetRaw.trim())} onClick={() => targetRaw.trim() && setStep(4)}>Next →</button>
          <button style={backBtn} onClick={() => setStep(2)}>← Back</button>
        </div>
      </div>
    )
  }

  // ── Step 4: Level slider ──────────────────────────────────────────────────
  const level = LEVELS[levelIndex]
  return (
    <div style={shell}>
      <div style={{ padding: '20px 24px 0', flexShrink: 0, ...logoStyle }}>COACH</div>
      <div style={body}>
        <Dots step={4} />
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
          borderRadius: 10, border: `1px solid ${Z.border2}`, textAlign: 'center',
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

        {error && (
          <div style={{ marginTop: 16, fontSize: 12, color: Z.red, textAlign: 'center', lineHeight: 1.5 }}>
            {error}
          </div>
        )}

        <div style={{ flex: 1 }} />
        <button style={primaryBtn()} onClick={handleComplete}>Let's go →</button>
        <button style={backBtn} onClick={() => setStep(3)}>← Back</button>
      </div>
    </div>
  )
}
