import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function useSettings() {
  const [settings, setSettings] = useState({
    tone: 50, consequences: 50, detail_level: 50, coaching_reach: 50,
    name: '', races: [],
    goal_type: null, current_level: null, health_notes: null,
  })

  useEffect(() => {
    supabase.from('athlete_settings').select('*').maybeSingle()
      .then(({ data }) => { if (data) setSettings(data) })
  }, [])

  return settings
}
