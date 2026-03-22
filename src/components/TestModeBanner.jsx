export default function TestModeBanner() {
  if (import.meta.env.VITE_TEST_MODE !== 'true') return null
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: '#7f1d1d',
      color: '#fecaca',
      textAlign: 'center',
      padding: '6px 12px',
      fontSize: 11,
      fontFamily: "'DM Mono', monospace",
      fontWeight: 600,
      letterSpacing: '0.05em',
      borderTop: '1px solid #991b1b',
    }}>
      ⚠ TEST MODE — test database active
    </div>
  )
}
