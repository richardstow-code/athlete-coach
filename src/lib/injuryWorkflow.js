import { supabase } from './supabase'
import { callClaude } from './claudeProxy'

const TZ = 'Europe/Vienna'

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

// ─── SAVE POST-RUN CHECK-IN ──────────────────────────────────────

export async function savePostRunCheckin({
  activityId,       // bigint (activities.id)
  sessionFeel,      // 1–5 integer or null
  hasInjuryFlag,    // boolean
  athleteNotes,     // string or null
  bodyLocation,     // string or null
  activitySummary,  // plain text summary for Claude context
}) {
  const { data: { user } } = await supabase.auth.getUser()
  const userId = user?.id
  if (!userId) return { injuryFlagged: false }

  if (!hasInjuryFlag) {
    if (sessionFeel) {
      await supabase.from('injury_reports').insert({
        user_id: userId,
        activity_id: activityId || null,
        session_feel: sessionFeel,
        status: 'resolved',
        severity: null,
      })
    }
    return { injuryFlagged: false }
  }

  const assessment = await triageInjuryWithClaude({
    athleteNotes,
    bodyLocation,
    sessionFeel,
    activitySummary,
  })

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const followUpDate = tomorrow.toLocaleDateString('en-CA', { timeZone: TZ })

  const { data: report, error } = await supabase
    .from('injury_reports')
    .insert({
      user_id: userId,
      activity_id: activityId || null,
      session_feel: sessionFeel || null,
      athlete_notes: athleteNotes || null,
      body_location: bodyLocation || null,
      severity: assessment.severity,
      claude_assessment: JSON.stringify(assessment),
      status: 'active',
      follow_up_due_date: followUpDate,
      follow_up_count: 0,
    })
    .select()
    .single()

  if (error) throw error

  await addFollowUpFlag(userId, report.id, followUpDate)

  if (assessment.severity !== 'minor' && assessment.proposedChanges?.length > 0) {
    await proposeInjuryPlanChanges(userId, report.id, assessment.proposedChanges)
  }

  return {
    injuryFlagged: true,
    reportId: report.id,
    assessment,
    severity: assessment.severity,
  }
}

// ─── CLAUDE TRIAGE ───────────────────────────────────────────────

async function triageInjuryWithClaude({ athleteNotes, bodyLocation, sessionFeel, activitySummary }) {
  const prompt = `You are a sports coach assessing a post-run injury report. Respond ONLY with a JSON object.

ACTIVITY: ${activitySummary || 'Not provided'}
SESSION FEEL (1=destroyed, 5=great): ${sessionFeel || 'Not rated'}
BODY LOCATION: ${bodyLocation || 'Not specified'}
ATHLETE NOTES: ${athleteNotes || 'Not provided'}

KNOWN INJURY HISTORY:
- C6 degenerative disc disease (neck/upper back)
- Right shoulder suspected bone spurs (undiagnosed)
- Lower back flares with rapid running ramp-up

Assess and return this exact JSON structure:
{
  "severity": "minor",
  "coachMessage": "2-3 sentence direct assessment. What it likely is. What to do today/tomorrow.",
  "requiresRestDay": false,
  "proposedChanges": [],
  "followUpMessage": "One-line question to ask tomorrow."
}

Severity guide:
- minor: niggle, mild tightness, no functional impact. Monitor only. No plan changes unless it recurs.
- moderate: pain during or after run, localised, likely soft tissue. Suggest load reduction and rehab.
- significant: sharp pain, swelling, structural concern, or relates to known injury history. Flag for physio. Significant plan impact.

proposedChanges should be [] for minor severity.
For moderate: suggest reduced load or add rehab sessions.
For significant: suggest rest days and physio referral, add rehab.

Each change in proposedChanges:
{ "title": "...", "reasoning": "...", "change_type": "reschedule|add_rehab|remove", "days_to_affect": 3, "rehab_exercises": ["exercise 1"] }`

  try {
    const response = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: 'You are a sports medicine-aware running coach. Return only valid JSON. No markdown, no preamble.',
      messages: [{ role: 'user', content: prompt }],
    })
    const text = response?.content?.[0]?.text || '{}'
    const cleaned = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return {
      severity: 'minor',
      coachMessage: 'Unable to assess automatically. Monitor how it feels over the next 24 hours.',
      requiresRestDay: false,
      proposedChanges: [],
      followUpMessage: 'How is it feeling today compared to yesterday?',
    }
  }
}

// ─── PROPOSE PLAN CHANGES ────────────────────────────────────────

