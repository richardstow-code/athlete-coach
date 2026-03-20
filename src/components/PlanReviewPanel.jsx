import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claudeProxy'
import { fetchAndBuildPrompt } from '../lib/coachingPrompt'

const Z = {
  bg: '#0a0a0a', surface: '#111111', border: 'rgba(255,255,255,0.08)',
  border2: 'rgba(255,255,255,0.14)', text: '#f0ede8', muted: '#888580',
  accent: '#e8ff47', red: '#ff5c5c', green: '#4dff91', amber: '#ffb347',
}

const typeColor = { run: '#e8ff47', trail: '#47d4ff', strength: '#ffb347', rest: '#888580' }
const typeIcon  = { run: '🏃', trail: '⛰️', strength: '🏋️', rest: '😴' }

function getWeekLabel(dateStr, baseDate) {
  const d = new Date(dateStr + 'T12:00:00')
  const base = new Date(baseDate)
  // Align base to Monday
  const dow = base.getDay()
  base.setDate(base.getDate() - (dow === 0 ? 6 : dow - 1))
  base.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((d - base) / 86400000)
  const weekNum = Math.floor(diffDays / 7)
  if (weekNum === 0) return 'This week'
  if (weekNum === 1) return 'Next week'
  return `Week ${weekNum + 1}`
}

function groupByWeek(sessions) {
  const today = new Date().toISOString().slice(0, 10)
  const groups = new Map()
  for (const s of sessions) {
    const label = getWeekLabel(s.planned_date, today)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label).push(s)
  }
  return [...groups.entries()]
}

function SessionMiniCard({ session }) {
  const col = typeColor[session.session_type] || Z.muted
  const d = new Date(session.planned_date + 'T12:00:00')
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: `1px solid ${Z.border}` }}>
      <div style={{ width: 32, flexShrink: 0, textAlign: 'center', paddingTop: 2 }}>
        <div style={{ fontSize: 10, color: Z.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {d.toLocaleDateString('en-GB', { weekday: 'short' })}
        </div>
        <div style={{ fontSize: 11, color: Z.muted }}>{d.getDate()}</div>
        <div style={{ fontSize: 16, marginTop: 2 }}>{typeIcon[session.session_type] || '📋'}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: Z.text, fontWeight: 500 }}>{session.name}</div>
        {session.zone && (
          <div style={{ fontSize: 10, color: col, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
            {session.zone}
            {session.duration_min_low
              ? ` · ${session.duration_min_low}${session.duration_min_high !== session.duration_min_low ? `–${session.duration_min_high}` : ''} min`
              : ''}
          </div>
        )}
        {session.notes && (
          <div style={{ fontSize: 11, color: '#6b6865', marginTop: 3, lineHeight: 1.4 }}>{session.notes}</div>
        )}
      </div>
    </div>
  )
}

