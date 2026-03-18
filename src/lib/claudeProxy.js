import { supabase } from './supabase'

export async function callClaude({ model, max_tokens, system, messages }) {
  const { data, error } = await supabase.functions.invoke('claude-proxy', {
    body: { model, max_tokens, system, messages },
  })
  if (error) throw error
  if (data?.type === 'error') {
    throw new Error(data.error?.message || JSON.stringify(data.error))
  }
  return data
}
