/**
 * API tests: analyze-activity card redesign (v1.2) — schema/prompt/pace.
 * Tier @minor (`npm run test:api`). Pure-logic: pace formatter (the "5:73" bug),
 * grade bucket (method-leak fix), v1.2 normalize shape, and the SCHEMA_VERSION
 * fold into the #11 regen guard. LLM output quality is the AI-eval/behavioural gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtPace,
  gradeImpactBucket,
  coerceAnalysisShape,
  parseAnalysisJSON,
  shouldSkipRegen,
  SCHEMA_VERSION,
} from '../../api/analyze-activity.js';

test('fmtPace: m/s → mm:ss; the 5:73 bug can never recur', () => {
  assert.equal(fmtPace(2.91), '5:44');      // split 1 of activity 362
  assert.equal(fmtPace(2.78), '6:00');      // 1000/2.78 ≈ 360s
  assert.equal(fmtPace(3.33), '5:00');
  assert.equal(fmtPace(0), null);
  assert.equal(fmtPace(-1), null);
  assert.equal(fmtPace(null), null);
  // No formatted pace may ever have a seconds field ≥ 60 (catches "5:73"/"5:85").
  for (let mps = 1.0; mps <= 6.0; mps += 0.001) {
    const p = fmtPace(mps);
    assert.ok(!/\d:[6-9]\d/.test(p), `bad pace ${p} for ${mps}`);
  }
});

test('gradeImpactBucket: qualitative only (never the coefficient)', () => {
  assert.equal(gradeImpactBucket(57, -0.183), 'moderate');   // activity 362 (elev 57, |r| .183)
  assert.equal(gradeImpactBucket(10, 0.05), 'minimal');
  assert.equal(gradeImpactBucket(400, 0.6), 'significant');
  assert.equal(gradeImpactBucket(0, null), 'minimal');
});

test('coerceAnalysisShape: v1.2 shape, caps, plan_verdict whitelist, mandatory annotation', () => {
  const v = coerceAnalysisShape({
    sport: 'run',
    verdict: { call: 'Solid Z2 long run, executed as planned.', plan_verdict: 'as_planned', action: 'Easy day tomorrow.' },
    type_inference: null,
    summary: 'Controlled aerobic effort; HR held in Z2 across 137 min.',
    measured_against: '23km steady Z2, HR<148',
    metric_blocks: [
      { metric_key: 'hr', label: 'Heart rate', canonical_value: 'Z2 136m', session_line: 'avg 139, max 145', plan_line: 'HR<148', annotation: 'Right in the aerobic box.', data_available: true },
      { metric_key: 'pace', label: 'Pace', canonical_value: '5:52/km', session_line: '5:44→5:02 negative split', annotation: 'Strong close.' },
    ],
    flags: [{ type: 'info', severity: 'warn', message: 'Hot day' }],
  });
  assert.equal(v.schema, 'v1.2');
  assert.equal(v.verdict.plan_verdict, 'as_planned');
  assert.equal(v.metric_blocks.length, 2);
  assert.equal(v.metric_blocks[1].plan_line, null);          // missing → null
  assert.equal(typeof v.metric_blocks[1].annotation, 'string'); // always present
  assert.equal(v.flags[0].severity, 'warn');
  // bad plan_verdict → falls back to no_plan
  assert.equal(coerceAnalysisShape({ verdict: { call: 'x', plan_verdict: 'bogus' }, summary: 's' }).verdict.plan_verdict, 'no_plan');
});

test('parseAnalysisJSON: accepts v1.2; rejects missing verdict.call/summary', () => {
  const good = JSON.stringify({ sport: 'run', verdict: { call: 'c', plan_verdict: 'no_plan' }, summary: 's', metric_blocks: [], flags: [] });
  assert.equal(parseAnalysisJSON(good).ok, true);
  assert.equal(parseAnalysisJSON(JSON.stringify({ headline: 'old', coach_note: 'old' })).ok, false); // v1 shape rejected
});

test('shouldSkipRegen: a still-v1.1 card regenerates under v1.2 even if injury+zone unchanged', () => {
  const injuryFp = 'none', zoneFp = 'z';
  const current = { injury_fingerprint: injuryFp, zone_fingerprint: zoneFp, prompt_version: SCHEMA_VERSION };
  const stale = { injury_fingerprint: injuryFp, zone_fingerprint: zoneFp, prompt_version: 'analyze-activity@v1.1' };
  // same schema + unchanged source → skip
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'injury_change', prevAudit: current, injuryFp, zoneFp }), true);
  // OLD schema → regenerate (the v1.2 deploy bump)
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'injury_change', prevAudit: stale, injuryFp, zoneFp }), false);
  // manual force still always regenerates
  assert.equal(shouldSkipRegen({ force: true, regenReason: undefined, prevAudit: current, injuryFp, zoneFp }), false);
});
