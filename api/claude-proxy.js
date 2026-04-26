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

  // AC-144 P2: pass `tools` and `tool_choice` through so the coach
  // chat surface can use propose_schedule_change. Other fields are
  // unchanged.
  const { model, max_tokens, system, messages, tools, tool_choice } = req.body

  try {
    const body = { model, max_tokens, system, messages }
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools
    if (tool_choice) body.tool_choice = tool_choice

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
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