async function proposeInjuryPlanChanges(userId, injuryReportId, proposedChanges) {
  for (const change of proposedChanges) {
    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + 1)
    const dateStr = targetDate.toLocaleDateString('en-CA', { timeZone: TZ })

    if (change.change_type === 'add_rehab') {
      await supabase.from('schedule_changes').insert({
        user_id: userId,
        title: change.title,
        reasoning: change.reasoning,
        change_type: 'add_session',
        status: 'pending',
        context: 'injury',
        injury_report_id: injuryReportId,
        new_date: dateStr,
        proposed_session: {
          session_type: 'rehab',
          name: change.title,
          notes: (change.rehab_exercises || []).join(', ') || change.reasoning,
          duration_min_low: 20,
          duration_min_high: 30,
          planned_date: dateStr,
          status: 'planned',
        },
      })
    } else {
      await supabase.from('schedule_changes').insert({
        user_id: userId,
        title: change.title,
        reasoning: change.reasoning,
        change_type: change.change_type,
        status: 'pending',
        context: 'injury',
        injury_report_id: injuryReportId,
        new_date: change.change_type === 'reschedule' ? dateStr : null,
      })
    }
  }
}

// ─── FOLLOW-UP FLAG MANAGEMENT ───────────────────────────────────

async function addFollowUpFlag(userId, injuryReportId, nextFollowUpDate) {
  const { data: settings } = await supabase
    .from('athlete_settings')
    .select('active_injury_follow_ups')
    .maybeSingle()

  const existing = settings?.active_injury_follow_ups || []
  const updated = [...existing, { injury_report_id: injuryReportId, next_follow_up_date: nextFollowUpDate }]

  await supabase
    .from('athlete_settings')
    .update({ active_injury_follow_ups: updated })
    .eq('user_id', userId)
}

export async function removeFollowUpFlag(injuryReportId) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: settings } = await supabase
    .from('athlete_settings')
    .select('active_injury_follow_ups')
    .maybeSingle()

  const existing = settings?.active_injury_follow_ups || []
  const updated = existing.filter(f => f.injury_report_id !== injuryReportId)

  await supabase
    .from('athlete_settings')
    .update({ active_injury_follow_ups: updated })
    .eq('user_id', user.id)
}

// ─── FETCH ACTIVE INJURIES FOR FOLLOW-UP ─────────────────────────

export async function getActiveInjuryFollowUps() {
  const today = todayStr()

  const { data: settings } = await supabase
    .from('athlete_settings')
    .select('active_injury_follow_ups')
    .maybeSingle()

  const flags = settings?.active_injury_follow_ups || []
  const dueToday = flags.filter(f => f.next_follow_up_date <= today)
  if (dueToday.length === 0) return []

  const ids = dueToday.map(f => f.injury_report_id)
  const { data: reports } = await supabase
    .from('injury_reports')
    .select('*')
    .in('id', ids)
    .eq('status', 'active')

  return reports || []
}

// ─── HANDLE FOLLOW-UP RESPONSE ───────────────────────────────────

export async function handleFollowUpResponse({ injuryReportId, feelingBetter }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const { data: report } = await supabase
    .from('injury_reports')
    .select('*')
    .eq('id', injuryReportId)
    .single()

  if (!report) return

  const newFollowUpCount = (report.follow_up_count || 0) + 1

  if (feelingBetter === 'resolved') {
    await supabase
      .from('injury_reports')
      .update({ status: 'resolved', resolved_at: new Date().toISOString(), follow_up_count: newFollowUpCount })
      .eq('id', injuryReportId)
    await removeFollowUpFlag(injuryReportId)
    return { action: 'resolved' }
  }

  const nextFollowUp = new Date()
  nextFollowUp.setDate(nextFollowUp.getDate() + 7)
  const nextDate = nextFollowUp.toLocaleDateString('en-CA', { timeZone: TZ })

  await supabase
    .from('injury_reports')
    .update({ follow_up_count: newFollowUpCount, follow_up_due_date: nextDate, status: 'monitoring' })
    .eq('id', injuryReportId)

  const { data: settings } = await supabase
    .from('athlete_settings')
    .select('active_injury_follow_ups')
    .maybeSingle()

  const existing = settings?.active_injury_follow_ups || []
  const updated = existing.map(f =>
    f.injury_report_id === injuryReportId ? { ...f, next_follow_up_date: nextDate } : f
  )
  await supabase
    .from('athlete_settings')
    .update({ active_injury_follow_ups: updated })
    .eq('user_id', user.id)

  if (newFollowUpCount >= 2 && feelingBetter === 'worse') {
    await supabase.from('schedule_changes').insert({
      user_id: user.id,
      title: `Injury review — ${report.body_location || 'ongoing issue'}`,
      reasoning: `Injury reported on ${report.reported_at?.split('T')[0]} has not resolved after ${newFollowUpCount} check-ins. Consider physio and further plan modification.`,
      change_type: 'review',
      status: 'pending',
      context: 'injury',
      injury_report_id: injuryReportId,
    })
  }

  return { action: 'monitoring', nextFollowUp: nextDate }
}
