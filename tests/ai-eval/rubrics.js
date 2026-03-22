/**
 * AI Coaching Quality Evaluator — Persona Rubrics
 *
 * Each rubric defines:
 *   - persona_description: context given to the evaluator Claude
 *   - test_prompts: canonical questions fired at the coaching AI
 *   - criteria: list of pass/fail checks, each flagged critical or not
 *
 * CRITICAL criteria failures cause the overall eval to exit 1.
 * Non-critical failures are logged as warnings but do not block release.
 */

export const RUBRICS = {
  bodybuilder: {
    persona_description:
      'Marcus, 32yo male, 92kg. Goal: strength/hypertrophy. No running. Trains WeightTraining only. Progressive overload focus.',
    test_prompts: [
      'What should I focus on this week?',
      'How is my training going?',
      'I missed my leg session yesterday, what do I do?',
    ],
    criteria: [
      {
        id: 'no_running_prescribed',
        label: 'Response does not prescribe running or cardio unprompted',
        critical: true,
      },
      {
        id: 'strength_language',
        label: 'Response uses strength-appropriate language (sets, reps, load, muscle groups)',
        critical: true,
      },
      {
        id: 'no_z2_references',
        label: 'Response does not reference Z2, heart rate zones, or aerobic base',
        critical: true,
      },
      {
        id: 'actionable',
        label: 'Response gives specific, actionable strength guidance',
        critical: false,
      },
      {
        id: 'appropriate_length',
        label: 'Response is appropriately concise (not a 1000-word essay)',
        critical: false,
      },
    ],
  },

  female_cycle: {
    persona_description:
      'Sofia, 29yo female. Marathon training. Cycle tracking active. Currently in LUTEAL phase (day 18 of 28-day cycle). Race in 5 weeks. Training is building phase.',
    test_prompts: [
      'How am I feeling today compared to last week?',
      'Should I do my hard session today?',
      'Why might my runs feel harder this week?',
    ],
    criteria: [
      {
        id: 'cycle_awareness',
        label: 'Response acknowledges cycle phase (luteal) when relevant to the question',
        critical: true,
      },
      {
        id: 'no_generic_advice',
        label: 'Response does not give generic advice that ignores cycle context',
        critical: false,
      },
      {
        id: 'luteal_appropriate',
        label: 'For hard session question: response appropriately considers luteal phase fatigue',
        critical: true,
      },
      {
        id: 'empathetic_tone',
        label: 'Tone is supportive and acknowledges physiological factors, not dismissive',
        critical: false,
      },
      {
        id: 'no_override_physiology',
        label: 'Response does not dismiss or minimize the impact of cycle phase on performance',
        critical: true,
      },
    ],
  },

  injured: {
    persona_description:
      'Tom, 41yo male. Marathon training. ACTIVE INJURY: left knee, suspected ITB syndrome, moderate severity, reported 10 days ago. Rehab plan in place. Cleared for runs under 6km only.',
    test_prompts: [
      'Can I do a long run this weekend?',
      'What should my training look like this week?',
      'My knee feels a bit better today, can I push harder?',
    ],
    criteria: [
      {
        id: 'injury_acknowledged',
        label: 'Response explicitly references the knee injury / ITB issue',
        critical: true,
      },
      {
        id: 'no_unsafe_advice',
        label: 'Response does NOT recommend running more than 6km or doing downhill running',
        critical: true,
      },
      {
        id: 'no_overhead_wording',
        label: "For 'push harder' prompt: response does not simply say yes without caveats",
        critical: true,
      },
      {
        id: 'rehab_mentioned',
        label: 'Response references rehab exercises or recovery protocol',
        critical: false,
      },
      {
        id: 'professional_referral',
        label: 'If severity seems unresolved, response suggests consulting a physio',
        critical: false,
      },
      {
        id: 'empathetic_not_dismissive',
        label: 'Response acknowledges frustration of injury without dismissing it',
        critical: false,
      },
    ],
  },

  elite_taper: {
    persona_description:
      'Anna, 27yo female. Elite marathon runner. Goal: sub-2:45 at London Marathon in 5 weeks. Currently in TAPER phase. Weekly volume reducing. Fitness is peak. Very efficient aerobic system (easy run HR 130-145).',
    test_prompts: [
      'My legs feel heavy and sluggish. Is something wrong?',
      'Should I add more volume this week to feel sharper?',
      'How should I approach race week?',
    ],
    criteria: [
      {
        id: 'taper_awareness',
        label: 'Response demonstrates awareness of taper phase',
        critical: true,
      },
      {
        id: 'no_volume_increase',
        label: "For 'add more volume' prompt: response advises AGAINST adding volume in taper",
        critical: true,
      },
      {
        id: 'taper_madness_context',
        label: "For 'heavy legs' prompt: response contextualises this as normal taper response",
        critical: true,
      },
      {
        id: 'elite_appropriate',
        label: 'Advice is calibrated for an elite athlete, not a beginner',
        critical: false,
      },
      {
        id: 'no_base_building_advice',
        label: 'Response does not suggest base-building work inappropriate for taper',
        critical: true,
      },
      {
        id: 'race_specific',
        label: 'Race week advice is specific and tactical (pacing, nutrition, warm-up)',
        critical: false,
      },
    ],
  },

  struggling: {
    persona_description:
      'Dave, 45yo male. Amateur marathon runner, goal 4:15. Consistently missing sessions. Low fitness relative to plan. Inconsistent nutrition. 18 units alcohol last week. Needs encouragement but honest feedback.',
    test_prompts: [
      'I missed most of my runs this week again.',
      "I'm not sure I can hit my goal time.",
      'What do I need to do to get back on track?',
    ],
    criteria: [
      {
        id: 'honest_not_harsh',
        label: 'Response is honest about the gap but not punishing or shaming',
        critical: true,
      },
      {
        id: 'no_empty_reassurance',
        label: "Response does not give empty 'you can do it!' reassurance without substance",
        critical: false,
      },
      {
        id: 'actionable_recovery',
        label: 'Response gives specific, achievable steps to get back on track',
        critical: true,
      },
      {
        id: 'plan_adjustment',
        label: 'Response suggests adjusting the plan rather than abandoning it',
        critical: false,
      },
      {
        id: 'alcohol_flag_if_relevant',
        label: 'If nutrition/recovery discussed, 18 units alcohol is noted as above target',
        critical: false,
      },
      {
        id: 'no_catastrophising',
        label: 'Response does not catastrophise the missed sessions',
        critical: false,
      },
    ],
  },

  multisport: {
    persona_description:
      'Lena, 35yo female. Training for Ironman 70.3 Salzburg in June. Three sports: running (priority 1), cycling (priority 2), swimming (priority 3). Swim is the limiter. Brick sessions in plan.',
    test_prompts: [
      'How is my training across all three sports?',
      'Which sport should I prioritise this week?',
      'My swim sessions feel really hard. What should I do?',
    ],
    criteria: [
      {
        id: 'all_sports_referenced',
        label: 'Response references all three sports (run, bike, swim) when asked about overall training',
        critical: true,
      },
      {
        id: 'no_running_only_framing',
        label: 'Response does not treat the athlete as a runner-only',
        critical: true,
      },
      {
        id: 'swim_limiter_awareness',
        label: 'For swim question: response acknowledges swimming is the identified limiter',
        critical: true,
      },
      {
        id: 'triathlon_specific',
        label: 'Response uses triathlon-appropriate language (brick, transition, T1/T2, etc.)',
        critical: false,
      },
      {
        id: 'sport_priority_respected',
        label: 'When advising on prioritisation, respects the running > cycling > swimming hierarchy',
        critical: false,
      },
      {
        id: 'cross_training_recognised',
        label: 'Response recognises cross-training load from cycling/swimming as valid training stress',
        critical: false,
      },
    ],
  },
}
