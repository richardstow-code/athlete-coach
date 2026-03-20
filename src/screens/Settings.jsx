import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { inferAthleteContext } from '../lib/inferAthleteContext'
import { runBackfill } from '../lib/stravaBackfill'
import { generatePlanDraft } from '../lib/planGenerator'
import SportsPriorities from './SportsPriorities'
import PlanReviewPanel from '../components/PlanReviewPanel'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const SLIDERS = [
  { key:'tone', label:'Tone', left:'Brutal honesty', right:'Overly British', leftIcon:'💀', rightIcon:'🎩',
    desc: val => val < 30 ? 'Unfiltered. Will hurt.' : val < 60 ? 'Direct but respectful' : 'Frightfully encouraging, old chap' },
  { key:'consequences', label:'Consequences', left:'Gentle nudge', right:'Apocalyptic', leftIcon:'🌱', rightIcon:'🔥',
    desc: val => val < 30 ? 'Soft encouragement, no drama' : val < 60 ? 'Clear stakes, firm expectations' : 'Every missed session brings your race closer to disaster' },
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

function CancelRaceModal({ race, onConfirm, onClose }) {
  const [reason, setReason] = useState('')
  const [nextStep, setNextStep] = useState('')
  const reasons = [
    'Injury / health issue',
    'Life circumstances changed',
    'Not enough time to train',
    'Race cancelled or rescheduled',
    'Changed goals / priorities',
    'Other',
  ]
  const inp2 = { background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 12px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, width: '100%', outline: 'none', boxSizing: 'border-box' }
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 350, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }} />
      <div style={{ position: 'relative', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 430 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 700, color: Z.text, marginBottom: 4 }}>Cancel event</div>
        <div style={{ fontSize: 12, color: Z.muted, marginBottom: 18 }}>{race.name} · {race.date}</div>
        <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>What happened?</div>
        <select value={reason} onChange={e => setReason(e.target.value)} style={{ ...inp2, marginBottom: 14, cursor: 'pointer' }}>
          <option value="">Select a reason...</option>
          {reasons.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>What's next? (optional)</div>
        <textarea
          value={nextStep}
          onChange={e => setNextStep(e.target.value)}
          placeholder="e.g. Focusing on base fitness for now, targeting a race next year..."
          rows={2}
          style={{ ...inp2, resize: 'none', lineHeight: 1.5, marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => reason && onConfirm(reason, nextStep)}
            disabled={!reason}
            style={{ flex: 1, background: reason ? Z.red : '#1a1a1a', border: 'none', borderRadius: 7, padding: '11px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: reason ? 'pointer' : 'not-allowed', color: reason ? '#fff' : Z.muted, fontWeight: 600 }}
          >
            Remove event
          </button>
          <button onClick={onClose} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '11px 16px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
            Keep it
          </button>
        </div>
      </div>
    </div>
  )
}

function RaceItem({ race, onCancel }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border2}`, marginBottom: 8 }}>
      <div>
        <div style={{ fontSize: 13, color: Z.text, fontWeight: 500 }}>{race.name}</div>
        <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
          {race.date} · {race.distance}km · Target: {race.target}
        </div>
      </div>
      <button onClick={onCancel} style={{ background: 'none', border: `1px solid rgba(255,92,92,0.2)`, borderRadius: 6, padding: '3px 8px', color: Z.muted, cursor: 'pointer', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>Cancel</button>
    </div>
  )
}

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID

export default function Settings({ onClose, stravaConnectError, onLogout }) {
  const [settings, setSettings] = useState({
    tone:50, consequences:50, detail_level:50, coaching_reach:50,
    name:'', races:[],
    goal_type:null, current_level:null,
    health_notes:null,
    cycle_tracking_enabled: false, cycle_length_avg: null, cycle_is_irregular: false,
    cycle_last_period_date: null, cycle_notes: null,
    benchmark_raw:null, benchmark_value:null, health_notes_raw:null,
    has_injury:null, training_days_per_week:null, sleep_hours_typical:null,
    current_weight_kg:null, onboarding_nudges_sent:null,
  })
  const [inferState, setInferState] = useState(null) // null | 'running' | { result } | 'error'
  const [showSports, setShowSports] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [newRace, setNewRace] = useState({ name:'', date:'', type:'Run', distance:'42.2', target:'3:10:00', elevation:'' })
  const [showRaceForm, setShowRaceForm] = useState(false)
  const [stravaToken, setStravaToken] = useState(null)   // null = loading, false = not connected
  const [stravaStatus, setStravaStatus] = useState(null) // 'syncing' | 'synced' | 'error' | null
  const [userId, setUserId] = useState(null)
  const [backfillStatus, setBackfillStatus] = useState(null) // null | 'syncing' | {n} | 'error:<msg>'
  const [newRaceJustAdded, setNewRaceJustAdded] = useState(null) // race object | null
  const [generatingPlan, setGeneratingPlan] = useState(false)
  const [planDraftId, setPlanDraftId] = useState(null)
  const [cancelModal, setCancelModal] = useState(null) // null | { race, index }
  const [deleteAccountStep, setDeleteAccountStep] = useState(0) // 0=hidden, 1=confirm, 2=final
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

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

  async function testStravaToken() {
    const sessionRes = await supabase.auth.getSession()
    const jwt = sessionRes.data?.session?.access_token
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-sync?test=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_KEY,
        ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    setStravaStatus(`diag: ${JSON.stringify(data).slice(0, 200)}`)
  }

  async function syncStrava() {
    setStravaStatus('syncing')
    const sessionRes = await supabase.auth.getSession()
    const jwt = sessionRes.data?.session?.access_token
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_KEY,
          ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({}),
      })
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = { error: text } }
      if (!res.ok || data?.error) {
        setStravaStatus(`error: ${data?.error || res.status}`)
      } else {
        setStravaStatus(`synced ${data?.synced ?? 0} activities`)
        setTimeout(() => setStravaStatus(null), 4000)
      }
    } catch (e) {
      setStravaStatus(`error: ${e.message}`)
    }
  }

  async function disconnectStrava() {
    await supabase.from('strava_tokens').delete().eq('user_id', (await supabase.auth.getUser()).data.user.id)
    setStravaToken(false)
  }

  async function reanalyse() {
    setInferState('running')
    try {
      const result = await inferAthleteContext({
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
    const raceToAdd = { ...newRace }
    const updated = { ...settings, races: [...(settings.races || []), raceToAdd] }
    setSettings(updated)
    setNewRace({ name:'', date:'', type:'Run', distance:'42.2', target:'3:10:00', elevation:'' })
    setShowRaceForm(false)
    // Auto-save immediately so the race isn't lost if the user closes Settings
    await supabase.from('athlete_settings').upsert({ user_id: userId, ...updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    // Prompt to generate a training plan for the new race
    setNewRaceJustAdded(raceToAdd)
  }

  async function handleResync() {
    setBackfillStatus('syncing')
    const result = await runBackfill()
    if (result.error) {
      setBackfillStatus(`error:${result.error}`)
      setTimeout(() => setBackfillStatus(null), 5000)
    } else {
      setBackfillStatus(result.activitiesImported)
      setTimeout(() => setBackfillStatus(null), 4000)
    }
  }

  async function handleGeneratePlan(race) {
    setGeneratingPlan(true)
    setNewRaceJustAdded(null)
    try {
      const { data: settingsData } = await supabase.from('athlete_settings').select('*').maybeSingle()
      const id = await generatePlanDraft({
        trigger: 'new_race',
        race: { name: race.name, date: race.date, targetTime: race.target },
        currentDate: new Date().toISOString().slice(0, 10),
        athleteSettings: settingsData,
      })
      setPlanDraftId(id)
    } catch (e) {
      alert('Plan generation failed: ' + e.message)
    }
    setGeneratingPlan(false)
  }

  function removeRace(i) {
    setSettings(s => ({ ...s, races: s.races.filter((_, idx) => idx !== i) }))
  }

  async function cancelRace(index, reason, nextStep) {
    const race = settings.races[index]
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('coaching_memory').insert({
        source: 'app-settings',
        category: 'race_cancellation',
        content: `Race cancelled: ${race.name} (${race.date})\nReason: ${reason}\nNext steps: ${nextStep || 'Not specified'}`,
        user_id: user?.id,
        date: new Date().toISOString().slice(0, 10),
      })
    } catch (e) {
      console.warn('Could not save cancellation to coaching_memory:', e)
    }
    const newRaces = settings.races.filter((_, idx) => idx !== index)
    const updated = { ...settings, races: newRaces }
    setSettings(updated)
    await supabase.from('athlete_settings').upsert(
      { user_id: userId, ...updated, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setCancelModal(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function deleteAccount() {
    if (deleteConfirmText !== 'DELETE') return
    setDeleting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const uid = user.id
      await Promise.all([
        supabase.from('activities').delete().eq('user_id', uid),
        supabase.from('nutrition_logs').delete().eq('user_id', uid),
        supabase.from('coaching_memory').delete().eq('user_id', uid),
        supabase.from('daily_briefings').delete().eq('user_id', uid),
        supabase.from('scheduled_sessions').delete().eq('user_id', uid),
        supabase.from('plan_drafts').delete().eq('user_id', uid),
        supabase.from('strava_tokens').delete().eq('user_id', uid),
        supabase.from('cycle_logs').delete().eq('user_id', uid),
        supabase.from('schedule_changes').delete().eq('user_id', uid),
        supabase.from('athlete_sports').delete().eq('user_id', uid),
      ])
      await supabase.from('athlete_settings').delete().eq('user_id', uid)
      await supabase.auth.signOut()
      onLogout?.()
      onClose?.()
    } catch (e) {
      alert('Delete failed: ' + e.message)
      setDeleting(false)
    }
  }

  async function deleteCycleData() {
    if (!userId) return
    await Promise.all([
      supabase.from('cycle_logs').delete().eq('user_id', userId),
      supabase.from('athlete_settings').update({
        cycle_tracking_enabled: false, cycle_length_avg: null,
        cycle_is_irregular: false, cycle_last_period_date: null, cycle_notes: null,
      }).eq('user_id', userId),
    ])
    setSettings(s => ({
      ...s,
      cycle_tracking_enabled: false, cycle_length_avg: null,
      cycle_is_irregular: false, cycle_last_period_date: null, cycle_notes: null,
    }))
  }

  const inp = { background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 12px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' }
  const sel = { ...inp, cursor: 'pointer' }
  const ta  = { ...inp, resize: 'vertical', minHeight: 72, lineHeight: 1.5 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      {showSports && <SportsPriorities onClose={() => setShowSports(false)} />}

      {/* Cancel race modal */}
      {cancelModal && (
        <CancelRaceModal
          race={cancelModal.race}
          onConfirm={(reason, nextStep) => cancelRace(cancelModal.index, reason, nextStep)}
          onClose={() => setCancelModal(null)}
        />
      )}

      {/* Plan Review Panel — shown after plan generation */}
      {planDraftId && (
        <PlanReviewPanel
          draftId={planDraftId}
          onCommit={() => setPlanDraftId(null)}
          onDiscard={() => setPlanDraftId(null)}
          onClose={() => setPlanDraftId(null)}
        />
      )}

      {/* New race → generate plan prompt */}
      {newRaceJustAdded && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={() => setNewRaceJustAdded(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 430 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: Z.text, marginBottom: 8 }}>
              New race added!
            </div>
            <div style={{ fontSize: 13, color: Z.muted, marginBottom: 20, lineHeight: 1.5 }}>
              {newRaceJustAdded.name} · {newRaceJustAdded.date}<br />
              Generate a personalised training plan for this race?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => handleGeneratePlan(newRaceJustAdded)}
                disabled={generatingPlan}
                style={{ flex: 1, background: generatingPlan ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '12px', fontFamily: "'DM Mono', monospace", fontSize: 13, cursor: generatingPlan ? 'wait' : 'pointer', color: generatingPlan ? Z.muted : Z.bg, fontWeight: 700 }}
              >
                {generatingPlan ? '⏳ Generating plan...' : 'Yes, generate plan'}
              </button>
              <button
                onClick={() => setNewRaceJustAdded(null)}
                style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '12px 16px', fontFamily: "'DM Mono', monospace", fontSize: 13, cursor: 'pointer', color: Z.muted }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
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

        {/* Cycle Tracking (opt-in) */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Cycle Tracking</div>
              <div style={{ fontSize: 11, color: Z.muted, marginTop: 3, lineHeight: 1.4, maxWidth: 220 }}>
                Optional — helps your coach adapt to your energy levels
              </div>
            </div>
            <button
              onClick={() => setSettings(s => ({...s, cycle_tracking_enabled: !s.cycle_tracking_enabled}))}
              style={{
                padding: '5px 16px', borderRadius: 20, flexShrink: 0,
                background: settings.cycle_tracking_enabled ? Z.accent : 'none',
                border: `1px solid ${settings.cycle_tracking_enabled ? Z.accent : Z.border2}`,
                color: settings.cycle_tracking_enabled ? Z.bg : Z.muted,
                fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                fontWeight: settings.cycle_tracking_enabled ? 600 : 400, transition: 'all 0.15s',
              }}
            >
              {settings.cycle_tracking_enabled ? 'On' : 'Off'}
            </button>
          </div>

          {settings.cycle_tracking_enabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.6, padding: '12px 14px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border}` }}>
                Your cycle data is completely private — only used to help your coach tune training and nutrition guidance to your energy levels.
              </div>

              {/* Cycle length */}
              <div>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>
                  Do you have a rough idea of your average cycle length?
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="number" placeholder="e.g. 28" min={15} max={60}
                    disabled={settings.cycle_is_irregular}
                    value={settings.cycle_length_avg || ''}
                    onChange={e => setSettings(s => ({...s, cycle_length_avg: parseInt(e.target.value) || null, cycle_is_irregular: false}))}
                    style={{ ...inp, width: 90, opacity: settings.cycle_is_irregular ? 0.4 : 1 }}
                  />
                  <span style={{ fontSize: 11, color: Z.muted }}>days</span>
                  <button
                    onClick={() => setSettings(s => ({...s, cycle_is_irregular: !s.cycle_is_irregular, cycle_length_avg: !s.cycle_is_irregular ? null : s.cycle_length_avg}))}
                    style={{
                      padding: '6px 14px', borderRadius: 20,
                      background: settings.cycle_is_irregular ? 'rgba(232,255,71,0.1)' : 'none',
                      border: `1px solid ${settings.cycle_is_irregular ? Z.accent : Z.border2}`,
                      color: settings.cycle_is_irregular ? Z.accent : Z.muted,
                      fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    My cycle is irregular
                  </button>
                </div>
                {settings.cycle_is_irregular && (
                  <div style={{ fontSize: 11, color: Z.muted, marginTop: 8, lineHeight: 1.5 }}>
                    That's completely fine — your coach will rely on your day-to-day signals rather than estimates.
                  </div>
                )}
              </div>

              {/* Last period date */}
              <div>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>
                  When did your last period start? (optional)
                </div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={settings.cycle_last_period_date || ''}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={e => setSettings(s => ({...s, cycle_last_period_date: e.target.value || null}))}
                    style={{ ...inp, width: 'auto' }}
                  />
                  {settings.cycle_last_period_date && (
                    <button
                      onClick={() => setSettings(s => ({...s, cycle_last_period_date: null}))}
                      style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}
                    >
                      not sure / skip
                    </button>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>
                  Anything else you'd like your coach to know? (optional)
                </div>
                <textarea
                  style={ta}
                  placeholder="e.g. I usually feel low energy for the first couple of days, heavy training makes it worse…"
                  value={settings.cycle_notes || ''}
                  onChange={e => setSettings(s => ({...s, cycle_notes: e.target.value || null}))}
                />
              </div>
            </div>
          )}

          {!settings.cycle_tracking_enabled && settings.cycle_last_period_date && (
            <div style={{ fontSize: 11, color: Z.muted, marginTop: 10, lineHeight: 1.6, padding: '10px 14px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border}` }}>
              Your cycle data is still saved in case you re-enable tracking.{' '}
              <button
                onClick={deleteCycleData}
                style={{ background: 'none', border: 'none', color: Z.red, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
              >
                Delete all cycle data
              </button>
            </div>
          )}
        </div>

        {/* Sports & Priorities */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Sports</div>
          <button
            onClick={() => setShowSports(true)}
            style={{
              width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 16px', background: Z.surface, border: `1px solid ${Z.border2}`,
              borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Mono', monospace",
            }}
          >
            <span style={{ fontSize: 13, color: Z.text }}>Sports &amp; Priorities</span>
            <span style={{ fontSize: 16, color: Z.muted }}>›</span>
          </button>
        </div>

        {/* Goal type & level */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Goal</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
          </div>
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
            {stravaConnectError && (
              <div style={{ background: 'rgba(255,92,92,0.1)', border: `1px solid rgba(255,92,92,0.3)`, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 12, color: Z.red }}>
                ⚠ {stravaConnectError}
              </div>
            )}
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
                    {stravaStatus === 'syncing' ? '⏳ Syncing...' : stravaStatus?.startsWith('synced') ? `✓ ${stravaStatus}` : '↓ Sync now'}
                  </button>
                  <button onClick={disconnectStrava} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '9px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>
                    Disconnect
                  </button>
                </div>
                {stravaStatus?.startsWith('error') && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: Z.red, marginBottom: 6, wordBreak: 'break-word' }}>{stravaStatus}</div>
                    <button onClick={testStravaToken} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '5px 10px', fontFamily: "'DM Mono', monospace", fontSize: 10, cursor: 'pointer', color: Z.muted }}>
                      Run token diagnostic
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 12, color: Z.muted, marginBottom: 12, lineHeight: 1.5 }}>Connect Strava to sync activities automatically. Your last 30 days will be imported immediately.</div>
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

        {/* Races */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Races</div>
            <button onClick={() => setShowRaceForm(true)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '4px 10px', color: Z.accent, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>+ Add race</button>
          </div>
          {(settings.races || []).map((r, i) => <RaceItem key={i} race={r} onCancel={() => setCancelModal({ race: r, index: i })} />)}
          {settings.races?.length === 0 && !showRaceForm && (
            <div style={{ fontSize: 13, color: Z.muted, padding: '12px 0' }}>No races added yet.</div>
          )}
          {showRaceForm && (
            <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16, marginTop: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Race name</div>
                  <input style={inp} placeholder="e.g. Munich Marathon" value={newRace.name} onChange={e => setNewRace(r => ({...r, name: e.target.value}))} /></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Date</div>
                  <input style={inp} type="date" value={newRace.date} onChange={e => setNewRace(r => ({...r, date: e.target.value}))} /></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Activity type</div>
                  <select style={sel} value={newRace.type} onChange={e => setNewRace(r => ({...r, type: e.target.value}))}>
                    {['Run','Trail Run','Bike','Skimo','Hyrox','Other'].map(t => <option key={t}>{t}</option>)}
                  </select></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Distance (km)</div>
                  <input style={inp} type="number" value={newRace.distance} onChange={e => setNewRace(r => ({...r, distance: e.target.value}))} /></div>
                <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Target time</div>
                  <input style={inp} placeholder="3:10:00" value={newRace.target} onChange={e => setNewRace(r => ({...r, target: e.target.value}))} /></div>
                {['Trail Run','Bike','Skimo'].includes(newRace.type) && (
                  <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Elevation (m)</div>
                    <input style={inp} type="number" placeholder="2500" value={newRace.elevation} onChange={e => setNewRace(r => ({...r, elevation: e.target.value}))} /></div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={addRace} style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace" }}>Add</button>
                <button onClick={() => setShowRaceForm(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        {/* DATA & SYNC */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 14 }}>Data &amp; Sync</div>
          <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.6, marginBottom: 12 }}>
              Re-imports the last 90 days from Strava and generates a baseline training analysis.
            </div>
            <button
              onClick={handleResync}
              disabled={backfillStatus === 'syncing'}
              style={{ width: '100%', background: backfillStatus === 'syncing' ? '#1a1a1a' : 'none', border: `1px solid ${backfillStatus === 'syncing' ? Z.border : Z.accent}`, borderRadius: 7, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: backfillStatus === 'syncing' ? 'wait' : 'pointer', color: backfillStatus === 'syncing' ? Z.muted : Z.accent }}
            >
              {backfillStatus === 'syncing'
                ? '⏳ Syncing...'
                : typeof backfillStatus === 'number'
                ? `✓ Synced ${backfillStatus} activities`
                : 'Re-sync Strava history (90 days)'}
            </button>
            {typeof backfillStatus === 'string' && backfillStatus.startsWith('error:') && (
              <div style={{ marginTop: 8, fontSize: 11, color: Z.red, wordBreak: 'break-word' }}>
                {backfillStatus.replace('error:', '')}
              </div>
            )}
          </div>
        </div>

        {/* LOGOUT */}
        <div style={{ padding: '24px 0 16px', borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: 8 }}>
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              onLogout?.()
              onClose?.()
            }}
            style={{ width: '100%', background: 'none', border: '1px solid rgba(255,92,92,0.3)', borderRadius: 8, padding: '11px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#ff5c5c' }}
          >
            Sign out
          </button>
        </div>

        {/* DELETE ACCOUNT */}
        <div style={{ paddingBottom: 40 }}>
          {deleteAccountStep === 0 && (
            <button
              onClick={() => setDeleteAccountStep(1)}
              style={{ width: '100%', background: 'none', border: 'none', color: 'rgba(255,92,92,0.35)', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: '6px 0', textDecoration: 'underline', textAlign: 'center' }}
            >
              Delete account
            </button>
          )}
          {deleteAccountStep === 1 && (
            <div style={{ background: 'rgba(255,92,92,0.06)', border: '1px solid rgba(255,92,92,0.2)', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, color: Z.red, fontWeight: 500, marginBottom: 8 }}>Delete account?</div>
              <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 14 }}>
                This will permanently delete all your data — activities, nutrition logs, coaching history, plans, and settings. This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setDeleteAccountStep(2)} style={{ flex: 1, background: Z.red, border: 'none', borderRadius: 7, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#fff', fontWeight: 600 }}>Yes, delete everything</button>
                <button onClick={() => setDeleteAccountStep(0)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>Cancel</button>
              </div>
            </div>
          )}
          {deleteAccountStep === 2 && (
            <div style={{ background: 'rgba(255,92,92,0.06)', border: '1px solid rgba(255,92,92,0.4)', borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, color: Z.red, fontWeight: 500, marginBottom: 8 }}>Are you absolutely sure?</div>
              <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 10 }}>Type DELETE to confirm. This action is permanent.</div>
              <input
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder="Type DELETE"
                style={{ ...inp, marginBottom: 10, borderColor: 'rgba(255,92,92,0.3)' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={deleteAccount}
                  disabled={deleteConfirmText !== 'DELETE' || deleting}
                  style={{ flex: 1, background: deleteConfirmText === 'DELETE' && !deleting ? Z.red : '#1a1a1a', border: 'none', borderRadius: 7, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: deleteConfirmText === 'DELETE' && !deleting ? 'pointer' : 'not-allowed', color: deleteConfirmText === 'DELETE' && !deleting ? '#fff' : Z.muted, fontWeight: 600 }}
                >
                  {deleting ? 'Deleting...' : 'Delete my account'}
                </button>
                <button onClick={() => { setDeleteAccountStep(0); setDeleteConfirmText('') }} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
