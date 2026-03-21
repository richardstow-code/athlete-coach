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
import WorkoutIngest from './screens/WorkoutIngest'
import HelpBot from './components/HelpBot'
import ReleaseNotes from './components/ReleaseNotes'
import Roadmap from './screens/Roadmap'

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
  const [profileIncomplete, setProfileIncomplete] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showWorkoutIngest, setShowWorkoutIngest] = useState(false)
  const [stravaConnecting, setStravaConnecting] = useState(false)
  const [stravaConnectError, setStravaConnectError] = useState(null)
  const [stravaConnected, setStravaConnected] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [showRoadmap, setShowRoadmap] = useState(false)
  const [showFeatureRequest, setShowFeatureRequest] = useState(false)
  const [showBugReport, setShowBugReport] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user?.id) setUserId(session.user.id)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user?.id) setUserId(session.user.id)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Check onboarding state and post-event state together on session change
  useEffect(() => {
    if (!session) { setNeedsOnboarding(null); setPostEventSettings(null); return }

    Promise.all([
      supabase.from('athlete_settings').select('goal_type, onboarding_complete').maybeSingle(),
      supabase.from('athlete_sports').select('*').eq('is_active', true).order('created_at'),
    ]).then(([{ data: settingsData }, { data: sportsData }]) => {
      // Guard: once set to false (by onComplete), never flip back due to a
      // session refresh firing before the DB write is visible.
      const notDone = settingsData?.onboarding_complete !== true
      setNeedsOnboarding(prev => prev === false ? false : notDone)

      setProfileIncomplete(!!settingsData && !settingsData.goal_type)

      // Post-event: find any sport whose target_date has passed and is not already handled
      const today = new Date().toISOString().slice(0, 10)
      const overdueSport = sportsData?.find(s =>
        s.target_date && s.target_date < today &&
        s.is_active &&
        !['recovery', 'what_next', 'maintenance'].includes(s.lifecycle_state)
      )
      if (overdueSport) {
        // Attach goal_type from settings so PostEventModal can use it
        setPostEventSettings({ ...overdueSport, goal_type: settingsData?.goal_type || null })
      }
    })
  }, [session])

  // Handle Strava OAuth callback (?code=...&scope=activity:read_all)
  useEffect(() => {
    if (!session) return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const scope = params.get('scope')
    // Also handle Strava errors (user denied)
    const stravaError = params.get('error')
    if (stravaError) {
      window.history.replaceState({}, '', window.location.pathname)
      setStravaConnectError('Strava authorisation was denied. Try connecting again.')
      setShowSettings(true)
      return
    }
    if (!code || !scope?.includes('activity')) return

    // Clean the URL immediately so a refresh doesn't re-trigger
    window.history.replaceState({}, '', window.location.pathname)
    setStravaConnecting(true)
    setStravaConnectError(null)

    // Explicitly get the session token — supabase.functions.invoke can race
    // on a fresh page load (post-OAuth redirect) and send the anon key instead
    supabase.auth.getSession().then(({ data: { session: sess } }) => {
      const jwt = sess?.access_token
      return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-exchange`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_KEY,
          ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}),
        },
        body: JSON.stringify({ code, redirect_uri: window.location.origin }),
      }).then(r => r.json())
    }).then(data => {
      setStravaConnecting(false)
      if (data?.error) {
        setStravaConnectError(data.error + (data.detail ? ` — ${data.detail}` : ''))
      } else {
        // Success — show confirmation banner and sync last 30 days
        setStravaConnected(true)
        setTimeout(() => setStravaConnected(false), 4000)
        // Explicitly get session JWT — same race-condition fix as strava-exchange
        supabase.auth.getSession().then(({ data: { session: sess } }) => {
          const jwt = sess?.access_token
          return fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_KEY,
              ...(jwt ? { 'Authorization': `Bearer ${jwt}` } : {}),
            },
            body: JSON.stringify({ after: Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000) }),
          })
        }).then(() => setRefreshKey(k => k + 1)).catch(e => console.warn('Background sync error:', e))
      }
      setShowSettings(true)
    }).catch(err => {
      setStravaConnecting(false)
      setStravaConnectError(err.message || 'Strava connection failed')
      setShowSettings(true)
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

  // Check for unseen feature notifications (badge on settings icon)
  useEffect(() => {
    if (!userId) return
    async function checkNotifs() {
      const { count } = await supabase
        .from('feature_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('seen', false)
      setNotifCount(count || 0)
    }
    checkNotifs()
    const interval = setInterval(checkNotifs, 120000)
    return () => clearInterval(interval)
  }, [userId])

  async function handleOpenRoadmap() {
    setShowRoadmap(true)
    // Mark all notifications as seen
    if (userId && notifCount > 0) {
      await supabase
        .from('feature_notifications')
        .update({ seen: true })
        .eq('user_id', userId)
        .eq('seen', false)
      setNotifCount(0)
    }
  }

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

      {/* RELEASE NOTES POPUP */}
      <ReleaseNotes userId={userId} />

      {/* HELP BOT — floating on all screens */}
      <HelpBot
        currentScreen={activeTab}
        onOpenRoadmap={handleOpenRoadmap}
        onOpenFeatureRequest={() => { setShowFeatureRequest(true); setShowRoadmap(true) }}
        onOpenBugReport={() => { setShowBugReport(true); setShowRoadmap(true) }}
      />

      {/* ROADMAP OVERLAY — also hosts feature request and bug report modals */}
      {showRoadmap && (
        <Roadmap
          onClose={() => { setShowRoadmap(false); setShowFeatureRequest(false); setShowBugReport(false) }}
          userId={userId}
          defaultShowRequest={showFeatureRequest}
          defaultShowBugReport={showBugReport}
        />
      )}

      {/* POST-WORKOUT POPUP */}
      <PostWorkoutPopup onViewDetail={(id) => { setShowSettings(false); setDetailId(id) }} />

      {/* POST-EVENT MODAL — shown once after target_date passes */}
      {postEventSettings && (
        <PostEventModal
          sportRow={postEventSettings}
          goalType={postEventSettings.goal_type}
          onComplete={(newState) => {
            setPostEventSettings(null)
            // Nudge the onboarding gate so lifecycle_state is re-evaluated if needed
            if (newState === 'what_next') setNeedsOnboarding(false)
          }}
        />
      )}

      {/* STRAVA CONNECTING OVERLAY */}
      {stravaConnecting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'DM Mono', monospace" }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🔗</div>
          <div style={{ fontSize: 14, color: '#f0ede8', marginBottom: 8 }}>Connecting Strava…</div>
          <div style={{ fontSize: 12, color: '#888580' }}>Exchanging authorisation token</div>
        </div>
      )}

      {/* STRAVA CONNECTED TOAST */}
      {stravaConnected && (
        <div style={{ position: 'fixed', top: 56, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: '#4dff91', color: '#0a0a0a', borderRadius: 20, padding: '8px 18px', fontSize: 12, fontFamily: "'DM Mono', monospace", fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}>
          ✓ Strava connected — syncing activities
        </div>
      )}

      {/* SETTINGS OVERLAY */}
      {showSettings && (
        <Settings
          onClose={() => { setShowSettings(false); setStravaConnectError(null) }}
          stravaConnectError={stravaConnectError}
          onLogout={() => setShowSettings(false)}
          onOpenRoadmap={() => { setShowSettings(false); handleOpenRoadmap() }}
          onOpenFeatureRequest={() => { setShowSettings(false); setShowFeatureRequest(true); setShowRoadmap(true) }}
        />
      )}

      {/* WORKOUT INGEST OVERLAY */}
      {showWorkoutIngest && <WorkoutIngest onClose={() => setShowWorkoutIngest(false)} />}

      {/* ONBOARDING OVERLAY — re-openable from "Complete profile" chip */}
      {showOnboarding && (
        <Onboarding onComplete={() => {
          setShowOnboarding(false)
          setProfileIncomplete(false)
          // Re-check settings to update profileIncomplete
        }} />
      )}

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
          {profileIncomplete && !showOnboarding && (
            <button
              onClick={() => setShowOnboarding(true)}
              style={{
                fontSize: 10, letterSpacing: '0.06em',
                background: 'rgba(255,183,71,0.15)',
                border: '1px solid rgba(255,183,71,0.4)',
                borderRadius: 20, padding: '4px 10px',
                color: '#ffb347', cursor: 'pointer',
                fontFamily: "'DM Mono', monospace",
              }}
            >
              Complete profile
            </button>
          )}
          <button onClick={() => setShowWorkoutIngest(true)} title="Log workout from photo" style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            cursor: 'pointer', fontSize: 15,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            📷
          </button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowSettings(true)} style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'rgba(232,255,71,0.12)',
              border: '1px solid rgba(232,255,71,0.25)',
              cursor: 'pointer', fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              👤
            </button>
            {notifCount > 0 && (
              <div style={{
                position: 'absolute', top: -2, right: -2,
                width: 14, height: 14, borderRadius: '50%',
                background: '#ff5c5c',
                fontSize: 9, fontWeight: 700, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'DM Mono', monospace",
              }}>
                {notifCount > 9 ? '9+' : notifCount}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {detailId ? (
          <ActivityDetail stravaId={detailId} onBack={closeActivity} />
        ) : (
          <>
            {activeTab === 'home'      && <ErrorBoundary><Home key={refreshKey} onActivityClick={openActivity} onOpenSettings={() => setShowSettings(true)} /></ErrorBoundary>}
            {activeTab === 'chat'      && <ErrorBoundary><Chat /></ErrorBoundary>}
            {activeTab === 'plan'      && <ErrorBoundary><Plan key={refreshKey} onActivityClick={openActivity} /></ErrorBoundary>}
            {activeTab === 'stats'     && <ErrorBoundary><Progress key={refreshKey} onActivityClick={openActivity} /></ErrorBoundary>}
            {activeTab === 'nutrition' && <ErrorBoundary><Nutrition key={refreshKey} /></ErrorBoundary>}
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
