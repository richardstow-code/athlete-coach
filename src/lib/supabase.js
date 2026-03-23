import { createClient } from '@supabase/supabase-js'

const isTestMode = import.meta.env.VITE_TEST_MODE === 'true'

const SUPABASE_URL = isTestMode
  ? import.meta.env.VITE_TEST_SUPABASE_URL
  : import.meta.env.VITE_SUPABASE_URL

const SUPABASE_KEY = isTestMode
  ? import.meta.env.VITE_TEST_SUPABASE_KEY
  : import.meta.env.VITE_SUPABASE_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { flowType: 'implicit' },
})
