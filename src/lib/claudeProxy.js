import { supabase } from './supabase'

export async function callClaude({ model, max_tokens, system, messages }) {
  const { data, error } = await supabase.functions.invoke('claude-proxy', {
    body: { model, max_tokens, system, messages },
  })
  if (error) throw error
  return data
}
