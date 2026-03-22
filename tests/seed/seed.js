/**
 * Test Database Seed Script
 *
 * Resets the test Supabase project to a known state with 6 athlete personas.
 * NEVER touches the production Supabase project (yjuhzmknabedjklsgbje).
 *
 * Usage:
 *   node tests/seed/seed.js
 *   npm run seed:test
 *
 * Requires /tests/.env.test with TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_KEY.
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: join(__dirname, '../.env.test') })

// ── Safety guard ────────────────────────────────────────────────────────────
// Ensure we never accidentally hit the production project
const PROD_PROJECT_ID = 'yjuhzmknabedjklsgbje'
const supabaseUrl = process.env.TEST_SUPABASE_URL || ''
if (supabaseUrl.includes(PROD_PROJECT_ID)) {
  console.error('FATAL: TEST_SUPABASE_URL points to the production project. Aborting.')
  process.exit(1)
}

const supabase = createClient(
  supabaseUrl,
  process.env.TEST_SUPABASE_SERVICE_KEY || '',
  { auth: { autoRefreshToken: false, persistSession: false } }
)

// ── Persona UUIDs ────────────────────────────────────────────────────────────
export const PERSONA_IDS = {
  bodybuilder:  '00000000-0000-0001-0000-000000000001',
  female_cycle: '00000000-0000-0001-0000-000000000002',
  injured:      '00000000-0000-0001-0000-000000000003',
  elite_taper:  '00000000-0000-0001-0000-000000000004',
  struggling:   '00000000-0000-0001-0000-000000000005',
  multisport:   '00000000-0000-0001-0000-000000000006',
}

const ALL_IDS = Object.values(PERSONA_IDS)

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function daysFromNow(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

// Day of week for a date (0=Mon..6=Sun)
function nextWeekday(weekday, offsetWeeks = 0) {
  const d = new Date()
  const day = d.getDay() // 0=Sun..6=Sat
  const mondayOffset = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + mondayOffset + weekday + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}

async function del(table) {
  const { error } = await supabase.from(table).delete().in('user_id', ALL_IDS)
  if (error) console.warn(`  warn: delete from ${table}:`, error.message)
}

async function ins(table, rows) {
  if (!rows.length) return
  const { error } = await supabase.from(table).insert(rows)
  if (error) throw new Error(`insert into ${table}: ${error.message}`)
}

// ── Main seed function ────────────────────────────────────────────────────────

export async function seedAll() {
  console.log('Starting seed...')

  // ── 1. Delete in FK-safe order ──
  console.log('  Clearing existing test data...')
  await del('cycle_logs')
  await del('nutrition_logs')
  await del('coaching_memory')
  await del('daily_briefings')
  await del('schedule_changes')
  await del('scheduled_sessions')
  await del('plan_drafts')
  await del('workout_logs')
  await del('athlete_sports')
  await del('strava_tokens')
  await del('activity_streams')
  await del('activities')
  await del('athlete_settings')

  // ── 2. athlete_settings ──
  console.log('  Seeding athlete_settings...')
  await ins('athlete_settings', [
    {
      user_id: PERSONA_IDS.bodybuilder,
      name: 'Marcus Weber',
      weight_kg: 92,
      height_cm: 183,
      goal_type: 'strength',
      tone: 40,
      consequences: 60,
      detail_level: 70,
      coaching_reach: 30,
      onboarding_complete: true,
      races: [],
      subscription_tier: 'founder',
    },
    {
      user_id: PERSONA_IDS.female_cycle,
      name: 'Sofia Müller',
      weight_kg: 62,
      height_cm: 168,
      goal_type: 'running',
      tone: 50,
      consequences: 50,
      detail_level: 50,
      coaching_reach: 70,
      cycle_tracking_enabled: true,
      cycle_length_avg: 28,
      cycle_last_period_date: daysAgo(18),
      onboarding_complete: true,
      races: [{ name: 'Vienna Marathon', date: '2026-04-26', goal_time: '3:45:00' }],
      subscription_tier: 'founder',
    },
    {
      user_id: PERSONA_IDS.injured,
      name: 'Tom Brennan',
      weight_kg: 78,
      height_cm: 177,
      goal_type: 'running',
      tone: 30,
      consequences: 50,
      detail_level: 50,
      coaching_reach: 50,
      onboarding_complete: true,
      races: [{ name: 'Berlin Marathon', date: '2026-09-27', goal_time: '3:30:00' }],
      subscription_tier: 'founder',
    },
    {
      user_id: PERSONA_IDS.elite_taper,
      name: 'Anna Kowalski',
      weight_kg: 57,
      height_cm: 165,
      goal_type: 'running',
      tone: 20,
      consequences: 70,
      detail_level: 80,
      coaching_reach: 40,
      onboarding_complete: true,
      races: [{ name: 'London Marathon', date: '2026-04-26', goal_time: '2:45:00' }],
      subscription_tier: 'founder',
    },
    {
      user_id: PERSONA_IDS.struggling,
      name: 'Dave Thornton',
      weight_kg: 84,
      height_cm: 180,
      goal_type: 'running',
      tone: 60,
      consequences: 40,
      detail_level: 40,
      coaching_reach: 60,
      onboarding_complete: true,
      races: [{ name: 'Frankfurt Marathon', date: '2026-10-25', goal_time: '4:15:00' }],
      subscription_tier: 'founder',
    },
    {
      user_id: PERSONA_IDS.multisport,
      name: 'Lena Fischer',
      weight_kg: 65,
      height_cm: 170,
      goal_type: 'multisport',
      tone: 45,
      consequences: 55,
      detail_level: 60,
      coaching_reach: 50,
      onboarding_complete: true,
      races: [{ name: 'Ironman 70.3 Salzburg', date: '2026-06-14', goal_time: '5:30:00' }],
      subscription_tier: 'founder',
    },
  ])

  // ── 3. athlete_sports ──
  console.log('  Seeding athlete_sports...')
  await ins('athlete_sports', [
    { user_id: PERSONA_IDS.bodybuilder, sport_key: 'weighttraining', display_name: 'Weight Training', priority: '1', lifecycle_state: 'base_build', is_active: true },
    { user_id: PERSONA_IDS.female_cycle, sport_key: 'run', display_name: 'Running', priority: '1', lifecycle_state: 'build', is_active: true },
    { user_id: PERSONA_IDS.injured, sport_key: 'run', display_name: 'Running', priority: '1', lifecycle_state: 'base_build', is_active: true },
    { user_id: PERSONA_IDS.elite_taper, sport_key: 'run', display_name: 'Running', priority: '1', lifecycle_state: 'taper', is_active: true },
    { user_id: PERSONA_IDS.struggling, sport_key: 'run', display_name: 'Running', priority: '1', lifecycle_state: 'base_build', is_active: true },
    { user_id: PERSONA_IDS.multisport, sport_key: 'run', display_name: 'Running', priority: '1', lifecycle_state: 'build', is_active: true },
    { user_id: PERSONA_IDS.multisport, sport_key: 'ride', display_name: 'Cycling', priority: '2', lifecycle_state: 'build', is_active: true },
    { user_id: PERSONA_IDS.multisport, sport_key: 'swim', display_name: 'Swimming', priority: '3', lifecycle_state: 'base_build', is_active: true },
  ])

  // ── 4. activities ──
  console.log('  Seeding activities...')

  const strengthNames = ['Chest & Triceps', 'Back & Biceps', 'Legs', 'Shoulders', 'Push Day', 'Pull Day']
  const bbActivities = []
  let stravaId = 90000001
  for (let w = 0; w < 6; w++) {
    for (const [i, weekday] of [0, 2, 4].entries()) { // Mon, Wed, Fri
      bbActivities.push({
        user_id: PERSONA_IDS.bodybuilder,
        strava_id: stravaId++,
        date: new Date(Date.now() - (w * 7 + (4 - weekday)) * 86400000).toISOString(),
        name: strengthNames[(w * 3 + i) % strengthNames.length],
        type: 'weighttraining',
        distance_km: 0,
        duration_min: 45 + Math.floor(Math.random() * 30),
        elevation_m: 0,
        enrichment_status: 'complete',
      })
    }
  }
  await ins('activities', bbActivities)

  // Sofia — female athlete with cycle tracking (running)
  const sofiaRuns = [
    { days: 42, name: 'Easy Recovery Run', dist: 6.2, pace: '6:20', hr: 138, dur: 39 },
    { days: 40, name: 'Tempo Session', dist: 8.5, pace: '5:05', hr: 158, dur: 43 },
    { days: 38, name: 'Long Run', dist: 18.0, pace: '6:15', hr: 143, dur: 112 },
    { days: 35, name: 'Easy Run', dist: 7.0, pace: '6:30', hr: 135, dur: 46 },
    { days: 33, name: 'Interval Session', dist: 9.0, pace: '5:00', hr: 162, dur: 45 },
    { days: 31, name: 'Long Run', dist: 19.0, pace: '6:20', hr: 145, dur: 120 },
    { days: 28, name: 'Easy Run', dist: 6.5, pace: '6:25', hr: 136, dur: 42 },
    { days: 26, name: 'Tempo Run', dist: 10.0, pace: '5:10', hr: 155, dur: 52 },
    { days: 24, name: 'Long Run', dist: 20.0, pace: '6:18', hr: 144, dur: 126 },
    { days: 21, name: 'Easy Run', dist: 7.5, pace: '6:30', hr: 137, dur: 49 },
    { days: 19, name: 'Fartlek Session', dist: 8.0, pace: '5:30', hr: 152, dur: 44 },
    { days: 17, name: 'Long Run (luteal)', dist: 16.0, pace: '6:35', hr: 151, dur: 106 },
    { days: 14, name: 'Easy Run (luteal)', dist: 6.0, pace: '6:40', hr: 148, dur: 40 },
    { days: 12, name: 'Easy Run', dist: 8.0, pace: '6:20', hr: 139, dur: 51 },
  ]
  await ins('activities', sofiaRuns.map(r => ({
    user_id: PERSONA_IDS.female_cycle,
    strava_id: stravaId++,
    date: new Date(Date.now() - r.days * 86400000).toISOString(),
    name: r.name,
    type: 'run',
    distance_km: r.dist,
    duration_min: r.dur,
    pace_per_km: r.pace,
    avg_hr: r.hr,
    max_hr: r.hr + 12,
    enrichment_status: 'complete',
  })))

  // Tom — injured athlete
  const tomRuns = [
    { days: 42, name: 'Morning Run', dist: 10.0, pace: '5:50', hr: 148, dur: 58 },
    { days: 39, name: 'Easy Run', dist: 8.0, pace: '6:00', hr: 144, dur: 48 },
    { days: 35, name: 'Long Run', dist: 14.0, pace: '5:55', hr: 151, dur: 83 },
    { days: 32, name: 'Tempo Session', dist: 9.5, pace: '5:10', hr: 162, dur: 49 },
    { days: 28, name: 'Easy Run', dist: 7.0, pace: '6:05', hr: 146, dur: 43 },
    { days: 24, name: 'Long Run', dist: 16.0, pace: '5:50', hr: 153, dur: 93 },
    { days: 10, name: 'Pre-injury Run', dist: 13.0, pace: '5:45', hr: 168, dur: 75 }, // injury trigger
    { days: 5, name: 'Easy Test Run', dist: 4.5, pace: '6:30', hr: 145, dur: 29 },
  ]
  await ins('activities', tomRuns.map(r => ({
    user_id: PERSONA_IDS.injured,
    strava_id: stravaId++,
    date: new Date(Date.now() - r.days * 86400000).toISOString(),
    name: r.name,
    type: 'run',
    distance_km: r.dist,
    duration_min: r.dur,
    pace_per_km: r.pace,
    avg_hr: r.hr,
    max_hr: r.hr + 14,
    enrichment_status: 'complete',
  })))

  // Anna — elite taper
  const annaRuns = [
    { days: 56, name: 'Easy Run', dist: 12, pace: '4:30', hr: 130, dur: 54 },
    { days: 54, name: 'Marathon Pace Run', dist: 16, pace: '3:55', hr: 143, dur: 63 },
    { days: 52, name: 'Long Run', dist: 28, pace: '4:20', hr: 138, dur: 122 },
    { days: 49, name: 'Easy Run', dist: 10, pace: '4:35', hr: 128, dur: 46 },
    { days: 47, name: 'Threshold Session', dist: 14, pace: '3:40', hr: 148, dur: 51 },
    { days: 45, name: 'Long Run', dist: 30, pace: '4:22', hr: 139, dur: 131 },
    { days: 42, name: 'Easy Run', dist: 12, pace: '4:30', hr: 130, dur: 54 },
    { days: 40, name: 'Tempo Session', dist: 16, pace: '3:38', hr: 150, dur: 58 },
    { days: 38, name: 'Long Run', dist: 32, pace: '4:18', hr: 140, dur: 138 },
    { days: 35, name: 'Easy Run', dist: 10, pace: '4:35', hr: 129, dur: 46 },
    { days: 33, name: 'Race Pace Session', dist: 18, pace: '3:56', hr: 144, dur: 71 },
    { days: 31, name: 'Long Run', dist: 30, pace: '4:20', hr: 138, dur: 130 },
    { days: 28, name: 'Easy Run', dist: 10, pace: '4:30', hr: 130, dur: 45 },
    { days: 26, name: 'Tempo Session', dist: 14, pace: '3:42', hr: 147, dur: 52 },
    { days: 24, name: 'Long Run (taper start)', dist: 26, pace: '4:25', hr: 137, dur: 115 },
    { days: 21, name: 'Easy Run', dist: 10, pace: '4:30', hr: 130, dur: 45 },
    { days: 19, name: 'Threshold Session', dist: 12, pace: '3:40', hr: 148, dur: 44 },
    { days: 17, name: 'Long Run (taper)', dist: 22, pace: '4:20', hr: 136, dur: 95 },
    { days: 14, name: 'Easy Run', dist: 8, pace: '4:35', hr: 128, dur: 37 },
    { days: 12, name: 'Race Pace Session', dist: 10, pace: '3:57', hr: 143, dur: 40 },
    { days: 10, name: 'Long Run (taper)', dist: 18, pace: '4:25', hr: 135, dur: 80 },
    { days: 7, name: 'Easy Run', dist: 6, pace: '4:35', hr: 127, dur: 28 },
    { days: 5, name: 'Short Tempo', dist: 8, pace: '3:45', hr: 146, dur: 30 },
    { days: 3, name: 'Easy Shakeout', dist: 6, pace: '4:40', hr: 126, dur: 28 },
  ]
  await ins('activities', annaRuns.map(r => ({
    user_id: PERSONA_IDS.elite_taper,
    strava_id: stravaId++,
    date: new Date(Date.now() - r.days * 86400000).toISOString(),
    name: r.name,
    type: 'run',
    distance_km: r.dist,
    duration_min: r.dur,
    pace_per_km: r.pace,
    avg_hr: r.hr,
    max_hr: r.hr + 15,
    enrichment_status: 'complete',
  })))

  // Dave — struggling
  const daveRuns = [
    { days: 41, name: 'First Run in Ages', dist: 5.0, pace: '7:20', hr: 162, dur: 37 },
    { days: 36, name: 'Short Run', dist: 5.5, pace: '7:10', hr: 165, dur: 39 },
    { days: 29, name: 'Morning Run', dist: 6.0, pace: '7:00', hr: 160, dur: 42 },
    { days: 27, name: 'Slow Run', dist: 4.5, pace: '7:30', hr: 167, dur: 34 },
    { days: 15, name: 'Comeback Run', dist: 7.0, pace: '6:50', hr: 158, dur: 48 },
    { days: 13, name: 'Short Easy Run', dist: 5.0, pace: '7:20', hr: 163, dur: 37 },
    { days: 6, name: 'Morning Run', dist: 6.5, pace: '7:00', hr: 161, dur: 46 },
    { days: 3, name: 'Short Run', dist: 5.0, pace: '7:15', hr: 164, dur: 36 },
  ]
  await ins('activities', daveRuns.map(r => ({
    user_id: PERSONA_IDS.struggling,
    strava_id: stravaId++,
    date: new Date(Date.now() - r.days * 86400000).toISOString(),
    name: r.name,
    type: 'run',
    distance_km: r.dist,
    duration_min: r.dur,
    pace_per_km: r.pace,
    avg_hr: r.hr,
    max_hr: r.hr + 10,
    enrichment_status: 'complete',
  })))

  // Lena — multisport
  const lenaActivities = [
    { days: 42, name: 'Long Ride', type: 'ride', dist: 65, dur: 130, hr: 148 },
    { days: 41, name: 'Easy Run', type: 'run', dist: 7.0, dur: 42, hr: 138, pace: '6:00' },
    { days: 38, name: 'Pool Swim', type: 'swim', dist: 2.0, dur: 40, hr: null },
    { days: 36, name: 'Interval Ride', type: 'ride', dist: 45, dur: 75, hr: 158 },
    { days: 35, name: 'Brick Run (after ride)', type: 'run', dist: 5.0, dur: 29, hr: 155, pace: '5:50' },
    { days: 33, name: 'Open Water Swim', type: 'swim', dist: 1.5, dur: 32, hr: null },
    { days: 31, name: 'Tempo Run', type: 'run', dist: 9.0, dur: 52, hr: 152, pace: '5:45' },
    { days: 28, name: 'Long Ride', type: 'ride', dist: 75, dur: 152, hr: 145 },
    { days: 26, name: 'Pool Swim', type: 'swim', dist: 2.2, dur: 44, hr: null },
    { days: 24, name: 'Easy Run', type: 'run', dist: 8.5, dur: 51, hr: 140, pace: '6:00' },
    { days: 21, name: 'Indoor Trainer', type: 'ride', dist: 40, dur: 60, hr: 152 },
    { days: 19, name: 'Pool Swim', type: 'swim', dist: 2.5, dur: 48, hr: null },
    { days: 17, name: 'Long Run', type: 'run', dist: 14.0, dur: 85, hr: 144, pace: '6:04' },
    { days: 14, name: 'Long Ride', type: 'ride', dist: 80, dur: 162, hr: 147 },
    { days: 12, name: 'Pool Swim', type: 'swim', dist: 2.0, dur: 40, hr: null },
    { days: 10, name: 'Brick Session', type: 'ride', dist: 50, dur: 88, hr: 150 },
    { days: 10, name: 'Brick Run', type: 'run', dist: 6.0, dur: 34, hr: 158, pace: '5:40' },
    { days: 7, name: 'Interval Ride', type: 'ride', dist: 38, dur: 65, hr: 160 },
  ]
  await ins('activities', lenaActivities.map(r => ({
    user_id: PERSONA_IDS.multisport,
    strava_id: stravaId++,
    date: new Date(Date.now() - r.days * 86400000).toISOString(),
    name: r.name,
    type: r.type,
    distance_km: r.dist,
    duration_min: r.dur,
    pace_per_km: r.pace || null,
    avg_hr: r.hr,
    max_hr: r.hr ? r.hr + 13 : null,
    enrichment_status: 'complete',
  })))

  // ── 5. scheduled_sessions ──
  console.log('  Seeding scheduled_sessions...')

  // Marcus (bodybuilder) — 4 sessions this week + next
  await ins('scheduled_sessions', [
    { user_id: PERSONA_IDS.bodybuilder, planned_date: nextWeekday(0), session_type: 'strength', name: 'Push Day — Chest & Triceps', duration_min_low: 60, duration_min_high: 75, intensity: 'hard', status: 'planned', notes: 'Bench press 4x6, OHP 4x8, lateral raises, tricep pushdowns' },
    { user_id: PERSONA_IDS.bodybuilder, planned_date: nextWeekday(2), session_type: 'strength', name: 'Pull Day — Back & Biceps', duration_min_low: 60, duration_min_high: 75, intensity: 'hard', status: 'planned', notes: 'Deadlift 4x5, pull-ups 4x6, rows, curls' },
    { user_id: PERSONA_IDS.bodybuilder, planned_date: nextWeekday(4), session_type: 'strength', name: 'Leg Day', duration_min_low: 60, duration_min_high: 80, intensity: 'hard', status: 'planned', notes: 'Squat 5x5 @ 80%, leg press, RDL, calf raises' },
    { user_id: PERSONA_IDS.bodybuilder, planned_date: nextWeekday(0, 1), session_type: 'strength', name: 'Shoulders & Arms', duration_min_low: 55, duration_min_high: 70, intensity: 'moderate', status: 'planned', notes: 'OHP, lateral raises, face pulls, bicep/tricep superset' },
  ])

  // Sofia — marathon training week
  await ins('scheduled_sessions', [
    { user_id: PERSONA_IDS.female_cycle, planned_date: nextWeekday(0), session_type: 'run', name: 'Easy Run', duration_min_low: 40, duration_min_high: 50, intensity: 'easy', zone: 'Z2', status: 'planned' },
    { user_id: PERSONA_IDS.female_cycle, planned_date: nextWeekday(1), session_type: 'run', name: 'Tempo Run', duration_min_low: 50, duration_min_high: 60, intensity: 'hard', zone: 'Z3-Z4', status: 'planned', notes: '2x15 min tempo with 3 min recovery' },
    { user_id: PERSONA_IDS.female_cycle, planned_date: nextWeekday(3), session_type: 'run', name: 'Easy Run', duration_min_low: 45, duration_min_high: 55, intensity: 'easy', zone: 'Z2', status: 'planned' },
    { user_id: PERSONA_IDS.female_cycle, planned_date: nextWeekday(6), session_type: 'run', name: 'Long Run', duration_min_low: 100, duration_min_high: 120, intensity: 'easy', zone: 'Z2', status: 'planned', notes: '16-18km, keep HR under 148bpm' },
  ])

  // Tom — injured: mostly rehab + short runs
  await ins('scheduled_sessions', [
    { user_id: PERSONA_IDS.injured, planned_date: nextWeekday(0), session_type: 'rehab', name: 'ITB Rehab Session', duration_min_low: 30, duration_min_high: 40, intensity: 'easy', status: 'planned', notes: 'Clamshells 3x15, Hip abduction 3x15, Foam rolling ITB, Single leg glute bridge 3x12' },
    { user_id: PERSONA_IDS.injured, planned_date: nextWeekday(1), session_type: 'run', name: 'Short Easy Run', duration_min_low: 25, duration_min_high: 35, intensity: 'easy', zone: 'Z2', status: 'planned', notes: 'Max 5km. Stop if any knee pain.' },
    { user_id: PERSONA_IDS.injured, planned_date: nextWeekday(3), session_type: 'rehab', name: 'Hip Strengthening', duration_min_low: 25, duration_min_high: 35, intensity: 'easy', status: 'planned', notes: 'Clamshells 3x15, Hip abduction 3x15, Foam rolling ITB, Single leg glute bridge 3x12' },
    { user_id: PERSONA_IDS.injured, planned_date: nextWeekday(4), session_type: 'run', name: 'Easy Run', duration_min_low: 30, duration_min_high: 40, intensity: 'easy', zone: 'Z2', status: 'planned', notes: 'Max 6km. Flat route only, no downhill.' },
    { user_id: PERSONA_IDS.injured, planned_date: nextWeekday(6), session_type: 'rehab', name: 'ITB Rehab + Strength', duration_min_low: 40, duration_min_high: 50, intensity: 'easy', status: 'planned', notes: 'Clamshells 3x15, Hip abduction 3x15, Foam rolling ITB, Single leg glute bridge 3x12' },
  ])

  // Anna — elite taper week
  await ins('scheduled_sessions', [
    { user_id: PERSONA_IDS.elite_taper, planned_date: nextWeekday(0), session_type: 'run', name: 'Easy Run', duration_min_low: 40, duration_min_high: 50, intensity: 'easy', zone: 'Z1-Z2', status: 'planned' },
    { user_id: PERSONA_IDS.elite_taper, planned_date: nextWeekday(1), session_type: 'run', name: 'Race Pace Session', duration_min_low: 60, duration_min_high: 70, intensity: 'hard', zone: 'Z3-Z4', status: 'planned', notes: '3x5km @ race pace (3:55/km), 3 min recovery jog' },
    { user_id: PERSONA_IDS.elite_taper, planned_date: nextWeekday(3), session_type: 'run', name: 'Easy Run', duration_min_low: 35, duration_min_high: 45, intensity: 'easy', zone: 'Z1-Z2', status: 'planned' },
    { user_id: PERSONA_IDS.elite_taper, planned_date: nextWeekday(4), session_type: 'run', name: 'Strides Session', duration_min_low: 30, duration_min_high: 40, intensity: 'moderate', status: 'planned', notes: 'Easy 25 min + 6x100m strides at race pace' },
    { user_id: PERSONA_IDS.elite_taper, planned_date: nextWeekday(6), session_type: 'run', name: 'Taper Long Run', duration_min_low: 85, duration_min_high: 100, intensity: 'easy', zone: 'Z2', status: 'planned', notes: '22km, keep it honest — no heroics' },
  ])

  // Dave — struggling: several missed sessions + some upcoming
  const davePastSessions = []
  for (let i = 6; i >= 1; i--) {
    davePastSessions.push(
      { user_id: PERSONA_IDS.struggling, planned_date: daysAgo(i * 7 - 1), session_type: 'run', name: 'Easy Run', duration_min_low: 50, duration_min_high: 60, intensity: 'easy', zone: 'Z2', status: i > 2 ? 'missed' : 'planned', notes: 'Target 8-10km at conversational pace' },
      { user_id: PERSONA_IDS.struggling, planned_date: daysAgo(i * 7 - 3), session_type: 'run', name: 'Tempo Run', duration_min_low: 45, duration_min_high: 55, intensity: 'moderate', zone: 'Z3', status: i > 1 ? 'missed' : 'planned', notes: '20 min tempo effort' },
      { user_id: PERSONA_IDS.struggling, planned_date: daysAgo(i * 7 - 6), session_type: 'run', name: 'Long Run', duration_min_low: 80, duration_min_high: 100, intensity: 'easy', zone: 'Z2', status: i > 2 ? 'missed' : 'planned', notes: '14-16km easy pace' },
    )
  }
  await ins('scheduled_sessions', davePastSessions)

  // Lena — triathlon week
  await ins('scheduled_sessions', [
    { user_id: PERSONA_IDS.multisport, planned_date: nextWeekday(0), session_type: 'swim', name: 'Pool Technique Session', duration_min_low: 45, duration_min_high: 55, intensity: 'easy', status: 'planned', notes: 'Focus on catch and pull. 6x200m with 30s rest.' },
    { user_id: PERSONA_IDS.multisport, planned_date: nextWeekday(1), session_type: 'ride', name: 'Indoor Intervals', duration_min_low: 60, duration_min_high: 75, intensity: 'hard', status: 'planned', notes: '4x8 min @ FTP with 4 min recovery' },
    { user_id: PERSONA_IDS.multisport, planned_date: nextWeekday(3), session_type: 'run', name: 'Easy Run', duration_min_low: 40, duration_min_high: 50, intensity: 'easy', zone: 'Z2', status: 'planned' },
    { user_id: PERSONA_IDS.multisport, planned_date: nextWeekday(5), session_type: 'ride', name: 'Long Ride + Brick Run', duration_min_low: 150, duration_min_high: 180, intensity: 'moderate', status: 'planned', notes: '70km ride then immediate 5km run at HIM pace' },
    { user_id: PERSONA_IDS.multisport, planned_date: nextWeekday(6), session_type: 'swim', name: 'Open Water Sim', duration_min_low: 40, duration_min_high: 50, intensity: 'moderate', status: 'planned', notes: '1.9km continuous. Practice sighting every 10 strokes.' },
  ])

  // ── 6. coaching_memory ──
  console.log('  Seeding coaching_memory...')
  await ins('coaching_memory', [
    // Bodybuilder
    { user_id: PERSONA_IDS.bodybuilder, date: daysAgo(30), type: 'baseline', category: 'baseline', source: 'system', content: 'Marcus Weber, 32yo male, 92kg, 183cm. Primary goal: strength and hypertrophy. No running events. Currently training 3x per week push/pull/legs. Strong in compound movements — bench ~120kg, squat ~140kg, deadlift ~180kg. No cardiovascular base noted. Recommend progressive overload approach with 5-10% volume increase per month.' },
    { user_id: PERSONA_IDS.bodybuilder, date: daysAgo(7), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Chest & Triceps session complete. Volume up 8% from last week. Bench press showing strength plateau — consider switching to 3x10 next cycle for hypertrophy stimulus. Recovery adequate.' },
    { user_id: PERSONA_IDS.bodybuilder, date: daysAgo(3), type: 'note', category: 'coaching_note', source: 'coach', content: 'Progressive overload on bench press: last three sessions at 100kg 4x6. Ready to attempt 105kg next session. Ensure adequate sleep (target 8h) to support muscle protein synthesis.' },

    // Female cycle
    { user_id: PERSONA_IDS.female_cycle, date: daysAgo(40), type: 'baseline', category: 'baseline', source: 'system', content: 'Sofia Müller, 29yo female, 62kg, 168cm. Vienna Marathon in 6 weeks (target 3:45). Currently in build phase — good aerobic base, tempo paces around 5:05-5:15/km. Cycle tracking enabled — in luteal phase currently, expect slightly elevated perceived exertion and HR. Recommend monitoring RPE vs HR parity over next 2 weeks.' },
    { user_id: PERSONA_IDS.female_cycle, date: daysAgo(14), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Long run complete (20km, 6:18/km). Strong effort — HR well controlled. In luteal phase this week, slightly elevated HR (+4-5bpm vs follicular average) is normal. Good aerobic work.' },
    { user_id: PERSONA_IDS.female_cycle, date: daysAgo(10), type: 'note', category: 'coaching_note', source: 'coach', content: 'Cycle phase impact noted: luteal phase runs showing ~5bpm HR elevation at same pace. Recommended Sofia reduce intensity targets by ~5-8% during luteal phase while maintaining volume. She has responded well to this adjusted approach.' },
    { user_id: PERSONA_IDS.female_cycle, date: daysAgo(5), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Easy run 8km. Good recovery effort. 5 weeks to Vienna Marathon. Fitness tracking well — on target for 3:40-3:45 finish based on tempo pace progression.' },

    // Injured (includes injury report)
    { user_id: PERSONA_IDS.injured, date: daysAgo(30), type: 'baseline', category: 'baseline', source: 'system', content: 'Tom Brennan, 41yo male, 78kg, 177cm. Berlin Marathon target 3:30. Strong base runner, 5-6 sessions per week pre-injury. Good aerobic capacity. Older athlete — recovery requires more attention. Currently in base_build phase.' },
    {
      user_id: PERSONA_IDS.injured,
      date: daysAgo(10),
      type: 'injury_report',
      category: 'injury_report',
      source: 'athlete',
      content: JSON.stringify({
        injury_location: 'left knee',
        severity: 'moderate',
        reported_date: daysAgo(10),
        status: 'active',
        symptoms: 'Pain on outside of left knee after runs exceeding 8km. Suspected ITB syndrome.',
        claude_assessment: 'Likely IT band syndrome. Avoid runs over 6km until resolved. Add hip strengthening exercises. No downhill running.',
        rehab_exercises: ['Clamshells 3x15', 'Hip abduction 3x15', 'Foam rolling ITB', 'Single leg glute bridge 3x12'],
      }),
    },
    { user_id: PERSONA_IDS.injured, date: daysAgo(5), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Short 4.5km test run post-injury. HR slightly elevated at this easy pace (likely stress response). No mention of pain during run — positive sign. Continue rehab protocol. Next run max 5km on flat terrain only.' },

    // Elite taper
    { user_id: PERSONA_IDS.elite_taper, date: daysAgo(55), type: 'baseline', category: 'baseline', source: 'system', content: 'Anna Kowalski, 27yo female, 57kg, 165cm. Elite level — London Marathon target 2:45. Exceptional aerobic efficiency (HR 128-132 at 4:30/km easy pace). Currently 8 weeks to race, entering taper. Peak week: 85km. Taper protocol: reduce volume 20% per week over 3 weeks while maintaining intensity. Sub-2:45 requires 3:54/km average.' },
    { user_id: PERSONA_IDS.elite_taper, date: daysAgo(12), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Race pace session: 3x5km @ 3:56/km avg. Excellent execution. First rep 3:57, second 3:55, third 3:54 — negative split showing strong aerobic ceiling. Taper progressing well.' },
    { user_id: PERSONA_IDS.elite_taper, date: daysAgo(8), type: 'note', category: 'coaching_note', source: 'coach', content: 'Taper madness check-in: Anna reporting feeling sluggish and doubting fitness. This is classic taper response — glycogen loading and reduced fatigue will manifest on race day. Current volume 55km vs peak 85km — appropriate 35% reduction. Confidence should return by race week.' },
    { user_id: PERSONA_IDS.elite_taper, date: daysAgo(4), type: 'note', category: 'coaching_note', source: 'coach', content: 'Race week prep: carbohydrate loading from Thursday (600g CHO/day), stay off feet Saturday, race morning target 3h pre-start for breakfast. Pacing strategy: 3:53/km for first 30km, then assess. Sub-2:45 is achievable in good conditions.' },

    // Struggling
    { user_id: PERSONA_IDS.struggling, date: daysAgo(42), type: 'baseline', category: 'baseline', source: 'system', content: 'Dave Thornton, 45yo male, 84kg, 180cm. Frankfurt Marathon target 4:15. Significant fitness gap vs plan — training compliance around 35% of planned sessions. High HR at easy paces (155-165bpm at 7:00/km) suggests poor aerobic base. Plan calls for 4 sessions/week; currently averaging 1.5. Key risk: injury from jumping volume too fast when motivated. Recommend addressing lifestyle barriers first.' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(28), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Run completed after 10-day gap. 6km at 7:00/km, HR 160bpm. Cardiovascular fitness not improving due to inconsistency. Session was solid given the break. Noted: this was a good week — 2 sessions completed vs planned 4. Positive reinforcement: any run is better than no run.' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(20), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Gap of 8 days since last run. Week 4 of 6 in base build — 3 sessions missed. HR still high at easy paces. Recommend a frank coaching conversation about realistic goal adjustment if adherence doesn\'t improve.' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(14), type: 'note', category: 'coaching_note', source: 'coach', content: 'Dave completed 2 runs this week — best week so far! Pace improving slightly (7:00 vs 7:20 previously). Positive trend. Encouraged to pre-schedule runs in calendar and treat them as appointments. Sub-4:30 still achievable if consistency improves now.' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(7), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Another gap of 6 days. Single 5km run logged. Nutrition data from this week shows low calorie days (~1600kcal) and alcohol consumption of 18 units — likely contributing to fatigue and motivation issues. Plan adherence this week: 1/4 sessions (25%).' },

    // Multisport
    { user_id: PERSONA_IDS.multisport, date: daysAgo(45), type: 'baseline', category: 'baseline', source: 'system', content: 'Lena Fischer, 35yo female, 65kg, 170cm. Ironman 70.3 Salzburg target 5:30 (June 14). Three sport athlete: run (strongest), bike (building), swim (limiter — technique issues noted). Currently in build phase across run/bike, base_build for swim. 12 weeks to race. Priority: swim consistency 2x/week, brick sessions 1x/week.' },
    { user_id: PERSONA_IDS.multisport, date: daysAgo(10), type: 'activity_feedback', category: 'activity_feedback', source: 'system', content: 'Brick session: 50km ride + 6km run. Transition time not recorded. Run pace 5:40/km immediately post-bike — excellent! HR high (158bpm) but this is expected in brick sessions. T-legs clearly improving over last 4 weeks.' },
    { user_id: PERSONA_IDS.multisport, date: daysAgo(7), type: 'note', category: 'coaching_note', source: 'coach', content: 'Swim remains the limiter — pull technique causing excessive drag. Recommended: attend at least one coached swim session before race day. Total swim volume last 4 weeks: 9km (target was 14km). This needs addressing — swim accounts for ~20 min of race time but poor technique costs energy for the rest of the day.' },
    { user_id: PERSONA_IDS.multisport, date: daysAgo(3), type: 'note', category: 'coaching_note', source: 'coach', content: 'Next week plan: swim Mon, intervals ride Tue, easy run Wed, off Thu, long brick Sat (70km+6km), OWS Sun. Race is 11 weeks away — this is peak build phase. Key focus: get swim to 2x/week minimum.' },
  ])

  // ── 7. nutrition_logs — Dave (struggling) ──
  console.log('  Seeding nutrition_logs...')
  await ins('nutrition_logs', [
    { user_id: PERSONA_IDS.struggling, date: daysAgo(14), meal_name: 'Skipped breakfast', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meal_type: 'breakfast' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(14), meal_name: 'Fast food lunch', calories: 820, protein_g: 28, carbs_g: 95, fat_g: 38, meal_type: 'lunch', upf_score: 3, sodium_mg: 1800 },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(14), meal_name: 'Beer x4 pints', calories: 720, protein_g: 4, carbs_g: 80, fat_g: 0, meal_type: 'snack', alcohol_units: 8 },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(13), meal_name: 'Toast with peanut butter', calories: 380, protein_g: 14, carbs_g: 42, fat_g: 18, meal_type: 'breakfast' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(13), meal_name: 'Sandwich and crisps', calories: 620, protein_g: 22, carbs_g: 68, fat_g: 28, meal_type: 'lunch', upf_score: 2 },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(13), meal_name: 'Wine x3 glasses', calories: 360, protein_g: 0, carbs_g: 12, fat_g: 0, meal_type: 'snack', alcohol_units: 4.5 },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(12), meal_name: 'Granola and yogurt', calories: 420, protein_g: 18, carbs_g: 62, fat_g: 10, meal_type: 'breakfast' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(12), meal_name: 'Chicken wrap', calories: 580, protein_g: 35, carbs_g: 55, fat_g: 18, meal_type: 'lunch' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(11), meal_name: 'Nothing all day (busy at work)', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, meal_type: 'other', notes: 'Completely forgot to eat — meetings all day' },
    { user_id: PERSONA_IDS.struggling, date: daysAgo(11), meal_name: 'Late night pizza', calories: 1100, protein_g: 38, carbs_g: 130, fat_g: 42, meal_type: 'dinner', upf_score: 2 },
  ])

  // ── 8. cycle_logs — Sofia ──
  console.log('  Seeding cycle_logs...')
  const cycleLogs = []
  for (let i = 18; i >= 0; i--) {
    const dayOfCycle = 18 - i + 1 // days since period start
    let phase
    if (dayOfCycle <= 5) phase = 'menstrual'
    else if (dayOfCycle <= 13) phase = 'follicular'
    else if (dayOfCycle <= 15) phase = 'ovulation'
    else phase = 'luteal'
    cycleLogs.push({
      user_id: PERSONA_IDS.female_cycle,
      log_date: daysAgo(i),
      phase_reported: phase,
      notes: dayOfCycle >= 16 ? 'Feeling slightly heavier legs than usual' : null,
    })
  }
  await ins('cycle_logs', cycleLogs)

  console.log('Seeding complete. 6 personas created.')
  console.log('  bodybuilder:  Marcus Weber   (strength, no races)')
  console.log('  female_cycle: Sofia Müller   (marathon, cycle tracking, luteal phase)')
  console.log('  injured:      Tom Brennan    (marathon, active ITB injury)')
  console.log('  elite_taper:  Anna Kowalski  (elite, 5 weeks to London Marathon)')
  console.log('  struggling:   Dave Thornton  (marathon, low adherence, nutrition issues)')
  console.log('  multisport:   Lena Fischer   (Ironman 70.3, run/ride/swim)')
}

// Run when called directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seedAll().catch(err => {
    console.error('Seed failed:', err.message)
    process.exit(1)
  })
}
