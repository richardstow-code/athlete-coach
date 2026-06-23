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
  assert.equal(SCHEMA_VERSION, 'analyze-activity@v1.2.1');
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

test('clampText: no sentence end → cuts at the last WORD boundary, never mid-word', () => {
  assert.equal(clampText('alpha beta gamma delta', 12), 'alpha beta');
  // a long single clause with an early period (before half) falls back to word boundary
  const out = clampText('Z1: 6 min. Z2 sixty-three minutes ninety-two percent of the run plus more text', 40);
  assert.ok(out.length <= 40);
  assert.ok(!/\w$/.test(out) === false, 'ends on a word char (complete word)');
  // the tail token must be a WHOLE word from the source (no partial like "minu")
  const lastWord = out.split(/\s+/).pop().replace(/[.!?,;:]+$/, '');
  assert.ok(('Z1: 6 min. Z2 sixty-three minutes ninety-two percent of the run plus more text').includes(lastWord));
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
  assert.ok(c.verdict.call.length <= 120);
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
});
