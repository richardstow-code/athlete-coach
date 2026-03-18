import React, { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

function Login() {
  const [mode, setMode] = useState('signin') // 'signin' | 'signup' | 'reset' | 'check_email'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const inputStyle = { background: '#111', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, padding: '12px 14px', color: '#f0ede8', fontFamily: "'DM Mono', monospace", fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' }
  const linkStyle = { background: 'none', border: 'none', color: '#888580', fontSize: 11, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: 0, textDecoration: 'underline' }

  function switchMode(m) { setMode(m); setError(null) }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)

    } else if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setError(error.message)
      else setMode('check_email')

    } else if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (error) setError(error.message)
      else setMode('check_email')
    }

    setLoading(false)
  }

  if (mode === 'check_email') {
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '0 32px', fontFamily: "'DM Mono', monospace" }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 28, color: '#e8ff47', letterSpacing: '-1px', marginBottom: 48 }}>COACH</div>
        <div style={{ width: '100%', maxWidth: 340, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: '#f0ede8', marginBottom: 10 }}>Check your email</div>
          <div style={{ fontSize: 11, color: '#888580', lineHeight: 1.6, marginBottom: 24 }}>
            We sent a link to <span style={{ color: '#f0ede8' }}>{email}</span>.<br />
            Click it to continue.
          </div>
          <button onClick={() => switchMode('signin')} style={linkStyle}>Back to sign in</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0a0a0a', padding: '0 32px', fontFamily: "'DM Mono', monospace" }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 28, color: '#e8ff47', letterSpacing: '-1px', marginBottom: 48 }}>COACH</div>
      <form onSubmit={handleSubmit} style={{ width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mode !== 'reset' && (
          <div style={{ fontSize: 11, color: '#888580', letterSpacing: '0.08em', marginBottom: 4 }}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </div>
        )}
        {mode === 'reset' && (
          <div style={{ fontSize: 11, color: '#888580', letterSpacing: '0.08em', marginBottom: 4 }}>Reset password</div>
        )}
        <input
          type="email" value={email} onChange={e => setEmail(e.target.value)}
          placeholder="Email" required autoComplete="email"
          style={inputStyle}
        />
        {mode !== 'reset' && (
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Password" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            style={inputStyle}
          />
        )}
        {error && <div style={{ fontSize: 11, color: '#ff5c5c' }}>{error}</div>}
        <button type="submit" disabled={loading} style={{ marginTop: 4, background: loading ? '#1a1a1a' : '#e8ff47', border: 'none', borderRadius: 8, padding: '13px', fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600, color: loading ? '#888580' : '#0a0a0a', cursor: loading ? 'wait' : 'pointer' }}>
          {loading
            ? (mode === 'signin' ? 'Signing in...' : mode === 'signup' ? 'Creating account...' : 'Sending...')
            : (mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link')}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          {mode === 'signin' && (
            <>
              <button type="button" onClick={() => switchMode('signup')} style={linkStyle}>Create account</button>
              <button type="button" onClick={() => switchMode('reset')} style={linkStyle}>Forgot password?</button>
            </>
          )}
          {mode === 'signup' && (
            <button type="button" onClick={() => switchMode('signin')} style={linkStyle}>Already have an account?</button>
          )}
          {mode === 'reset' && (
            <button type="button" onClick={() => switchMode('signin')} style={linkStyle}>Back to sign in</button>
          )}
        </div>
      </form>
    </div>
  )
}

