export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { model, max_tokens, system, messages } = req.body

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    })

    const data = await resp.json()
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json({ ...data, _status: resp.status })
  } catch (err) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json({
      type: 'error',
      error: { type: 'proxy_error', message: err.message },
    })
  }
}
