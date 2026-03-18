import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { inferAthleteContext } from '../lib/inferAthleteContext'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const SLIDERS = [
  { key:'tone', label:'Tone', left:'Brutal honesty', right:'Overly British', leftIcon:'💀', rightIcon:'🎩',
    desc: val => val < 30 ? 'Unfiltered. Will hurt.' : val < 60 ? 'Direct but respectful' : 'Frightfully encouraging, old chap' },
  { key:'consequences', label:'Consequences', left:'Gentle nudge', right:'Apocalyptic', leftIcon:'🌱', rightIcon:'🔥',
    desc: val => val < 30 ? 'Soft encouragement, no drama' : val < 60 ? 'Clear stakes, firm expectations' : 'Every missed session brings Munich closer to disaster' },
  { key:'detail_level', label:'Detail', left:'Headlines only', right:'Deep analysis', leftIcon:'📌', rightIcon:'🔬',
    desc: val => val < 30 ? 'Key point only, move on' : val < 60 ? 'Summary + key insight' : 'Full split analysis, zone breakdowns, biomechanics' },
  { key:'coaching_reach', label:'Coaching reach', left:'Training only', right:'Full lifestyle', leftIcon:'🏃', rightIcon:'🥗',
    desc: val => val < 30 ? 'Running and strength only' : val < 60 ? 'Training + nutrition when relevant' : 'Sleep, nutrition, alcohol, stress — the full picture' },
]

function Slider({ config, value, onChange }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: Z.text, letterSpacing: '0.04em' }}>{config.label}</span>
        <span style={{ fontSize: 11, color: Z.accent }}>{config.desc(value)}</span>
      </div>
      <div style={{ position: 'relative' }}>
        <input type="range" min={0} max={100} value={value}
          onChange={e => onChange(parseInt(e.target.value))}
          style={{ width: '100%', accentColor: Z.accent, height: 4, cursor: 'pointer' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontSize: 11, color: Z.muted }}>{config.leftIcon} {config.left}</span>
        <span style={{ fontSize: 11, color: Z.muted }}>{config.right} {config.rightIcon}</span>
      </div>
    </div>
  )
}

