import { useSettings } from '../lib/useSettings'
import { buildSystemPrompt } from '../lib/coachingPrompt'
import { buildContext, formatContext } from '../lib/buildContext'
import { getActiveNudge } from '../lib/nudges'
import { useState, useRef, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { callClaude } from '../lib/claudeProxy'
import NudgeCard from '../components/NudgeCard'
import CycleLogNudge from '../components/CycleLogNudge'

export default function Chat() {
  const settings = useSettings()

  const quickQuestions = useMemo(() => {
    const goalType = settings.goal_type
    const eventName = settings.target_event_name
    const sport = settings.sport_category || settings.sport || 'training'

    if (goalType === 'compete' || goalType === 'complete_event') {
      return [
        eventName ? `Am I on track for ${eventName}?` : 'Am I on track for my goal?',
        `How was my last ${sport} session?`,
        'What should I focus on this week?',
        'Am I recovering well enough?',
      ]
    }
    if (goalType === 'body_composition') {
      return [
        'How is my nutrition looking this week?',
        'Am I hitting my protein targets?',
        'How is my training consistency?',
        'Any changes I should make?',
      ]
    }
    if (goalType === 'injury_recovery') {
      return [
        'How should I train today?',
        'Am I progressing safely?',
        'What should I avoid this week?',
        'How is my recovery going?',
      ]
    }
    return [
      'How did my last session go?',
      'What should I do this week?',
      'How is my consistency looking?',
      'Any advice for today?',
    ]
  }, [settings.goal_type, settings.target_event_name, settings.sport_category, settings.sport])

  const [messages, setMessages] = useState([])
  const [greeting, setGreeting] = useState('Loading...')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [ctx, setCtx] = useState(null)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const [showCycleNudge, setShowCycleNudge] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Fire at most one nudge per session, only after settings have loaded
  // (lifecycle_state being non-null is our signal that the DB fetch completed)
  const activeNudge = (!nudgeDismissed && settings.lifecycle_state != null)
    ? getActiveNudge(settings)
    : null

  useEffect(() => {
    buildContext().then(c => {
      setCtx(c)
      const snippet = c.briefing?.briefing_text?.split('\n').find(l => l.trim().startsWith('→'))?.replace(/^→\s*/, '').slice(0, 100)
      const g = snippet ? snippet + "... What's on your mind?" : "Ready to coach. What's on your mind?"
      setGreeting(g)
      setMessages([{ role: 'assistant', content: g }])
    })
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!settings.cycle_tracking_enabled) return
    const today = new Date().toISOString().slice(0, 10)
    const dismissKey = `cycle_nudge_dismissed_${today}`
    if (localStorage.getItem(dismissKey)) return
    supabase.from('cycle_logs').select('id').eq('log_date', today).maybeSingle()
      .then(({ data }) => { if (!data) setShowCycleNudge(true) })
  }, [settings.cycle_tracking_enabled])

  async function sendMessage(text) {
    const userText = text || input.trim()
    if (!userText || loading) return
    setInput('')

    const contextBlock = ctx ? formatContext(ctx) : ''
    const systemPrompt = buildSystemPrompt(settings) + (contextBlock ? '\n\n' + contextBlock : '')

    const newMessages = [...messages, { role: 'user', content: userText }]
    setMessages(newMessages)
    setLoading(true)

    try {
      const data = await callClaude({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        system: systemPrompt,
        messages: newMessages.map(m => ({ role: m.role, content: m.content })),
      })
      const reply = data.content?.[0]?.text || 'Something went wrong.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      // Save to coaching_memory
      supabase.auth.getSession().then(({ data: { session } }) => {
        supabase.from('coaching_memory').insert({
          source: 'app-chat',
          category: 'chat',
          content: `Q: ${userText}\nA: ${reply}`,
          user_id: session?.user?.id,
        }).then(() => {})
      })

    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
    }
    setLoading(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* NUDGE CARD — fires once per session for the next missing profile field */}
      {activeNudge && (
        <NudgeCard
          nudge={activeNudge}
          settings={settings}
          onDismiss={() => setNudgeDismissed(true)}
        />
      )}

      {showCycleNudge && (
        <CycleLogNudge
          onDismiss={() => {
            const today = new Date().toISOString().slice(0, 10)
            localStorage.setItem(`cycle_nudge_dismissed_${today}`, '1')
            setShowCycleNudge(false)
          }}
        />
      )}

      {/* MESSAGES */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '100%' }}>
            <div style={{ maxWidth: '85%' }}>
              <div style={{
                padding: '12px 14px', borderRadius: '12px', fontSize: '13px', lineHeight: 1.6,
                background: m.role === 'user' ? '#e8ff47' : '#111111',
                color: m.role === 'user' ? '#0a0a0a' : '#f0ede8',
                border: m.role === 'assistant' ? '1px solid rgba(255,255,255,0.14)' : 'none',
                borderBottomRightRadius: m.role === 'user' ? '4px' : '12px',
                borderBottomLeftRadius: m.role === 'assistant' ? '4px' : '12px',
                whiteSpace: 'pre-wrap',
              }}>
                {m.content}
              </div>
              <div style={{ fontSize: '10px', color: '#888580', marginTop: '4px', padding: '0 4px', textAlign: m.role === 'user' ? 'right' : 'left' }}>
                {m.role === 'user' ? 'You' : 'Coach'}
              </div>
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '12px 14px', background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '12px', borderBottomLeftRadius: '4px' }}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#888580', animation: `bounce-dot 1.2s ${i * 0.2}s infinite` }} className="typing-dot" />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* QUICK PILLS */}
      <div style={{ padding: '0 20px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {quickQuestions.map((q, i) => (
          <button key={i} onClick={() => sendMessage(q)} style={{ fontSize: '11px', padding: '5px 12px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '20px', color: '#888580', background: 'transparent', cursor: 'pointer', fontFamily: "'DM Mono', monospace', transition: 'all 0.15s'" }}>
            {q}
          </button>
        ))}
      </div>

      {/* INPUT */}
      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', gap: '10px', alignItems: 'flex-end', background: '#0a0a0a' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask your coach..."
          rows={1}
          style={{ flex: 1, background: '#111111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px', padding: '10px 14px', color: '#f0ede8', fontFamily: "'DM Mono', monospace", fontSize: '13px', resize: 'none', outline: 'none', minHeight: '40px', maxHeight: '120px' }}
        />
        <button onClick={() => sendMessage()} disabled={loading || !input.trim()} style={{ width: '40px', height: '40px', background: '#e8ff47', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, opacity: loading || !input.trim() ? 0.4 : 1 }}>
          ↑
        </button>
      </div>
    </div>
  )
}
