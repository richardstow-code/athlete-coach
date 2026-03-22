import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import OnboardingHints from '../components/OnboardingHints'
import { useSettings } from '../lib/useSettings'
import { buildSystemPrompt } from '../lib/coachingPrompt'
import { callClaude } from '../lib/claudeProxy'
import { inferCyclePhase } from '../lib/inferCyclePhase'
import { usePullToRefresh } from '../lib/usePullToRefresh'

const TZ = 'Europe/Vienna'

const Z = {
  bg:'#0a0a0a', surface:'#111111', border:'rgba(255,255,255,0.08)',
  border2:'rgba(255,255,255,0.14)', text:'#f0ede8', muted:'#888580',
  accent:'#e8ff47', accent2:'#47d4ff', red:'#ff5c5c', green:'#4dff91', amber:'#ffb347'
}

const ALCOHOL_UNITS = {
  'Pint beer (4%)': 2.3, 'Pint beer (5%)': 2.8,
  'Small wine 125ml': 1.5, 'Large wine 250ml': 3.0, 'Bottle of wine': 9.0,
  'Single spirit 25ml': 1.0, 'Double spirit 50ml': 2.0,
  'Can beer 330ml': 1.7, 'Can beer 500ml': 2.5,
}

const KCAL_TARGET = 2800
const PROTEIN_TARGET = 150
const UNITS_TARGET = 14
const FIBRE_TARGET = 25

// ── Timezone helper ───────────────────────────────────────────
// Converts a Vienna local date + HH:MM time to a UTC ISO string
function viennaTimeToUTC(dateStr, timeStr) {
  const naive = new Date(`${dateStr}T${timeStr}:00.000Z`)
  const viennaStr = naive.toLocaleString('sv-SE', { timeZone: TZ })
  const viennaDate = new Date(viennaStr.replace(' ', 'T') + '.000Z')
  const offsetMs = viennaDate.getTime() - naive.getTime()
  return new Date(naive.getTime() - offsetMs).toISOString()
}

function getCurrentViennaTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

// ── Nutrition parsing prompt ──────────────────────────────────
const NUTRITION_SYSTEM = `You are a nutrition analysis assistant. Parse the meal or food and return ONLY a raw JSON object. No markdown, no code fences, no explanation, no text before or after the JSON.

Return EXACTLY this structure:
{
  "meal_name": "brief clean description of what was eaten",
  "calories": <number>,
  "protein_g": <number>,
  "carbs_g": <number>,
  "fat_g": <number>,
  "fibre_g": <number>,
  "sodium_mg": <number>,
  "upf_score": <0|1|2|3>,
  "alcohol_units": <number>,
  "rating": "green|amber|red",
  "notes": "one sentence coaching note on this meal relative to training"
}

Field guidance:
- calories: total kcal estimate
- protein_g / carbs_g / fat_g: grams
- fibre_g: dietary fibre in grams. Oats ~4g/100g, white bread ~2g/slice, veg 2–5g/100g, legumes ~7g/100g, fruit ~2g/100g, processed snacks typically <1g
- sodium_mg: estimated sodium. Homemade meals ~400–800mg, restaurant ~800–1500mg, crisps ~150–200mg per 30g, processed meats ~500mg/serving, plain cooked ~100–200mg
- upf_score: NOVA classification 0–3:
    0 = unprocessed (eggs, oats, fruit, veg, plain cooked meat, homemade meals)
    1 = processed ingredient (cheese, canned goods, cured meat, artisan bread)
    2 = processed food (protein bars, packaged snacks, ready sauces)
    3 = ultra-processed (crisps, biscuits, fast food, fizzy drinks, sweetened cereals)
- alcohol_units: UK units (1 unit = 10ml pure alcohol). 0 if none. Pint 4% ≈ 2.3u, 175ml wine 13% ≈ 2.3u, 25ml spirit 40% ≈ 1u
- rating: green = well-balanced for training; amber = ok but room to improve; red = poor nutritional fit
- If any value is genuinely unknown, use null (not 0)`

