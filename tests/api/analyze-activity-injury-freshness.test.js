/**
 * API tests: analyze-activity injury/zone freshness (ticket 9808c786)
 *
 * Tier: @minor — `npm run test:api`. Pure-logic unit tests for the source
 * fingerprint + the trigger-driven regen decision. The end-to-end (resolve an
 * injury → card regenerates without the active / medical-review language) is the
 * architect's post-deploy behavioural gate (it needs the DB trigger + the LLM).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  injuryFingerprint,
  zoneFingerprint,
  stableStringify,
  shouldSkipRegen,
  SCHEMA_VERSION,
} from '../../api/analyze-activity.js';

test('injuryFingerprint: none when no active injuries; order-independent', () => {
  assert.equal(injuryFingerprint([]), 'none');
  assert.equal(injuryFingerprint(null), 'none');
  const a = injuryFingerprint([
    { body_location: 'left_calf', severity: 'moderate', follow_up_overdue: true },
    { body_location: 'right_knee', severity: 'minor', follow_up_overdue: false },
  ]);
  const b = injuryFingerprint([
    { body_location: 'right_knee', severity: 'minor', follow_up_overdue: false },
    { body_location: 'left_calf', severity: 'moderate', follow_up_overdue: true },
  ]);
  assert.equal(a, b, 'fingerprint is order-independent');
  assert.ok(a.includes('left_calf|moderate|1'));
});

test('injuryFingerprint changes when an injury resolves (the bug)', () => {
  const active = injuryFingerprint([{ body_location: 'left_calf', severity: 'moderate', follow_up_overdue: true }]);
  const resolved = injuryFingerprint([]); // resolved → no longer in the active list
  assert.notEqual(active, resolved);
  assert.equal(resolved, 'none');
});

test('zoneFingerprint: none when absent; stable across key order; prefers hr_zones', () => {
  assert.equal(zoneFingerprint(null), 'none');
  assert.equal(zoneFingerprint({}), 'none');
  const z1 = zoneFingerprint({ hr_zones: { z1: 110, z2: 140, z3: 160 } });
  const z2 = zoneFingerprint({ hr_zones: { z3: 160, z1: 110, z2: 140 } });
  assert.equal(z1, z2, 'zone fingerprint is key-order independent');
  const changed = zoneFingerprint({ hr_zones: { z1: 110, z2: 145, z3: 160 } });
  assert.notEqual(z1, changed);
  // falls back to training_zones only when hr_zones absent
  assert.equal(zoneFingerprint({ training_zones: { z1: 1 } }), stableStringify({ z1: 1 }));
});

test('shouldSkipRegen: skips a trigger force only when injury AND zone fingerprints are unchanged', () => {
  const injuryFp = 'left_calf|moderate|1';
  const zoneFp = stableStringify({ z1: 110 });
  const matchAudit = { injury_fingerprint: injuryFp, zone_fingerprint: zoneFp, prompt_version: SCHEMA_VERSION };

  // unchanged source on a trigger fire → skip the LLM
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'injury_change', prevAudit: matchAudit, injuryFp, zoneFp }), true);
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'zone_change', prevAudit: matchAudit, injuryFp, zoneFp }), true);

  // injury changed (resolved → 'none') → DO regenerate (the fix)
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'injury_change', prevAudit: matchAudit, injuryFp: 'none', zoneFp }), false);
  // zone changed → DO regenerate
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'zone_change', prevAudit: matchAudit, injuryFp, zoneFp: stableStringify({ z1: 999 }) }), false);
});

test('shouldSkipRegen: never skips a manual force, a non-force call, or a legacy card with no stored fingerprint', () => {
  const fp = { injury_fingerprint: 'none', zone_fingerprint: 'none' };
  assert.equal(shouldSkipRegen({ force: false, regenReason: 'injury_change', prevAudit: fp, injuryFp: 'none', zoneFp: 'none' }), false);
  assert.equal(shouldSkipRegen({ force: true, regenReason: undefined, prevAudit: fp, injuryFp: 'none', zoneFp: 'none' }), false); // manual force → full regen
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'manual', prevAudit: fp, injuryFp: 'none', zoneFp: 'none' }), false);
  assert.equal(shouldSkipRegen({ force: true, regenReason: 'injury_change', prevAudit: {}, injuryFp: 'none', zoneFp: 'none' }), false); // legacy: no stored fp → regenerate once
});
