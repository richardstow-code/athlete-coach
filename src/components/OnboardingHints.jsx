import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

const Z = {
  surface: '#111111',
  border: 'rgba(255,255,255,0.08)',
  accent: '#e8ff47',
  text: '#f0ede8',
  muted: '#888580',
}

// All known hint IDs — used for "Skip all" to dismiss everything at once
export const ALL_HINT_IDS = [
  'home_briefing',
  'plan_sessions',
  'chat_context',
  'fuel_logging',
  'progress_views',
  'settings_overview',
]

export default function OnboardingHints({ hintId, title, body, position = 'bottom' }) {
  const [dismissed, setDismissed] = useState(true) // start hidden until checked
  const [visible, setVisible] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const { data: settings } = await supabase
        .from('athlete_settings')
        .select('hints_dismissed')
        .maybeSingle()

      if (cancelled) return

      const dismissed_map = settings?.hints_dismissed || {}
      if (dismissed_map[hintId]) {
        setDismissed(true)
        return
      }

      setDismissed(false)
      timerRef.current = setTimeout(() => {
        if (!cancelled) setVisible(true)
      }, 1000)
    }

    check()
    return () => {
      cancelled = true
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [hintId])

  async function dismissOne() {
    setVisible(false)
    setDismissed(true)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' })
    const { data: settings } = await supabase
      .from('athlete_settings')
      .select('hints_dismissed')
      .maybeSingle()
    const existing = settings?.hints_dismissed || {}
    await supabase
      .from('athlete_settings')
      .update({ hints_dismissed: { ...existing, [hintId]: today } })
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
  }

  async function dismissAll() {
    setVisible(false)
    setDismissed(true)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' })
    const allDismissed = {}
    ALL_HINT_IDS.forEach(id => { allDismissed[id] = today })
    await supabase
      .from('athlete_settings')
      .update({ hints_dismissed: allDismissed })
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id)
  }

  if (dismissed || !visible) return null

  return (
    <div style={{
      position: 'fixed',
      [position === 'top' ? 'top' : 'bottom']: position === 'top' ? 64 : 80,
      left: 16,
      right: 16,
      maxWidth: 398,
      zIndex: 200,
      background: Z.surface,
      borderRadius: 10,
      borderLeft: `3px solid ${Z.accent}`,
      padding: '14px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      fontFamily: "'DM Mono', monospace",
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{ color: Z.accent, fontSize: 14, flexShrink: 0, marginTop: 1 }}>ⓘ</span>
        <div>
          <div style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 700,
            fontSize: 13, color: Z.text, marginBottom: 4,
          }}>
            {title}
          </div>
          <div style={{ fontSize: 11, color: Z.muted, lineHeight: 1.6 }}>
            {body}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <button
          onClick={dismissAll}
          style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }}
        >
          Skip all
        </button>
        <button
          onClick={dismissOne}
          style={{ background: Z.accent, border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 11, fontWeight: 600, color: '#0a0a0a', cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
