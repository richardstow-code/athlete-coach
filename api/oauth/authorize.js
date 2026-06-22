// oauth/authorize.js — OAuth 2.1 consent page (Path B, ruling #2).
//
// Supabase's OAuth server redirects the user here (Dashboard: Authentication →
// OAuth Server → Authorization Path = /oauth/authorize; Site URL = this app) with
// ?authorization_id=<id>. We REQUIRE a Supabase login before the approve action
// (this is the control that makes Dynamic Client Registration safe — an attacker
// can self-register a client but cannot approve without Richard's session).
// Single-user, minimal. Uses supabase-js auth.oauth: getAuthorizationDetails /
// approveAuthorization / denyAuthorization, then redirects to data.redirect_url.
//
// AC-156: the consent screen now shows WHICH account is about to be authorized
// ("Signed in as <email>") and offers an account switch, and the session is
// re-validated against the server (getUser) before consent — so a stale/wrong
// cached session on this origin can no longer silently authorize the wrong
// account (the IBM work account vs the hotmail athlete account incident).

export const config = { maxDuration: 10 };

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';

export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_KEY || '';
  const cfg = JSON.stringify({ url: SUPABASE_URL, anon });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // No framing; this page handles credentials.
  res.setHeader('X-Frame-Options', 'DENY');
  res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Coach Claude — Authorize</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#0a0a0a;background:#ffffff}
  .card{border:1px solid #e5e5e5;border-radius:12px;padding:1.5rem}
  h1{font-size:1.2rem} .muted{color:#666;font-size:.9rem}
  button{font-size:1rem;padding:.6rem 1rem;border-radius:8px;border:0;cursor:pointer;margin-right:.5rem}
  .approve{background:#14b8a6;color:#fff}.deny{background:#f1f1f1;color:#0a0a0a}
  a{color:#14b8a6;cursor:pointer}
  .acct{margin:.2rem 0 1rem;padding:.6rem .75rem;background:#f5f5f5;border-radius:8px}
  input{width:100%;padding:.5rem;margin:.3rem 0;border:1px solid #ccc;border-radius:8px}
  ul{padding-left:1.1rem}
</style></head>
<body><div class="card" id="root">Loading…</div>
<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CFG = ${cfg};
const root = document.getElementById('root');
const params = new URLSearchParams(location.search);
const authorizationId = params.get('authorization_id'); // module-level: preserved across login<->consent renders
const sb = createClient(CFG.url, CFG.anon);

function h(html){ root.innerHTML = html; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// getSession() only reads the LOCAL cache, which can be stale/expired and would
// then fail at approve time. Re-validate against the server with getUser(): if it
// does not resolve a real user, return null so we fall through to the login form
// instead of showing a consent screen for an unusable session.
async function currentUser(){
  const { data:{ session } } = await sb.auth.getSession();
  if(!session) return null;
  const { data:{ user }, error } = await sb.auth.getUser();
  if(error || !user) return null;
  return user;
}

async function main(){
  if(!authorizationId){ h('<h1>Missing authorization request</h1><p class="muted">No authorization_id in the URL.</p>'); return; }
  const user = await currentUser();
  if(!user){ renderLogin(); return; }
  await renderConsent(user);
}

function renderLogin(){
  h('<h1>Sign in to authorize</h1>'+
    '<p class="muted">Log in to the Coach Claude account that owns your training data to approve this connection.</p>'+
    '<input id="email" type="email" placeholder="email" autocomplete="username">'+
    '<input id="password" type="password" placeholder="password" autocomplete="current-password">'+
    '<p id="err" class="muted"></p>'+
    '<button class="approve" id="login">Sign in</button>');
  document.getElementById('login').onclick = async () => {
    const email=document.getElementById('email').value, password=document.getElementById('password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ document.getElementById('err').textContent = error.message; return; }
    const user = await currentUser();
    if(!user){ document.getElementById('err').textContent = 'Signed in, but no active session resolved — please try again.'; return; }
    await renderConsent(user); // SAME authorizationId (module const) — never dropped on the login round-trip
  };
}

async function renderConsent(user){
  const { data, error } = await sb.auth.oauth.getAuthorizationDetails(authorizationId);
  if(error){ h('<h1>Authorization error</h1><p class="muted">'+esc(error.message)+'</p>'); return; }
  if(data && data.redirect_url && !data.authorization_id){ location.href = data.redirect_url; return; } // already consented
  const name = (data && data.client && data.client.name) || 'An application';
  const scopes = (data && data.scope ? String(data.scope).split(' ').filter(Boolean) : []);
  h('<h1>Authorize '+esc(name)+'?</h1>'+
    '<div class="acct">Signed in as <strong>'+esc(user.email)+'</strong><br>'+
      '<a id="switch">Not you? Use a different account</a></div>'+
    '<p class="muted">'+esc(name)+' is requesting access to your Coach Claude training data.</p>'+
    (scopes.length? '<p>Requested scopes:</p><ul>'+scopes.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
    '<p id="err" class="muted"></p>'+
    '<button class="approve" id="approve">Approve</button>'+
    '<button class="deny" id="deny">Deny</button>');
  document.getElementById('approve').onclick = () => decide('approve');
  document.getElementById('deny').onclick = () => decide('deny');
  document.getElementById('switch').onclick = async (e) => {
    if(e && e.preventDefault) e.preventDefault();
    await sb.auth.signOut();   // clear the cached session for this origin
    renderLogin();             // back to the login form; authorizationId is preserved
  };
}

async function decide(kind){
  const fn = kind==='approve' ? sb.auth.oauth.approveAuthorization : sb.auth.oauth.denyAuthorization;
  const { data, error } = await fn.call(sb.auth.oauth, authorizationId);
  if(error){ document.getElementById('err').textContent = error.message; return; }
  if(data && data.redirect_url){ location.href = data.redirect_url; }
}

main().catch(e => h('<h1>Unexpected error</h1><p class="muted">'+esc(e.message)+'</p>'));
</script></body></html>`);
}
