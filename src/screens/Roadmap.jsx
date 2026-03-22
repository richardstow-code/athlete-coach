import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claudeProxy'

const Z = {
  bg: '#0a0a0a',
  surface: '#111111',
  border: 'rgba(255,255,255,0.08)',
  accent: '#e8ff47',
  text: '#f0ede8',
  muted: '#888580',
  red: '#ff5c5c',
}

const STATUS_ORDER = ['in_dev', 'designing', 'in_review', 'triage', 'completed', 'declined']

const STATUS_LABELS = {
  triage:    'Triage',
  in_review: 'In Review',
  designing: 'Designing',
  in_dev:    'In Dev',
  completed: 'Completed',
  declined:  'Declined',
}

const STATUS_COLOURS = {
  triage:    { bg: 'rgba(255,255,255,0.08)', text: '#888580' },
  in_review: { bg: 'rgba(71,130,255,0.15)',  text: '#8aabff' },
  designing: { bg: 'rgba(180,71,255,0.15)',  text: '#c98aff' },
  in_dev:    { bg: '#e8ff47',                text: '#0a0a0a' },
  completed: { bg: 'rgba(71,255,130,0.15)',  text: '#4dff91' },
  declined:  { bg: 'rgba(255,71,71,0.15)',   text: '#ff5c5c' },
}

const APP_SCREENS = [
  'Home', 'Plan', 'Chat', 'Fuel', 'Progress',
  'Settings', 'Activity detail', 'Roadmap', 'Onboarding', 'Other',
]

const BUG_FREQUENCIES = [
  { value: 'always',     label: 'Every time' },
  { value: 'often',      label: 'Often' },
  { value: 'sometimes',  label: 'Sometimes' },
  { value: 'once',       label: 'Only happened once' },
]

function StatusBadge({ status }) {
  const col = STATUS_COLOURS[status] || STATUS_COLOURS.triage
  return (
    <div style={{
      display: 'inline-block',
      background: col.bg, color: col.text,
      fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
      borderRadius: 4, padding: '2px 7px',
      fontFamily: "'DM Mono', monospace",
    }}>
      {STATUS_LABELS[status] || status}
    </div>
  )
}

