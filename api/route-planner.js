export const config = { maxDuration: 30 }

const GRAPHHOPPER_BASE = 'https://graphhopper.com/api/1'

// AC-139: Map native-app sport values to GraphHopper profile names.
// Trail runs and hikes get the 'hike' profile so off-road trail networks
// are preferred — 'foot' returns urban-pavement-only routes which fail
// for hill / forest workouts.
function ghProfile(vehicle) {
  switch (vehicle) {
    case 'bike':
    case 'ride': return 'bike'
    case 'mtb':  return 'mtb'
    case 'car':  return 'car'
    case 'hike':
    case 'trail':
    case 'trailrun':
    case 'trail_run': return 'hike'
    default:     return 'foot'   // run, walk, unknown
  }
}

async function handleRoute(body, res) {
  const { points, vehicle = 'foot', elevation = false } = body

  if (!points || !Array.isArray(points) || points.length < 2) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(400).json({ error: 'points must be an array of at least 2 [lat, lng] pairs' })
  }

  const apiKey = process.env.GRAPHHOPPER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GRAPHHOPPER_API_KEY not configured' })
  }

  // GraphHopper route endpoint expects [lng, lat] order
  const ghPoints = points.map(([lat, lng]) => [lng, lat])

  const requestedProfile = ghProfile(vehicle)

  async function callGraphHopper(profile) {
    return fetch(`${GRAPHHOPPER_BASE}/route?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: ghPoints,
        profile,
        locale: 'en',
        points_encoded: false,
        elevation,
      }),
    })
  }

  let resp = await callGraphHopper(requestedProfile)
  let usedProfile = requestedProfile
  let fallbackUsed = false

  // AC-139: hike profile can return empty for purely urban inputs that
  // have no trails within range. Retry once with 'foot' and surface a
  // fallback flag so the client can show a heads-up.
  if ((!resp.ok || resp.status === 400) && requestedProfile === 'hike') {
    const detail = await resp.text().catch(() => '')
    console.warn('[route-planner] hike profile failed, retrying as foot', detail)
    resp = await callGraphHopper('foot')
    usedProfile = 'foot'
    fallbackUsed = true
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(502).json({ error: `GraphHopper routing failed: ${resp.status}`, detail })
  }

  const ghData = await resp.json()
  const path = ghData.paths?.[0]
  if (!path) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(502).json({ error: 'No route found' })
  }

  // coordinates are [lng, lat, elev?] from GraphHopper
  const polyline = path.points?.coordinates ?? []

  res.setHeader('Access-Control-Allow-Origin', '*')
  return res.status(200).json({
    polyline,
    distance_m: path.distance ?? 0,
    elevation_gain_m: path.ascend ?? 0,
    profile_used: usedProfile,
    fallback_profile: fallbackUsed,
  })
}

async function handleGeocode(body, res) {
  const { lat, lng } = body

  if (lat == null || lng == null) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(400).json({ error: 'lat and lng are required' })
  }

  const apiKey = process.env.GRAPHHOPPER_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: 'GRAPHHOPPER_API_KEY not configured' })
  }

  const url = `${GRAPHHOPPER_BASE}/geocode?reverse=true&point=${lat},${lng}&locale=en&limit=1&key=${apiKey}`
  const resp = await fetch(url)

  if (!resp.ok) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(200).json({ name: null, city: null, place_name: null, nearest_feature: null, region: null })
  }

  const ghData = await resp.json()
  const hit = ghData.hits?.[0] ?? {}

  const name = hit.name ?? null
  const city = hit.city ?? hit.county ?? null
  const region = hit.state ?? hit.country ?? null

  res.setHeader('Access-Control-Allow-Origin', '*')
  return res.status(200).json({
    name,
    city,
    place_name: name ?? city,
    nearest_feature: name,
    region,
  })
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    return res.status(200).end()
  }

  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const body = req.body ?? {}
  const { action } = body

  try {
    if (action === 'route') return await handleRoute(body, res)
    if (action === 'geocode') return await handleGeocode(body, res)
    return res.status(400).json({ error: `Unknown action: ${action ?? '(none)'}` })
  } catch (err) {
    console.error('[route-planner]', err)
    return res.status(500).json({ error: err.message })
  }
}
