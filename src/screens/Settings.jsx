import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { inferAthleteContext } from '../lib/inferAthleteContext'
import { runBackfill } from '../lib/stravaBackfill'
import { generatePlanDraft } from '../lib/planGenerator'
import SportsPriorities from './SportsPriorities'
import PlanReviewPanel from '../components/PlanReviewPanel'
import OnboardingHints from '../components/OnboardingHints'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const DEFAULT_ZONES = { z1_max:124, z2_min:125, z2_max:140, z3_min:141, z3_max:157, z4_min:158, z4_max:172, z5_min:173 }

const ZONE_DEFS = [
  { key:'z1', label:'Z1', name:'Recovery',  color:'#4a9eff', maxKey:'z1_max',  minKey:null },
  { key:'z2', label:'Z2', name:'Aerobic',   color:'#44cc88', maxKey:'z2_max',  minKey:'z2_min' },
  { key:'z3', label:'Z3', name:'Tempo',     color:'#ffcc00', maxKey:'z3_max',  minKey:'z3_min' },
  { key:'z4', label:'Z4', name:'Threshold', color:'#ff8800', maxKey:'z4_max',  minKey:'z4_min' },
  { key:'z5', label:'Z5', name:'Max',       color:'#ff3333', maxKey:null,       minKey:'z5_min' },
]

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

const STRAVA_CLIENT_ID = import.meta.env.VITE_STRAVA_CLIENT_ID

// ── Shared sub-components ──────────────────────────────────────────────────────

function SectionHeader({ title, summary, isOpen, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: Z.text, marginBottom: isOpen || !summary ? 0 : 3 }}>
          {title}
        </div>
        {!isOpen && summary && (
          <div style={{ fontSize: 11, color: Z.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary}
          </div>
        )}
      </div>
      <span style={{ fontSize: 13, color: Z.accent, marginLeft: 12, flexShrink: 0 }}>
        {isOpen ? '▾' : '▸'}
      </span>
    </button>
  )
}

