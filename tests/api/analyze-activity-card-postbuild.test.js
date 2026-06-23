/**
 * API tests: activity-card POST-BUILD corrections (fix brief Part 1 / Chunk A).
 * Tier @minor. Pure-logic: boundary-safe clampText (the mid-word-truncation bug
 * confirmed on stored card id=367 — "…thou", "…cumulati"), the raised caps, and the
 * SCHEMA_VERSION bump that forces the regen guard to re-generate stored cards.
 * The internal-term-leak + one-home-scope rules are LLM behaviour → architect's
 * AI-eval gate; here we assert the prompt carries those rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampText, coerceAnalysisShape, SCHEMA_VERSION, buildAnalysisPrompt } from '../../api/analyze-activity.js';

test('SCHEMA_VERSION bumped so the regen guard re-generates v1.2 cards', () => {
  assert.equal(SCHEMA_VERSION, 'analyze-activity@v1.2.3');
});

test('clampText: returns short strings unchanged', () => {
  assert.equal(clampText('All good.', 120), 'All good.');
  assert.equal(clampText('', 120), '');
  assert.equal(clampText(null, 120), '');
});

test('clampText: cuts at a sentence end when one sits past the halfway point', () => {
  const s = 'This is a reasonably long first sentence indeed. Extra tail text here beyond the cap.';
  const out = clampText(s, 60);
  assert.equal(out, 'This is a reasonably long first sentence indeed.');
  assert.ok(/[.!?]$/.test(out), 'ends on sentence punctuation');
});

test('clampText: no sentence end → word boundary, never mid-word, ends in terminal punctuation (v1.2.3)', () => {
  assert.equal(clampText('alpha beta gamma delta', 12), 'alpha beta.'); // v1.2.3: completes with a period
  const src = 'Z1: 6 min. Z2 sixty-three minutes ninety-two percent of the run plus more text';
  const out = clampText(src, 40);
  assert.ok(out.length <= 40);
  assert.ok(/[.!?]$/.test(out), `ends in terminal punctuation: ${JSON.stringify(out)}`);
  // the last token is a WHOLE word from the source (no partial like "minu")
  const lastWord = out.replace(/[.!?]+$/, '').split(/\s+/).pop();
  assert.ok(src.includes(lastWord), `whole word tail: ${lastWord}`);
});

test('clampText: reproduces the id=367 failures cleanly (no mid-word tail)', () => {
  const verdict = 'Easy session completed as planned—HR and pace aligned to Z2 volume-builder intensity, though late drift appeared near the finish.';
  const v = clampText(verdict, 120);
  assert.ok(v.length <= 120);
  assert.ok(!v.endsWith('thou'), 'no "…thou" mid-word cut');
  assert.ok(!/[,;:—–-]$/.test(v), 'no dangling clause punctuation');

  const summary = 'Late-km splits show HR rising toward 142 despite pace holding, signalling aerobic decoupling—a normal sign of cumulative fatigue after a heavy four-run training week that should ease with recovery and a lighter next session overall.';
  const sm = clampText(summary, 450);
  assert.ok(!sm.endsWith('cumulati'), 'no "…cumulati" mid-word cut');
});

test('coerceAnalysisShape: applies the raised, boundary-safe caps', () => {
  const long = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ') + '.';
  const obj = {
    sport: 'run',
    verdict: { call: long(60), plan_verdict: 'as_planned', action: long(60) },
    summary: long(200),
    measured_against: 'Easy Z2 60-70 min',
    metric_blocks: [{ metric_key: 'hr', label: 'Heart rate', canonical_value: '132 avg', session_line: long(60), plan_line: long(60), annotation: long(80), data_available: true }],
    flags: [{ type: 'aerobic_decoupling', severity: 'info', message: long(60) }],
  };
  const c = coerceAnalysisShape(obj);
  assert.ok(c.verdict.call.length <= 80);   // v1.2.2: short qualitative call
  assert.ok(c.verdict.action.length <= 140);
  assert.ok(c.summary.length <= 450);
  assert.ok(c.metric_blocks[0].session_line.length <= 120);
  assert.ok(c.metric_blocks[0].plan_line.length <= 120);
  assert.ok(c.metric_blocks[0].annotation.length <= 220);
  assert.ok(c.flags[0].message.length <= 120);
  // and equals clampText of the source (coerce delegates to the boundary-safe trim)
  assert.equal(c.summary, clampText(obj.summary, 450));
  // every prose field ends on a complete word (no trailing partial "word4" cut to "wor")
  for (const f of [c.verdict.call, c.summary, c.metric_blocks[0].session_line, c.metric_blocks[0].annotation, c.flags[0].message]) {
    assert.ok(/(\bword\d+\b|[.!?])$/.test(f), `clean tail: ${JSON.stringify(f.slice(-12))}`);
  }
});

test('v1.2.2 clampText: never ends on a dangling function word or hanging clause', () => {
  // "…matching the" — strip the dangling article, then comma-fallback to the clean clause
  const s = 'Session executed as planned with HR 92% in Z2 and RPE 2, matching the prescribed easy intensity';
  const out = clampText(s, 60);
  assert.ok(out.length <= 60);
  const last = out.toLowerCase().replace(/[^a-z]+$/, '').split(/\s+/).pop();
  assert.ok(!['the', 'a', 'and', 'of', 'to', 'with', 'no', 'matching'].includes(last), `dangling tail: ${JSON.stringify(out)}`);
  // "…and no" (cadence dangle)
  const c = clampText('Cadence held firm indicating good neuromuscular control and no turnover compromise across the run', 50);
  assert.ok(!/\b(and|no|the)$/i.test(c), `dangling tail: ${JSON.stringify(c)}`);
});

test('v1.2.2 cadence unit guard: bpm → spm on the cadence block only', () => {
  const c = coerceAnalysisShape({
    verdict: { call: 'Easy run', plan_verdict: 'as_planned' }, summary: 's',
    metric_blocks: [
      { metric_key: 'cadence', label: 'Cadence', canonical_value: '172 bpm', session_line: 'Held 170–172 bpm steady', annotation: 'Turnover stable at 172 bpm throughout.', data_available: true },
      { metric_key: 'hr', label: 'Heart Rate', canonical_value: '132 bpm', session_line: 'Avg 132 bpm', annotation: 'Z2 the whole way.', data_available: true },
    ],
    flags: [],
  });
  const cad = c.metric_blocks.find(b => b.metric_key === 'cadence');
  const hr = c.metric_blocks.find(b => b.metric_key === 'hr');
  assert.equal(cad.canonical_value, '172 spm');
  assert.ok(!/bpm/i.test(cad.session_line) && /spm/.test(cad.session_line));
  assert.ok(!/bpm/i.test(cad.annotation));
  assert.equal(hr.canonical_value, '132 bpm'); // HR stays bpm — guard is cadence-only
});

test('v1.2.2 label: abbreviated before the cap, never mid-word', () => {
  const c = coerceAnalysisShape({
    verdict: { call: 'x', plan_verdict: 'no_plan' }, summary: 's',
    metric_blocks: [
      { metric_key: 'rpe', label: 'Rate of Perceived Exertion', canonical_value: '2', session_line: 'RPE 2', annotation: 'Very easy.', data_available: true },
    ],
    flags: [],
  });
  assert.equal(c.metric_blocks[0].label, 'RPE');           // mapped, not "Rate of Perceived Exerti"
});

test('v1.2.2 verdict.call cap is 80 (short qualitative call)', () => {
  const c = coerceAnalysisShape({ verdict: { call: 'x'.repeat(200), plan_verdict: 'as_planned' }, summary: 's', flags: [] });
  assert.equal(c.verdict.call.length, 80);
});

test('v1.2.3 action: ≤110, no ";", ends in terminal punctuation, no dangling fragment', () => {
  // the live id=367 v4 action — semicolon-joined run-on that dangled on "a true"
  const c = coerceAnalysisShape({
    verdict: {
      call: 'Easy run', plan_verdict: 'as_planned',
      action: 'Monitor HR creep in closing km on future easy runs; consider pacing slightly more conservatively in the first 2-3 km to settle into a true',
    },
    summary: 's', flags: [],
  });
  const action = c.verdict.action;
  assert.ok(action.length <= 110, `len ${action.length}`);
  assert.ok(!action.includes(';'), 'no semicolon run-on');
  assert.ok(/[.!?]$/.test(action), 'ends in terminal punctuation');
  assert.ok(!/settle into a true/i.test(action), 'the "settle into a true" fragment must NOT occur');
  assert.ok(!/\b(a|an|the|into|to|and|of|with)$/i.test(action.replace(/[.!?]+$/, '')), 'no trailing dangling word');
});

test('v1.2.3 clampText: drops a trailing "determiner + content word" fragment with no noun', () => {
  const out = clampText('We need to find a true north star to chase', 24);
  assert.ok(/[.!?]$/.test(out));
  assert.ok(!/a true$/i.test(out.replace(/[.!?]+$/, '')), `must not end on "a true": ${JSON.stringify(out)}`);
});

test('prompt carries the post-build rules (no-internal-terms, one-home scope, complete-sentences)', () => {
  const { system } = buildAnalysisPrompt({
    activity: { name: 'Morning Run', type: 'run', date: '2026-06-23T05:00:00Z', distance_km: 12.3, duration_min: 68, avg_hr: 132 },
    sport: 'run',
    completeness: { not_available: ['fuel'] },
  });
  assert.match(system, /banned/i);
  assert.match(system, /qualitative bucket/);          // named as a banned term, with the plain-language example
  assert.match(system, /ONE HOME PER FINDING|exactly ONE place/);
  assert.match(system, /COMPLETE SENTENCES WITHIN CAPS|never end mid-word/i);
  assert.match(system, /terse label-style/i);          // flags terseness rule
  // v1.2.2 rules
  assert.match(system, /SHORT QUALITATIVE|NO numbers and NO metric values/); // metric-free verdict.call
  assert.match(system, /spm.*NEVER bpm|never bpm/i);    // cadence unit
  assert.match(system, /standard abbreviation \(RPE/);  // label abbreviation rule
});
