import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claudeProxy'
import { useSettings } from '../lib/useSettings'

const Z = {
  bg: '#0a0a0a', surface: '#111111', border: 'rgba(255,255,255,0.08)',
  border2: 'rgba(255,255,255,0.14)', text: '#f0ede8', muted: '#888580',
  accent: '#e8ff47', accent2: '#47d4ff', amber: '#ffb347',
  green: '#4dff91', red: '#ff5c5c',
}

const TYPE_COLORS = {
  AMRAP: '#47d4ff', EMOM: '#e8ff47', ForTime: '#ff5c5c',
  RFT: '#ffb347', Tabata: '#4dff91', Straight: '#888580', Hyrox: '#e8ff47',
}

const PARSE_PROMPT = `You are parsing a workout board photo for an athlete tracking app.
Extract the complete workout structure. Return ONLY valid JSON with no preamble, explanation, or markdown.

Schema (strictly):
{
  "workout_type": "AMRAP | EMOM | ForTime | RFT | Tabata | Straight | Hyrox",
  "time_cap_minutes": null or integer,
  "rounds": null or integer,
  "intervals": null or { "work_seconds": 40, "rest_seconds": 20 },
  "movements": [
    { "name": "string", "reps": null or integer, "weight_kg": null or number, "distance_m": null or integer, "notes": "" }
  ],
  "raw_text": "verbatim text extracted from image",
  "confidence": "high | medium | low"
}

Rules:
- workout_type: pick the closest match. If unclear, use "Straight".
- Map abbreviations: WB→Wall Balls, DU→Double Unders, TTB→Toes to Bar, KB→Kettlebell, C2→Rowing, etc.
- Convert lb to kg (divide by 2.205, round to 1 decimal).
- If no weight visible, set weight_kg to null.
- If no reps (e.g. distance-based), set reps to null and use distance_m.
- raw_text: transcribe all visible text from the image exactly.
- confidence: "high" if board is clearly readable, "medium" if partially obscured, "low" if very unclear.`

function MovementRow({ movement, index, onChange, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${Z.border}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          style={{ background: 'none', border: 'none', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 13, width: '100%', outline: 'none', padding: 0 }}
          value={movement.name}
          onChange={e => onChange(index, { ...movement, name: e.target.value })}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
          {movement.reps != null && (
            <span style={{ fontSize: 11, color: Z.accent }}>
              <input
                type="number"
                style={{ background: 'none', border: 'none', color: Z.accent, fontFamily: "'DM Mono', monospace", fontSize: 11, width: 40, outline: 'none', padding: 0 }}
                value={movement.reps}
                onChange={e => onChange(index, { ...movement, reps: parseInt(e.target.value) || 0 })}
              /> reps
            </span>
          )}
          {movement.distance_m != null && (
            <span style={{ fontSize: 11, color: Z.accent2 }}>
              {movement.distance_m}m
            </span>
          )}
          {movement.weight_kg != null && (
            <span style={{ fontSize: 11, color: Z.amber }}>
              {movement.weight_kg}kg
            </span>
          )}
          {movement.notes && <span style={{ fontSize: 11, color: Z.muted }}>{movement.notes}</span>}
        </div>
      </div>
      <button onClick={() => onRemove(index)} style={{ background: 'none', border: 'none', color: Z.muted, cursor: 'pointer', fontSize: 16, flexShrink: 0, lineHeight: 1, padding: '0 4px' }}>×</button>
    </div>
  )
}

