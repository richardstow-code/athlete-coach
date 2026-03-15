import { useState, useEffect } from 'react'
import { supabase } from './supabase'

let cache = null

export function useSettings() {
  const [settings, setSettings] = useState(cache || {
    tone: 50, consequences: 50, detail_level: 50, coaching_reach: 50,
    name: '', races: []
  })

  useEffect(() => {
    if (cache) return
    supabase.from('athlete_settings').select('*').eq('id', 1).single()
      .then(({ data }) => { if (data) { cache = data; setSettings(data) } })
  }, [])

  return settings
}

export function buildSystemPrompt(settings, context = 'general') {
  const tone = settings.tone ?? 50
  const consequences = settings.consequences ?? 50
  const detail = settings.detail_level ?? 50
  const reach = settings.coaching_reach ?? 50
  const name = settings.name ? `The athlete's name is ${settings.name}. ` : ''

  // Tone
  const toneStr = tone < 25
    ? 'Be brutally direct. No softening. Call out problems bluntly without apology.'
    : tone < 50
    ? 'Be direct and honest. Say what needs to be said without excessive padding.'
    : tone < 75
    ? 'Be encouraging but clear. Balance honesty with motivation.'
    : 'Be supportive and warm with a slightly British tone — firm but never harsh, old chap.'

  // Consequences
  const consequencesStr = consequences < 25
    ? 'Keep tone light. Encouragement over alarm.'
    : consequences < 50
    ? 'Mention risks clearly but without drama.'
    : consequences < 75
    ? 'Be direct about consequences. Make it clear what is at stake.'
    : 'Paint the full picture of consequences. Missed sessions, bad habits — make the stakes visceral and real relative to Munich.'

  // Detail
  const detailStr = detail < 25
    ? 'Keep responses very short — one key insight maximum. No elaboration.'
    : detail < 50
    ? 'Give a concise summary with one supporting detail.'
    : detail < 75
    ? 'Provide a solid analysis with specific numbers and clear reasoning.'
    : 'Give deep, thorough analysis. Reference specific splits, HR values, zone percentages, and physiological implications.'

  // Reach
  const reachStr = reach < 25
    ? 'Focus exclusively on running and strength training. Do not comment on nutrition or lifestyle.'
    : reach < 50
    ? 'Focus on training. Mention nutrition only when directly relevant to performance.'
    : reach < 75
    ? 'Cover training and nutrition together. Reference calorie burn, fuelling, and recovery.'
    : 'Coach the full athlete — training, nutrition, sleep, alcohol, stress. Everything connects to Munich.'

  const races = settings.races?.length > 0
    ? `Upcoming races: ${settings.races.map(r => `${r.name} (${r.date}, ${r.distance}km, target ${r.target})`).join(', ')}. `
    : 'Target race: Munich Marathon 12 October 2026, target 3:10 to sub-3:00. '

  return `You are a personal running and fitness coach. ${name}${races}Male athlete, 38yo, 79kg, 180cm. Currently Week 2 base build phase. Training zones: Z2=125-140bpm, Z3=140-158, Z4=158-172.

Tone: ${toneStr}
Consequences: ${consequencesStr}  
Detail level: ${detailStr}
Coaching scope: ${reachStr}

Always be specific — reference actual numbers from the athlete's data. Never be generic.`
}
