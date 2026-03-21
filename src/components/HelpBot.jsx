import { useState, useRef, useEffect } from 'react'
import { callClaude } from '../lib/claudeProxy'

const Z = {
  bg: '#0a0a0a',
  surface: '#111111',
  panel: '#161616',
  border: 'rgba(255,255,255,0.08)',
  accent: '#e8ff47',
  text: '#f0ede8',
  muted: '#888580',
}

const HELP_SYSTEM_PROMPT = `You are a helpful guide for the Athlete Coach app. Your job is to explain how the app works, what features exist, and how to get the most out of each tab and capability. You are NOT a fitness coach — do not give training advice. Direct training questions to the Chat tab.

The app has five main tabs:
- Home: daily briefing, today's session check-in, activity feed, nutrition summary, weekly stats. Briefing can be refreshed on demand. Pull down to refresh all data.
- Plan: weekly training schedule, approve/reject coach proposals, generate a new training plan, view upcoming sessions. Coach can propose changes mid-chat that appear here.
- Chat: AI coaching conversations. Ask anything about your training, nutrition, recovery. Coach has full context of your recent activities, nutrition, and schedule.
- Fuel: log meals by description or photo. AI rates each entry against training load. Tracks alcohol against weekly target. Post-workout nutrition reminders.
- Progress: macro view of monthly training volume by goal type, micro view of event-specific phase compliance and personal bests.

Settings (profile icon top right): personal details, goals and races, training zones, health flags, coaching preferences, connected services, subscription.

Help is also available per-screen via the onboarding hints (tap the ⓘ icon on any screen to re-show hints).

Be concise. Answer in 2-4 sentences unless the question needs more detail. If unsure, say so honestly.`

const SCREEN_LABELS = {
  home: 'Home',
  plan: 'Plan',
  chat: 'Chat',
  nutrition: 'Fuel',
  stats: 'Progress',
}

const DEFAULT_CHIPS = [
  'What does the Plan tab do?',
  'How do I log food?',
  'How does the coach use my data?',
]

const SCREEN_CHIPS = {
  home: ['What is the daily briefing?', 'How do I refresh the briefing?', 'What does the check-in card do?'],
  plan: ['How do I approve a change?', 'How do I generate a plan?', 'What is mismatch detection?'],
  chat: ['Does the coach know my recent runs?', 'Can I request training changes in chat?', 'What context does the coach have?'],
  nutrition: ['How do I log a meal?', 'Can I log by photo?', 'How is alcohol tracked?'],
  stats: ['What is macro vs micro view?', 'Where are my personal bests?', 'How is compliance calculated?'],
}