export default function WorkoutIngest({ onClose }) {
  const settings = useSettings()
  const cameraRef = useRef(null)
  const libraryRef = useRef(null)

  const [step, setStep] = useState('capture') // 'capture' | 'parsing' | 'review' | 'saving' | 'done'
  const [preview, setPreview] = useState(null)
  const [imageData, setImageData] = useState(null)
  const [imageMime, setImageMime] = useState('image/jpeg')
  const [parsed, setParsed] = useState(null)
  const [error, setError] = useState(null)
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10))
  const [logAs, setLogAs] = useState('completed') // 'completed' | 'planned'
  const [extraNotes, setExtraNotes] = useState('')

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    e.target.value = ''
    const mime = file.type || 'image/jpeg'
    setImageMime(mime)
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target.result
      setPreview(result)
      setImageData(result.split(',')[1])
    }
    reader.readAsDataURL(file)
    setError(null)
  }

  async function parseWorkout() {
    if (!imageData) return
    setStep('parsing')
    setError(null)
    try {
      const data = await callClaude({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: PARSE_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: imageMime.includes('png') ? 'image/png'
                  : imageMime.includes('gif') ? 'image/gif'
                  : imageMime.includes('webp') ? 'image/webp'
                  : 'image/jpeg',
                data: imageData,
              },
            },
            { type: 'text', text: 'Parse this workout board into the specified JSON schema.' },
          ],
        }],
      })
      const raw = data.content?.[0]?.text
      if (!raw) throw new Error('No response from Claude')
      const result = JSON.parse(raw.replace(/```json|```/g, '').trim())
      if (!result.movements || !Array.isArray(result.movements)) throw new Error('Invalid workout structure returned')
      setParsed(result)
      setStep('review')
    } catch (e) {
      setError(e.message || 'Parse failed')
      setStep('capture')
    }
  }

  function updateMovement(index, updated) {
    setParsed(p => ({ ...p, movements: p.movements.map((m, i) => i === index ? updated : m) }))
  }

  function removeMovement(index) {
    setParsed(p => ({ ...p, movements: p.movements.filter((_, i) => i !== index) }))
  }

  async function saveWorkout() {
    if (!parsed) return
    setStep('saving')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const notesText = [
        `${parsed.workout_type}${parsed.time_cap_minutes ? ` · ${parsed.time_cap_minutes}min cap` : ''}${parsed.rounds ? ` · ${parsed.rounds} rounds` : ''}`,
        parsed.raw_text ? `Board: ${parsed.raw_text.slice(0, 200)}` : null,
        extraNotes || null,
      ].filter(Boolean).join('\n')

      await supabase.from('workout_logs').insert({
        date: logDate,
        exercises: parsed.movements.map(m => ({
          name: m.name,
          sets: m.reps != null ? [{ reps: m.reps, weight: m.weight_kg || '' }] : [],
          distance_m: m.distance_m || null,
          notes: m.notes || '',
        })),
        notes: notesText,
        user_id: session?.user?.id,
        strava_id: null,
      })
      setStep('done')
    } catch (e) {
      setError(e.message || 'Save failed')
      setStep('review')
    }
  }

  const typeColor = parsed ? (TYPE_COLORS[parsed.workout_type] || Z.muted) : Z.muted

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', zIndex: 300, display: 'flex', flexDirection: 'column', maxWidth: 430, margin: '0 auto' }}>
      {/* Hidden file inputs */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
      <input ref={libraryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${Z.border}`, background: Z.bg, flexShrink: 0 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 17, color: Z.text }}>
          {step === 'review' ? 'Confirm Workout' : step === 'done' ? 'Logged' : 'Log Workout'}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

        {/* ── CAPTURE STEP ── */}
        {(step === 'capture' || step === 'parsing') && (
          <>
            {/* Image preview or placeholder */}
            {preview ? (
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <img src={preview} alt="Workout board" style={{ width: '100%', borderRadius: 12, maxHeight: 280, objectFit: 'cover', display: 'block' }} />
                <button onClick={() => { setPreview(null); setImageData(null) }} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', width: 28, height: 28, color: Z.text, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
              </div>
            ) : (
              <div style={{ background: Z.surface, border: `2px dashed ${Z.border2}`, borderRadius: 12, padding: '40px 20px', textAlign: 'center', marginBottom: 16 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📸</div>
                <div style={{ fontSize: 14, color: Z.text, marginBottom: 6 }}>Photograph a workout board</div>
                <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.6 }}>CrossFit WOD, Hyrox session,<br />PT board, EMOM card — anything works</div>
              </div>
            )}

            {/* Capture buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <button onClick={() => cameraRef.current?.click()} style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: '14px', fontSize: 13, cursor: 'pointer', color: Z.text, fontFamily: "'DM Mono', monospace", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                📷 Camera
              </button>
              <button onClick={() => libraryRef.current?.click()} style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: '14px', fontSize: 13, cursor: 'pointer', color: Z.text, fontFamily: "'DM Mono', monospace", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                🖼 Library
              </button>
            </div>

            {error && (
              <div style={{ background: 'rgba(255,92,92,0.1)', border: `1px solid rgba(255,92,92,0.3)`, borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: Z.red }}>
                {error}
              </div>
            )}

            <button
              onClick={parseWorkout}
              disabled={!imageData || step === 'parsing'}
              style={{ width: '100%', background: imageData ? Z.accent : '#1a1a1a', border: 'none', borderRadius: 10, padding: '14px', fontSize: 14, cursor: imageData ? 'pointer' : 'default', color: imageData ? Z.bg : Z.muted, fontFamily: "'DM Mono', monospace", fontWeight: 600, transition: 'all 0.2s' }}
            >
              {step === 'parsing' ? '⏳ Parsing workout…' : 'Parse workout →'}
            </button>
          </>
        )}

        {/* ── REVIEW STEP ── */}
        {step === 'review' && parsed && (
          <>
            {/* Workout type badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ background: `${typeColor}18`, border: `1px solid ${typeColor}40`, borderRadius: 20, padding: '4px 14px', fontSize: 11, color: typeColor, fontWeight: 600, letterSpacing: '0.08em' }}>
                {parsed.workout_type}
              </div>
              {parsed.time_cap_minutes && (
                <div style={{ fontSize: 11, color: Z.muted }}>{parsed.time_cap_minutes} min cap</div>
              )}
              {parsed.rounds && (
                <div style={{ fontSize: 11, color: Z.muted }}>{parsed.rounds} rounds</div>
              )}
              <div style={{ marginLeft: 'auto', fontSize: 10, color: parsed.confidence === 'high' ? Z.green : parsed.confidence === 'medium' ? Z.amber : Z.red }}>
                {parsed.confidence} confidence
              </div>
            </div>

            {/* Movements */}
            <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 12, padding: '4px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 0 4px' }}>
                Movements ({parsed.movements.length})
              </div>
              {parsed.movements.map((m, i) => (
                <MovementRow key={i} movement={m} index={i} onChange={updateMovement} onRemove={removeMovement} />
              ))}
              {parsed.movements.length === 0 && (
                <div style={{ fontSize: 12, color: Z.muted, padding: '10px 0' }}>No movements detected — tap × to dismiss or save anyway.</div>
              )}
            </div>

            {/* Raw text (collapsed) */}
            {parsed.raw_text && (
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 11, color: Z.muted, cursor: 'pointer', userSelect: 'none' }}>Raw text from image</summary>
                <div style={{ marginTop: 8, fontSize: 11, color: Z.muted, lineHeight: 1.6, background: Z.surface, borderRadius: 8, padding: '10px 12px', whiteSpace: 'pre-wrap' }}>{parsed.raw_text}</div>
              </details>
            )}

            {/* Date + log type */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Date</div>
                <input type="date" value={logDate} max={new Date().toISOString().slice(0,10)} onChange={e => setLogDate(e.target.value)}
                  style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 10px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, width: '100%', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Log as</div>
                <select value={logAs} onChange={e => setLogAs(e.target.value)}
                  style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 10px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, width: '100%', outline: 'none', boxSizing: 'border-box', cursor: 'pointer' }}>
                  <option value="completed">Completed</option>
                  <option value="planned">Planned</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Notes (optional)</div>
              <textarea value={extraNotes} onChange={e => setExtraNotes(e.target.value)} placeholder="How did it feel? Any PRs?" rows={2}
                style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 10px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, width: '100%', outline: 'none', resize: 'none', boxSizing: 'border-box' }} />
            </div>

            {error && (
              <div style={{ background: 'rgba(255,92,92,0.1)', border: `1px solid rgba(255,92,92,0.3)`, borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: Z.red }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setStep('capture'); setParsed(null) }} style={{ flex: 1, background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 10, padding: '12px', fontSize: 13, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>
                ← Retake
              </button>
              <button onClick={saveWorkout} style={{ flex: 2, background: Z.accent, border: 'none', borderRadius: 10, padding: '12px', fontSize: 13, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
                Save workout
              </button>
            </div>
          </>
        )}

        {/* ── SAVING ── */}
        {step === 'saving' && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: Z.muted, fontSize: 13 }}>
            Saving…
          </div>
        )}

        {/* ── DONE ── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, color: Z.accent, marginBottom: 8 }}>Workout logged</div>
            <div style={{ fontSize: 13, color: Z.muted, marginBottom: 32, lineHeight: 1.6 }}>
              {parsed?.workout_type} · {parsed?.movements?.length} movements
            </div>
            <button onClick={onClose} style={{ background: Z.accent, border: 'none', borderRadius: 10, padding: '12px 32px', fontSize: 13, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
