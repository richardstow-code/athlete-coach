import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function ResetPasswordScreen({ onComplete }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const inputStyle = {
    background: '#111111',
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 8,
    padding: '12px 14px',
    color: '#f0ede8',
    fontFamily: "'DM Mono', monospace",
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setLoading(true)
    setError('')
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) {
      setError(updateError.message)
    } else {
      setSuccess(true)
      setTimeout(() => onComplete(), 2000)
    }
  }

  return (
    <div style={{
      height: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0a0a0a',
      padding: '0 32px',
      fontFamily: "'DM Mono', monospace",
    }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 28, color: '#e8ff47', letterSpacing: '-1px', marginBottom: 48 }}>
        COACH
      </div>
      <div style={{ width: '100%', maxWidth: 340 }}>
        {success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#e8ff47', marginBottom: 8 }}>Password updated!</div>
            <div style={{ fontSize: 11, color: '#888580' }}>You're now logged in.</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 11, color: '#888580', letterSpacing: '0.08em', marginBottom: 4 }}>
              Set new password
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="New password"
              required
              autoComplete="new-password"
              style={inputStyle}
            />
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm password"
              required
              autoComplete="new-password"
              style={inputStyle}
            />
            {error && <div style={{ fontSize: 11, color: '#ff5c5c' }}>{error}</div>}
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                background: loading ? '#1a1a1a' : '#e8ff47',
                border: 'none',
                borderRadius: 8,
                padding: '13px',
                fontFamily: "'DM Mono', monospace",
                fontSize: 13,
                fontWeight: 600,
                color: loading ? '#888580' : '#0a0a0a',
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'Updating...' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
