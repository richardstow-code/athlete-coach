import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { inferAthleteContext } from '../lib/inferAthleteContext'

const Z = {
  bg: '#0a0a0a', surface: '#111111',
  border: 'rgba(255,255,255,0.08)', border2: 'rgba(255,255,255,0.14)',
  text: '#f0ede8', muted: '#888580',
  accent: '#e8ff47', red: '#ff5c5c', amber: '#ffb347', green: '#4dff91',
}

const SPORT_CHIPS = [
  'running', 'cycling', 'swimming', 'triathlon', 'hyrox',
  'strength', 'yoga', 'rowing', 'padel', 'crossfit',
  'football', 'martial arts', 'climbing', 'other',
]

const PRIORITIES = ['primary', 'supporting', 'recovery', 'paused']

const LIFECYCLE_LABELS = {
  planning:    'Planning',
  training:    'Training',
  taper:       'Taper',
  race_week:   'Race week',
  recovery:    'Recovery',
  what_next:   'What next',
  maintenance: 'Maintenance',
}

const inp = {
  background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6,
  padding: '8px 12px', color: Z.text, fontFamily: "'DM Mono', monospace",
  fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box',
}

export default function SportsPriorities({ onClose }) {
  const [sports, setSports]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [newInput, setNewInput]   = useState('')
  const [adding, setAdding]       = useState(false)
  const [savingId, setSavingId]   = useState(null) // id of sport row currently saving

  useEffect(() => {
    fetchSports()
  }, [])

  async function fetchSports() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('athlete_sports')
      .select('*')
      .eq('is_active', true)
      .order('created_at')
    if (err) setError(err.message)
    else setSports(data || [])
    setLoading(false)
  }

  async function updateField(id, fields) {
    setSavingId(id)
    const { error: err } = await supabase
      .from('athlete_sports')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (err) setError(err.message)
    else setSports(prev => prev.map(s => s.id === id ? { ...s, ...fields } : s))
    setSavingId(null)
  }

  async function changePriority(id, newPriority) {
    // If setting to primary, demote the current primary to supporting
    const updates = []
    if (newPriority === 'primary') {
      const currentPrimary = sports.find(s => s.priority === 'primary' && s.id !== id)
      if (currentPrimary) {
        updates.push(
          supabase.from('athlete_sports')
            .update({ priority: 'supporting', updated_at: new Date().toISOString() })
            .eq('id', currentPrimary.id)
        )
      }
    }
    updates.push(
      supabase.from('athlete_sports')
        .update({ priority: newPriority, updated_at: new Date().toISOString() })
        .eq('id', id)
    )
    setSavingId(id)
    await Promise.all(updates)
    setSavingId(null)
    await fetchSports()
  }

  async function archiveSport(id, sportRaw) {
    const confirmed = window.confirm(
      `Are you sure? This will hide ${sportRaw} from your coaching context.`
    )
    if (!confirmed) return
    const { error: err } = await supabase
      .from('athlete_sports')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (err) setError(err.message)
    else setSports(prev => prev.filter(s => s.id !== id))
  }

  async function addSport(raw) {
    const trimmed = raw.trim()
    if (!trimmed) return
    const alreadyExists = sports.some(s => s.sport_raw.toLowerCase() === trimmed.toLowerCase())
    if (alreadyExists) { setNewInput(''); return }

    setAdding(true)
    const isFirst = sports.length === 0
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error: err } = await supabase
      .from('athlete_sports')
      .insert({
        user_id: user.id,
        sport_raw: trimmed,
        priority: isFirst ? 'primary' : 'supporting',
        lifecycle_state: 'planning',
      })
      .select()
      .single()

    if (err) {
      setError(err.message)
      setAdding(false)
      return
    }

    setSports(prev => [...prev, data])
    setNewInput('')

    // Kick off inference for the new sport (non-fatal)
    try {
      await inferAthleteContext({
        sports: [{ id: data.id, sport_raw: trimmed, current_goal_raw: null }],
        health_notes_raw: null,
        benchmark_raw: null,
      })
      // Refresh to pick up inferred fields
      await fetchSports()
    } catch { /* non-fatal */ }

    setAdding(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      zIndex: 300, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', borderBottom: `1px solid ${Z.border}`, background: Z.bg,
        flexShrink: 0,
      }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 17, color: Z.text }}>
          Sports &amp; Priorities
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20, fontFamily: "'DM Mono', monospace" }}>
        {loading && (
          <div style={{ fontSize: 12, color: Z.muted, textAlign: 'center', marginTop: 40 }}>
            Loading…
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: Z.red, marginBottom: 16, padding: '10px 12px', background: 'rgba(255,92,92,0.08)', borderRadius: 8, border: `1px solid rgba(255,92,92,0.2)` }}>
            {error}
          </div>
        )}

        {!loading && sports.length === 0 && (
          <div style={{ fontSize: 13, color: Z.muted, textAlign: 'center', marginTop: 32, lineHeight: 1.7 }}>
            No sports added yet.<br />Add one below to get started.
          </div>
        )}

        {/* Sport cards */}
        {sports.map(sport => (
          <div key={sport.id} style={{
            background: Z.surface, border: `1px solid ${Z.border2}`,
            borderRadius: 10, padding: '14px 16px', marginBottom: 12,
            opacity: savingId === sport.id ? 0.7 : 1, transition: 'opacity 0.15s',
          }}>
            {/* Name row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, color: Z.text, fontWeight: 600 }}>{sport.sport_raw}</div>
                {sport.sport_category && (
                  <div style={{
                    display: 'inline-block', marginTop: 4,
                    fontSize: 10, color: Z.muted,
                    background: 'rgba(255,255,255,0.06)', border: `1px solid ${Z.border}`,
                    borderRadius: 20, padding: '2px 8px', letterSpacing: '0.06em',
                  }}>
                    {sport.sport_category}
                  </div>
                )}
                {sport.lifecycle_state && (
                  <div style={{
                    display: 'inline-block', marginTop: 4, marginLeft: sport.sport_category ? 6 : 0,
                    fontSize: 10, color: Z.accent,
                    background: 'rgba(232,255,71,0.08)', border: `1px solid rgba(232,255,71,0.2)`,
                    borderRadius: 20, padding: '2px 8px', letterSpacing: '0.06em',
                  }}>
                    {LIFECYCLE_LABELS[sport.lifecycle_state] || sport.lifecycle_state}
                  </div>
                )}
              </div>
              <button
                onClick={() => archiveSport(sport.id, sport.sport_raw)}
                style={{
                  background: 'none', border: `1px solid ${Z.border2}`,
                  borderRadius: 6, padding: '4px 10px',
                  color: Z.muted, fontSize: 11, cursor: 'pointer',
                  fontFamily: "'DM Mono', monospace", flexShrink: 0, marginLeft: 10,
                }}
              >
                Archive
              </button>
            </div>

            {/* Priority pills */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              {PRIORITIES.map(p => (
                <button
                  key={p}
                  onClick={() => changePriority(sport.id, p)}
                  style={{
                    padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                    background: sport.priority === p
                      ? (p === 'primary' ? Z.accent : 'rgba(255,255,255,0.08)')
                      : 'transparent',
                    border: `1px solid ${sport.priority === p
                      ? (p === 'primary' ? Z.accent : Z.border2)
                      : Z.border}`,
                    color: sport.priority === p
                      ? (p === 'primary' ? Z.bg : Z.text)
                      : Z.muted,
                    fontFamily: "'DM Mono', monospace", fontSize: 11,
                    fontWeight: sport.priority === p ? 600 : 400,
                    transition: 'all 0.12s',
                  }}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>

            {/* Current goal */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Current goal</div>
              <input
                style={inp}
                placeholder="e.g. sub 3:10 marathon in October"
                value={sport.current_goal_raw || ''}
                onChange={e => setSports(prev => prev.map(s => s.id === sport.id ? { ...s, current_goal_raw: e.target.value } : s))}
                onBlur={e => updateField(sport.id, { current_goal_raw: e.target.value || null })}
              />
            </div>

            {/* Target date */}
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Target date</div>
              <input
                style={{ ...inp, width: 'auto' }}
                type="date"
                value={sport.target_date || ''}
                onChange={e => setSports(prev => prev.map(s => s.id === sport.id ? { ...s, target_date: e.target.value } : s))}
                onBlur={e => updateField(sport.id, { target_date: e.target.value || null })}
              />
            </div>
          </div>
        ))}

        {/* Add new sport */}
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>
            Add a sport
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              style={{ ...inp, flex: 1 }}
              placeholder="e.g. open water swimming, padel…"
              value={newInput}
              onChange={e => setNewInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addSport(newInput) }}
            />
            <button
              onClick={() => addSport(newInput)}
              disabled={adding || !newInput.trim()}
              style={{
                background: adding || !newInput.trim() ? '#1a1a1a' : Z.accent,
                border: 'none', borderRadius: 6, padding: '0 14px',
                fontFamily: "'DM Mono', monospace", fontSize: 12,
                fontWeight: 700, color: adding || !newInput.trim() ? Z.muted : Z.bg,
                cursor: adding || !newInput.trim() ? 'default' : 'pointer', flexShrink: 0,
              }}
            >
              {adding ? '…' : 'Add'}
            </button>
          </div>

          {/* Chip suggestions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {SPORT_CHIPS.map(chip => {
              const already = sports.some(s => s.sport_raw.toLowerCase() === chip)
              return (
                <button
                  key={chip}
                  onClick={() => addSport(chip)}
                  disabled={already || adding}
                  style={{
                    padding: '5px 11px', borderRadius: 20,
                    cursor: already || adding ? 'default' : 'pointer',
                    background: already ? 'rgba(232,255,71,0.08)' : 'transparent',
                    border: `1px solid ${already ? Z.accent : Z.border2}`,
                    color: already ? Z.accent : Z.muted,
                    fontFamily: "'DM Mono', monospace", fontSize: 12,
                    opacity: already ? 0.5 : 1, transition: 'all 0.12s',
                  }}
                >
                  {chip}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
