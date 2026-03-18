import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claudeProxy'

const Z = {
  bg: '#0a0a0a', surface: '#111111',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#f0ede8', muted: '#888580', accent: '#e8ff47',
}

const EVENT_FELT = [
  { value: 'great',          label: 'Great' },
  { value: 'ok',             label: 'OK' },
  { value: 'tough',          label: 'Tough' },
  { value: 'didnt_complete', label: "Didn't complete" },
]

const GOAL_FELT = [
  { value: 'great',          label: 'Nailed it' },
  { value: 'ok',             label: 'Nearly' },
  { value: 'tough',          label: 'Not quite' },
  { value: 'didnt_complete', label: 'Not this time' },
]

function isEventGoal(goalType) {
  return goalType === 'compete' || goalType === 'complete_event'
}

async function generateRecoverySessions({ settings, felt, userId }) {
  const today = new Date().toISOString().slice(0, 10)
  const sportCategory = settings.sport_category || settings.sport || 'general'
  const eventLabel = settings.target_event_name || 'event'
  const recoveryDays = (felt === 'great' || felt === 'ok') ? 10 : 14
  const sportSession = sportCategory === 'cycling' ? 'easy bike ride'
    : sportCategory === 'swimming' ? 'easy swim'
    : sportCategory === 'running' ? 'easy run'
    : 'easy session'

  const system = `You are a coach generating a post-event recovery schedule. Return ONLY a valid JSON array of session objects — no markdown, no commentary.

Each object must have exactly these keys:
- name: string (short session name, e.g. "Easy walk", "Rest day", "Easy run")
- planned_date: "YYYY-MM-DD"
- session_type: string (e.g. easy_run, rest, walk, yoga, strength, swim, bike, cross_train)
- zone: "Z1" or null
- intensity: "easy", "very_easy", or "rest"
- duration_min_low: integer (0 for rest days)
- duration_min_high: integer (0 for rest days)
- notes: string (one brief coaching note)
- elevation_target_m: 0
- status: "planned"`

  const prompt = `Event: ${eventLabel}
Sport: ${sportCategory}
How it felt: ${felt}
Today: ${today}
Recovery window: ${recoveryDays} days

Generate a ${recoveryDays}-day recovery plan starting today. Rules:
- Days 1-3: rest only or very easy walk (15-20min), no running or intensity
- Days 4-7: easy ${sportSession} 20-30min, Z1 only, or rest
- ${recoveryDays > 10 ? 'Days 8-14: gentle easy sessions 30-45min, one optional rest day, no intensity' : 'Days 8-10: easy sessions up to 40min, one rest day'}
- felt=tough or didnt_complete: replace days 4-5 with additional rest, start ${sportSession} on day 6
- 1 session per day max, include 3+ rest days total
- Keep session names concise`

  try {
    const data = await callClaude({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = data.content?.[0]?.text ?? '[]'
    let sessions
    try { sessions = JSON.parse(raw) } catch { return }
    if (!Array.isArray(sessions) || sessions.length === 0) return

    await supabase.from('scheduled_sessions').insert(
      sessions.map(s => ({ ...s, user_id: userId }))
    )
  } catch {
    // non-fatal — recovery plan generation is best-effort
  }
}

export default function PostEventModal({ settings, onComplete }) {
  const isEvent = isEventGoal(settings.goal_type)
  const [felt, setFelt] = useState(null)
  const [result, setResult] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [statusMsg, setStatusMsg] = useState(null)
  const [error, setError] = useState(false)

  const eventLabel = settings.target_event_name || (isEvent ? 'your event' : 'your goal')
  const feltOptions = isEvent ? EVENT_FELT : GOAL_FELT

  async function handleSubmit() {
    if (!felt || submitting) return
    setSubmitting(true)
    setError(false)

    try {
      const { data: { user } } = await supabase.auth.getUser()

      // 1. Write race_results
      setStatusMsg('Saving…')
      await supabase.from('race_results').insert({
        user_id: user.id,
        event_name: settings.target_event_name || null,
        event_date: settings.target_date || null,
        goal_type: settings.goal_type || null,
        result_raw: result.trim() || null,
        felt,
        notes: notes.trim() || null,
      })

      // 2. Update lifecycle_state
      const newState = isEvent ? 'recovery' : 'what_next'
      await supabase.from('athlete_settings')
        .update({ lifecycle_state: newState, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)

      // 3. Generate recovery sessions (event users only)
      if (isEvent) {
        setStatusMsg('Building recovery plan…')
        await generateRecoverySessions({ settings, felt, userId: user.id })
      }

      onComplete(newState)
    } catch (err) {
      console.error('PostEventModal submit error:', err)
      setError(true)
      setSubmitting(false)
      setStatusMsg(null)
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: Z.bg, display: 'flex', flexDirection: 'column',
      fontFamily: "'DM Mono', monospace", overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '36px 24px 0', flexShrink: 0 }}>
        <div style={{
          fontSize: 10, letterSpacing: '0.12em', fontWeight: 600,
          color: Z.accent, textTransform: 'uppercase', marginBottom: 10,
        }}>
          {isEvent ? 'Event complete' : 'Goal checkpoint'}
        </div>
        <h1 style={{
          margin: 0, fontFamily: 'Syne, sans-serif', fontWeight: 800,
          fontSize: 22, color: Z.text, lineHeight: 1.25,
        }}>
          {isEvent ? `How did ${eventLabel} go?` : `Did you hit ${eventLabel}?`}
        </h1>
        {settings.target_date && (
          <div style={{ fontSize: 11, color: Z.muted, marginTop: 6 }}>
            {settings.target_date}
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 24px 0' }}>

        {/* Felt chips */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 11, color: Z.muted, marginBottom: 10, letterSpacing: '0.06em' }}>
            How did it feel?
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {feltOptions.map(o => (
              <button key={o.value} onClick={() => setFelt(o.value)} style={{
                padding: '8px 16px', borderRadius: 20, fontSize: 12,
                border: `1px solid ${felt === o.value ? Z.accent : Z.border2}`,
                background: felt === o.value ? 'rgba(232,255,71,0.1)' : 'transparent',
                color: felt === o.value ? Z.accent : Z.text,
                cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                transition: 'all 0.15s',
              }}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Result */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8, letterSpacing: '0.06em' }}>
            {isEvent ? 'Result (time, placement, or how it went)' : 'What happened?'}
          </div>
          <textarea
            value={result}
            onChange={e => setResult(e.target.value)}
            placeholder={isEvent
              ? 'e.g. 3:22:44, finished top 200, strong first half'
              : 'e.g. Hit target weight, consistency was the win'}
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: Z.surface, border: `1px solid ${Z.border2}`,
              borderRadius: 8, padding: '10px 12px', color: Z.text,
              fontFamily: "'DM Mono', monospace", fontSize: 13,
              resize: 'none', outline: 'none', lineHeight: 1.5,
            }}
          />
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8, letterSpacing: '0.06em' }}>
            Notes (optional)
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Anything else worth capturing…"
            rows={2}
            style={{
              width: '100%', boxSizing: 'border-box',
              background: Z.surface, border: `1px solid ${Z.border2}`,
              borderRadius: 8, padding: '10px 12px', color: Z.text,
              fontFamily: "'DM Mono', monospace", fontSize: 13,
              resize: 'none', outline: 'none', lineHeight: 1.5,
            }}
          />
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 24px',
        borderTop: `1px solid ${Z.border}`,
        background: Z.bg, flexShrink: 0,
      }}>
        {error && (
          <div style={{ fontSize: 11, color: '#ff5c5c', marginBottom: 10 }}>
            Something went wrong — please try again.
          </div>
        )}
        {submitting && statusMsg && (
          <div style={{ fontSize: 11, color: Z.muted, marginBottom: 10 }}>
            {statusMsg}
          </div>
        )}
        <button
          onClick={handleSubmit}
          disabled={!felt || submitting}
          style={{
            width: '100%', padding: '14px',
            background: !felt || submitting ? '#1a1a1a' : Z.accent,
            border: 'none', borderRadius: 8,
            fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600,
            color: !felt || submitting ? Z.muted : '#0a0a0a',
            cursor: !felt || submitting ? 'default' : 'pointer',
          }}
        >
          {submitting
            ? (statusMsg || 'Saving…')
            : isEvent ? 'Log result & start recovery' : 'Log & continue'}
        </button>
      </div>
    </div>
  )
}
