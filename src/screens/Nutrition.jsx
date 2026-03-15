import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY

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

// ── Shared Insights Graph ─────────────────────────────────────
function InsightsGraph({ entries7Days, active }) {
  // Build last 7 days of data
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = d.toISOString().slice(0, 10)
    const dayEntries = entries7Days.filter(e => e.date === ds)
    days.push({
      label: d.toLocaleDateString('en-GB', { weekday: 'short' }),
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

  return (
    <div style={{ padding: '0 0 8px' }}>
      {/* Bar chart */}
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
      {/* Day labels */}
      <div style={{ display: 'flex', gap: 4 }}>
        {days.map((d, i) => (
          <div key={i} style={{ flex: 1, fontSize: 9, color: d.date === new Date().toISOString().slice(0,10) ? Z.accent : Z.muted, textAlign: 'center', fontWeight: d.date === new Date().toISOString().slice(0,10) ? 600 : 400 }}>{d.label}</div>
        ))}
      </div>
      {/* Legend */}
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
  return (
    <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setExpanded(e => !e)} style={{ padding: '11px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, color: Z.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isAlcohol ? '🍺 ' : ''}{entry.meal_name || 'Meal'}</div>
          <div style={{ fontSize: 10, color: Z.muted, marginTop: 1 }}>
            {entry.date} {entry.logged_at ? '· ' + new Date(entry.logged_at).toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'}) : ''}
            {isAlcohol ? ` · ${parseFloat(entry.alcohol_units||0).toFixed(1)} units` : ` · ${entry.calories||'?'} kcal`}
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
              {[['Protein', entry.protein_g + 'g'], ['Carbs', entry.carbs_g + 'g'], ['Fat', entry.fat_g + 'g']].map(([l, v]) => (
                <div key={l} style={{ background: '#1a1a1a', borderRadius: 6, padding: '6px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: Z.accent, fontWeight: 600 }}>{v}</div>
                  <div style={{ fontSize: 9, color: Z.muted, textTransform: 'uppercase' }}>{l}</div>
                </div>
              ))}
            </div>
          )}
          {entry.notes && <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.5, marginBottom: 8 }}>{entry.notes}</div>}
          <button onClick={() => onDelete(entry.id)} style={{ background: 'none', border: 'none', color: Z.red, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>Delete</button>
        </div>
      )}
    </div>
  )
}

// ── Main Screen ───────────────────────────────────────────────
export default function Nutrition() {
  const cameraRef = useRef(null)
  const libraryRef = useRef(null)
  const [entries, setEntries] = useState([])
  const [entries7, setEntries7] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [preview, setPreview] = useState(null)
  const [imageData, setImageData] = useState(null)
  const [imageMime, setImageMime] = useState('image/jpeg')
  const [context, setContext] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10))
  const [activeMetrics, setActiveMetrics] = useState(['kcal', 'protein', 'units'])

  const todayKcal = entries.filter(e => e.meal_type !== 'alcohol' && e.date === logDate).reduce((s, e) => s + (e.calories || 0), 0)
  const todayProtein = entries.filter(e => e.meal_type !== 'alcohol' && e.date === logDate).reduce((s, e) => s + parseFloat(e.protein_g || 0), 0)

  // Weekly units
  const weekStart = (() => { const d = new Date(); const dow = d.getDay(); d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); return d.toISOString().slice(0,10) })()
  const weekUnits = entries7.filter(e => e.meal_type === 'alcohol').reduce((s, e) => s + parseFloat(e.alcohol_units || 0), 0)

  async function load() {
    const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10)
    const [{ data: all }, { data: w7 }] = await Promise.all([
      supabase.from('nutrition_logs').select('*').eq('date', logDate).order('logged_at', { ascending: false }),
      supabase.from('nutrition_logs').select('*').gte('date', sevenDaysAgo).order('date')
    ])
    setEntries(all || [])
    setEntries7(w7 || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [logDate])

  function toggleMetric(key) {
    setActiveMetrics(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const mime = file.type || 'image/jpeg'
    setImageMime(mime)
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target.result
      setPreview(result)
      // Extract pure base64 without data URI prefix
      setImageData(result.split(',')[1])
    }
    reader.readAsDataURL(file)
  }

  async function analyzeAndLog() {
    if (!imageData && !context.trim()) return
    setAnalyzing(true)
    try {
      const userContent = imageData
        ? [
            { type: 'image', source: { type: 'base64', media_type: imageMime.includes('png') ? 'image/png' : imageMime.includes('gif') ? 'image/gif' : imageMime.includes('webp') ? 'image/webp' : 'image/jpeg', data: imageData } },
            { type: 'text', text: `Analyse this meal. Context: ${context || 'none'}. Eaten today so far: ${todayKcal} kcal, ${Math.round(todayProtein)}g protein. Respond ONLY in JSON: {"meal_name":"...","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"rating":"green|amber|red","notes":"one sentence reason"}` }
          ]
        : `Estimate this meal: ${context}. Eaten today so far: ${todayKcal} kcal. Respond ONLY in JSON: {"meal_name":"...","calories":0,"protein_g":0,"carbs_g":0,"fat_g":0,"rating":"green|amber|red","notes":"one sentence reason"}`

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          system: 'Sports nutritionist for a marathon athlete. Estimate calories and macros accurately. Return valid JSON only, no markdown, no explanation.',
          messages: [{ role: 'user', content: userContent }]
        })
      })
      if (!resp.ok) throw new Error('API error ' + resp.status)
      const data = await resp.json()
      const raw = data.content?.[0]?.text
      if (!raw) throw new Error('No response')
      const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
      await supabase.from('nutrition_logs').insert({ date: logDate, meal_name: parsed.meal_name, calories: parsed.calories, protein_g: parsed.protein_g, carbs_g: parsed.carbs_g, fat_g: parsed.fat_g, rating: parsed.rating, notes: parsed.notes, logged_at: new Date().toISOString(), meal_type: 'food' })
      setPreview(null); setImageData(null); setContext('')
      load()
    } catch(e) {
      console.error('Nutrition analysis error:', e)
      alert('Analysis failed: ' + e.message + '. Try describing the meal in text instead.')
    }
    setAnalyzing(false)
  }

  async function logAlcohol({ drink, quantity, units }) {
    await supabase.from('nutrition_logs').insert({ date: logDate, meal_name: `${quantity}x ${drink}`, alcohol_units: units, logged_at: new Date().toISOString(), meal_type: 'alcohol' })
    load()
  }

  async function deleteEntry(id) { await supabase.from('nutrition_logs').delete().eq('id', id); load() }

  const isToday = logDate === new Date().toISOString().slice(0, 10)

  return (
    <div style={{ height: '100%', overflowY: 'auto', fontFamily: "'DM Mono', monospace" }}>
      {/* Header */}
      <div style={{ padding: '14px 20px 10px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700 }}>Fuel</div>
          {/* Date picker */}
          <input type="date" value={logDate} max={new Date().toISOString().slice(0,10)}
            onChange={e => setLogDate(e.target.value)}
            style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 6, padding: '5px 8px', color: isToday ? Z.muted : Z.accent, fontFamily: "'DM Mono', monospace", fontSize: 11, outline: 'none', cursor: 'pointer' }} />
        </div>
        <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
          {isToday ? 'Today' : new Date(logDate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          {!isToday && <span style={{ color: Z.amber }}> · Historical entry</span>}
        </div>
      </div>

      {/* Clickable stat cards + graph */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
          <StatCard metricKey="kcal" val={todayKcal} target={KCAL_TARGET} label="Kcal" unit="kcal" col={Z.accent}
            active={activeMetrics} onToggle={toggleMetric}
            insight={`Target: ${KCAL_TARGET} kcal/day in base build. Moderate surplus on training days helps muscle retention. Deficit on rest days is fine.`} />
          <StatCard metricKey="protein" val={Math.round(todayProtein)} target={PROTEIN_TARGET} label="Protein" unit="g" col={Z.accent2}
            active={activeMetrics} onToggle={toggleMetric}
            insight={`Target: ${PROTEIN_TARGET}g/day. At 79kg that's ~1.9g/kg — optimal for muscle retention during marathon training. Spread across 4+ meals.`} />
          <StatCard metricKey="units" val={parseFloat(weekUnits.toFixed(1))} target={UNITS_TARGET} label="Units/wk" unit="" col={Z.amber}
            active={activeMetrics} onToggle={toggleMetric}
            insight={`Weekly target: ≤${UNITS_TARGET} units. Current: ${weekUnits.toFixed(1)}. Alcohol disrupts sleep quality and HRV recovery — two things that determine how well you adapt to training.`} />
        </div>

        {/* Shared toggle graph */}
        <div style={{ background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            7 days · tap cards to toggle
          </div>
          <InsightsGraph entries7Days={entries7} active={activeMetrics} />
        </div>
      </div>

      {/* Log section */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontSize: 11, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Log {!isToday && `(${logDate})`}
        </div>

        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={handleFile} style={{ display: 'none' }} />
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
          style={{ width: '100%', background: Z.surface, border: `1px solid ${Z.border2}`, borderRadius: 8, padding: '9px 12px', color: Z.text, fontFamily: "'DM Mono', monospace", fontSize: 12, resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 8 }} />

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={analyzeAndLog} disabled={analyzing || (!imageData && !context.trim())}
            style={{ flex: 2, background: analyzing ? '#1a1a1a' : (!imageData && !context.trim()) ? '#1a1a1a' : Z.accent, border: 'none', borderRadius: 8, padding: '10px', fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: analyzing || (!imageData && !context.trim()) ? 'not-allowed' : 'pointer', color: analyzing || (!imageData && !context.trim()) ? Z.muted : Z.bg, fontWeight: 600 }}>
            {analyzing ? '⏳ Analysing...' : '→ Log meal'}
          </button>
          <AlcoholQuickLog onLog={logAlcohol} />
        </div>
      </div>

      {/* Log list */}
      <div style={{ padding: '12px 20px 32px' }}>
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
