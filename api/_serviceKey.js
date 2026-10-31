// _serviceKey.js — headers for server-side Supabase calls with the secret key.
//
// W0-D2 (#20): production moves from the legacy service_role JWT to an
// sb_secret_ key. The legacy key is a JWT and also rides on Authorization:
// Bearer (verify_jwt functions need it there). sb_secret_ keys are not JWTs and
// Supabase documents them as apikey-only, so the Bearer is sent only for a JWT.
// The same code works on both sides of the env swap.

export function serviceKeyHeaders(key = process.env.SUPABASE_SECRET_KEY) {
  if (key && key.startsWith('eyJ')) {
    return { apikey: key, Authorization: `Bearer ${key}` };
  }
  return { apikey: key };
}
