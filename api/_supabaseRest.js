// _supabaseRest.js — tiny injectable Supabase REST client for the MCP server.
//
// Phase 1 (read-only) needs restGet + callRPC only. We deliberately do NOT
// import the module-local restGet/svcHeaders out of analyze-activity.js (they
// are not exported and we don't want to perturb the live analyze path). This
// is a 1:1 behavioural copy of those helpers (claude-proxy.js:43 callRPC,
// analyze-activity.js:39-54 svcHeaders/restGet) with two additions:
//   - base URL + service key are injectable (default to the same prod pin +
//     SUPABASE_SECRET_KEY the other api/ files use) so tests can point at the
//     test project without ever touching prod.
//   - restGet THROWS on a non-2xx response (with .status/.body) so tools can
//     surface a structured { error } instead of silently returning [].

const PROD_SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';

export function makeSupabaseRest({ baseUrl, serviceKey, fetchImpl, appBaseUrl, regenSecret } = {}) {
  const url = (baseUrl || process.env.SUPABASE_URL || PROD_SUPABASE_URL).replace(/\/$/, '');
  const key = serviceKey || process.env.SUPABASE_SECRET_KEY;
  const doFetch = fetchImpl || fetch;
  // Phase-3 outbound calls. appBase = this deployment's own origin (for sibling
  // Vercel API routes); regenSecretResolved = the shared x-analyze-secret.
  const appBase = (appBaseUrl || process.env.APP_BASE_URL || 'https://athlete-coach-alpha.vercel.app').replace(/\/$/, '');
  const regenSecretResolved = regenSecret || process.env.ANALYZE_ACTIVITY_SECRET || '';

  function headers(extra) {
    return {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(extra || {}),
    };
  }

  async function restGet(pathAndQuery) {
    const resp = await doFetch(`${url}/rest/v1/${pathAndQuery}`, { headers: headers() });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err = new Error(`restGet ${resp.status} on ${pathAndQuery}`);
      err.status = resp.status;
      err.body = body;
      throw err;
    }
    try {
      return await resp.json();
    } catch {
      return [];
    }
  }

  async function callRPC(fnName, body) {
    const resp = await doFetch(`${url}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await resp.json();
    } catch {
      /* non-JSON body */
    }
    return { ok: resp.ok, status: resp.status, data };
  }

  // INSERT/UPSERT. Returns the inserted/updated row(s) (Prefer return=representation).
  // Pass onConflict + merge:true for an upsert (resolution=merge-duplicates).
  async function restPost(table, body, { onConflict, merge = false } = {}) {
    const prefer = ['return=representation'];
    if (merge) prefer.push('resolution=merge-duplicates');
    const path = onConflict ? `${table}?on_conflict=${onConflict}` : table;
    const resp = await doFetch(`${url}/rest/v1/${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: prefer.join(',') }),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const b = await resp.text().catch(() => '');
      const e = new Error(`restPost ${resp.status} on ${table}`);
      e.status = resp.status;
      e.body = b;
      throw e;
    }
    try {
      return await resp.json();
    } catch {
      return [];
    }
  }

  // PATCH by query. Returns the updated row(s).
  async function restPatch(table, query, body) {
    const resp = await doFetch(`${url}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const b = await resp.text().catch(() => '');
      const e = new Error(`restPatch ${resp.status} on ${table}`);
      e.status = resp.status;
      e.body = b;
      throw e;
    }
    try {
      return await resp.json();
    } catch {
      return [];
    }
  }

  // Invoke a Supabase Edge Function. The service-role key is itself a valid JWT,
  // so this satisfies verify_jwt:true functions (e.g. generate-periodised-plan).
  // Returns { ok, status, data } — never throws (tools surface { error }).
  async function callEdgeFunction(slug, body) {
    try {
      const resp = await doFetch(`${url}/functions/v1/${slug}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body || {}),
      });
      let data = null;
      try { data = await resp.json(); } catch { /* non-JSON */ }
      return { ok: resp.ok, status: resp.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e.message };
    }
  }

  // POST the existing Coach's-Take regen route on THIS Vercel deployment
  // (api/regenerate-coaching-artifact.js), with the shared x-analyze-secret.
  // Returns { ok, status, data }.
  async function regenerateCoachingArtifact(body) {
    try {
      const resp = await doFetch(`${appBase}/api/regenerate-coaching-artifact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-analyze-secret': regenSecretResolved },
        body: JSON.stringify(body || {}),
      });
      let data = null;
      try { data = await resp.json(); } catch { /* non-JSON */ }
      return { ok: resp.ok, status: resp.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e.message };
    }
  }

  return { url, appBase, restGet, callRPC, restPost, restPatch, callEdgeFunction, regenerateCoachingArtifact };
}

export { PROD_SUPABASE_URL };
