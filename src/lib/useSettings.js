import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useSettings() {
  const [settings, setSettings] = useState({
    tone: 50, consequences: 50, detail_level: 50, coaching_reach: 50,
    name: '', races: [],
    goal_type: null, sport: null, sport_other: null,
    target_type: null, target_event_name: null, target_date: null,
    target_description: null, current_level: null,
    health_notes: null, lifecycle_state: null,
  })

  useEffect(() => {
    supabase.from('athlete_settings').select('*').maybeSingle()
      .then(({ data }) => { if (data) setSettings(data) })
  }, [])

  return settings
}
