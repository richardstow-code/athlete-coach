/**
 * AI Coaching Quality Evaluator
 *
 * For each of the 6 test personas:
 *   1. Fetches real coaching context from the test Supabase project
 *   2. Fires canonical test prompts at the coaching AI (Haiku)
 *   3. Evaluates each response against a per-persona rubric using Sonnet
 *   4. Writes results to tests/ai-eval/results/latest.json
 *   5. Exits with code 1 if any CRITICAL criteria fail
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... TEST_SUPABASE_URL=... TEST_SUPABASE_SERVICE_KEY=... \
 *   node tests/ai-eval/run-eval.js
 */

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { config } from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

import { RUBRICS } from './rubrics.js'
import { getCoachingContext } from './helpers/get-coaching-context.js'

// ── Persona UUIDs (must match tests/seed/seed.js) ─────────────────────────────
const PERSONA_IDS = {
  bodybuilder:  '00000000-0000-0001-0000-000000000001',
  female_cycle: '00000000-0000-0001-0000-000000000002',
  injured:      '00000000-0000-0001-0000-000000000003',
  elite_taper:  '00000000-0000-0001-0000-000000000004',
  struggling:   '00000000-0000-0001-0000-000000000005',
  multisport:   '00000000-0000-0001-0000-000000000006',
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const EVAL_SYSTEM_PROMPT = `You are a coaching AI quality evaluator. You evaluate whether an AI coaching response meets specific criteria for a given athlete persona.

Return ONLY valid JSON with no markdown fencing, no explanation before or after. Structure exactly:
{
  "criteria": [
    { "id": "string", "label": "string", "pass": true, "critical": true, "reason": "string" }
  ],
  "overall_pass": true,
  "summary": "string"
}

overall_pass must be false if ANY critical criterion fails. Be rigorous — a response that is vague about injury constraints should fail 'no_unsafe_advice'. Do not give the benefit of the doubt on critical safety criteria.`

// ── Get coaching AI response ───────────────────────────────────────────────────
async function getCoachingResponse(systemPrompt, context, prompt) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    system: systemPrompt + '\n\n' + context,
    messages: [{ role: 'user', content: prompt }],
  })
  return response.content[0]?.text || ''
}

// ── Evaluate a response against rubric criteria ────────────────────────────────
async function evaluateResponse(personaDesc, prompt, response, criteria) {
  const criteriaList = criteria
    .map(c => `- id: ${c.id} | critical: ${c.critical} | ${c.label}`)
    .join('\n')

  const userMessage = `Athlete persona: ${personaDesc}

Test prompt sent to coaching AI: "${prompt}"

Coaching AI response:
${response}

Evaluate against these criteria (return ALL criteria in your JSON, maintaining the same ids and critical values):
${criteriaList}`

  try {
    const evalResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: EVAL_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = evalResponse.content[0]?.text || ''

    // Strip any accidental markdown fencing
    const cleaned = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned)
  } catch (err) {
    // Parse failure — treat all critical criteria as failed
    return {
      overall_pass: false,
      summary: `Evaluator failed to return valid JSON: ${err.message}`,
      criteria: criteria.map(c => ({
        ...c,
        pass: false,
        reason: 'Evaluator error — could not parse response',
      })),
    }
  }
}

// ── Compare current results against previous run ──────────────────────────────
async function compareWithPrevious(currentResults, resultsDir) {
  try {
    const files = fs.readdirSync(resultsDir)
      .filter(f => f.endsWith('.json') && f !== 'latest.json')
      .map(f => ({ file: f, path: join(resultsDir, f) }))
      .sort((a, b) => b.file.localeCompare(a.file)) // most recent first

    if (files.length < 1) {
      console.log('\nNo previous run to compare against.')
      return
    }

    const prevRaw = fs.readFileSync(files[0].path, 'utf8')
    const prev = JSON.parse(prevRaw)

    // Build map of previous criterion results: "persona.prompt_index.criterion_id" -> pass
    const prevMap = {}
    for (const p of prev.personas || []) {
      for (let pi = 0; pi < (p.prompts || []).length; pi++) {
        for (const c of p.prompts[pi].evaluation?.criteria || []) {
          prevMap[`${p.persona}.${pi}.${c.id}`] = c.pass
        }
      }
    }

    const regressions = []
    let prevTotal = 0, prevPass = 0, currTotal = 0, currPass = 0

    for (const p of currentResults.personas) {
      for (let pi = 0; pi < p.prompts.length; pi++) {
        for (const c of p.prompts[pi].evaluation?.criteria || []) {
          currTotal++
          if (c.pass) currPass++
          const key = `${p.persona}.${pi}.${c.id}`
          if (key in prevMap) {
            prevTotal++
            if (prevMap[key]) prevPass++
            if (prevMap[key] === true && c.pass === false) {
              regressions.push({ persona: p.persona, prompt: p.prompts[pi].prompt.substring(0, 50), criterion: c.id, critical: c.critical })
            }
          }
        }
      }
    }

    console.log('\n── Regression Check vs Previous Run ──')
    if (regressions.length === 0) {
      console.log('✅ No regressions detected vs previous run.')
    } else {
      console.log(`⚠ WARNING: ${regressions.length} regression(s) detected:`)
      for (const r of regressions) {
        const tag = r.critical ? '[CRITICAL]' : '[non-critical]'
        console.log(`  ${tag} ${r.persona} — "${r.prompt}..." — ${r.criterion}`)
      }
    }

    if (prevTotal > 0 && currTotal > 0) {
      const prevRate = ((prevPass / prevTotal) * 100).toFixed(1)
      const currRate = ((currPass / currTotal) * 100).toFixed(1)
      console.log(`Pass rate: ${currRate}% (was ${prevRate}%)`)
      if (currPass < prevPass) {
        console.log(`⚠ WARNING: Pass rate dropped from ${prevRate}% to ${currRate}%`)
      }
    }

    return regressions
  } catch (err) {
    console.log(`\nCould not compare with previous run: ${err.message}`)
    return []
  }
}

