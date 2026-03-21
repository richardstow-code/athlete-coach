import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const Z = {
  bg: '#0a0a0a',
  surface: '#111111',
  border: 'rgba(255,255,255,0.08)',
  accent: '#e8ff47',
  text: '#f0ede8',
  muted: '#888580',
}

function isNewerVersion(latest, lastSeen) {
  if (!lastSeen) return true
  const [lMaj, lMin, lPat] = latest.split('.').map(Number)
  const [sMaj, sMin, sPat] = lastSeen.split('.').map(Number)
  if (lMaj !== sMaj) return lMaj > sMaj
  if (lMin !== sMin) return lMin > sMin
  return lPat > sPat
}

function ReleaseHistoryModal({ onClose }) {
  const [releases, setReleases] = useState([])

  useEffect(() => {
    supabase
      .from('app_releases')
      .select('version, release_date, headline, changes')
      .order('release_date', { ascending: false })
      .then(({ data }) => setReleases(data || []))
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', flexDirection: 'column', background: Z.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: `1px solid ${Z.border}` }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color: Z.text, letterSpacing: '-0.5px' }}>
          RELEASE HISTORY
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: Z.muted, fontSize: 20, cursor: 'pointer', padding: 4 }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {releases.map(r => (
          <div key={r.version} style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: Z.accent }}>v{r.version}</div>
              <div style={{ fontSize: 11, color: Z.muted }}>{r.release_date}</div>
            </div>
            <div style={{ fontSize: 12, color: Z.text, marginBottom: 12 }}>{r.headline}</div>
            {(r.changes || []).map((c, i) => (
              <div key={i} style={{ marginBottom: 8, paddingLeft: 12, borderLeft: `2px solid ${Z.border}` }}>
                <div style={{ fontSize: 12, fontFamily: 'Syne, sans-serif', fontWeight: 600, color: Z.text, marginBottom: 2 }}>{c.title}</div>
                <div style={{ fontSize: 11, color: Z.muted, lineHeight: 1.5 }}>{c.description}</div>
              </div>
            ))}
          </div>
        ))}
        {releases.length === 0 && (
          <div style={{ fontSize: 12, color: Z.muted, textAlign: 'center', marginTop: 40 }}>No releases found</div>
        )}
      </div>
    </div>
  )
}

export default function ReleaseNotes({ userId }) {
  const [release, setRelease] = useState(null)
  const [show, setShow] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!userId) return

    async function check() {
      const [{ data: latest }, { data: settings }] = await Promise.all([
        supabase.from('app_releases').select('*').order('release_date', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('athlete_settings').select('last_seen_version').maybeSingle(),
      ])
      if (!latest) return
      const lastSeen = settings?.last_seen_version || null
      if (isNewerVersion(latest.version, lastSeen)) {
        setRelease(latest)
        setShow(true)
      }
    }

    check()
  }, [userId])

  async function handleDismiss() {
    if (!release) return
    setDismissed(true)
    setShow(false)
    await supabase
      .from('athlete_settings')
      .update({ last_seen_version: release.version })
      .eq('user_id', userId)
  }

  if (!show || !release || dismissed) return null

  if (showHistory) {
    return <ReleaseHistoryModal onClose={() => setShowHistory(false)} />
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex', alignItems: 'flex-end',
      fontFamily: "'DM Mono', monospace",
    }}>
      <div style={{
        width: '100%', maxWidth: 430, margin: '0 auto',
        background: Z.bg,
        borderRadius: '16px 16px 0 0',
        maxHeight: '85dvh',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div style={{ padding: '12px 20px 16px', borderBottom: `1px solid ${Z.border}` }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20, color: Z.text, letterSpacing: '-0.5px', marginBottom: 4 }}>
            WHAT'S NEW IN v{release.version}
          </div>
          <div style={{ fontSize: 12, color: Z.muted }}>{release.headline}</div>
        </div>

        {/* Changes list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {(release.changes || []).map((change, i) => (
            <div key={i} style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, color: Z.text }}>
                  {change.title}
                </div>
                {change.tab && (
                  <div style={{
                    background: Z.accent, color: Z.bg,
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                    borderRadius: 4, padding: '2px 6px',
                    fontFamily: "'DM Mono', monospace",
                  }}>
                    {change.tab.toUpperCase()}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: Z.muted, lineHeight: 1.6 }}>{change.description}</div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '16px 20px', borderTop: `1px solid ${Z.border}`, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button
            onClick={handleDismiss}
            style={{
              width: '100%', padding: '14px',
              background: Z.accent, border: 'none', borderRadius: 10,
              fontFamily: "'DM Mono', monospace", fontSize: 13, fontWeight: 600,
              color: Z.bg, cursor: 'pointer',
            }}
          >
            Got it
          </button>
          <button
            onClick={() => setShowHistory(true)}
            style={{
              background: 'none', border: 'none',
              color: Z.muted, fontSize: 11,
              cursor: 'pointer', fontFamily: "'DM Mono', monospace",
              textDecoration: 'underline', textAlign: 'center',
            }}
          >
            See all release history
          </button>
        </div>
      </div>
    </div>
  )
}