function SaveBtn({ onClick, saving, saved, label = 'Save' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
      <button
        onClick={onClick}
        disabled={saving}
        style={{ background: Z.accent, border: 'none', borderRadius: 7, padding: '9px 20px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: saving ? 'wait' : 'pointer', color: Z.bg, fontWeight: 600 }}
      >
        {saving ? 'Saving...' : label}
      </button>
      {saved && <span style={{ fontSize: 11, color: Z.green }}>Saved ✓</span>}
    </div>
  )
}

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
  const reasons = ['Injury / health issue','Life circumstances changed','Not enough time to train','Race cancelled or rescheduled','Changed goals / priorities','Other']
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
        <textarea value={nextStep} onChange={e => setNextStep(e.target.value)}
          placeholder="e.g. Focusing on base fitness for now, targeting a race next year..."
          rows={2} style={{ ...inp2, resize: 'none', lineHeight: 1.5, marginBottom: 16 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => reason && onConfirm(reason, nextStep)} disabled={!reason}
            style={{ flex: 1, background: reason ? Z.red : '#1a1a1a', border: 'none', borderRadius: 7, padding: '11px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: reason ? 'pointer' : 'not-allowed', color: reason ? '#fff' : Z.muted, fontWeight: 600 }}>
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

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings({ onClose, stravaConnectError, onLogout, onOpenRoadmap, onOpenFeatureRequest }) {
  const [openSection, setOpenSection] = useState(null)

  // ── Core settings from DB ────────────────────────────────
  const [settings, setSettings] = useState({
    tone:50, consequences:50, detail_level:50, coaching_reach:50,
    name:'', races:[], dob:'', height_cm:'', weight_kg:'',
    goal_type:null, current_level:null,
    health_notes:null,
    cycle_tracking_enabled: false, cycle_length_avg: null, cycle_is_irregular: false,
    cycle_last_period_date: null, cycle_notes: null,
    benchmark_raw:null, benchmark_value:null, health_notes_raw:null,
    has_injury:null, training_days_per_week:null, sleep_hours_typical:null,
    current_weight_kg:null, onboarding_nudges_sent:null,
    training_zones: null, health_flags: null, subscription_tier: 'founder',
  })
  const [userId, setUserId] = useState(null)
  const [email, setEmail] = useState('')

  // ── Section-local save states ────────────────────────────
  const [personalSaving, setPersonalSaving] = useState(false)
  const [personalSaved, setPersonalSaved] = useState(false)
  const [coachingSaving, setCoachingSaving] = useState(false)
  const [coachingSaved, setCoachingSaved] = useState(false)
  const [zoneSaving, setZoneSaving] = useState(false)
  const [zoneSaved, setZoneSaved] = useState(false)
  const [zoneError, setZoneError] = useState(null)

  // ── Training zones local state ───────────────────────────
  const [zones, setZones] = useState({ ...DEFAULT_ZONES })

  // ── Health flags local state ─────────────────────────────
  const [healthFlags, setHealthFlags] = useState([])
  const [editingFlagId, setEditingFlagId] = useState(null)
  const [flagEdits, setFlagEdits] = useState({})
  const [flagSaving, setFlagSaving] = useState(false)
  const [showAddFlag, setShowAddFlag] = useState(false)
  const [newFlag, setNewFlag] = useState({ label:'', status:'active', notes:'' })

  // ── Races / plan ─────────────────────────────────────────
  const [newRace, setNewRace] = useState({ name:'', date:'', type:'Run', distance:'42.2', target:'3:10:00', elevation:'' })
  const [showRaceForm, setShowRaceForm] = useState(false)
  const [newRaceJustAdded, setNewRaceJustAdded] = useState(null)
  const [generatingPlan, setGeneratingPlan] = useState(false)
  const [planDraftId, setPlanDraftId] = useState(null)
  const [cancelModal, setCancelModal] = useState(null)

  // ── Strava ────────────────────────────────────────────────
  const [stravaToken, setStravaToken] = useState(null)
  const [stravaStatus, setStravaStatus] = useState(null)
  const [backfillStatus, setBackfillStatus] = useState(null)

  // ── Sports / AI ───────────────────────────────────────────
  const [showSports, setShowSports] = useState(false)
  const [inferState, setInferState] = useState(null)

  // ── Delete account ────────────────────────────────────────
  const [deleteAccountStep, setDeleteAccountStep] = useState(0)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  // ── Load ─────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data?.user?.id ?? null)
      setEmail(data?.user?.email ?? '')
    })
    supabase.from('athlete_settings').select('*').maybeSingle().then(({ data }) => {
      if (data) {
        setSettings(s => ({ ...s, ...data, races: data.races || [] }))
        setZones({ ...DEFAULT_ZONES, ...(data.training_zones || {}) })
        setHealthFlags(data.health_flags || [])
      }
    })
    supabase.from('strava_tokens').select('athlete_id, athlete_name').maybeSingle()
      .then(({ data }) => setStravaToken(data || false))
  }, [])

  // ── Helpers ───────────────────────────────────────────────
  function toggleSection(key) { setOpenSection(s => s === key ? null : key) }

  const inp = { background: Z.bg, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 12px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 13, width: '100%', outline: 'none', boxSizing: 'border-box' }
  const sel = { ...inp, cursor: 'pointer' }
  const ta  = { ...inp, resize: 'vertical', minHeight: 72, lineHeight: 1.5 }

  function flash(setSaved) { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  // ── Save functions ────────────────────────────────────────

  async function savePersonal() {
    setPersonalSaving(true)
    try {
      await supabase.from('athlete_settings').upsert({
        user_id: userId,
        name: settings.name || null,
        dob: settings.dob || null,
        height_cm: settings.height_cm ? parseInt(settings.height_cm) : null,
        weight_kg: settings.weight_kg ? parseFloat(settings.weight_kg) : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      flash(setPersonalSaved)
    } catch (e) { console.error('savePersonal failed:', e) }
    setPersonalSaving(false)
  }

  async function saveCoaching() {
    setCoachingSaving(true)
    try {
      await supabase.from('athlete_settings').upsert({
        user_id: userId,
        tone: settings.tone,
        consequences: settings.consequences,
        detail_level: settings.detail_level,
        coaching_reach: settings.coaching_reach,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      flash(setCoachingSaved)
    } catch (e) { console.error('saveCoaching failed:', e) }
    setCoachingSaving(false)
  }

  async function saveZones() {
    // Validate contiguity
    if (zones.z2_min !== zones.z1_max + 1) { setZoneError('Z2 min must equal Z1 max + 1'); return }
    if (zones.z3_min !== zones.z2_max + 1) { setZoneError('Z3 min must equal Z2 max + 1'); return }
    if (zones.z4_min !== zones.z3_max + 1) { setZoneError('Z4 min must equal Z3 max + 1'); return }
    if (zones.z5_min !== zones.z4_max + 1) { setZoneError('Z5 min must equal Z4 max + 1'); return }
    setZoneError(null)
    setZoneSaving(true)
    try {
      await supabase.from('athlete_settings').upsert({
        user_id: userId, training_zones: zones, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      flash(setZoneSaved)
    } catch (e) { console.error('saveZones failed:', e) }
    setZoneSaving(false)
  }

  async function saveHealthFlags(updatedFlags) {
    setFlagSaving(true)
    try {
      await supabase.from('athlete_settings').upsert({
        user_id: userId, health_flags: updatedFlags, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      setHealthFlags(updatedFlags)
    } catch (e) { console.error('saveHealthFlags failed:', e) }
    setFlagSaving(false)
  }

  async function addRace() {
    if (!newRace.name || !newRace.date) return
    const raceToAdd = { ...newRace }
    const updated = { ...settings, races: [...(settings.races || []), raceToAdd] }
    setSettings(updated)
    setNewRace({ name:'', date:'', type:'Run', distance:'42.2', target:'3:10:00', elevation:'' })
    setShowRaceForm(false)
    await supabase.from('athlete_settings').upsert({ user_id: userId, ...updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setNewRaceJustAdded(raceToAdd)
  }

  async function cancelRace(index, reason, nextStep) {
    const race = settings.races[index]
    try {
      const { data: { user } } = await supabase.auth.getUser()
      await supabase.from('coaching_memory').insert({
        source: 'app-settings', category: 'race_cancellation',
        content: `Race cancelled: ${race.name} (${race.date})\nReason: ${reason}\nNext steps: ${nextStep || 'Not specified'}`,
        user_id: user?.id, date: new Date().toISOString().slice(0, 10),
      })
    } catch (e) { console.warn('Could not save cancellation to coaching_memory:', e) }
    const newRaces = settings.races.filter((_, idx) => idx !== index)
    const updated = { ...settings, races: newRaces }
    setSettings(updated)
    await supabase.from('athlete_settings').upsert({ user_id: userId, ...updated, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    setCancelModal(null)
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
    } catch (e) { alert('Plan generation failed: ' + e.message) }
    setGeneratingPlan(false)
  }

  function connectStrava() {
    const redirectUri = window.location.origin
    const url = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&approval_prompt=auto&scope=activity:read_all`
    window.location.href = url
  }

  async function syncStrava() {
    setStravaStatus('syncing')
    const sessionRes = await supabase.auth.getSession()
    const jwt = sessionRes.data?.session?.access_token
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_KEY, ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}) },
        body: JSON.stringify({}),
      })
      const text = await res.text()
      let data; try { data = JSON.parse(text) } catch { data = { error: text } }
      if (!res.ok || data?.error) { setStravaStatus(`error: ${data?.error || res.status}`) }
      else { setStravaStatus(`synced ${data?.synced ?? 0} activities`); setTimeout(() => setStravaStatus(null), 4000) }
    } catch (e) { setStravaStatus(`error: ${e.message}`) }
  }

  async function testStravaToken() {
    const sessionRes = await supabase.auth.getSession()
    const jwt = sessionRes.data?.session?.access_token
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-sync?test=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_KEY, ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}) },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    setStravaStatus(`diag: ${JSON.stringify(data).slice(0, 200)}`)
  }

  async function disconnectStrava() {
    await supabase.from('strava_tokens').delete().eq('user_id', (await supabase.auth.getUser()).data.user.id)
    setStravaToken(false)
  }

  async function handleResync() {
    setBackfillStatus('syncing')
    const result = await runBackfill()
    if (result.error) { setBackfillStatus(`error:${result.error}`); setTimeout(() => setBackfillStatus(null), 5000) }
    else { setBackfillStatus(result.activitiesImported); setTimeout(() => setBackfillStatus(null), 4000) }
  }

  async function reanalyse() {
    setInferState('running')
    try {
      const result = await inferAthleteContext({ benchmark_raw: settings.benchmark_raw || null, health_notes_raw: settings.health_notes_raw || null })
      const { data } = await supabase.from('athlete_settings').select('*').maybeSingle()
      if (data) setSettings(s => ({ ...s, ...data, races: data.races || [] }))
      setInferState(result)
    } catch { setInferState('error') }
  }

  async function deleteCycleData() {
    if (!userId) return
    await Promise.all([
      supabase.from('cycle_logs').delete().eq('user_id', userId),
      supabase.from('athlete_settings').update({ cycle_tracking_enabled: false, cycle_length_avg: null, cycle_is_irregular: false, cycle_last_period_date: null, cycle_notes: null }).eq('user_id', userId),
    ])
    setSettings(s => ({ ...s, cycle_tracking_enabled: false, cycle_length_avg: null, cycle_is_irregular: false, cycle_last_period_date: null, cycle_notes: null }))
  }

  async function saveCycleSettings() {
    await supabase.from('athlete_settings').upsert({
      user_id: userId,
      cycle_tracking_enabled: settings.cycle_tracking_enabled,
      cycle_length_avg: settings.cycle_length_avg,
      cycle_is_irregular: settings.cycle_is_irregular,
      cycle_last_period_date: settings.cycle_last_period_date,
      cycle_notes: settings.cycle_notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
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
      onLogout?.(); onClose?.()
    } catch (e) { alert('Delete failed: ' + e.message); setDeleting(false) }
  }

  // ── Derived values for collapsed summaries ────────────────

  const age = settings.dob
    ? Math.floor((Date.now() - new Date(settings.dob)) / (365.25 * 24 * 60 * 60 * 1000))
    : null
  const personalSummary = settings.name
    ? [settings.name, age ? `${age}` : null].filter(Boolean).join(' · ')
    : 'Set your profile'

  const today = new Date().toISOString().slice(0, 10)
  const nextRace = (settings.races || []).filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0]
  const racesSummary = nextRace ? `${nextRace.name} · ${nextRace.date}` : 'No active target'

  const z2min = zones.z2_min ?? DEFAULT_ZONES.z2_min
  const z2max = zones.z2_max ?? DEFAULT_ZONES.z2_max
  const zonesSummary = `Z2: ${z2min}–${z2max} bpm`

  const activeFlags = healthFlags.filter(f => f.status === 'active' || f.status === 'monitoring')
  const flagsSummary = activeFlags.length === 0
    ? 'No active flags'
    : activeFlags.length === 1
    ? `1 active flag: ${activeFlags[0].label}`
    : `${activeFlags.length} active flags`

  const coachingSummary = `Tone ${settings.tone ?? 50} · Detail ${settings.detail_level ?? 50} · Reach ${settings.coaching_reach ?? 50}`

  const stravaSummary = stravaToken ? 'Strava connected' : stravaToken === false ? 'Strava not connected' : '...'

  const tierLabels = { founder: 'Founder', free: 'Free', pro: 'Pro' }
  const subTier = settings.subscription_tier || 'founder'
  const subSummary = tierLabels[subTier] || subTier

  // ── Zone input helper ─────────────────────────────────────
  function updateZone(key, value) {
    const v = parseInt(value, 10)
    if (isNaN(v)) return
    setZones(z => ({ ...z, [key]: v }))
    setZoneError(null)
  }

  // ── Health flag helpers ───────────────────────────────────
  function startEditFlag(flag) {
    setEditingFlagId(flag.id)
    setFlagEdits({ status: flag.status, notes: flag.notes })
  }

  async function saveFlag(flag) {
    const updated = healthFlags.map(f => f.id === flag.id
      ? { ...f, ...flagEdits, updated_date: new Date().toISOString().slice(0, 10) }
      : f
    )
    await saveHealthFlags(updated)
    setEditingFlagId(null)
  }

  async function addFlag() {
    if (!newFlag.label) return
    const flag = { id: newFlag.label.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now(), ...newFlag, updated_date: new Date().toISOString().slice(0, 10) }
    const updated = [...healthFlags, flag]
    await saveHealthFlags(updated)
    setNewFlag({ label:'', status:'active', notes:'' })
    setShowAddFlag(false)
  }

  const shouldShowPhysioReminder = healthFlags.some(f =>
    f.id === 'shoulder_right' &&
    (f.status === 'active' || f.status === 'monitoring') &&
    (f.notes?.toLowerCase().includes('undiagnosed') || f.notes?.toLowerCase().includes('pending') || f.notes?.toLowerCase().includes('suspected'))
  )

  // ── Render ────────────────────────────────────────────────

  const sectionStyle = (key) => ({
    background: Z.surface,
    border: `1px solid ${openSection === key ? 'rgba(255,255,255,0.18)' : Z.border}`,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 8,
    transition: 'border-color 0.15s',
  })
  const sectionBody = { padding: '0 20px 20px' }

  async function resetHints() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) await supabase.from('athlete_settings').update({ hints_dismissed: {} }).eq('user_id', user.id)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column' }}>
      <OnboardingHints
        hintId="settings_overview"
        title="Your profile and preferences"
        body="Set your training zones, health flags, and coaching tone here. Your coach reads this data live — updating your shoulder status or zones immediately affects coaching advice. Connected Services links your Strava account."
        position="bottom"
      />
      {showSports && <SportsPriorities onClose={() => setShowSports(false)} />}

      {cancelModal && (
        <CancelRaceModal
          race={cancelModal.race}
          onConfirm={(reason, nextStep) => cancelRace(cancelModal.index, reason, nextStep)}
          onClose={() => setCancelModal(null)}
        />
      )}

      {planDraftId && (
        <PlanReviewPanel draftId={planDraftId} onCommit={() => setPlanDraftId(null)} onDiscard={() => setPlanDraftId(null)} onClose={() => setPlanDraftId(null)} />
      )}

      {newRaceJustAdded && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={() => setNewRaceJustAdded(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }} />
          <div style={{ position: 'relative', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: '16px 16px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 430 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 17, fontWeight: 700, color: Z.text, marginBottom: 8 }}>New race added!</div>
            <div style={{ fontSize: 13, color: Z.muted, marginBottom: 20, lineHeight: 1.5 }}>
              {newRaceJustAdded.name} · {newRaceJustAdded.date}<br />Generate a personalised training plan for this race?
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => handleGeneratePlan(newRaceJustAdded)} disabled={generatingPlan}
                style={{ flex: 1, background: generatingPlan ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '12px', fontFamily: "'DM Mono', monospace", fontSize: 13, cursor: generatingPlan ? 'wait' : 'pointer', color: generatingPlan ? Z.muted : Z.bg, fontWeight: 700 }}>
                {generatingPlan ? '⏳ Generating plan...' : 'Yes, generate plan'}
              </button>
              <button onClick={() => setNewRaceJustAdded(null)}
                style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '12px 16px', fontFamily: "'DM Mono', monospace", fontSize: 13, cursor: 'pointer', color: Z.muted }}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${Z.border}`, background: Z.bg, flexShrink: 0 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 17, color: Z.text }}>Settings</div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>

        {/* ── SECTION 1: PERSONAL ── */}
        <div style={sectionStyle('personal')}>
          <SectionHeader title="Personal" summary={personalSummary} isOpen={openSection === 'personal'} onToggle={() => toggleSection('personal')} />
          {openSection === 'personal' && (
            <div style={sectionBody}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Full name</div>
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
                    onChange={e => setSettings(s => ({...s, height_cm: e.target.value}))} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Weight (kg)</div>
                  <input style={inp} type="number" placeholder="79" value={settings.weight_kg || ''}
                    onChange={e => setSettings(s => ({...s, weight_kg: e.target.value}))} />
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Account email</div>
                <div style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${Z.border}`, borderRadius: 6, fontSize: 13, color: Z.muted }}>
                  {email || '—'}
                </div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>To change your email contact support.</div>
              </div>
              <SaveBtn onClick={savePersonal} saving={personalSaving} saved={personalSaved} />
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${Z.border}` }}>
                <button
                  onClick={resetHints}
                  style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
                >
                  Reset onboarding hints
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 2: GOALS & RACES ── */}
        <div style={sectionStyle('races')}>
          <SectionHeader title="Goals & Races" summary={racesSummary} isOpen={openSection === 'races'} onToggle={() => toggleSection('races')} />
          {openSection === 'races' && (
            <div style={sectionBody}>
              {/* Sports link */}
              <button onClick={() => setShowSports(true)}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', border: `1px solid ${Z.border}`, borderRadius: 8, cursor: 'pointer', fontFamily: "'DM Mono', monospace", marginBottom: 16 }}>
                <span style={{ fontSize: 12, color: Z.text }}>Sports & Priorities</span>
                <span style={{ fontSize: 14, color: Z.muted }}>›</span>
              </button>

              {/* Goal type & level */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
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

              {/* Race list */}
              <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Races</div>
              {(settings.races || []).map((r, i) => {
                const daysTo = r.date >= today ? Math.ceil((new Date(r.date) - new Date()) / (1000 * 60 * 60 * 24)) : null
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 8, border: `1px solid ${Z.border}`, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, color: Z.text, fontWeight: 500 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
                        {r.date}{daysTo !== null ? ` · ${daysTo}d` : ''} · {r.distance}km · {r.target}
                      </div>
                    </div>
                    <button onClick={() => setCancelModal({ race: r, index: i })}
                      style={{ background: 'none', border: `1px solid rgba(255,92,92,0.2)`, borderRadius: 6, padding: '3px 8px', color: Z.muted, cursor: 'pointer', fontSize: 11, fontFamily: "'DM Mono', monospace" }}>
                      Cancel
                    </button>
                  </div>
                )
              })}
              {(settings.races || []).length === 0 && !showRaceForm && (
                <div style={{ fontSize: 12, color: Z.muted, padding: '8px 0', marginBottom: 8 }}>No races added yet.</div>
              )}

              {/* Add race form */}
              {!showRaceForm ? (
                <button onClick={() => setShowRaceForm(true)}
                  style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '8px 16px', color: Z.accent, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                  + Add race
                </button>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${Z.border}`, borderRadius: 10, padding: 14, marginTop: 8 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Race name</div>
                      <input style={inp} placeholder="e.g. Munich Marathon" value={newRace.name} onChange={e => setNewRace(r => ({...r, name: e.target.value}))} /></div>
                    <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Date</div>
                      <input style={inp} type="date" value={newRace.date} onChange={e => setNewRace(r => ({...r, date: e.target.value}))} /></div>
                    <div><div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Type</div>
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
          )}
        </div>

        {/* ── SECTION 3: TRAINING ZONES ── */}
        <div style={sectionStyle('zones')}>
          <SectionHeader title="Training Zones" summary={zonesSummary} isOpen={openSection === 'zones'} onToggle={() => toggleSection('zones')} />
          {openSection === 'zones' && (
            <div style={sectionBody}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>

                {/* Z1 — max only */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #4a9eff' }}>
                  <div style={{ width: 28, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#4a9eff' }}>Z1</div>
                    <div style={{ fontSize: 10, color: Z.muted }}>Recovery</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: Z.muted }}>
                    <span>&lt;</span>
                    <input type="number" value={zones.z1_max} onChange={e => updateZone('z1_max', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>bpm</span>
                  </div>
                </div>

                {/* Z2 — min and max */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #44cc88' }}>
                  <div style={{ width: 28, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#44cc88' }}>Z2</div>
                    <div style={{ fontSize: 10, color: Z.muted }}>Aerobic</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: Z.muted }}>
                    <input type="number" value={zones.z2_min} onChange={e => updateZone('z2_min', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>–</span>
                    <input type="number" value={zones.z2_max} onChange={e => updateZone('z2_max', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>bpm</span>
                  </div>
                </div>

                {/* Z3 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #ffcc00' }}>
                  <div style={{ width: 28, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#ffcc00' }}>Z3</div>
                    <div style={{ fontSize: 10, color: Z.muted }}>Tempo</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: Z.muted }}>
                    <input type="number" value={zones.z3_min} onChange={e => updateZone('z3_min', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>–</span>
                    <input type="number" value={zones.z3_max} onChange={e => updateZone('z3_max', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>bpm</span>
                  </div>
                </div>

                {/* Z4 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #ff8800' }}>
                  <div style={{ width: 28, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#ff8800' }}>Z4</div>
                    <div style={{ fontSize: 10, color: Z.muted }}>Threshold</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: Z.muted }}>
                    <input type="number" value={zones.z4_min} onChange={e => updateZone('z4_min', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>–</span>
                    <input type="number" value={zones.z4_max} onChange={e => updateZone('z4_max', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>bpm</span>
                  </div>
                </div>

                {/* Z5 — min only */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, borderLeft: '3px solid #ff3333' }}>
                  <div style={{ width: 28, flexShrink: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#ff3333' }}>Z5</div>
                    <div style={{ fontSize: 10, color: Z.muted }}>Max</div>
                  </div>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: Z.muted }}>
                    <span>&gt;</span>
                    <input type="number" value={zones.z5_min} onChange={e => updateZone('z5_min', e.target.value)}
                      style={{ ...inp, width: 64, textAlign: 'center', padding: '5px 8px', fontSize: 13 }} />
                    <span>bpm</span>
                  </div>
                </div>
              </div>

              {zoneError && <div style={{ fontSize: 11, color: Z.red, marginBottom: 10 }}>⚠ {zoneError}</div>}
              <SaveBtn onClick={saveZones} saving={zoneSaving} saved={zoneSaved} />
              <div style={{ marginTop: 14, fontSize: 11, color: Z.muted, lineHeight: 1.5 }}>
                Zones are estimates. Run a 5km time trial to recalibrate.
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 4: HEALTH & INJURIES ── */}
        <div style={sectionStyle('health')}>
          <SectionHeader title="Health & Injuries" summary={flagsSummary} isOpen={openSection === 'health'} onToggle={() => toggleSection('health')} />
          {openSection === 'health' && (
            <div style={sectionBody}>
              {/* Health flags */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                {healthFlags.map(flag => {
                  const isEditing = editingFlagId === flag.id
                  const statusColors = { active: { bg:'rgba(255,92,92,0.12)', color:Z.red }, monitoring: { bg:'rgba(255,179,71,0.12)', color:Z.amber }, resolved: { bg:'rgba(77,255,145,0.12)', color:Z.green } }
                  const sc = statusColors[flag.status] || statusColors.monitoring
                  return (
                    <div key={flag.id} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${Z.border}`, borderRadius: 8, padding: '12px 14px' }}>
                      {!isEditing ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                            <div style={{ fontSize: 13, color: Z.text, fontWeight: 500 }}>{flag.label}</div>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4, background: sc.bg, color: sc.color }}>
                                {flag.status}
                              </span>
                              <button onClick={() => startEditFlag(flag)}
                                style={{ background: 'none', border: `1px solid ${Z.border}`, borderRadius: 5, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>
                                Edit
                              </button>
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 4 }}>{flag.notes}</div>
                          <div style={{ fontSize: 10, color: '#444' }}>Updated {flag.updated_date}</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, marginBottom: 10 }}>{flag.label}</div>
                          <div style={{ marginBottom: 8 }}>
                            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Status</div>
                            <select value={flagEdits.status} onChange={e => setFlagEdits(f => ({...f, status: e.target.value}))} style={{ ...sel, width: 'auto' }}>
                              <option value="active">Active</option>
                              <option value="monitoring">Monitoring</option>
                              <option value="resolved">Resolved</option>
                            </select>
                          </div>
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Notes</div>
                            <textarea value={flagEdits.notes} onChange={e => setFlagEdits(f => ({...f, notes: e.target.value}))} rows={3} style={ta} />
                          </div>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => saveFlag(flag)} disabled={flagSaving}
                              style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace" }}>
                              {flagSaving ? 'Saving...' : 'Save'}
                            </button>
                            <button onClick={() => setEditingFlagId(null)}
                              style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Add flag */}
              {!showAddFlag ? (
                <button onClick={() => setShowAddFlag(true)}
                  style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '7px 16px', color: Z.accent, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Mono', monospace", marginBottom: 14 }}>
                  + Add flag
                </button>
              ) : (
                <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${Z.border}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Label</div>
                    <input style={inp} placeholder="e.g. Left knee" value={newFlag.label} onChange={e => setNewFlag(f => ({...f, label: e.target.value}))} />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Status</div>
                    <select value={newFlag.status} onChange={e => setNewFlag(f => ({...f, status: e.target.value}))} style={{ ...sel, width: 'auto' }}>
                      <option value="active">Active</option>
                      <option value="monitoring">Monitoring</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Notes</div>
                    <textarea value={newFlag.notes} onChange={e => setNewFlag(f => ({...f, notes: e.target.value}))} rows={2} style={ta} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={addFlag} style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 12, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace" }}>Add</button>
                    <button onClick={() => setShowAddFlag(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: Z.muted, fontFamily: "'DM Mono', monospace" }}>Cancel</button>
                  </div>
                </div>
              )}

              {shouldShowPhysioReminder && (
                <div style={{ fontSize: 12, color: Z.amber, lineHeight: 1.5, padding: '10px 12px', background: 'rgba(255,179,71,0.08)', border: '1px solid rgba(255,179,71,0.2)', borderRadius: 8, marginBottom: 14 }}>
                  ⚠ Right shoulder diagnosis still pending — physio appointment not yet booked.
                </div>
              )}

              {/* Cycle tracking */}
              <div style={{ borderTop: `1px solid ${Z.border}`, paddingTop: 16, marginTop: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 12, color: Z.text, marginBottom: 2 }}>Cycle Tracking</div>
                    <div style={{ fontSize: 11, color: Z.muted, lineHeight: 1.4, maxWidth: 200 }}>Optional — helps coach adapt to energy levels</div>
                  </div>
                  <button onClick={() => setSettings(s => ({...s, cycle_tracking_enabled: !s.cycle_tracking_enabled}))}
                    style={{ padding: '5px 16px', borderRadius: 20, flexShrink: 0, background: settings.cycle_tracking_enabled ? Z.accent : 'none', border: `1px solid ${settings.cycle_tracking_enabled ? Z.accent : Z.border2}`, color: settings.cycle_tracking_enabled ? Z.bg : Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", fontWeight: settings.cycle_tracking_enabled ? 600 : 400 }}>
                    {settings.cycle_tracking_enabled ? 'On' : 'Off'}
                  </button>
                </div>
                {settings.cycle_tracking_enabled && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>Average cycle length</div>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="number" placeholder="e.g. 28" min={15} max={60} disabled={settings.cycle_is_irregular}
                          value={settings.cycle_length_avg || ''}
                          onChange={e => setSettings(s => ({...s, cycle_length_avg: parseInt(e.target.value) || null, cycle_is_irregular: false}))}
                          style={{ ...inp, width: 90, opacity: settings.cycle_is_irregular ? 0.4 : 1 }} />
                        <span style={{ fontSize: 11, color: Z.muted }}>days</span>
                        <button onClick={() => setSettings(s => ({...s, cycle_is_irregular: !s.cycle_is_irregular, cycle_length_avg: !s.cycle_is_irregular ? null : s.cycle_length_avg}))}
                          style={{ padding: '5px 12px', borderRadius: 20, background: settings.cycle_is_irregular ? 'rgba(232,255,71,0.1)' : 'none', border: `1px solid ${settings.cycle_is_irregular ? Z.accent : Z.border2}`, color: settings.cycle_is_irregular ? Z.accent : Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                          Irregular
                        </button>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>Last period start (optional)</div>
                      <input type="date" value={settings.cycle_last_period_date || ''} max={today}
                        onChange={e => setSettings(s => ({...s, cycle_last_period_date: e.target.value || null}))}
                        style={{ ...inp, width: 'auto' }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>Notes (optional)</div>
                      <textarea style={ta} placeholder="e.g. Low energy for first couple of days…"
                        value={settings.cycle_notes || ''} onChange={e => setSettings(s => ({...s, cycle_notes: e.target.value || null}))} />
                    </div>
                    <button onClick={saveCycleSettings} style={{ background: Z.accent, border: 'none', borderRadius: 7, padding: '8px 18px', fontSize: 12, cursor: 'pointer', color: Z.bg, fontFamily: "'DM Mono', monospace", fontWeight: 600, alignSelf: 'flex-start' }}>
                      Save cycle settings
                    </button>
                  </div>
                )}
                {!settings.cycle_tracking_enabled && settings.cycle_last_period_date && (
                  <div style={{ fontSize: 11, color: Z.muted, lineHeight: 1.6, padding: '10px 12px', background: Z.surface, borderRadius: 8, border: `1px solid ${Z.border}` }}>
                    Cycle data is still saved.{' '}
                    <button onClick={deleteCycleData}
                      style={{ background: 'none', border: 'none', color: Z.red, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}>
                      Delete all cycle data
                    </button>
                  </div>
                )}
              </div>

              {/* AI inputs */}
              <div style={{ borderTop: `1px solid ${Z.border}`, paddingTop: 16, marginTop: 16 }}>
                <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>AI analysis inputs</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Current fitness</div>
                    <textarea style={ta} placeholder="e.g. I can run 5k in about 28 mins…" value={settings.benchmark_raw || ''}
                      onChange={e => setSettings(s => ({...s, benchmark_raw: e.target.value || null}))} />
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: Z.muted, marginBottom: 5 }}>Health notes (free text)</div>
                    <textarea style={ta} placeholder="e.g. C6 disc issue, no overhead pressing…" value={settings.health_notes_raw || ''}
                      onChange={e => setSettings(s => ({...s, health_notes_raw: e.target.value || null}))} />
                  </div>
                </div>
                <button onClick={reanalyse} disabled={inferState === 'running'}
                  style={{ marginTop: 10, width: '100%', background: inferState === 'running' ? '#1a1a1a' : 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: inferState === 'running' ? 'wait' : 'pointer', color: inferState === 'running' ? Z.muted : Z.accent }}>
                  {inferState === 'running' ? 'Analysing…' : '↺ Re-analyse'}
                </button>
                {inferState && inferState !== 'running' && inferState !== 'error' && (
                  <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: `1px solid ${Z.border}`, fontSize: 12, color: Z.muted, lineHeight: 1.8 }}>
                    {inferState.benchmark_value && <div>→ Benchmark: <span style={{ color: Z.text }}>{inferState.benchmark_value}</span></div>}
                    {inferState.has_injury != null && <div>→ Injury: <span style={{ color: inferState.has_injury ? Z.amber : Z.green }}>{inferState.has_injury ? 'flagged' : 'none'}</span></div>}
                    {inferState.current_level && <div>→ Level: <span style={{ color: Z.text }}>{inferState.current_level}</span></div>}
                  </div>
                )}
                {inferState === 'error' && <div style={{ marginTop: 8, fontSize: 11, color: Z.red }}>Analysis failed — try again</div>}
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 5: COACHING PREFERENCES ── */}
        <div style={sectionStyle('coaching')}>
          <SectionHeader title="Coaching Preferences" summary={coachingSummary} isOpen={openSection === 'coaching'} onToggle={() => toggleSection('coaching')} />
          {openSection === 'coaching' && (
            <div style={sectionBody}>
              <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${Z.border}`, borderRadius: 10, padding: '20px 20px 4px' }}>
                {SLIDERS.map(s => (
                  <Slider key={s.key} config={s} value={settings[s.key] ?? 50}
                    onChange={v => setSettings(prev => ({...prev, [s.key]: v}))} />
                ))}
              </div>
              <SaveBtn onClick={saveCoaching} saving={coachingSaving} saved={coachingSaved} />
            </div>
          )}
        </div>

        {/* ── SECTION 6: CONNECTED SERVICES ── */}
        <div style={sectionStyle('services')}>
          <SectionHeader
            title="Connected Services"
            summary={<span style={{ color: stravaToken ? Z.green : Z.muted }}>{stravaSummary}</span>}
            isOpen={openSection === 'services'}
            onToggle={() => toggleSection('services')}
          />
          {openSection === 'services' && (
            <div style={sectionBody}>
              {/* Strava */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Strava</div>
                <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${Z.border}`, borderRadius: 10, padding: 14 }}>
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
                        <button onClick={syncStrava} disabled={stravaStatus === 'syncing'}
                          style={{ flex: 1, background: stravaStatus === 'syncing' ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: stravaStatus === 'syncing' ? 'wait' : 'pointer', color: Z.bg, fontWeight: 600 }}>
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
                      <div style={{ fontSize: 12, color: Z.muted, marginBottom: 12, lineHeight: 1.5 }}>Connect Strava to sync activities automatically.</div>
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

              {/* Re-sync */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8, lineHeight: 1.5 }}>Re-import last 90 days from Strava and regenerate baseline analysis.</div>
                <button onClick={handleResync} disabled={backfillStatus === 'syncing'}
                  style={{ width: '100%', background: backfillStatus === 'syncing' ? '#1a1a1a' : 'none', border: `1px solid ${backfillStatus === 'syncing' ? Z.border : Z.border2}`, borderRadius: 7, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: backfillStatus === 'syncing' ? 'wait' : 'pointer', color: backfillStatus === 'syncing' ? Z.muted : Z.muted }}>
                  {backfillStatus === 'syncing' ? '⏳ Syncing...' : typeof backfillStatus === 'number' ? `✓ Synced ${backfillStatus} activities` : 'Re-sync Strava history (90 days)'}
                </button>
                {typeof backfillStatus === 'string' && backfillStatus.startsWith('error:') && (
                  <div style={{ marginTop: 6, fontSize: 11, color: Z.red }}>{backfillStatus.replace('error:', '')}</div>
                )}
              </div>

              {/* Coming soon placeholders */}
              <div style={{ fontSize: 11, color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>Coming soon</div>
              {['Suunto / HRV data', 'Apple Health'].map(name => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${Z.border}`, borderRadius: 8, marginBottom: 8, opacity: 0.5 }}>
                  <span style={{ fontSize: 12, color: Z.muted }}>{name}</span>
                  <span style={{ fontSize: 10, color: Z.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Soon</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── SECTION 7: SUBSCRIPTION ── */}
        <div style={sectionStyle('subscription')}>
          <SectionHeader
            title="Subscription"
            summary={<span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4, background: subTier === 'founder' ? 'rgba(232,255,71,0.15)' : 'rgba(255,255,255,0.08)', color: subTier === 'founder' ? Z.accent : Z.muted }}>{subSummary}</span>}
            isOpen={openSection === 'subscription'}
            onToggle={() => toggleSection('subscription')}
          />
          {openSection === 'subscription' && (
            <div style={sectionBody}>
              {/* Account block */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${Z.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${Z.border}` }}>
                  <span style={{ fontSize: 11, color: Z.muted }}>Email</span>
                  <span style={{ fontSize: 12, color: Z.text }}>{email || '—'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${Z.border}` }}>
                  <span style={{ fontSize: 11, color: Z.muted }}>User ID</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: '#555', fontFamily: "'DM Mono', monospace" }}>{userId ? userId.slice(0, 8) + '...' : '—'}</span>
                    {userId && (
                      <button onClick={() => navigator.clipboard.writeText(userId)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: Z.muted, padding: 0 }} title="Copy full ID">
                        ⎘
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${Z.border}` }}>
                  <span style={{ fontSize: 11, color: Z.muted }}>Subscription</span>
                  <span style={{ fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4, background: subTier === 'founder' ? 'rgba(232,255,71,0.15)' : subTier === 'pro' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)', color: subTier === 'founder' ? Z.accent : subTier === 'pro' ? Z.text : Z.muted }}>
                    {subSummary}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0' }}>
                  <span style={{ fontSize: 11, color: Z.muted }}>App version</span>
                  <span style={{ fontSize: 11, color: '#555' }}>1.0.0</span>
                </div>
              </div>

              {/* Billing placeholder */}
              <div style={{ fontSize: 12, color: '#444', padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${Z.border}`, borderRadius: 8, marginBottom: 16, lineHeight: 1.5 }}>
                Billing and subscription management coming soon.
              </div>

              {/* Roadmap & feature request */}
              <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                <button
                  onClick={() => { onClose?.(); onOpenRoadmap?.() }}
                  style={{ background: 'none', border: 'none', color: Z.accent, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
                >
                  View roadmap
                </button>
                <button
                  onClick={() => { onClose?.(); onOpenFeatureRequest?.() }}
                  style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
                >
                  Request a feature
                </button>
              </div>

              {/* Sign out */}
              <button onClick={async () => { await supabase.auth.signOut(); onLogout?.(); onClose?.() }}
                style={{ width: '100%', background: 'none', border: '1px solid rgba(255,92,92,0.3)', borderRadius: 8, padding: '11px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.red, marginBottom: 16 }}>
                Sign out
              </button>

              {/* Delete account */}
              <div style={{ borderTop: `1px solid rgba(255,255,255,0.06)`, paddingTop: 16 }}>
                {deleteAccountStep === 0 && (
                  <button onClick={() => setDeleteAccountStep(1)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,92,92,0.35)', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: '4px 0', textDecoration: 'underline' }}>
                    Delete account
                  </button>
                )}
                {deleteAccountStep === 1 && (
                  <div style={{ background: 'rgba(255,92,92,0.06)', border: '1px solid rgba(255,92,92,0.2)', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 13, color: Z.red, fontWeight: 500, marginBottom: 6 }}>Delete account?</div>
                    <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 12 }}>This will permanently delete all your data. Cannot be undone.</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setDeleteAccountStep(2)} style={{ flex: 1, background: Z.red, border: 'none', borderRadius: 7, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: '#fff', fontWeight: 600 }}>Yes, delete everything</button>
                      <button onClick={() => setDeleteAccountStep(0)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>Cancel</button>
                    </div>
                  </div>
                )}
                {deleteAccountStep === 2 && (
                  <div style={{ background: 'rgba(255,92,92,0.06)', border: '1px solid rgba(255,92,92,0.4)', borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: 13, color: Z.red, fontWeight: 500, marginBottom: 6 }}>Are you absolutely sure?</div>
                    <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 10 }}>Type DELETE to confirm. This action is permanent.</div>
                    <input value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)}
                      placeholder="Type DELETE" style={{ ...inp, marginBottom: 10, borderColor: 'rgba(255,92,92,0.3)' }} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={deleteAccount} disabled={deleteConfirmText !== 'DELETE' || deleting}
                        style={{ flex: 1, background: deleteConfirmText === 'DELETE' && !deleting ? Z.red : '#1a1a1a', border: 'none', borderRadius: 7, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: deleteConfirmText === 'DELETE' && !deleting ? 'pointer' : 'not-allowed', color: deleteConfirmText === 'DELETE' && !deleting ? '#fff' : Z.muted, fontWeight: 600 }}>
                        {deleting ? 'Deleting...' : 'Delete my account'}
                      </button>
                      <button onClick={() => { setDeleteAccountStep(0); setDeleteConfirmText('') }} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 7, padding: '10px 14px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.muted }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div style={{ height: 32 }} />
      </div>
    </div>
  )
}