import Home from './screens/Home'
import Chat from './screens/Chat'
import Plan from './screens/Plan'
import Progress from './screens/Stats'
import Nutrition from './screens/Nutrition'
import ActivityDetail from './screens/ActivityDetail'
import Settings from './screens/Settings'
import Onboarding from './screens/Onboarding'
import PostWorkoutPopup from './components/PostWorkoutPopup'
import PostEventModal from './components/PostEventModal'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  render() {
    if (this.state.hasError) return (
      <div style={{ padding: 24, color: '#ff5c5c', fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
        <div style={{ marginBottom: 8, color: '#e8ff47', fontWeight: 600 }}>Something went wrong</div>
        <div style={{ color: '#888580', fontSize: 11 }}>{this.state.error?.message}</div>
        <button onClick={() => this.setState({ hasError: false })} style={{ marginTop: 16, background: '#e8ff47', border: 'none', borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontFamily: "'DM Mono', monospace", fontSize: 12 }}>Retry</button>
      </div>
    )
    return this.props.children
  }
}


const TABS = [
  { id: 'home',      label: 'Home',  icon: '⌂' },
  { id: 'plan',      label: 'Plan',  icon: '◉' },
  { id: 'chat',      label: 'Chat',  icon: '◎' },
  { id: 'nutrition', label: 'Fuel',  icon: '◈' },
  { id: 'stats',     label: 'Progress', icon: '◫' },
]

const Z = {
  bg: '#0a0a0a',
  surface: '#111111',
  border: 'rgba(255,255,255,0.08)',
  accent: '#e8ff47',
  text: '#f0ede8',
  muted: '#888580',
}

export default function App() {
  const [session, setSession] = useState(undefined)
  const [needsOnboarding, setNeedsOnboarding] = useState(null) // null=checking, true/false
  const [postEventSettings, setPostEventSettings] = useState(null)
  const [activeTab, setActiveTab] = useState('home')
  const [detailId, setDetailId] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingChanges, setPendingChanges] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setSession(session))
    return () => subscription.unsubscribe()
  }, [])

  // Check onboarding state and post-event state together on session change
  useEffect(() => {
    if (!session) { setNeedsOnboarding(null); setPostEventSettings(null); return }
    supabase
      .from('athlete_settings')
      .select('lifecycle_state, target_date, goal_type, target_event_name, target_metric, sport_category, sport')
      .maybeSingle()
      .then(({ data }) => {
        const state = data?.lifecycle_state
        setNeedsOnboarding(!data || !state || state === 'onboarding')

        // Post-event: target_date has passed and athlete isn't already in recovery/what_next
        const today = new Date().toISOString().slice(0, 10)
        const targetPassed = data?.target_date && data.target_date < today
        const alreadyHandled = !state || ['onboarding', 'recovery', 'what_next'].includes(state)
        if (targetPassed && !alreadyHandled) {
          setPostEventSettings(data)
        }
      })
  }, [session])

  // Handle Strava OAuth callback (?code=...&scope=activity:read_all)
  useEffect(() => {
    if (!session) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const scope = params.get('scope')
    if (!code || !scope?.includes('activity')) return

    // Clean the URL immediately so a refresh doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname)

    supabase.functions.invoke('strava-exchange', {
      body: { code, redirect_uri: window.location.origin },
    }).then(({ error }) => {
      if (error) console.error('Strava exchange failed:', error)
      setShowSettings(true) // Return user to Settings to see the connected state
    })
  }, [session])

  // Check for pending schedule changes (badge on Plan tab)
  useEffect(() => {
    async function checkPending() {
      const { count } = await supabase
        .from('schedule_changes')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
      setPendingChanges(count || 0)
    }
    checkPending()
    const interval = setInterval(checkPending, 60000)
    return () => clearInterval(interval)
  }, [])

  function openActivity(id) { setDetailId(id) }
  function closeActivity() { setDetailId(null) }

  function navigate(tabId) {
    setActiveTab(tabId)
    setDetailId(null)
  }

  const loading = <div style={{ height: '100dvh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 28, color: '#e8ff47', letterSpacing: '-1px' }}>COACH</div>

  if (session === undefined) return loading
  if (session === null) return <Login />
  if (needsOnboarding === null) return loading
  if (needsOnboarding) return <Onboarding onComplete={() => setNeedsOnboarding(false)} />

  return (
    <div style={{
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      background: Z.bg,
      color: Z.text,
      fontFamily: "'DM Mono', monospace",
      overflow: 'hidden',
      maxWidth: 430,
      margin: '0 auto',
      position: 'relative',
    }}>

      {/* POST-WORKOUT POPUP */}
      <PostWorkoutPopup onViewDetail={(id) => { setShowSettings(false); setDetailId(id) }} />

      {/* POST-EVENT MODAL — shown once after target_date passes */}
      {postEventSettings && (
        <PostEventModal
          settings={postEventSettings}
          onComplete={(newState) => {
            setPostEventSettings(null)
            // Nudge the onboarding gate so lifecycle_state is re-evaluated if needed
            if (newState === 'what_next') setNeedsOnboarding(false)
          }}
        />
      )}

      {/* SETTINGS OVERLAY */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* TOP HEADER — slim, just logo + profile */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        height: '48px',
        flexShrink: 0,
        borderBottom: `1px solid ${Z.border}`,
        background: Z.bg,
      }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color: Z.accent, letterSpacing: '-0.5px' }}>
          COACH
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {detailId && (
            <button onClick={closeActivity} style={{ background: 'none', border: 'none', color: Z.accent, fontSize: 12, cursor: 'pointer', fontFamily: "'DM Mono', monospace", padding: '4px 8px' }}>
              ← Back
            </button>
          )}
          <button onClick={() => setShowSettings(true)} style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(232,255,71,0.12)',
            border: '1px solid rgba(232,255,71,0.25)',
            cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            👤
          </button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {detailId ? (
          <ActivityDetail stravaId={detailId} onBack={closeActivity} />
        ) : (
          <>
            {activeTab === 'home'      && <ErrorBoundary><Home onActivityClick={openActivity} /></ErrorBoundary>}
            {activeTab === 'chat'      && <ErrorBoundary><Chat /></ErrorBoundary>}
            {activeTab === 'plan'      && <ErrorBoundary><Plan onActivityClick={openActivity} /></ErrorBoundary>}
            {activeTab === 'stats'     && <ErrorBoundary><Progress onActivityClick={openActivity} /></ErrorBoundary>}
            {activeTab === 'nutrition' && <ErrorBoundary><Nutrition /></ErrorBoundary>}
          </>
        )}
      </main>

      {/* BOTTOM TAB BAR */}
      {!detailId && (
        <nav style={{
          display: 'flex',
          height: '64px',
          flexShrink: 0,
          borderTop: `1px solid ${Z.border}`,
          background: Z.surface,
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {TABS.map(t => {
            const isActive = activeTab === t.id
            const hasBadge = t.id === 'plan' && pendingChanges > 0
            return (
              <button key={t.id} onClick={() => navigate(t.id)} style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                gap: 3, position: 'relative',
                transition: 'all 0.15s',
              }}>
                {/* Active indicator bar */}
                {isActive && (
                  <div style={{
                    position: 'absolute', top: 0, left: '50%',
                    transform: 'translateX(-50%)',
                    width: 24, height: 2,
                    background: Z.accent, borderRadius: '0 0 2px 2px',
                  }} />
                )}
                {/* Badge */}
                {hasBadge && (
                  <div style={{
                    position: 'absolute', top: 8, right: 'calc(50% - 18px)',
                    width: 8, height: 8, borderRadius: '50%',
                    background: '#ff5c5c',
                  }} />
                )}
                <span style={{ fontSize: 18, lineHeight: 1, filter: isActive ? 'none' : 'opacity(0.4)' }}>
                  {t.icon}
                </span>
                <span style={{
                  fontSize: 10, letterSpacing: '0.05em',
                  color: isActive ? Z.accent : Z.muted,
                  fontWeight: isActive ? 600 : 400,
                }}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </nav>
      )}
    </div>
  )
}