// ── Shared Insights Graph ─────────────────────────────────────
function InsightsGraph({ entries7Days, active }) {
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = d.toLocaleDateString('en-CA', { timeZone: TZ })
    const dayEntries = entries7Days.filter(e => e.date === ds)
    days.push({
      label: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ }),
      date: ds,
      kcal: dayEntries.filter(e => e.meal_type !== 'alcohol').reduce((s, e) => s + (e.calories || 0), 0),
      protein: dayEntries.filter(e => e.meal_type !== 'alcohol').reduce((s, e) => s + parseFloat(e.protein_g || 0), 0),
      units: dayEntries.filter(e => e.meal_type === 'alcohol').reduce((s, e) => s + parseFloat(e.alcohol_units || 0), 0),
    })
  }

  const maxKcal = Math.max(...days.map(d => d.kcal), KCAL_TARGET)
  const maxProtein = Math.max(...days.map(d => d.protein), PROTEIN_TARGET)
  const maxUnits = Math.max(...days.map(d => d.units), UNITS_TARGET / 7 * 2)

  const METRICS = [
    { key: 'kcal', label: 'Kcal', target: KCAL_TARGET, max: maxKcal, col: Z.accent },
    { key: 'protein', label: 'Protein', target: PROTEIN_TARGET, max: maxProtein, col: Z.accent2 },
    { key: 'units', label: 'Units', target: UNITS_TARGET / 7, max: maxUnits, col: Z.amber },
  ].filter(m => active.includes(m.key))

  if (METRICS.length === 0) return null

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  return (
    <div style={{ padding: '0 0 8px' }}>
      <div style={{ display: 'flex', gap: 4, height: 80, alignItems: 'flex-end', marginBottom: 4 }}>
        {days.map((day, di) => (
          <div key={di} style={{ flex: 1, display: 'flex', gap: 2, alignItems: 'flex-end', justifyContent: 'center', height: '100%' }}>
            {METRICS.map(m => {
              const val = day[m.key]
              const pct = val > 0 ? Math.max(4, Math.round((val / m.max) * 74)) : 0
              const overTarget = val > m.target
              return (
                <div key={m.key} style={{ flex: 1, maxWidth: 18, height: pct, minHeight: pct > 0 ? 4 : 0, background: overTarget && m.key === 'units' ? Z.red : overTarget && m.key === 'kcal' ? Z.amber : m.col, borderRadius: '2px 2px 0 0', opacity: 0.85 }} />
              )
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {days.map((d, i) => (
          <div key={i} style={{ flex: 1, fontSize: 9, color: d.date === todayStr ? Z.accent : Z.muted, textAlign: 'center', fontWeight: d.date === todayStr ? 600 : 400 }}>{d.label}</div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        {METRICS.map(m => (
          <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: Z.muted }}>
            <div style={{ width: 8, height: 8, background: m.col, borderRadius: 2 }} />
            {m.label} (target: {m.key === 'units' ? (m.target).toFixed(1) + '/day' : m.target + (m.key === 'protein' ? 'g' : 'kcal')})
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────
function StatCard({ metricKey, val, target, label, unit, col, active, onToggle, insight }) {
  const [expanded, setExpanded] = useState(false)
  const isActive = active.includes(metricKey)
  const pct = Math.min(100, Math.round((val / target) * 100))
  const status = metricKey === 'units'
    ? (val > target * 0.7 ? Z.red : val > target * 0.4 ? Z.amber : Z.green)
    : (pct > 90 ? Z.green : pct > 60 ? Z.amber : Z.red)

  return (
    <div style={{ background: Z.surface, border: `1px solid ${isActive ? col + '60' : Z.border2}`, borderRadius: 10, padding: '10px 10px 8px', cursor: 'pointer', transition: 'border-color 0.2s' }}
      onClick={() => { onToggle(metricKey); setExpanded(e => !e) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 20, fontWeight: 700, color: status, lineHeight: 1 }}>{typeof val === 'number' && val % 1 !== 0 ? val.toFixed(1) : val}</div>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: isActive ? col : Z.border2, marginTop: 4, transition: 'background 0.2s' }} />
      </div>
      <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase', marginTop: 2, marginBottom: 5 }}>{label}</div>
      <div style={{ height: 3, background: '#1a1a1a', borderRadius: 2 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: status, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
      {expanded && insight && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#a8a5a0', lineHeight: 1.5, borderTop: `1px solid ${Z.border}`, paddingTop: 8 }}>{insight}</div>
      )}
    </div>
  )
}

// ── Alcohol Quick Log ─────────────────────────────────────────
function AlcoholQuickLog({ onLog }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState('')
  const [qty, setQty] = useState(1)
  if (!open) return (
    <button onClick={() => setOpen(true)} style={{ flex: 1, background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '9px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.amber }}>
      🍺 Log drink
    </button>
  )
  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.amber}40`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: Z.muted, marginBottom: 8 }}>What did you have?</div>
      <select value={selected} onChange={e => setSelected(e.target.value)} style={{ width: '100%', background: '#1a1a1a', border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '8px 10px', color: selected ? Z.text : Z.muted, fontFamily: "'DM Mono', monospace", fontSize: 12, marginBottom: 8, outline: 'none' }}>
        <option value="">Select drink...</option>
        {Object.keys(ALCOHOL_UNITS).map(d => <option key={d} value={d}>{d} ({ALCOHOL_UNITS[d]} units)</option>)}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: selected ? 8 : 0 }}>
        <span style={{ fontSize: 11, color: Z.muted }}>Qty:</span>
        {[1,2,3,4].map(n => (
          <button key={n} onClick={() => setQty(n)} style={{ width: 32, height: 32, borderRadius: 6, border: `1px solid ${qty === n ? Z.amber : Z.border2}`, background: qty === n ? `${Z.amber}20` : 'none', color: qty === n ? Z.amber : Z.muted, cursor: 'pointer', fontSize: 13 }}>{n}</button>
        ))}
      </div>
      {selected && <div style={{ fontSize: 12, color: Z.amber, marginBottom: 8 }}>= {(ALCOHOL_UNITS[selected] * qty).toFixed(1)} units</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => { if (selected) { onLog({ drink: selected, quantity: qty, units: ALCOHOL_UNITS[selected] * qty }); setOpen(false); setSelected(''); setQty(1) } }} disabled={!selected} style={{ flex: 1, background: Z.amber, border: 'none', borderRadius: 8, padding: '8px', cursor: selected ? 'pointer' : 'not-allowed', fontFamily: "'DM Mono', monospace", fontSize: 12, color: Z.bg, fontWeight: 600 }}>Log</button>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontFamily: "'DM Mono', monospace", fontSize: 12, color: Z.muted }}>Cancel</button>
      </div>
    </div>
  )
}

// ── Meal Card ─────────────────────────────────────────────────
function MealCard({ entry, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const isAlcohol = entry.meal_type === 'alcohol'
  const upfColors = ['#4dff91', '#4dff91', '#ffb347', '#ff5c5c']
  const upfLabels = ['Unprocessed', 'Minimally processed', 'Processed', 'Ultra-processed']
  return (
    <div data-testid="nutrition-entry" style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(e => !e)} style={{ padding: '11px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isAlcohol ? '🍺 ' : ''}{entry.meal_name || 'Meal'}</div>
          <div style={{ fontSize: 10, color: Z.muted, marginTop: 1 }}>
            {entry.date} {entry.logged_at ? '· ' + new Date(entry.logged_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ }) : ''}
            {isAlcohol ? ` · ${parseFloat(entry.alcohol_units||0).toFixed(1)} units` : ` · ${entry.calories||'?'} kcal`}
            {!isAlcohol && entry.upf_score != null && (
              <span style={{ color: upfColors[entry.upf_score] || Z.muted }}> · UPF {entry.upf_score}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {!isAlcohol && <span style={{ fontSize: 11, color: entry.rating === 'green' ? Z.green : entry.rating === 'red' ? Z.red : Z.amber }}>{entry.rating === 'green' ? '🟢' : entry.rating === 'red' ? '🔴' : '🟡'}</span>}
          {isAlcohol && <span style={{ fontSize: 11, color: Z.amber }}>🍺 {parseFloat(entry.alcohol_units||0).toFixed(1)}u</span>}
          <span style={{ color: Z.muted, fontSize: 11 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: `1px solid ${Z.border}` }}>
          {!isAlcohol && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
                {[['Protein', entry.protein_g != null ? entry.protein_g + 'g' : '—'], ['Carbs', entry.carbs_g != null ? entry.carbs_g + 'g' : '—'], ['Fat', entry.fat_g != null ? entry.fat_g + 'g' : '—']].map(([l, v]) => (
                  <div key={l} style={{ background: '#1a1a1a', borderRadius: 6, padding: '6px', textAlign: 'center' }}>
                    <div style={{ fontSize: 13, color: Z.accent, fontWeight: 600 }}>{v}</div>
                    <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase' }}>{l}</div>
                  </div>
                ))}
              </div>
              {(entry.fibre_g != null || entry.sodium_mg != null || entry.upf_score != null) && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
                  {entry.fibre_g != null && (
                    <div style={{ background: '#1a1a1a', borderRadius: 6, padding: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: Z.green, fontWeight: 600 }}>{entry.fibre_g}g</div>
                      <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase' }}>Fibre</div>
                    </div>
                  )}
                  {entry.sodium_mg != null && (
                    <div style={{ background: '#1a1a1a', borderRadius: 6, padding: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, color: Z.accent2, fontWeight: 600 }}>{entry.sodium_mg}mg</div>
                      <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase' }}>Sodium</div>
                    </div>
                  )}
                  {entry.upf_score != null && (
                    <div style={{ background: '#1a1a1a', borderRadius: 6, padding: '6px', textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: upfColors[entry.upf_score] || Z.muted }}>{entry.upf_score}/3</div>
                      <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase' }}>UPF</div>
                    </div>
                  )}
                </div>
              )}
              {entry.upf_score != null && (
                <div style={{ fontSize: 10, color: upfColors[entry.upf_score] || Z.muted, marginBottom: 6 }}>
                  {upfLabels[entry.upf_score]}
                </div>
              )}
            </>
          )}
          {entry.notes && <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 8 }}>{entry.notes}</div>}
          <button onClick={() => onDelete(entry.id)} style={{ background: 'none', border: 'none', color: Z.red, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>Delete</button>
        </div>
      )}
    </div>
  )
}

// ── Weekly Digest ─────────────────────────────────────────────
function WeeklyDigest({ entries14, activities7 }) {
  // Build last 7 days and previous 7 days
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
  const days7 = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    days7.push(d.toLocaleDateString('en-CA', { timeZone: TZ }))
  }
  const prevDays7 = []
  for (let i = 13; i >= 7; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    prevDays7.push(d.toLocaleDateString('en-CA', { timeZone: TZ }))
  }

  const thisWeekFood = entries14.filter(e => days7.includes(e.date) && e.meal_type !== 'alcohol')
  const prevWeekFood = entries14.filter(e => prevDays7.includes(e.date) && e.meal_type !== 'alcohol')
  const daysWithLogs = [...new Set(thisWeekFood.map(e => e.date))]

  if (daysWithLogs.length < 2) {
    return (
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>This week</div>
        <div style={{ fontSize: 13, color: Z.muted }}>Log a few more meals to see your weekly patterns.</div>
      </div>
    )
  }

  // Per-day totals for this week
  const dayTotals = days7.map(ds => {
    const food = thisWeekFood.filter(e => e.date === ds)
    return {
      date: ds,
      kcal: food.reduce((s, e) => s + (e.calories || 0), 0),
      protein: food.reduce((s, e) => s + parseFloat(e.protein_g || 0), 0),
      fibre: food.reduce((s, e) => s + parseFloat(e.fibre_g || 0), 0),
      hasLogs: food.length > 0,
      maxUPF: food.length > 0 ? Math.max(...food.map(e => e.upf_score ?? -1)) : null,
    }
  })
  const loggedDays = dayTotals.filter(d => d.hasLogs)
  const avgKcal = loggedDays.length > 0 ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / loggedDays.length) : 0
  const avgProtein = loggedDays.length > 0 ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedDays.length) : 0
  const avgFibre = loggedDays.length > 0 ? parseFloat((loggedDays.reduce((s, d) => s + d.fibre, 0) / loggedDays.length).toFixed(1)) : 0
  const weeklyUnits = entries14.filter(e => days7.includes(e.date) && e.meal_type === 'alcohol').reduce((s, e) => s + parseFloat(e.alcohol_units || 0), 0)

  // Trend arrows (week-on-week) — only if prev week has ≥3 log days
  const prevLoggedDays = [...new Set(prevWeekFood.map(e => e.date))]
  let trendKcal = null, trendProtein = null
  if (prevLoggedDays.length >= 3) {
    const prevAvgKcal = Math.round(prevLoggedDays.reduce((s, ds) => s + prevWeekFood.filter(e => e.date === ds).reduce((s2, e) => s2 + (e.calories || 0), 0), 0) / prevLoggedDays.length)
    const prevAvgProtein = Math.round(prevLoggedDays.reduce((s, ds) => s + prevWeekFood.filter(e => e.date === ds).reduce((s2, e) => s2 + parseFloat(e.protein_g || 0), 0), 0) / prevLoggedDays.length)
    const arrow = (curr, prev) => {
      if (prev === 0) return null
      const pct = (curr - prev) / prev * 100
      if (Math.abs(pct) <= 5) return '→'
      return pct > 0 ? '↑' : '↓'
    }
    trendKcal = arrow(avgKcal, prevAvgKcal)
    trendProtein = arrow(avgProtein, prevAvgProtein)
  }

  // UPF strip
  const upfDotColor = (maxUPF) => {
    if (maxUPF === null || maxUPF < 0) return '#333'
    if (maxUPF >= 3) return '#ff5c5c'
    if (maxUPF >= 2) return '#ffb347'
    return '#4dff91'
  }
  const upfStrip = dayTotals.map(d => ({ ...d, dotColor: upfDotColor(d.maxUPF) }))
  const cleanCount = upfStrip.filter(d => d.hasLogs && d.maxUPF !== null && d.maxUPF <= 1).length
  const amberCount = upfStrip.filter(d => d.dotColor === '#ffb347').length
  const redCount = upfStrip.filter(d => d.dotColor === '#ff5c5c').length

  // Post-run protein flag (most recent run only)
  let postRunFlag = null
  const recentRun = activities7.find(a => a.type?.toLowerCase().includes('run'))
  if (recentRun) {
    const actEndMs = new Date(recentRun.created_at || (recentRun.date + 'T10:00:00Z')).getTime() + (recentRun.duration_sec || 0) * 1000
    const windowEndMs = actEndMs + 90 * 60 * 1000
    const postRunLogs = entries14.filter(e => {
      if (e.meal_type === 'alcohol') return false
      const t = new Date(e.logged_at || e.created_at).getTime()
      return t >= actEndMs && t <= windowEndMs
    })
    const postRunProtein = postRunLogs.reduce((s, e) => s + parseFloat(e.protein_g || 0), 0)
    if (postRunLogs.length === 0 || postRunProtein < 25) {
      const dayName = new Date((recentRun.date || todayStr) + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' })
      postRunFlag = `Post-run protein missed on ${dayName}`
    }
  }

  // Streaks (computed from most recent days backwards)
  let proteinStreak = 0
  let cleanStreak = 0
  for (let i = 0; i <= 6; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const ds = d.toLocaleDateString('en-CA', { timeZone: TZ })
    const dayFood = thisWeekFood.filter(e => e.date === ds)
    if (dayFood.length === 0) { if (i === 0) continue; break }
    if (dayFood.reduce((s, e) => s + parseFloat(e.protein_g || 0), 0) >= 130) proteinStreak++
    else if (i > 0) { proteinStreak = 0 } // reset if gap
  }
  for (let i = 0; i <= 6; i++) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const ds = d.toLocaleDateString('en-CA', { timeZone: TZ })
    const dayFood = thisWeekFood.filter(e => e.date === ds)
    if (dayFood.length === 0) { if (i === 0) continue; break }
    if (Math.max(...dayFood.map(e => e.upf_score ?? 0)) <= 1) cleanStreak++
    else if (i > 0) { cleanStreak = 0 }
  }

  // Streak badges (min 3, max 2 shown)
  const badges = [
    proteinStreak >= 3 && { icon: '🔥', text: `${proteinStreak}-day protein streak` },
    cleanStreak >= 3 && { icon: '✅', text: `${cleanStreak}-day clean eating streak` },
  ].filter(Boolean).slice(0, 2)
  const alcoholOnTrack = weeklyUnits < 10 && weeklyUnits > 0

  return (
    <div style={{ padding: '12px 20px', borderBottom: `1px solid ${Z.border}` }}>
      <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>This week</div>

      {/* Streak badges */}
      {(badges.length > 0 || alcoholOnTrack) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {badges.map((b, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(77,255,145,0.1)', border: '1px solid rgba(77,255,145,0.25)', borderRadius: 20, padding: '4px 10px', fontSize: 11, color: Z.green }}>
              {b.icon} {b.text}
            </div>
          ))}
          {alcoholOnTrack && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.04)', border: `1px solid ${Z.border2}`, borderRadius: 20, padding: '4px 10px', fontSize: 11, color: Z.muted }}>
              Alcohol on track this week
            </div>
          )}
        </div>
      )}

      {/* Daily averages */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Avg kcal', numVal: avgKcal, dispVal: String(avgKcal), target: KCAL_TARGET, col: Z.accent, trend: trendKcal },
          { label: 'Avg protein', numVal: avgProtein, dispVal: avgProtein + 'g', target: PROTEIN_TARGET, col: Z.accent2, trend: trendProtein },
          { label: 'Avg fibre', numVal: avgFibre, dispVal: avgFibre + 'g', target: FIBRE_TARGET, col: Z.green, trend: null },
        ].map(({ label, numVal, dispVal, target, col, trend }) => {
          const pct = Math.min(100, Math.round(numVal / target * 100))
          return (
            <div key={label} style={{ background: Z.surface, borderRadius: 8, padding: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: col }}>{dispVal}</div>
                {trend && <span style={{ fontSize: 11, color: trend === '↑' ? Z.green : trend === '↓' ? Z.red : Z.muted }}>{trend}</span>}
              </div>
              <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase', marginTop: 2, marginBottom: 5 }}>{label}</div>
              <div style={{ height: 3, background: '#1a1a1a', borderRadius: 2 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: col, borderRadius: 2 }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* UPF 7-day strip */}
      <div style={{ marginBottom: postRunFlag ? 10 : 0 }}>
        <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>UPF this week</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {upfStrip.map((d, i) => {
            const dayLetter = new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 1)
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: d.dotColor, flexShrink: 0 }} />
                <div style={{ fontSize: 9, color: d.date === todayStr ? Z.accent : Z.muted }}>{dayLetter}</div>
              </div>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: Z.muted }}>
          {[cleanCount > 0 && `${cleanCount} clean`, amberCount > 0 && `${amberCount} amber`, redCount > 0 && `${redCount} red`].filter(Boolean).join(', ') || 'No UPF data logged yet'}
        </div>
      </div>

      {/* Post-run protein flag */}
      {postRunFlag && (
        <div style={{ fontSize: 11, color: Z.amber, marginTop: 10 }}>
          ⚡ {postRunFlag}
        </div>
      )}
    </div>
  )
}

// ── Main Screen ───────────────────────────────────────────────
export default function Nutrition() {
  const settings = useSettings()
  const cameraRef = useRef(null)
  const libraryRef = useRef(null)
  const [entries, setEntries] = useState([])
  const [entries14, setEntries14] = useState([]) // 14 days for trend + digest
  const [activities7, setActivities7] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [imageData, setImageData] = useState(null)
  const [imageMime, setImageMime] = useState('image/jpeg')
  const [context, setContext] = useState('')
  const [logDate, setLogDate] = useState(new Date().toLocaleDateString('en-CA', { timeZone: TZ }))
  const [logTime, setLogTime] = useState(getCurrentViennaTime)
  const [activeMetrics, setActiveMetrics] = useState(['kcal', 'protein', 'units'])
  const [todaySession, setTodaySession] = useState(null)
  const [todayActivity, setTodayActivity] = useState(null)
  const [cycleLog, setCycleLog] = useState(null)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.id) setUserId(session.user.id)
    })
  }, [])

  const todayKcal = entries.filter(e => e.meal_type !== 'alcohol' && e.date === logDate).reduce((s, e) => s + (e.calories || 0), 0)
  const todayProtein = entries.filter(e => e.meal_type !== 'alcohol' && e.date === logDate).reduce((s, e) => s + parseFloat(e.protein_g || 0), 0)

  const weekUnits = entries14.filter(e => {
    const d = new Date(); const dow = d.getDay()
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
    return e.meal_type === 'alcohol' && e.date >= d.toLocaleDateString('en-CA', { timeZone: TZ })
  }).reduce((s, e) => s + parseFloat(e.alcohol_units || 0), 0)

  const load = useCallback(async () => {
    const uid = userId || (await supabase.auth.getSession()).data.session?.user?.id
    const fourteenDaysAgo = new Date(Date.now() - 14*24*60*60*1000).toLocaleDateString('en-CA', { timeZone: TZ })
    const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toLocaleDateString('en-CA', { timeZone: TZ })
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    const [{ data: all }, { data: w14 }, { data: sessions }, { data: acts }, { data: cLog }, { data: acts7 }] = await Promise.all([
      supabase.from('nutrition_logs').select('*').eq('user_id', uid).eq('date', logDate).order('logged_at', { ascending: false }),
      supabase.from('nutrition_logs').select('*').eq('user_id', uid).gte('date', fourteenDaysAgo).order('date'),
      supabase.from('scheduled_sessions').select('session_type,name,zone,duration_min_low,duration_min_high').eq('user_id', uid).eq('planned_date', todayStr).limit(3),
      supabase.from('activities').select('name,type,distance_km,elevation_m,avg_hr,duration_sec,created_at,date').eq('user_id', uid).eq('date', todayStr).order('date', { ascending: false }).limit(1),
      supabase.from('cycle_logs').select('phase_reported, override_intensity, notes').eq('user_id', uid).eq('log_date', todayStr).maybeSingle(),
      supabase.from('activities').select('name,type,distance_km,duration_sec,created_at,date').eq('user_id', uid).gte('date', sevenDaysAgo).order('date', { ascending: false }).limit(20),
    ])
    setEntries(all || [])
    setEntries14(w14 || [])
    setTodaySession(sessions?.[0] || null)
    setTodayActivity(acts?.[0] || null)
    setCycleLog(cLog || null)
    setActivities7(acts7 || [])
    setLoading(false)
  }, [logDate])

  useEffect(() => { load() }, [load])

  // Reset logTime to current time when logDate changes to today
  useEffect(() => {
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: TZ })
    if (logDate === todayStr) setLogTime(getCurrentViennaTime())
  }, [logDate])

  const { containerRef: nutriContainerRef, pullDistance: nutriPullDist, refreshing: nutriRefreshing } = usePullToRefresh(load)

  function toggleMetric(key) {
    setActiveMetrics(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

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
  }

  async function analyzeAndLog() {
    if (!imageData && !context.trim()) return
    setAnalyzing(true)
    try {
      const trainingCtx = todayActivity
        ? ` Training today: ${todayActivity.name} (${todayActivity.distance_km ? `${todayActivity.distance_km}km ` : ''}${todayActivity.type}).`
        : todaySession ? ` Planned session today: ${todaySession.name} (${todaySession.session_type}).` : ''

      const mealCtx = `Eaten today so far: ${todayKcal} kcal, ${Math.round(todayProtein)}g protein.${trainingCtx}`

      const userContent = imageData
        ? [
            { type: 'image', source: { type: 'base64', media_type: imageMime.includes('png') ? 'image/png' : imageMime.includes('gif') ? 'image/gif' : imageMime.includes('webp') ? 'image/webp' : 'image/jpeg', data: imageData } },
            { type: 'text', text: `Analyse this meal. Context: ${context || 'none'}. ${mealCtx}` }
          ]
        : `Estimate nutrition for: ${context}. ${mealCtx}`

      const data = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: NUTRITION_SYSTEM,
        messages: [{ role: 'user', content: userContent }],
      })
      const raw = data.content?.[0]?.text
      if (!raw) throw new Error('No response')
      const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
      const cleaned = fenced ? fenced[1].trim() : raw.replace(/```json|```/g, '').trim()
      const parsed = JSON.parse(cleaned)

      const { data: { session } } = await supabase.auth.getSession()
      await supabase.from('nutrition_logs').insert({
        date: logDate,
        meal_name: parsed.meal_name,
        calories: parsed.calories,
        protein_g: parsed.protein_g,
        carbs_g: parsed.carbs_g,
        fat_g: parsed.fat_g,
        fibre_g: parsed.fibre_g ?? null,
        sodium_mg: parsed.sodium_mg ?? null,
        upf_score: parsed.upf_score ?? null,
        rating: parsed.rating,
        notes: parsed.notes,
        logged_at: viennaTimeToUTC(logDate, logTime),
        meal_type: 'food',
        user_id: session?.user?.id,
      })
      setPreview(null); setImageData(null); setContext('')
      setLogTime(getCurrentViennaTime())
      load()
    } catch(e) {
      console.error('Nutrition analysis error:', e)
      alert('Analysis failed: ' + e.message + '. Try describing the meal in text instead.')
    }
    setAnalyzing(false)
  }

  async function logAlcohol({ drink, quantity, units }) {
    const { data: { session } } = await supabase.auth.getSession()
    await supabase.from('nutrition_logs').insert({
      date: logDate,
      meal_name: `${quantity}x ${drink}`,
      alcohol_units: units,
      logged_at: viennaTimeToUTC(logDate, logTime),
      meal_type: 'alcohol',
      user_id: session?.user?.id,
    })
    load()
  }

  async function deleteEntry(id) { await supabase.from('nutrition_logs').delete().eq('id', id); load() }

  const isToday = logDate === new Date().toLocaleDateString('en-CA', { timeZone: TZ })

  const inp = {
    background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8,
    padding: '8px 12px', color: Z.text, fontFamily: "'DM Mono', monospace",
    fontSize: 12, outline: 'none',
  }

  return (
    <div ref={nutriContainerRef} data-testid="fuel-screen" style={{ height: '100%', overflowY: 'auto', fontFamily: "'DM Mono', monospace" }}>
      {(nutriPullDist > 0 || nutriRefreshing) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: Math.max(nutriPullDist, nutriRefreshing ? 48 : 0), overflow: 'hidden', color: '#888580', fontSize: '12px', letterSpacing: '0.06em' }}>
          {nutriRefreshing ? 'Refreshing...' : nutriPullDist > 72 ? 'Release to refresh' : 'Pull to refresh'}
        </div>
      )}
      <OnboardingHints
        hintId="fuel_logging"
        title="Log meals in seconds"
        body="Describe what you ate or take a photo and your coach rates it against your training load. Alcohol is tracked separately against your weekly target. The coach uses this data in all coaching conversations."
        position="bottom"
      />

      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700 }}>Fuel</div>
          <input type="date" value={logDate} max={new Date().toLocaleDateString('en-CA', { timeZone: TZ })}
            onChange={e => setLogDate(e.target.value)}
            style={{ ...inp, color: isToday ? Z.muted : Z.accent, cursor: 'pointer' }} />
        </div>
        <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
          {isToday ? 'Today' : new Date(logDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          {!isToday && <span style={{ color: Z.amber }}> · Historical entry</span>}
        </div>
      </div>

      {/* Training context banner */}
      {isToday && (todayActivity || todaySession) && (() => {
        const act = todayActivity
        const sess = todaySession
        const isRun = act?.type?.toLowerCase().includes('run') || act?.type?.toLowerCase().includes('trail')
        const isStrength = act?.type?.toLowerCase().includes('weight') || act?.type?.toLowerCase().includes('strength')
        const distKm = parseFloat(act?.distance_km || 0)
        const elevM = parseFloat(act?.elevation_m || 0)
        const durationMin = act?.duration_sec ? Math.round(act.duration_sec / 60) : null

        let label, icon, bg, border, advice
        if (act) {
          icon = isRun ? '🏃' : isStrength ? '🏋️' : '✓'
          label = 'Workout done'
          bg = 'rgba(77,255,145,0.07)'
          border = 'rgba(77,255,145,0.25)'
          const calBurn = isRun && distKm > 0 ? Math.round(distKm * 70 * 1.05) : null
          const statStr = [distKm > 0 && `${distKm.toFixed(1)}km`, elevM > 0 && `${Math.round(elevM)}m elev`, durationMin && `${durationMin}min`, calBurn && `~${calBurn} kcal`].filter(Boolean).join(' · ')
          const isHardRun = sess?.zone?.includes('Z4') || sess?.zone?.includes('Z5') || sess?.intensity?.toLowerCase().includes('hard')
          if (isRun) {
            const carbNote = distKm > 16 || isHardRun ? 'High carb run — aim for 400–500g carbs today to refill glycogen.' : 'Moderate run — 250–300g carbs sufficient, focus on hitting protein.'
            advice = `${carbNote} Get 30–40g protein within 30min, then a full meal within 2hrs.`
          } else if (isStrength) {
            advice = 'Protein window is open — aim for 40g+ protein now, then again at your next meal.'
          } else {
            advice = 'Session complete — protein focus for recovery, hit your calorie target.'
          }
          return (
            <div style={{ margin: '10px 20px 0', padding: '10px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: Z.green, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, marginBottom: 2 }}>
                {icon} {act.name}
                {statStr && <span style={{ fontSize: 11, color: Z.muted, fontWeight: 400 }}> · {statStr}</span>}
              </div>
              <div style={{ fontSize: 11, color: '#a8a5a0', lineHeight: 1.5 }}>{advice}</div>
            </div>
          )
        } else if (sess) {
          icon = sess.session_type === 'run' ? '🏃' : sess.session_type === 'trail' ? '⛰️' : sess.session_type === 'strength' ? '🏋️' : '😴'
          label = "Today's session"
          bg = sess.session_type === 'rest' ? 'rgba(136,133,128,0.1)' : sess.session_type === 'strength' ? 'rgba(255,179,71,0.1)' : 'rgba(232,255,71,0.08)'
          border = sess.session_type === 'rest' ? 'rgba(136,133,128,0.25)' : sess.session_type === 'strength' ? 'rgba(255,179,71,0.3)' : 'rgba(232,255,71,0.2)'
          advice = sess.session_type === 'rest' ? 'Rest day · protein focus, modest calorie deficit is fine' : sess.session_type === 'strength' ? 'Strength day · hit protein target, moderate carbs pre-session' : 'Training day · prioritise carbs, eat 2–3hrs before session'
          return (
            <div style={{ margin: '10px 20px 0', padding: '10px 14px', background: bg, border: `1px solid ${border}`, borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, marginBottom: 2 }}>
                {icon} {sess.name}
                {sess.zone && <span style={{ fontSize: 11, color: Z.muted, fontWeight: 400 }}> · {sess.zone} · {sess.duration_min_low}{sess.duration_min_high !== sess.duration_min_low ? `–${sess.duration_min_high}` : ''}min</span>}
              </div>
              <div style={{ fontSize: 11, color: '#a8a5a0', lineHeight: 1.5 }}>{advice}</div>
            </div>
          )
        }
        return null
      })()}

      {/* Post-workout 45-min refuel nudge */}
      {isToday && todayActivity?.created_at && (() => {
        const msSinceActivity = Date.now() - new Date(todayActivity.created_at).getTime()
        const inWindow = msSinceActivity > 0 && msSinceActivity < 45 * 60 * 1000
        const fedSinceActivity = entries.some(e => e.meal_type !== 'alcohol' && e.logged_at && new Date(e.logged_at) > new Date(todayActivity.created_at))
        if (!inWindow || fedSinceActivity) return null
        const minAgo = Math.floor(msSinceActivity / 60000)
        return (
          <div style={{ margin: '10px 20px 0', padding: '10px 14px', background: 'rgba(77,255,145,0.08)', border: '1px solid rgba(77,255,145,0.3)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: Z.green, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Refuel window · {minAgo}min ago</div>
            <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, marginBottom: 2 }}>Time to eat</div>
            <div style={{ fontSize: 11, color: '#a8a5a0', lineHeight: 1.5 }}>Post-workout window is open. Log your recovery meal to hit that protein target — 30–40g now makes a real difference.</div>
          </div>
        )
      })()}

      {/* Cycle nutrition banner */}
      {isToday && settings.cycle_tracking_enabled && (() => {
        const phase = inferCyclePhase(settings.cycle_last_period_date, settings.cycle_length_avg, settings.cycle_is_irregular || false, cycleLog ? [cycleLog] : [])
        const override = cycleLog?.override_intensity
        const PHASE_NUTRITION = {
          menstrual:  'Iron-rich foods and magnesium can help right now — think leafy greens, nuts, dark chocolate. Cravings are normal.',
          follicular: 'Rising energy — lighter, fresh foods suit this phase well. Good time to build protein if training is increasing.',
          ovulatory:  'Energy tends to peak around now. Keep fuelling well around sessions.',
          luteal:     'Complex carbs and magnesium can help with energy and mood. If PMS symptoms, reducing caffeine may help.',
        }
        const tip = PHASE_NUTRITION[phase]
        if (!tip && phase !== 'unknown') return null
        if (phase === 'unknown' && !cycleLog) return null
        const overrideNote = override === 'rest' ? ' Rest day — keep nutrition easy and hydration up.' : override === 'reduce' ? ' Lighter session — moderate fuelling.' : null
        return (
          <div style={{ margin: '10px 20px 0', padding: '10px 14px', background: 'rgba(232,255,71,0.05)', border: '1px solid rgba(232,255,71,0.15)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: Z.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Nutrition note</div>
            <div style={{ fontSize: 12, color: '#c8c5bf', lineHeight: 1.6 }}>{tip}{overrideNote}</div>
          </div>
        )
      })()}

      {/* Stat cards + graph */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          <StatCard metricKey="kcal" val={todayKcal} target={KCAL_TARGET} label="Kcal" unit="kcal" col={Z.accent}
            active={activeMetrics} onToggle={toggleMetric}
            insight={`Target: ${KCAL_TARGET} kcal/day. Moderate surplus on training days, deficit on rest days is fine.`} />
          <StatCard metricKey="protein" val={Math.round(todayProtein)} target={PROTEIN_TARGET} label="Protein" unit="g" col={Z.accent2}
            active={activeMetrics} onToggle={toggleMetric}
            insight={`Target: ${PROTEIN_TARGET}g/day. Spread across 4+ meals for best absorption.`} />
          <StatCard metricKey="units" val={parseFloat(weekUnits.toFixed(1))} target={UNITS_TARGET} label="Units/wk" unit="" col={Z.amber}
            active={activeMetrics} onToggle={toggleMetric}
            insight={`Weekly target: ≤${UNITS_TARGET} units. Current: ${weekUnits.toFixed(1)}. Alcohol disrupts sleep and HRV recovery.`} />
        </div>
        <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>7 days · tap cards to toggle</div>
          <InsightsGraph entries7Days={entries14} active={activeMetrics} />
        </div>
      </div>

      {/* Weekly Digest */}
      <WeeklyDigest entries14={entries14} activities7={activities7} />

      {/* Log section */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Log {!isToday && `(${logDate})`}
        </div>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} data-testid="nutrition-image-input" style={{ display: 'none' }} />
        <input ref={libraryRef} type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />

        {preview ? (
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <img src={preview} alt="meal" style={{ width: '100%', borderRadius: 10, maxHeight: 200, objectFit: 'cover' }} />
            <button onClick={() => { setPreview(null); setImageData(null) }} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: '50%', width: 28, height: 28, color: Z.text, cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button onClick={() => cameraRef.current?.click()} style={{ flex: 1, background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.text }}>📸 Camera</button>
            <button onClick={() => libraryRef.current?.click()} style={{ flex: 1, background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer', color: Z.text }}>🖼 Library</button>
          </div>
        )}

        <textarea value={context} onChange={e => setContext(e.target.value)} rows={2}
          placeholder="Describe meal: '2 scrambled eggs on toast with butter', 'chicken breast salad'..."
          data-testid="nutrition-input"
          style={{ width: '100%', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '9px 12px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />

        {/* When did you eat this? */}
        <div data-testid="nutrition-time-picker" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: Z.muted, flexShrink: 0 }}>When?</span>
          <input
            type="time"
            value={logTime}
            onChange={e => setLogTime(e.target.value)}
            data-testid="nutrition-time-input"
            style={{ ...inp, flex: 1, padding: '7px 10px', cursor: 'pointer' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={analyzeAndLog} disabled={analyzing || (!imageData && !context.trim())}
            data-testid="nutrition-submit"
            style={{ flex: 2, background: analyzing ? '#1a1a1a' : (!imageData && !context.trim()) ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: analyzing || (!imageData && !context.trim()) ? 'not-allowed' : 'pointer', color: analyzing || (!imageData && !context.trim()) ? Z.muted : Z.bg, fontWeight: 600 }}>
            {analyzing ? '⏳ Analysing...' : '→ Log meal'}
          </button>
          <AlcoholQuickLog onLog={logAlcohol} />
        </div>
      </div>

      {/* Log list */}
      <div data-testid="nutrition-entries" style={{ padding: '12px 20px 32px' }}>
        <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          {isToday ? 'Today' : logDate} · {entries.length} item{entries.length !== 1 ? 's' : ''}
        </div>
        {loading ? <div style={{ color: Z.muted, fontSize: 13 }}>Loading...</div> :
         entries.length === 0 ? <div style={{ fontSize: 13, color: Z.muted }}>Nothing logged {isToday ? 'today' : 'for this date'}.</div> :
         entries.map(e => <MealCard key={e.id} entry={e} onDelete={deleteEntry} />)}
      </div>
    </div>
  )
}
