import { useState, useEffect } from 'react'
import { supabase } from './supabase'

export function usePrimarySport() {
  const [primarySport, setPrimarySport] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id
      if (!uid) { setLoading(false); return }
      supabase
        .from('athlete_sports')
        .select('*')
        .eq('user_id', uid)
        .eq('is_active', true)
        .order('created_at')
        .then(({ data }) => {
          const primary = data?.find(s => s.priority === 'primary') || data?.[0] || null
          setPrimarySport(primary)
          setLoading(false)
        })
    })
  }, [])

  return { primarySport, loading }
}