export default function HelpBot({ currentScreen, onOpenRoadmap, onOpenFeatureRequest, onOpenBugReport }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [chips, setChips] = useState(DEFAULT_CHIPS)
  const messagesEndRef = useRef(null)

  const screenLabel = SCREEN_LABELS[currentScreen] || currentScreen || 'App'

  useEffect(() => {
    if (open) {
      setChips(SCREEN_CHIPS[currentScreen] || DEFAULT_CHIPS)
    }
  }, [open, currentScreen])

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, open])

  function handleClose() {
    setOpen(false)
    setMessages([])
    setInput('')
  }

  async function sendMessage(text) {
    if (!text.trim() || loading) return
    const userMsg = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const contextNote = `The user is currently on the ${screenLabel} screen.`
      const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))

      const response = await callClaude({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: HELP_SYSTEM_PROMPT + '\n\n' + contextNote,
        messages: history,
      })

      const replyText = response?.content?.[0]?.text || 'Sorry, I couldn\'t get a response. Try again.'
      setMessages(prev => [...prev, { role: 'assistant', content: replyText }])

      // Generate new contextual chips after response
      const contextChips = SCREEN_CHIPS[currentScreen] || DEFAULT_CHIPS
      setChips(contextChips.filter(c => c !== text))
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
    } finally {
      setLoading(false)
    }
  }

  function handleChip(chip) {
    sendMessage(chip)
    setChips([])
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          bottom: 88,
          right: 16,
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: Z.surface,
          border: `1.5px solid ${Z.accent}`,
          color: Z.accent,
          fontSize: 20,
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 300,
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          fontFamily: 'Syne, sans-serif',
          transition: 'opacity 0.2s',
        }}
        aria-label="Help"
      >
        ?
      </button>

      {/* Help panel */}
      {open && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 500,
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          background: 'rgba(0,0,0,0.6)',
        }}>
          <div style={{
            background: Z.bg,
            borderRadius: '16px 16px 0 0',
            height: '76dvh',
            maxWidth: 430,
            width: '100%',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Drag handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px', flexShrink: 0 }}>
              <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
            </div>

            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 20px 12px', borderBottom: `1px solid ${Z.border}`, flexShrink: 0,
            }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, color: Z.text, letterSpacing: '-0.3px' }}>
                HELP <span style={{ color: Z.muted, fontWeight: 400 }}>· {screenLabel.toUpperCase()}</span>
              </div>
              <button onClick={handleClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 22, cursor: 'pointer', padding: 4, lineHeight: 1 }}>×</button>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: Z.panel }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', paddingTop: 24 }}>
                  <div style={{ fontSize: 28, marginBottom: 12 }}>?</div>
                  <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, color: Z.text, marginBottom: 6 }}>
                    How can I help?
                  </div>
                  <div style={{ fontSize: 11, color: Z.muted, lineHeight: 1.6 }}>
                    Ask anything about how the app works. Tap a question below to get started.
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} style={{
                  marginBottom: 12,
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{
                    maxWidth: '80%',
                    padding: '10px 14px',
                    borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    background: m.role === 'user' ? Z.accent : Z.surface,
                    color: m.role === 'user' ? Z.bg : Z.text,
                    fontSize: 12,
                    lineHeight: 1.6,
                    fontFamily: "'DM Mono', monospace",
                  }}>
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                  <div style={{ background: Z.surface, borderRadius: '12px 12px 12px 2px', padding: '10px 14px', fontSize: 12, color: Z.muted }}>
                    …
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick chips */}
            {chips.length > 0 && (
              <div style={{
                padding: '10px 20px 0',
                display: 'flex', gap: 8, flexWrap: 'wrap',
                background: Z.bg, flexShrink: 0,
              }}>
                {chips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => handleChip(chip)}
                    style={{
                      background: 'rgba(232,255,71,0.08)',
                      border: `1px solid rgba(232,255,71,0.25)`,
                      borderRadius: 20,
                      padding: '5px 12px',
                      fontSize: 11,
                      color: Z.accent,
                      cursor: 'pointer',
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Feature request / roadmap / bug report links */}
            <div style={{ padding: '8px 20px 0', display: 'flex', gap: 8, flexWrap: 'wrap', background: Z.bg, flexShrink: 0 }}>
              <button
                onClick={() => { handleClose(); onOpenFeatureRequest?.() }}
                style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
              >
                Request a feature →
              </button>
              <span style={{ color: Z.border, fontSize: 11 }}>|</span>
              <button
                onClick={() => { handleClose(); onOpenBugReport?.() }}
                style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
              >
                Report a bug →
              </button>
              <span style={{ color: Z.border, fontSize: 11 }}>|</span>
              <button
                onClick={() => { handleClose(); onOpenRoadmap?.() }}
                style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
              >
                See what's coming →
              </button>
            </div>

            {/* Input */}
            <div style={{
              padding: '10px 16px 20px',
              background: Z.bg,
              flexShrink: 0,
              display: 'flex', gap: 8, alignItems: 'flex-end',
            }}>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                placeholder="Ask about a feature..."
                rows={1}
                style={{
                  flex: 1,
                  background: Z.surface,
                  border: `1px solid ${Z.border}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                  color: Z.text,
                  fontSize: 12,
                  fontFamily: "'DM Mono', monospace",
                  resize: 'none',
                  outline: 'none',
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                style={{
                  background: input.trim() && !loading ? Z.accent : 'rgba(255,255,255,0.08)',
                  border: 'none', borderRadius: 10,
                  width: 40, height: 40,
                  cursor: input.trim() && !loading ? 'pointer' : 'default',
                  color: input.trim() && !loading ? Z.bg : Z.muted,
                  fontSize: 16, flexShrink: 0,
                }}
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