export default function PlanReviewPanel({ draftId, onCommit, onDiscard, onClose }) {
  const [draft, setDraft] = useState(null)
  const [tab, setTab] = useState('summary')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [visible, setVisible] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    supabase
      .from('plan_drafts')
      .select('*')
      .eq('id', draftId)
      .single()
      .then(({ data }) => {
        if (data) {
          setDraft(data)
          setMessages(data.review_messages || [])
        }
      })
  }, [draftId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || sending) return
    const userMsg = { role: 'user', content: input.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setSending(true)

    try {
      const systemPrompt = await fetchAndBuildPrompt(supabase)
      const sessionSample = JSON.stringify((draft?.sessions || []).slice(0, 15))

      const data = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system:
          systemPrompt +
          `\n\nYou are reviewing a draft training plan with the athlete. Current proposed sessions (sample): ${sessionSample}\n\nRespond to the athlete's adjustment requests with specific, actionable suggestions. Be concise.`,
        messages: newMessages,
      })

      const assistantText = data?.content?.[0]?.text || ''
      const assistantMsg = { role: 'assistant', content: assistantText }
      const updatedMessages = [...newMessages, assistantMsg]
      setMessages(updatedMessages)

      await supabase
        .from('plan_drafts')
        .update({ review_messages: updatedMessages })
        .eq('id', draftId)
    } catch (e) {
      console.error('Chat error:', e)
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong — please try again.' },
      ])
    }
    setSending(false)
  }

  async function commitPlan() {
    if (!draft?.sessions?.length) return
    setCommitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const sessions = draft.sessions

      // Get date range of the plan
      const dates = sessions.map(s => s.planned_date).sort()
      const minDate = dates[0]
      const maxDate = dates[dates.length - 1]

      // Delete existing planned sessions in this date range to avoid duplicates
      await supabase
        .from('scheduled_sessions')
        .delete()
        .eq('user_id', user?.id)
        .eq('status', 'planned')
        .gte('planned_date', minDate)
        .lte('planned_date', maxDate)

      // Insert the new sessions
      const rows = sessions.map(s => ({
        user_id: user?.id,
        planned_date: s.planned_date,
        session_type: s.session_type,
        name: s.name,
        duration_min_low: s.duration_min_low || null,
        duration_min_high: s.duration_min_high || null,
        intensity: s.intensity || null,
        zone: s.zone || null,
        notes: s.notes || null,
        status: 'planned',
      }))

      const { error } = await supabase.from('scheduled_sessions').insert(rows)
      if (error) throw error

      await supabase
        .from('plan_drafts')
        .update({ status: 'committed' })
        .eq('id', draftId)

      onCommit?.()
    } catch (e) {
      console.error('Commit failed:', e)
      alert('Failed to commit plan: ' + e.message)
    }
    setCommitting(false)
  }

  async function discardPlan() {
    await supabase
      .from('plan_drafts')
      .update({ status: 'discarded' })
      .eq('id', draftId)
    onDiscard?.()
  }

  const sessions = draft?.sessions || []
  const weekGroups = groupByWeek(sessions)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)',
          transition: 'opacity 0.3s', opacity: visible ? 1 : 0,
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'relative', background: Z.bg,
        borderRadius: '16px 16px 0 0', border: `1px solid ${Z.border2}`,
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        transition: 'transform 0.3s ease-out',
        transform: visible ? 'translateY(0)' : 'translateY(100%)',
      }}>
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0', flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, background: Z.border2, borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', flexShrink: 0, borderBottom: `1px solid ${Z.border}` }}>
          <div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 800, color: Z.text }}>Training Plan Draft</div>
            {draft && (
              <div style={{ fontSize: 11, color: Z.muted, marginTop: 2 }}>
                {sessions.length} sessions proposed
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${Z.border}`, flexShrink: 0 }}>
          {[['summary', 'Plan Summary'], ['discuss', 'Discuss & Adjust']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                flex: 1, padding: '10px', background: 'none', border: 'none',
                borderBottom: `2px solid ${tab === id ? Z.accent : 'transparent'}`,
                color: tab === id ? Z.accent : Z.muted,
                fontFamily: "'DM Mono', monospace", fontSize: 12, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {!draft ? (
            <div style={{ padding: 24, textAlign: 'center', color: Z.muted, fontSize: 13 }}>
              Loading plan...
            </div>
          ) : tab === 'summary' ? (
            <div style={{ padding: '16px 20px 8px' }}>
              {/* Plain-English summary */}
              <div style={{
                fontSize: 13, color: Z.text, lineHeight: 1.7, marginBottom: 20,
                padding: '14px 16px', background: Z.surface,
                borderRadius: 10, border: `1px solid ${Z.border2}`,
              }}>
                {draft.summary_text || 'No summary available.'}
              </div>

              {/* Sessions grouped by week */}
              {weekGroups.map(([week, weekSessions]) => (
                <div key={week} style={{ marginBottom: 20 }}>
                  <div style={{
                    fontSize: 10, color: Z.muted, textTransform: 'uppercase',
                    letterSpacing: '0.08em', marginBottom: 8,
                    paddingBottom: 6, borderBottom: `1px solid ${Z.border}`,
                  }}>
                    {week} · {weekSessions.length} sessions
                  </div>
                  {weekSessions.map((s, i) => <SessionMiniCard key={i} session={s} />)}
                </div>
              ))}

              {sessions.length === 0 && (
                <div style={{ textAlign: 'center', color: Z.muted, fontSize: 13, padding: '24px 0' }}>
                  No sessions in this plan.
                </div>
              )}
            </div>
          ) : (
            /* Discuss & Adjust tab */
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                {messages.length === 0 && (
                  <div style={{
                    color: Z.muted, fontSize: 12, lineHeight: 1.7,
                    padding: '12px 14px', background: Z.surface,
                    borderRadius: 8, border: `1px solid ${Z.border}`, marginBottom: 16,
                  }}>
                    Ask your coach to adjust the plan. Try: "Move Tuesday's run to Wednesday" or "I need a rest day on Fridays" or "Make week 3 easier".
                  </div>
                )}

                {messages.map((m, i) => (
                  <div key={i} style={{ marginBottom: 12, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <div style={{
                      maxWidth: '85%', padding: '10px 14px',
                      borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                      background: m.role === 'user' ? Z.accent : Z.surface,
                      color: m.role === 'user' ? '#0a0a0a' : Z.text,
                      fontSize: 13, lineHeight: 1.5,
                      border: m.role === 'assistant' ? `1px solid ${Z.border2}` : 'none',
                    }}>
                      {m.content}
                    </div>
                  </div>
                ))}

                {sending && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                    <div style={{ padding: '10px 14px', background: Z.surface, borderRadius: '12px 12px 12px 2px', border: `1px solid ${Z.border2}`, fontSize: 13, color: Z.muted }}>
                      Thinking...
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Chat input */}
              <div style={{ padding: '12px 20px', borderTop: `1px solid ${Z.border}`, display: 'flex', gap: 8, flexShrink: 0 }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                  placeholder="Request a change to the plan..."
                  style={{
                    flex: 1, background: Z.surface, border: `1px solid ${Z.border2}`,
                    borderRadius: 8, padding: '10px 12px', color: Z.text,
                    fontFamily: "'DM Mono', monospace", fontSize: 12, outline: 'none',
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sending}
                  style={{
                    background: Z.accent, border: 'none', borderRadius: 8,
                    padding: '10px 14px', color: '#0a0a0a',
                    fontFamily: "'DM Mono', monospace", fontSize: 12,
                    cursor: input.trim() && !sending ? 'pointer' : 'default',
                    opacity: input.trim() && !sending ? 1 : 0.4,
                    fontWeight: 600,
                  }}
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Action bar */}
        <div style={{
          padding: '14px 20px 24px', borderTop: `1px solid ${Z.border}`,
          display: 'flex', gap: 10, flexShrink: 0,
          background: Z.bg,
        }}>
          <button
            onClick={commitPlan}
            disabled={committing || !draft}
            style={{
              flex: 1, background: committing ? '#1a1a1a' : Z.accent,
              border: 'none', borderRadius: 8, padding: '13px',
              fontFamily: "'DM Mono', monospace", fontSize: 13,
              cursor: committing || !draft ? 'wait' : 'pointer',
              color: committing ? Z.muted : '#0a0a0a', fontWeight: 700,
            }}
          >
            {committing ? '⏳ Committing...' : 'Commit Plan'}
          </button>
          <button
            onClick={discardPlan}
            style={{
              background: 'none', border: `1px solid ${Z.border2}`, borderRadius: 8,
              padding: '13px 18px', fontFamily: "'DM Mono', monospace", fontSize: 13,
              cursor: 'pointer', color: Z.muted,
            }}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}