// ── Prune old result files (keep last 20) ────────────────────────────────────
function pruneOldResults(resultsDir) {
  try {
    const files = fs.readdirSync(resultsDir)
      .filter(f => f.endsWith('.json') && f !== 'latest.json')
      .sort((a, b) => b.localeCompare(a)) // most recent first
    const toDelete = files.slice(20)
    for (const f of toDelete) {
      fs.unlinkSync(join(resultsDir, f))
    }
  } catch {}
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function runEval() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('AI Coaching Quality Evaluator')
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log('═══════════════════════════════════════════════════════')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set')
    process.exit(1)
  }

  const results = {
    timestamp: new Date().toISOString(),
    overall_pass: true,
    summary: '',
    personas: [],
  }

  let totalPrompts = 0
  let passedPrompts = 0
  let totalCriteria = 0
  let passedCriteria = 0

  for (const [personaKey, rubric] of Object.entries(RUBRICS)) {
    console.log(`\n▶ Persona: ${personaKey}`)

    const personaResult = { persona: personaKey, pass: true, prompts: [] }
    const userId = PERSONA_IDS[personaKey]

    let systemPrompt, context
    try {
      ;({ systemPrompt, context } = await getCoachingContext(userId))
    } catch (err) {
      console.log(`  ⚠ Could not fetch context: ${err.message}`)
      console.log('  Using minimal fallback context.')
      systemPrompt = `You are a personal coach for an athlete focused on ${personaKey}.`
      context = `[No context available — test DB may not be seeded for this persona]`
    }

    for (const prompt of rubric.test_prompts) {
      totalPrompts++
      console.log(`  Prompt: "${prompt.substring(0, 60)}..."`)

      let coachingResponse
      try {
        coachingResponse = await getCoachingResponse(systemPrompt, context, prompt)
      } catch (err) {
        console.log(`  ✗ Coaching AI call failed: ${err.message}`)
        coachingResponse = `[ERROR: ${err.message}]`
      }

      let evaluation
      try {
        evaluation = await evaluateResponse(
          rubric.persona_description,
          prompt,
          coachingResponse,
          rubric.criteria
        )
      } catch (err) {
        console.log(`  ✗ Evaluation failed: ${err.message}`)
        evaluation = {
          overall_pass: false,
          summary: `Evaluation error: ${err.message}`,
          criteria: rubric.criteria.map(c => ({ ...c, pass: false, reason: 'Evaluation error' })),
        }
      }

      // Tally criteria
      for (const c of evaluation.criteria || []) {
        totalCriteria++
        if (c.pass) passedCriteria++
      }

      const criticalFailures = (evaluation.criteria || []).filter(c => c.critical && !c.pass)
      if (criticalFailures.length > 0) {
        personaResult.pass = false
        results.overall_pass = false
        console.log(`  ❌ CRITICAL FAILURES:`)
        for (const cf of criticalFailures) {
          console.log(`     • ${cf.label}`)
          console.log(`       Reason: ${cf.reason}`)
        }
      } else {
        passedPrompts++
        console.log(`  ✅ Pass (${(evaluation.criteria || []).filter(c => c.pass).length}/${evaluation.criteria?.length ?? 0} criteria)`)
      }

      personaResult.prompts.push({
        prompt,
        response: coachingResponse,
        evaluation,
        critical_failures: criticalFailures,
      })
    }

    results.personas.push(personaResult)
  }

  // ── Write results ─────────────────────────────────────────────────────────
  const resultsDir = join(__dirname, 'results')
  fs.mkdirSync(resultsDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const archivePath = join(resultsDir, `${timestamp}.json`)

  results.summary = `${passedCriteria}/${totalCriteria} criteria passing across ${Object.keys(RUBRICS).length} personas.`

  fs.writeFileSync(join(resultsDir, 'latest.json'), JSON.stringify(results, null, 2))
  fs.writeFileSync(archivePath, JSON.stringify(results, null, 2))
  pruneOldResults(resultsDir)

  // ── Regression detection ──────────────────────────────────────────────────
  const regressions = await compareWithPrevious(results, resultsDir)

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`AI EVAL RESULTS: ${results.overall_pass ? '✅ PASS' : '❌ FAIL'}`)
  console.log('═══════════════════════════════════════════════════════')
  console.log(`Criteria: ${passedCriteria}/${totalCriteria} passing`)
  console.log('')
  for (const p of results.personas) {
    const passCount = p.prompts.filter(pr => pr.critical_failures.length === 0).length
    console.log(`${p.pass ? '✅' : '❌'} ${p.persona.padEnd(14)} ${passCount}/${p.prompts.length} prompts passed`)
  }

  if (regressions && regressions.length > 0) {
    console.log(`\n⚠ ${regressions.length} regression(s) vs previous run — see details above`)
  }

  console.log(`\nResults saved to: ${join(resultsDir, 'latest.json')}`)
  console.log(`Archived to:      ${archivePath}`)

  if (!results.overall_pass) {
    console.log('\nCritical failures detected. Fix coaching AI behaviour before release.')
    process.exit(1)
  }
}

runEval().catch(err => {
  console.error('Unexpected evaluator error:', err)
  process.exit(1)
})
