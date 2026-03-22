import { createClient } from '@supabase/supabase-js'

const TEST_SUPABASE_URL = process.env.TEST_SUPABASE_URL || 'https://nvoqqhaybhswdqcjyaws.supabase.co'
const TEST_SUPABASE_SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_KEY

if (!TEST_SUPABASE_SERVICE_KEY) {
  throw new Error('TEST_SUPABASE_SERVICE_KEY environment variable is required for test DB access')
}

export const testDb = createClient(TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
})