function RaceItem({ race, onRemove }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border2}`, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, color: Z.text, fontWeight: 500 }}>{race.name}</div>
        <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
          {race.date} · {race.distance}km · Target: {race.target}
        </div>
      </div>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', color: Z.muted, cursor: 'pointer', fontSize: 16, padding: 4 }}>×</button>
    </div>
  )
}

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID

export default function Settings({ onClose }) {
  const [settings, setSettings] = useState({
    tone:50, consequences:50, detail_level:50, coaching_reach:50,
    name:'', races:[],
    goal_type:null, sport:null, sport_other:null,
    target_type:null, target_event_name:null, target_date:null,
    target_description:null, current_level:null,
    health_notes:null, lifecycle_state:null,
    sport_raw:null, sport_category:null, target_raw:null, target_metric:null,
    benchmark_raw:null, benchmark_value:null, health_notes_raw:null,
    has_injury:null, training_days_per_week:null, sleep_hours_typical:null,
    current_weight_kg:null, onboarding_nudges_sent:null,
  })
  const [inferState, setInferState] = useState(null) // null | 'running' | { result } | 'error'
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newRace, setNewRace] = useState({ name:'', date:'', distance:'42.2', target:'3:10:00' })
  const [showRaceForm, setShowRaceForm] = useState(false)
  const [stravaToken, setStravaToken] = useState(null)   // null = loading, false = not connected
  const [stravaStatus, setStravaStatus] = useState(null) // 'syncing' | 'synced' | 'error' | null
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data?.user?.id ?? null))
    supabase.from('athlete_settings').select('*').maybeSingle()
      .then(({ data }) => { if (data) setSettings(s => ({ ...s, ...data, races: data.races || [] })) })
    supabase.from('strava_tokens').select('athlete_id, athlete_name').maybeSingle()
      .then(({ data }) => setStravaToken(data || false))
  }, [])

  function connectStrava() {
    const redirectUri = window.location.origin
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&approval_prompt=auto&scope=activity:read_all`
    window.location.href = url
  }

  async function syncStrava() {
    setStravaStatus('syncing')
    const { data, error } = await supabase.functions.invoke('strava-sync', {})
    if (error) { setStravaStatus('error'); return }
    setStravaStatus(`synced ${data.synced} activities`)
    setTimeout(() => setStravaStatus(null), 4000)
  }

  async function disconnectStrava() {
    await supabase.from('strava_tokens').delete().eq('user_id', (await supabase.auth.getUser()).data.user.id)
    setStravaToken(false)
  }

  async function reanalyse() {
    setInferState('running')
    try {
      const result = await inferAthleteContext({
        sport_raw:        settings.sport_raw || null,
        target_raw:       settings.target_raw || null,
        benchmark_raw:    settings.benchmark_raw || null,
        health_notes_raw: settings.health_notes_raw || null,
      })
      // Refresh settings from DB so all inferred fields reflect what the function saved
      const { data } = await supabase.from('athlete_settings').select('*').maybeSingle()
      if (data) setSettings(s => ({ ...s, ...data, races: data.races || [] }))
      setInferState(result)
    } catch {
      setInferState('error')
    }
  }

  async function save() {
    setSaving(true)
    await supabase.from('athlete_settings').upsert({ user_id: userId, ...settings, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setSaving(false); setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function addRace() {
    if (!newRace.name || !newRace.date) return
    const updated = { ...settings, races: [...(settings.races || []), newRace] }
    setSettings(updated)
    setNewRace({ name:'', date:'', distance:'42.2', target:'3:10:00' })
    setShowRaceForm(false)
    // Auto-save immediately so the race isn't lost if the user closes Settings
    await supabase.from('athlete_settings').upsert({ user_id: userId, ...updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function removeRace(i) {
    setSettings(s => ({ ...s, races: s.races.filter((_, idx) => idx !== i) }))
  }

  const inp = { background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 12px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' }
  const sel = { ...inp, cursor: 'pointer' }
  const ta  = { ...inp, resize: 'vertical', minHeight: 72, lineHeight: 1.5 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${Z.border}`, background: Z.bg }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 17, color: Z.text }}>Settings</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {saved && <span style={{ fontSize: 11, color: Z.green }}>Saved ✓</span>}
          <button onClick={save} disabled={saving} style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '6px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.bg, fontWeight: 500 }}>
            {saving ? '...' : 'Save'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
        {/* Profile */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Profile</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Name</div>
              <input style={inp} placeholder="Your name" value={settings.name || ''}
                onChange={e => setSettings(s => ({...s, name: e.target.value}))} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Date of birth</div>
              <input style={inp} type="date" value={settings.dob || ''}
                onChange={e => setSettings(s => ({...s, dob: e.target.value}))} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Height (cm)</div>
              <input style={inp} type="number" placeholder="180" value={settings.height_cm || ''}
                onChange={e => setSettings(s => ({...s, height_cm: parseInt(e.target.value)}))} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Weight (kg)</div>
              <input style={inp} type="number" placeholder="79" value={settings.weight_kg || ''}
                onChange={e => setSettings(s => ({...s, weight_kg: parseFloat(e.target.value)}))} />
            </div>
          </div>
        </div>

        {/* Health */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Health</div>
          <div>
            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Health notes</div>
            <textarea style={ta} placeholder="Injuries, conditions, limitations…" value={settings.health_notes || ''}
              onChange={e => setSettings(s => ({...s, health_notes: e.target.value || null}))} />
          </div>
        </div>

        {/* Sport & Goal */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Sport &amp; Goal</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Sport</div>
              <select style={sel} value={settings.sport || ''} onChange={e => setSettings(s => ({...s, sport: e.target.value || null}))}>
                <option value="">— select —</option>
                <option value="running">Running</option>
                <option value="cycling">Cycling</option>
                <option value="triathlon">Triathlon</option>
                <option value="swimming">Swimming</option>
                <option value="strength">Strength</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Goal type</div>
              <select style={sel} value={settings.goal_type || ''} onChange={e => setSettings(s => ({...s, goal_type: e.target.value || null}))}>
                <option value="">— select —</option>
                <option value="compete">Compete</option>
                <option value="complete_event">Complete event</option>
                <option value="body_composition">Body composition</option>
                <option value="general_fitness">General fitness</option>
                <option value="injury_recovery">Injury recovery</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Current level</div>
              <select style={sel} value={settings.current_level || ''} onChange={e => setSettings(s => ({...s, current_level: e.target.value || null}))}>
                <option value="">— select —</option>
                <option value="beginner">Beginner</option>
                <option value="returning">Returning</option>
                <option value="regular">Regular</option>
                <option value="competitive">Competitive</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Training phase</div>
              <select style={sel} value={settings.lifecycle_state || ''} onChange={e => setSettings(s => ({...s, lifecycle_state: e.target.value || null}))}>
                <option value="">— select —</option>
                <option value="onboarding">Onboarding</option>
                <option value="planning">Planning</option>
                <option value="training">Training</option>
                <option value="taper">Taper</option>
                <option value="race_week">Race Week</option>
                <option value="recovery">Recovery</option>
                <option value="what_next">What next?</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          </div>
          {settings.sport === 'other' && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Sport (specify)</div>
              <input style={inp} placeholder="e.g. rowing, climbing…" value={settings.sport_other || ''}
                onChange={e => setSettings(s => ({...s, sport_other: e.target.value || null}))} />
            </div>
          )}
        </div>

        {/* AI Inputs */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>AI Analysis</div>
            {inferState && inferState !== 'running' && inferState !== 'error' && (
              <span style={{ fontSize: 11, color: Z.green }}>✓ Updated</span>
            )}
            {inferState === 'error' && (
              <span style={{ fontSize: 11, color: Z.red }}>Analysis failed</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Sport / activity</div>
              <textarea style={ta} placeholder="e.g. marathon running, olympic weightlifting…"
                value={settings.sport_raw || ''}
                onChange={e => setSettings(s => ({...s, sport_raw: e.target.value || null}))} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Target (in your words)</div>
              <textarea style={ta} placeholder="e.g. sub-2 hour half marathon in Berlin in October…"
                value={settings.target_raw || ''}
                onChange={e => setSettings(s => ({...s, target_raw: e.target.value || null}))} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Current fitness</div>
              <textarea style={ta} placeholder="e.g. I can run 5k in about 28 mins…"
                value={settings.benchmark_raw || ''}
                onChange={e => setSettings(s => ({...s, benchmark_raw: e.target.value || null}))} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Health notes (raw)</div>
              <textarea style={ta} placeholder="e.g. C6 disc issue, no overhead pressing…"
                value={settings.health_notes_raw || ''}
                onChange={e => setSettings(s => ({...s, health_notes_raw: e.target.value || null}))} />
            </div>
          </div>
          <button
            onClick={reanalyse}
            disabled={inferState === 'running'}
            style={{ marginTop: 12, width: '100%', background: inferState === 'running' ? '#1a1a1a' : 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: inferState === 'running' ? 'wait' : 'pointer', color: inferState === 'running' ? Z.muted : Z.accent }}
          >
            {inferState === 'running' ? 'Analysing…' : '↺ Re-analyse'}
          </button>
          {inferState && inferState !== 'running' && inferState !== 'error' && (
            <div style={{ marginTop: 12, padding: '12px 14px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border2}`, fontSize: 12, color: Z.muted, lineHeight: 1.8 }}>
              {inferState.sport_category    && <div>→ Sport: <span style={{ color: Z.text }}>{inferState.sport_category}</span></div>}
              {inferState.target_event_name && <div>→ Event: <span style={{ color: Z.text }}>{inferState.target_event_name}</span></div>}
              {inferState.target_date       && <div>→ Date: <span style={{ color: Z.text }}>{inferState.target_date}</span></div>}
              {inferState.target_metric     && <div>→ Target: <span style={{ color: Z.accent }}>{inferState.target_metric}</span></div>}
              {inferState.benchmark_value   && <div>→ Benchmark: <span style={{ color: Z.text }}>{inferState.benchmark_value}</span></div>}
              {inferState.has_injury != null && <div>→ Injury flag: <span style={{ color: inferState.has_injury ? Z.amber : Z.green }}>{inferState.has_injury ? 'yes' : 'none'}</span></div>}
              {inferState.current_level     && <div>→ Level: <span style={{ color: Z.text }}>{inferState.current_level}</span></div>}
            </div>
          )}
        </div>

        {/* Coaching style */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Coaching Style</div>
          <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 20 }}>
            {SLIDERS.map(s => (
              <Slider key={s.key} config={s} value={settings[s.key] || 50}
                onChange={v => setSettings(prev => ({...prev, [s.key]: v}))} />
            ))}
          </div>
        </div>

        {/* Strava */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Strava</div>
          <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16 }}>
            {stravaToken === null ? (
              <div style={{ fontSize: 12, color: Z.muted }}>Checking...</div>
            ) : stravaToken ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, color: Z.green, fontWeight: 500 }}>✓ Connected</div>
                    <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>{stravaToken.athlete_name} · ID {stravaToken.athlete_id}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={syncStrava} disabled={stravaStatus === 'syncing'} style={{ flex: 1, background: stravaStatus === 'syncing' ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: stravaStatus === 'syncing' ? 'wait' : 'pointer', color: Z.bg, fontWeight: 600 }}>
                    {stravaStatus === 'syncing' ? '⏳ Syncing...' : stravaStatus?.startsWith('synced') ? `✓ ${stravaStatus}` : '↓ Sync activities'}
                  </button>
                  <button onClick={disconnectStrava} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '9px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
                    Disconnect
                  </button>
                </div>
                {stravaStatus === 'error' && <div style={{ fontSize: 11, color: Z.red, marginTop: 8 }}>Sync failed — check your connection.</div>}
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: Z.muted, marginBottom: 12, lineHeight: 1.5 }}>Connect Strava to sync your activities automatically.</div>
                {!STRAVA_CLIENT_ID ? (
                  <div style={{ fontSize: 11, color: Z.amber }}>Set VITE_STRAVA_CLIENT_ID in .env to enable.</div>
                ) : (
                  <button onClick={connectStrava} style={{ width: '100%', background: '#FC4C02', border: 'none', borderRadius: 7, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#fff', fontWeight: 600 }}>
                    Connect with Strava
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Target */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Primary Target</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Target type</div>
              <select style={sel} value={settings.target_type || ''} onChange={e => setSettings(s => ({...s, target_type: e.target.value || null}))}>
                <option value="">— select —</option>
                <option value="event">Event (race / competition)</option>
                <option value="milestone">Milestone (time, weight, distance)</option>
                <option value="open_ended">Open-ended</option>
              </select>
            </div>
            {(settings.target_type === 'event' || settings.target_type === 'milestone') && (
              <>
                <div>
                  <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Event / milestone name</div>
                  <input style={inp} placeholder="Munich Marathon 2026" value={settings.target_event_name || ''}
                    onChange={e => setSettings(s => ({...s, target_event_name: e.target.value || null}))} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Target date</div>
                  <input style={inp} type="date" value={settings.target_date || ''}
                    onChange={e => setSettings(s => ({...s, target_date: e.target.value || null}))} />
                </div>
              </>
            )}
          </div>
          <div>
            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Description / goal</div>
            <textarea style={ta} placeholder="e.g. Sub-3:00 marathon; secondary target 3:10" value={settings.target_description || ''}
              onChange={e => setSettings(s => ({...s, target_description: e.target.value || null}))} />
          </div>
        </div>

        {/* Races */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Races</div>
            <button onClick={() => setShowRaceForm(true)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '4px 10px', color: Z.accent, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>+ Add race</button>
          </div>
          {(settings.races || []).map((r, i) => <RaceItem key={i} race={r} onRemove={() => removeRace(i)} />)}
          {settings.races?.length === 0 && !showRaceForm && (
            <div style={{ fontSize: 13, color: Z.muted, padding: '12px 0' }}>No races added yet.</div>
          )}
          {showRaceForm && (
            <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16, marginTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Race name</div>
                  <input style={inp} placeholder="Munich Marathon" value={newRace.name} onChange={e => setNewRace(r => ({...r, name: e.target.value}))} /></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Date</div>
                  <input style={inp} type="date" value={newRace.date} onChange={e => setNewRace(r => ({...r, date: e.target.value}))} /></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Distance (km)</div>
                  <input style={inp} type="number" value={newRace.distance} onChange={e => setNewRace(r => ({...r, distance: e.target.value}))} /></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Target time</div>
                  <input style={inp} placeholder="3:10:00" value={newRace.target} onChange={e => setNewRace(r => ({...r, target: e.target.value}))} /></div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addRace} style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace" }}>Add</button>
                <button onClick={() => setShowRaceForm(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
