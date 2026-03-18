import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function usePrimarySport() {
  const [primarySport, setPrimarySport] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('athlete_sports')
      .select('*')
      .eq('is_active', true)
      .order('created_at')
      .then(({ data }) => {
        const primary = data?.find(s => s.priority === 'primary') || data?.[0] || null
        setPrimarySport(primary)
        setLoading(false)
      })
  }, [])

  return { primarySport, loading }
}
