import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', amber:'#ffb347', green:'#4dff91', red:'#ff5c5c'
}

const PRESET_EXERCISES = [
  'Back Squat', 'Romanian Deadlift', 'Bulgarian Split Squat', 'Hip Thrust',
  'Pull-ups', 'Dumbbell Row', 'Dips', 'Bench Press',
  'Plank', 'Dead Bug', 'Copenhagen Plank', 'Calf Raises'
]

const inp = { background: '#1a1a1a', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '7px 10px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box' }

export default function GymLogger({ stravaId, activityDate, onSaved }) {
  const [exercises, setExercises] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showExerciseForm, setShowExerciseForm] = useState(false)
  const [newExercise, setNewExercise] = useState({ name:'', sets:[{ reps:'', weight:'' }] })

  useEffect(() => {
    if (!stravaId) return
    supabase.from('workout_logs').select('*').eq('strava_id', stravaId).single()
      .then(({ data }) => { if (data) { setExercises(data.exercises || []); setNotes(data.notes || '') } })
  }, [stravaId])

  function addSet() {
    setNewExercise(e => ({ ...e, sets: [...e.sets, { reps: '', weight: '' }] }))
  }

  function removeSet(i) {
    setNewExercise(e => ({ ...e, sets: e.sets.filter((_, idx) => idx !== i) }))
  }

  function addExercise() {
    if (!newExercise.name) return
    setExercises(ex => [...ex, { ...newExercise }])
    setNewExercise({ name: '', sets: [{ reps: '', weight: '' }] })
    setShowExerciseForm(false)
  }

  function removeExercise(i) {
    setExercises(ex => ex.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    const date = activityDate?.slice(0, 10) || new Date().toISOString().slice(0, 10)
    await supabase.from('workout_logs').upsert({ strava_id: stravaId, date, exercises, notes })
    setSaving(false); setSaved(true)
    setTimeout(() => { setSaved(false); onSaved?.() }, 1500)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Exercises Logged</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 11, color: Z.green }}>Saved ✓</span>}
          <button onClick={() => setShowExerciseForm(true)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '4px 10px', color: Z.accent, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>+ Exercise</button>
        </div>
      </div>

      {/* Exercise list */}
      {exercises.length === 0 && !showExerciseForm && (
        <div style={{ fontSize: 13, color: Z.muted, padding: '10px 0 16px' }}>No exercises logged yet. Add what you completed.</div>
      )}

      {exercises.map((ex, i) => (
        <div key={i} style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: Z.text, fontWeight: 500 }}>{ex.name}</span>
            <button onClick={() => removeExercise(i)} style={{ background: 'none', border: 'none', color: Z.muted, cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: 6 }}>
            {ex.sets.map((set, si) => (
              <div key={si} style={{ background: '#1a1a1a', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 2 }}>Set {si + 1}</div>
                <div style={{ fontSize: 13, color: Z.accent, fontWeight: 500 }}>{set.reps}<span style={{ color: Z.muted, fontSize: 10 }}>reps</span></div>
                {set.weight && <div style={{ fontSize: 11, color: Z.amber }}>{set.weight}kg</div>}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add exercise form */}
      {showExerciseForm && (
        <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16, marginBottom: 12 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Exercise</div>
            <input list="exercises" style={inp} placeholder="Back Squat" value={newExercise.name}
              onChange={e => setNewExercise(ex => ({...ex, name: e.target.value}))} />
            <datalist id="exercises">
              {PRESET_EXERCISES.map(e => <option key={e} value={e} />)}
            </datalist>
          </div>

          <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>Sets</div>
          {newExercise.sets.map((set, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 6 }}>
              <div>
                <input style={inp} type="number" placeholder="Reps" value={set.reps}
                  onChange={e => setNewExercise(ex => ({ ...ex, sets: ex.sets.map((s, si) => si === i ? {...s, reps: e.target.value} : s) }))} />
              </div>
              <div>
                <input style={inp} type="number" placeholder="kg" value={set.weight}
                  onChange={e => setNewExercise(ex => ({ ...ex, sets: ex.sets.map((s, si) => si === i ? {...s, weight: e.target.value} : s) }))} />
              </div>
              {i > 0 && <button onClick={() => removeSet(i)} style={{ background: 'none', border: 'none', color: Z.muted, cursor: 'pointer', fontSize: 14 }}>×</button>}
            </div>
          ))}
          <button onClick={addSet} style={{ background: 'none', border: `1px solid ${Z.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 11, color: Z.muted, cursor: 'pointer', fontFamily: "'DM Mono', monospace", marginBottom: 12 }}>+ Add set</button>

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addExercise} style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace" }}>Add exercise</button>
            <button onClick={() => setShowExerciseForm(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Notes + Save */}
      {(exercises.length > 0 || showExerciseForm) && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Notes</div>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="How did it feel? Any PRs?" rows={2}
            style={{ ...inp, resize: 'none', width: '100%', marginBottom: 10 }} />
          <button onClick={save} disabled={saving}
            style={{ background: Z.accent, border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 13, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace", fontWeight: 500, width: '100%' }}>
            {saving ? 'Saving...' : 'Save session'}
          </button>
        </div>
      )}
    </div>
  )
}
