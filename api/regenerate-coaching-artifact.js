// regenerate-coaching-artifact.js — server-side regeneration of stored
// coaching artifacts when their source state changes (Adaptive Coaching
// Brain · Phase 2 · Track B / B1, Option 1).
//
// SCOPE: COACH'S TAKE ONLY. The morning briefing is regenerated
// CLIENT-SIDE (its prompt builder lives in the native bundle —
// lib/athleteContext.ts buildBriefingPromptParts); the server only marks
// daily_briefings.regen_status='stale' and the app regenerates on next
// open. So this route deliberately rejects artifact='morning_briefing'.
//
// INVOCATION: a Supabase AFTER trigger (architect-owned) recomputes the
// Coach's-Take source fingerprint on activity completion / enrichment /
// benchmark-outcome / schedule change; on a fingerprint change it sets
// regen_status='stale' and pg_net POSTs here, mirroring
// trg_analyze_activity_on_complete — shared secret in the
// `x-analyze-secret` header (the existing Vault secret
// 'analyze_activity_secret'), NEVER in the URL/query string.
//
// This reuses the EXISTING Coach's-Take generation path from
// claude-proxy.js (get_athlete_coaching_context →
// buildCoachTakeSystemPrompt → coaching_memory) so first-generation and
// regeneration produce identical artifact shapes — only the freshness
// bookkeeping (fingerprint / regen_status / regenerated_at, stored on
// activities.raw_data) is added here.

import {
  callRPC,
  buildCoachTakeSystemPrompt,
  buildAuditFromContext,
} from './claude-proxy.js';

export const config = { maxDuration: 30 };

const SUPABASE_URL = 'https://yjuhzmknabedjklsgbje.supabase.co';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function sbHeaders(extra) {
  return {
    'Content-Type': 'application/json',
    apikey: process.env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
    ...(extra || {}),
  };
}

function viennaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Vienna' });
}

// Read the activity's current owner + raw_data so we can MERGE the freshness
// bookkeeping rather than clobber raw_data (PostgREST PATCH replaces the whole
// jsonb column).
async function fetchActivity(activityId) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/activities?id=eq.${activityId}&select=id,user_id,raw_data,coach_analysis`,
    { headers: sbHeaders() }
  );
  if (!resp.ok) return null;
  const rows = await resp.json().catch(() => null);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// Merge-patch activities.raw_data with the Coach's-Take freshness fields.
// Preserves any existing raw_data (incl. coach_take_audit, duplicate_of, …).
async function patchTakeFreshness(activityId, currentRawData, fields) {
  const merged = { ...(currentRawData && typeof currentRawData === 'object' ? currentRawData : {}), ...fields };
  await fetch(`${SUPABASE_URL}/rest/v1/activities?id=eq.${activityId}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ raw_data: merged }),
  }).catch(() => {});
}

// Insert the regenerated take with the SAME shape claude-proxy.js writes on
// first generation (type='activity_feedback', category='feedback',
// source='activity-trigger', activity_id = activities.id). The activity-detail
// read takes the newest row by created_at, so a fresh insert supersedes the
// stale take on read.
async function insertCoachTake({ userId, activityId, content }) {
  await fetch(`${SUPABASE_URL}/rest/v1/coaching_memory`, {
    method: 'POST',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({
      user_id: userId,
      activity_id: activityId,
      type: 'activity_feedback',
      source: 'activity-trigger',
      category: 'feedback',
      content,
      date: viennaToday(),
    }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-analyze-secret, x-regen-secret');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Shared-secret auth (mirror analyze-activity; reuse the same Vault
  // secret 'analyze_activity_secret' → process.env.ANALYZE_ACTIVITY_SECRET).
  const secret = req.headers['x-analyze-secret'] || req.headers['X-Analyze-Secret']
    || req.headers['x-regen-secret'] || req.headers['X-Regen-Secret'];
  if (!process.env.ANALYZE_ACTIVITY_SECRET || secret !== process.env.ANALYZE_ACTIVITY_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const {
    artifact = 'coach_take',
    activity_id,
    user_id: bodyUserId,
    fingerprint,
    reason,
  } = req.body || {};

  // Briefing is client-driven (Option 1) — never server-regenerated here.
  if (artifact === 'morning_briefing' || artifact === 'briefing') {
    return res.status(400).json({
      error: 'morning_briefing is client-driven; mark daily_briefings.regen_status=\'stale\' instead',
      artifact,
    });
  }
  if (artifact !== 'coach_take') {
    return res.status(400).json({ error: `unsupported artifact: ${artifact}` });
  }
  if (!activity_id) {
    return res.status(400).json({ error: 'activity_id required for coach_take' });
  }

  const activity = await fetchActivity(activity_id);
  if (!activity) {
    return res.status(404).json({ error: `activity ${activity_id} not found` });
  }
  const userId = bodyUserId || activity.user_id;
  if (!userId) {
    return res.status(400).json({ error: 'could not resolve user_id for activity' });
  }

  // Mark in-flight so concurrent triggers don't double-fire.
  await patchTakeFreshness(activity_id, activity.raw_data, {
    coach_take_regen_status: 'regenerating',
  });

  try {
    // Re-run the EXISTING Coach's-Take path: canonical context → system prompt.
    const ctxResp = await callRPC('get_athlete_coaching_context', {
      p_user_id: userId,
      p_surface_type: 'activity_feedback',
      p_activity_id: activity_id,
    });
    if (!ctxResp.ok || !ctxResp.data) {
      throw new Error(`context fetch failed: ${ctxResp.status}`);
    }

    const ctx = ctxResp.data;
    const enrichedSystem = buildCoachTakeSystemPrompt(ctx);
    const audit = buildAuditFromContext(ctx);

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: enrichedSystem,
        messages: [{ role: 'user', content: 'Write the Coach\'s Take for the activity above.' }],
      }),
    });
    const data = await upstream.json();
    const text = (data?.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
      .trim();

    if (!text) {
      throw new Error('empty regeneration from model');
    }

    // Success: write the new take, then flip freshness bookkeeping to 'fresh'.
    await insertCoachTake({ userId, activityId: activity_id, content: text });
    await patchTakeFreshness(activity_id, activity.raw_data, {
      coach_take_audit: audit,
      coach_take_fingerprint: fingerprint ?? null,
      coach_take_regen_status: 'fresh',
      coach_take_regenerated_at: new Date().toISOString(),
    });

    return res.status(200).json({
      ok: true,
      artifact: 'coach_take',
      activity_id,
      regen_status: 'fresh',
      regenerated_at: new Date().toISOString(),
      _audit: audit,
      _reason: reason ?? null,
    });
  } catch (err) {
    // Failure: KEEP the prior content (never blank the artifact); record error.
    await patchTakeFreshness(activity_id, activity.raw_data, {
      coach_take_regen_status: 'error',
    });
    return res.status(500).json({
      ok: false,
      artifact: 'coach_take',
      activity_id,
      regen_status: 'error',
      error: err.message,
    });
  }
}