function FeatureCard({ feature, myVoteIds }) {
  const [expanded, setExpanded] = useState(false)
  const isMine = myVoteIds.includes(feature.id)

  return (
    <div style={{
      background: Z.surface, borderRadius: 10,
      padding: '14px 16px', marginBottom: 10,
      border: `1px solid ${isMine ? 'rgba(232,255,71,0.2)' : Z.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, color: Z.text, flex: 1 }}>
          {feature.title}
          {isMine && (
            <span style={{ marginLeft: 8, fontSize: 9, color: Z.accent, letterSpacing: '0.04em', fontFamily: "'DM Mono', monospace" }}>
              YOU REQUESTED
            </span>
          )}
        </div>
        <StatusBadge status={feature.status} />
      </div>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          fontSize: 11, color: Z.muted, lineHeight: 1.6, cursor: 'pointer',
          display: expanded ? 'block' : '-webkit-box',
          WebkitLineClamp: expanded ? 'none' : 2,
          WebkitBoxOrient: 'vertical',
          overflow: expanded ? 'visible' : 'hidden',
          marginBottom: feature.status === 'declined' && feature.decline_reason ? 6 : 8,
        }}
      >
        {feature.description}
      </div>
      {feature.status === 'declined' && feature.decline_reason && (
        <div style={{
          fontSize: 10, color: '#ff8080', background: 'rgba(255,71,71,0.08)',
          borderRadius: 6, padding: '6px 10px', marginBottom: 8,
          borderLeft: '2px solid rgba(255,71,71,0.4)',
        }}>
          <span style={{ opacity: 0.7 }}>Why declined: </span>{feature.decline_reason}
        </div>
      )}
      <div style={{ fontSize: 10, color: Z.muted }}>
        👍 {feature.vote_count} {feature.vote_count === 1 ? 'request' : 'requests'}
      </div>
    </div>
  )
}

// ── Feature Request Modal ─────────────────────────────────────────────────────

function FeatureRequestModal({ onClose, onSubmitted, userId, defaultType = 'feature' }) {
  const [type, setType] = useState(defaultType) // 'feature' | 'bug'
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Bug-specific
  const [screen, setScreen] = useState('')
  const [frequency, setFrequency] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null) // null | { matched: true, title } | { matched: false }
  const [error, setError] = useState(null)

  const isBug = type === 'bug'

  async function notifyAdmin(payload) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const jwt = session?.access_token
      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-feature-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_KEY,
          ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify(payload),
      })
    } catch {
      // Non-fatal — DB write already happened
    }
  }

  async function handleSubmit() {
    const trimTitle = title.trim()
    const trimDesc = description.trim()

    if (trimTitle.length < 5) {
      setError('Please add a title (at least 5 characters)')
      return
    }
    if (trimDesc.length < 10) {
      setError('Please describe it in a bit more detail')
      return
    }
    if (isBug && !screen) {
      setError('Please select the screen where the bug occurred')
      return
    }
    setError(null)
    setSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const uid = user?.id || userId

      if (isBug) {
        // Bugs: insert directly, no dedup check
        const fullDescription = [
          trimDesc,
          screen ? `Screen: ${screen}` : null,
          frequency ? `Frequency: ${BUG_FREQUENCIES.find(f => f.value === frequency)?.label || frequency}` : null,
        ].filter(Boolean).join('\n')

        const { data: newReq } = await supabase
          .from('feature_requests')
          .insert({
            title: trimTitle,
            description: fullDescription,
            type: 'bug',
            created_by: uid,
            vote_count: 1,
          })
          .select()
          .single()

        if (newReq) {
          await supabase.from('feature_votes').insert({ feature_id: newReq.id, user_id: uid, original_text: trimDesc })
          await notifyAdmin({ type: 'bug', title: trimTitle, description: fullDescription, submitter_email: user?.email, feature_id: newReq.id })
        }

        setResult({ matched: false, isBug: true })
      } else {
        // Features: similarity dedup check
        const { data: existing } = await supabase
          .from('feature_requests')
          .select('id, title, description')
          .eq('type', 'feature')
          .not('status', 'in', '("declined","completed")')

        let matchedId = null
        let matchedTitle = null

        if (existing && existing.length > 0) {
          const listText = existing.map(r => `${r.id} | ${r.title} | ${r.description}`).join('\n')
          const prompt = `You are reviewing a new feature request for a fitness coaching app. Compare it to the existing requests listed below and determine if it is substantially similar to any of them (same core idea, even if worded differently).

New request title: '${trimTitle}'
New request description: '${trimDesc}'

Existing requests:
${listText}

Respond ONLY with a JSON object:
{"match": true or false, "matched_id": "uuid of best match or null", "confidence": 0.0 to 1.0, "reasoning": "one sentence"}`

          try {
            const response = await callClaude({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 200,
              system: 'You compare feature requests. Respond only with valid JSON, no markdown fences.',
              messages: [{ role: 'user', content: prompt }],
            })
            const raw = response?.content?.[0]?.text?.trim() || ''
            const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
            const parsed = JSON.parse(cleaned)

            if (parsed.match && parsed.confidence >= 0.75 && parsed.matched_id) {
              matchedId = parsed.matched_id
              matchedTitle = existing.find(r => r.id === parsed.matched_id)?.title || 'an existing request'
            }
          } catch {
            // Similarity check failed — proceed with new request
          }
        }

        if (matchedId) {
          // Vote on existing
          await supabase.from('feature_votes').upsert(
            { feature_id: matchedId, user_id: uid, original_text: trimDesc },
            { onConflict: 'feature_id,user_id', ignoreDuplicates: true }
          )
          const { data: cur } = await supabase.from('feature_requests').select('vote_count').eq('id', matchedId).maybeSingle()
          if (cur) await supabase.from('feature_requests').update({ vote_count: (cur.vote_count || 0) + 1 }).eq('id', matchedId)
          await notifyAdmin({ type: 'vote', title: matchedTitle, description: trimDesc, submitter_email: user?.email, feature_id: matchedId })
          setResult({ matched: true, title: matchedTitle })
        } else {
          // New feature
          const adminNotes = existing === null ? 'similarity_check_failed' : null
          const { data: newReq } = await supabase
            .from('feature_requests')
            .insert({
              title: trimTitle,
              description: trimDesc,
              type: 'feature',
              created_by: uid,
              vote_count: 1,
              ...(adminNotes ? { admin_notes: adminNotes } : {}),
            })
            .select()
            .single()
          if (newReq) {
            await supabase.from('feature_votes').insert({ feature_id: newReq.id, user_id: uid, original_text: trimDesc })
            await notifyAdmin({ type: 'feature', title: trimTitle, description: trimDesc, submitter_email: user?.email, feature_id: newReq.id })
          }
          setResult({ matched: false, isBug: false })
        }
      }

      onSubmitted?.()
    } catch (err) {
      setError('Something went wrong. Please try again.')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const selectStyle = {
    width: '100%', boxSizing: 'border-box',
    background: Z.surface, border: `1px solid ${Z.border}`,
    borderRadius: 10, padding: '10px 14px',
    color: Z.text, fontSize: 12,
    fontFamily: "'DM Mono', monospace",
    outline: 'none', appearance: 'none', WebkitAppearance: 'none',
    marginBottom: 10,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 800,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end',
      fontFamily: "'DM Mono', monospace",
    }}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: Z.bg, borderRadius: '16px 16px 0 0',
        padding: '20px 20px 36px',
        maxHeight: '90dvh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color: Z.text }}>
            {isBug ? 'Report a bug' : 'Request a feature'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
        </div>

        {result ? (
          <div>
            <div style={{ fontSize: 12, color: Z.text, lineHeight: 1.7, marginBottom: 20 }}>
              {result.matched
                ? `This sounds like "${result.title}" which is already on the roadmap. Your vote has been added!`
                : result.isBug
                  ? "Bug report submitted — thanks. We'll investigate and update the roadmap."
                  : 'Feature request submitted. Track its progress on the roadmap.'}
            </div>
            <button onClick={onClose} style={{ width: '100%', padding: '13px', background: Z.accent, border: 'none', borderRadius: 10, fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600, color: Z.bg, cursor: 'pointer' }}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Type toggle */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[{ value: 'feature', label: '✨ Feature' }, { value: 'bug', label: '🐛 Bug' }].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { setType(opt.value); setError(null) }}
                  style={{
                    flex: 1, padding: '8px',
                    background: type === opt.value ? Z.accent : Z.surface,
                    border: `1px solid ${type === opt.value ? Z.accent : Z.border}`,
                    borderRadius: 8,
                    fontFamily: "'DM Mono', monospace", fontSize: 12, fontWeight: 600,
                    color: type === opt.value ? Z.bg : Z.muted,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Title */}
            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>
              {isBug ? 'Bug title' : 'Feature title'}
            </div>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={isBug ? 'e.g. Plan tab crashes when…' : 'e.g. Export week as PDF'}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: Z.surface, border: `1px solid ${Z.border}`,
                borderRadius: 10, padding: '10px 14px',
                color: Z.text, fontSize: 12,
                fontFamily: "'DM Mono', monospace",
                outline: 'none', marginBottom: 12,
              }}
            />

            {/* Description */}
            <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>
              {isBug ? 'What happened vs what you expected' : 'Describe the feature'}
            </div>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={isBug
                ? 'What did you do? What did you expect? What happened instead?'
                : 'Why would this be useful? How would it work?'}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: Z.surface, border: `1px solid ${Z.border}`,
                borderRadius: 10, padding: '12px 14px',
                color: Z.text, fontSize: 12,
                fontFamily: "'DM Mono', monospace",
                resize: 'none', outline: 'none', lineHeight: 1.6,
                marginBottom: 12,
              }}
            />

            {/* Bug-specific fields */}
            {isBug && (
              <>
                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>Screen where it happened</div>
                <select value={screen} onChange={e => setScreen(e.target.value)} style={selectStyle}>
                  <option value="">Select screen…</option>
                  {APP_SCREENS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>

                <div style={{ fontSize: 11, color: Z.muted, marginBottom: 6 }}>How often does it happen?</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                  {BUG_FREQUENCIES.map(f => (
                    <button
                      key={f.value}
                      onClick={() => setFrequency(f.value)}
                      style={{
                        padding: '6px 12px',
                        background: frequency === f.value ? 'rgba(232,255,71,0.15)' : Z.surface,
                        border: `1px solid ${frequency === f.value ? 'rgba(232,255,71,0.4)' : Z.border}`,
                        borderRadius: 20, cursor: 'pointer',
                        fontSize: 11, color: frequency === f.value ? Z.accent : Z.muted,
                        fontFamily: "'DM Mono', monospace",
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {error && <div style={{ fontSize: 11, color: Z.red, marginBottom: 10 }}>{error}</div>}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                width: '100%', padding: '13px',
                background: submitting ? 'rgba(255,255,255,0.08)' : Z.accent,
                border: 'none', borderRadius: 10,
                fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600,
                color: submitting ? Z.muted : Z.bg, cursor: submitting ? 'wait' : 'pointer',
              }}
            >
              {submitting ? (isBug ? 'Submitting…' : 'Checking for duplicates…') : (isBug ? 'Submit bug report' : 'Submit feature request')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Roadmap screen ───────────────────────────────────────────────────────

export default function Roadmap({ onClose, userId, defaultShowRequest = false, defaultShowBugReport = false }) {
  const [features, setFeatures] = useState([])
  const [myVoteIds, setMyVoteIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [collapsed, setCollapsed] = useState({ completed: true, declined: true })
  const [showModal, setShowModal] = useState(defaultShowRequest || defaultShowBugReport)
  const [modalType, setModalType] = useState(defaultShowBugReport ? 'bug' : 'feature')

  function openRequest() { setModalType('feature'); setShowModal(true) }
  function openBugReport() { setModalType('bug'); setShowModal(true) }

  useEffect(() => {
    async function load() {
      const [{ data: fReqs }, { data: myVotes }] = await Promise.all([
        // Only show features on the roadmap (bugs handled separately)
        supabase.from('feature_requests').select('*').eq('type', 'feature').order('vote_count', { ascending: false }),
        userId
          ? supabase.from('feature_votes').select('feature_id').eq('user_id', userId)
          : Promise.resolve({ data: [] }),
      ])
      setFeatures(fReqs || [])
      setMyVoteIds((myVotes || []).map(v => v.feature_id))
      setLoading(false)
    }
    load()
  }, [userId])

  const grouped = STATUS_ORDER.reduce((acc, status) => {
    acc[status] = features.filter(f => f.status === status)
    return acc
  }, {})

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: Z.bg,
      display: 'flex', flexDirection: 'column',
      fontFamily: "'DM Mono', monospace",
      maxWidth: 430, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 52,
        borderBottom: `1px solid ${Z.border}`, flexShrink: 0,
      }}>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color: Z.text, letterSpacing: '-0.5px' }}>
            ROADMAP
          </div>
          <div style={{ fontSize: 10, color: Z.muted }}>Features requested and in progress</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={openRequest}
            style={{
              background: 'rgba(232,255,71,0.1)', border: `1px solid rgba(232,255,71,0.3)`,
              borderRadius: 20, padding: '5px 12px',
              fontSize: 11, color: Z.accent, cursor: 'pointer',
              fontFamily: "'DM Mono', monospace",
            }}
          >
            + Request
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: Z.muted, fontSize: 12 }}>Loading…</div>
        )}

        {!loading && STATUS_ORDER.map(status => {
          const items = grouped[status] || []
          const isCollapsible = status === 'completed' || status === 'declined'
          const isCollapsed = isCollapsible && collapsed[status]
          if (items.length === 0) return null

          return (
            <div key={status} style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 10, cursor: isCollapsible ? 'pointer' : 'default',
                }}
                onClick={isCollapsible ? () => setCollapsed(c => ({ ...c, [status]: !c[status] })) : undefined}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusBadge status={status} />
                  <span style={{ fontSize: 11, color: Z.muted }}>{items.length}</span>
                </div>
                {isCollapsible && (
                  <span style={{ fontSize: 11, color: Z.muted }}>{isCollapsed ? '▶' : '▼'}</span>
                )}
              </div>

              {!isCollapsed && items.map(feature => (
                <FeatureCard key={feature.id} feature={feature} myVoteIds={myVoteIds} />
              ))}
            </div>
          )
        })}

        {!loading && features.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <div style={{ fontSize: 12, color: Z.muted, marginBottom: 12 }}>No feature requests yet.</div>
            <button
              onClick={openRequest}
              style={{ background: Z.accent, border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 12, fontWeight: 600, color: Z.bg, cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}
            >
              Be the first to request one
            </button>
          </div>
        )}

        {/* Footer bug link */}
        <div style={{ textAlign: 'center', paddingTop: 8, paddingBottom: 16 }}>
          <button
            onClick={openBugReport}
            style={{ background: 'none', border: 'none', fontSize: 11, color: Z.muted, cursor: 'pointer', fontFamily: "'DM Mono', monospace", textDecoration: 'underline' }}
          >
            🐛 Report a bug
          </button>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <FeatureRequestModal
          onClose={() => setShowModal(false)}
          onSubmitted={() => {}}
          userId={userId}
          defaultType={modalType}
        />
      )}
    </div>
  )
}
