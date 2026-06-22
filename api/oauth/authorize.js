// oauth/authorize.js — OAuth 2.1 consent page (Path B, ruling #2).
//
// Supabase's OAuth server redirects the user here (Dashboard: Authentication →
// OAuth Server → Authorization Path = /oauth/authorize; Site URL = this app) with
// ?authorization_id=<id>. We REQUIRE a Supabase login before the approve action
// (this is the control that makes Dynamic Client Registration safe — an attacker
// can self-register a client but cannot approve without Richard's session).
// Single-user, minimal. Uses supabase-js auth.oauth: getAuthorizationDetails /
// approveAuthorization / denyAuthorization, then redirects to data.redirect_url.

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
  body{font-family:system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem;color:#111}
  .card{border:1px solid #ddd;border-radius:12px;padding:1.5rem}
  h1{font-size:1.2rem} .muted{color:#666;font-size:.9rem}
  button{font-size:1rem;padding:.6rem 1rem;border-radius:8px;border:0;cursor:pointer;margin-right:.5rem}
  .approve{background:#0a7;color:#fff}.deny{background:#eee}
  input{width:100%;padding:.5rem;margin:.3rem 0;border:1px solid #ccc;border-radius:8px}
  ul{padding-left:1.1rem}
</style></head>
<body><div class="card" id="root">Loading…</div>
<script type="module">
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CFG = ${cfg};
const root = document.getElementById('root');
const params = new URLSearchParams(location.search);
const authorizationId = params.get('authorization_id');
const sb = createClient(CFG.url, CFG.anon);

function h(html){ root.innerHTML = html; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function main(){
  if(!authorizationId){ h('<h1>Missing authorization request</h1><p class="muted">No authorization_id in the URL.</p>'); return; }
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){ renderLogin(); return; }
  await renderConsent();
}

function renderLogin(){
  h('<h1>Sign in to authorize</h1>'+
    '<p class="muted">Log in to your Coach Claude account to approve this connection.</p>'+
    '<input id="email" type="email" placeholder="email" autocomplete="username">'+
    '<input id="password" type="password" placeholder="password" autocomplete="current-password">'+
    '<p id="err" class="muted"></p>'+
    '<button class="approve" id="login">Sign in</button>');
  document.getElementById('login').onclick = async () => {
    const email=document.getElementById('email').value, password=document.getElementById('password').value;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){ document.getElementById('err').textContent = error.message; return; }
    await renderConsent();
  };
}

async function renderConsent(){
  const { data, error } = await sb.auth.oauth.getAuthorizationDetails(authorizationId);
  if(error){ h('<h1>Authorization error</h1><p class="muted">'+esc(error.message)+'</p>'); return; }
  if(data && data.redirect_url && !data.authorization_id){ location.href = data.redirect_url; return; } // already consented
  const name = (data && data.client && data.client.name) || 'An application';
  const scopes = (data && data.scope ? String(data.scope).split(/\s+/).filter(Boolean) : []);
  h('<h1>Authorize '+esc(name)+'?</h1>'+
    '<p class="muted">'+esc(name)+' is requesting access to your Coach Claude training data.</p>'+
    (scopes.length? '<p>Requested scopes:</p><ul>'+scopes.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>':'')+
    '<p id="err" class="muted"></p>'+
    '<button class="approve" id="approve">Approve</button>'+
    '<button class="deny" id="deny">Deny</button>');
  document.getElementById('approve').onclick = () => decide('approve');
  document.getElementById('deny').onclick = () => decide('deny');
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
