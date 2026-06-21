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

export function makeSupabaseRest({ baseUrl, serviceKey, fetchImpl } = {}) {
  const url = (baseUrl || process.env.SUPABASE_URL || PROD_SUPABASE_URL).replace(/\/$/, '');
  const key = serviceKey || process.env.SUPABASE_SECRET_KEY;
  const doFetch = fetchImpl || fetch;

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

  return { url, restGet, callRPC };
}

export { PROD_SUPABASE_URL };
