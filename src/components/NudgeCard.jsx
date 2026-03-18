import { useState } from 'react'
import { processNudgeResponse, markNudgeSent } from '../lib/nudges'

const Z = {
  bg: '#0a0a0a', surface: '#111111',
  border2: 'rgba(255,255,255,0.14)', border: 'rgba(255,255,255,0.07)',
  text: '#f0ede8', muted: '#888580',
  accent: '#e8ff47',
}

export default function NudgeCard({ nudge, settings, onDismiss }) {
  const [response, setResponse] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    if (!response.trim() || submitting) return
    setSubmitting(true)
    await processNudgeResponse(nudge, response.trim(), settings)
    onDismiss()
  }

  async function handleSkip() {
    await markNudgeSent(nudge.key)
    onDismiss()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
  }

  return (
    <div style={{
      margin: '0 0 0 0',
      padding: '12px 16px 14px',
      background: Z.surface,
      borderBottom: `1px solid ${Z.border2}`,
      flexShrink: 0,
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          fontSize: 10, letterSpacing: '0.1em', fontWeight: 600,
          color: Z.accent, textTransform: 'uppercase',
        }}>
          Coach check-in
        </span>
        <button onClick={handleSkip} style={{
          background: 'none', border: 'none', color: Z.muted,
          fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: 'pointer', padding: 0,
        }}>
          skip
        </button>
      </div>

      {/* Question */}
      <p style={{
        fontSize: 13, color: Z.text, lineHeight: 1.55,
        margin: '0 0 10px', fontFamily: "'DM Mono', monospace",
      }}>
        {nudge.question(settings)}
      </p>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={response}
          onChange={e => setResponse(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your answer…"
          rows={1}
          autoFocus
          style={{
            flex: 1, background: Z.bg, border: `1px solid ${Z.border2}`,
            borderRadius: 8, padding: '8px 12px', color: Z.text,
            fontFamily: "'DM Mono', monospace", fontSize: 13,
            resize: 'none', outline: 'none', minHeight: 36, maxHeight: 96,
            lineHeight: 1.5,
          }}
        />
        <button
          onClick={handleSubmit}
          disabled={!response.trim() || submitting}
          style={{
            width: 36, height: 36, background: Z.accent, border: 'none',
            borderRadius: 8, cursor: response.trim() && !submitting ? 'pointer' : 'default',
            fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, opacity: response.trim() && !submitting ? 1 : 0.35,
          }}
        >
          {submitting ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}
