export async function callClaude({ model, max_tokens, system, messages }) {
  const resp = await fetch('/api/claude-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  })
  if (!resp.ok) throw new Error(`Proxy error: ${resp.status}`)
  const data = await resp.json()
  if (data?.type === 'error') {
    throw new Error(data.error?.message || JSON.stringify(data.error))
  }
  return data
}
