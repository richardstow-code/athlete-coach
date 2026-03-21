export const CANONICAL_SPORTS = [
  { key: 'running',       label: 'Running',       metric: 'km'       },
  { key: 'cycling',       label: 'Cycling',       metric: 'km'       },
  { key: 'swimming',      label: 'Swimming',      metric: 'km'       },
  { key: 'triathlon',     label: 'Triathlon',     metric: 'mixed'    },
  { key: 'strength',      label: 'Strength',      metric: 'sessions' },
  { key: 'hiking',        label: 'Hiking',        metric: 'km'       },
  { key: 'trail_running', label: 'Trail Running', metric: 'km'       },
  { key: 'rowing',        label: 'Rowing',        metric: 'km'       },
  { key: 'yoga',          label: 'Yoga',          metric: 'sessions' },
  { key: 'crossfit',      label: 'CrossFit',      metric: 'sessions' },
  { key: 'other',         label: 'Other',         metric: 'sessions' },
]

const ALIASES = {
  'run':              'running',
  'runs':             'running',
  'runing':           'running',
  'road running':     'running',
  'marathon':         'running',
  'half marathon':    'running',
  'bike':             'cycling',
  'biking':           'cycling',
  'bicycle':          'cycling',
  'road cycling':     'cycling',
  'mtb':              'cycling',
  'mountain biking':  'cycling',
  'swim':             'swimming',
  'swiming':          'swimming',
  'tri':              'triathlon',
  'weights':          'strength',
  'weight training':  'strength',
  'gym':              'strength',
  'lifting':          'strength',
  'weightlifting':    'strength',
  'powerlifting':     'strength',
  'bodybuilding':     'strength',
  'hike':             'hiking',
  'trail':            'trail_running',
  'trail run':        'trail_running',
  'erg':              'rowing',
}

/**
 * Normalise a user-supplied sport string to a canonical key.
 * Returns 'other' for unrecognised inputs.
 */
export function normaliseSport(input) {
  if (!input) return 'other'
  const lower = input.trim().toLowerCase()
  if (ALIASES[lower]) return ALIASES[lower]
  const exact = CANONICAL_SPORTS.find(s => s.key === lower || s.label.toLowerCase() === lower)
  if (exact) return exact.key
  const partial = CANONICAL_SPORTS.find(s => lower.includes(s.key) || s.key.includes(lower))
  if (partial) return partial.key
  return 'other'
}

/**
 * Get the full canonical sport object for a given key.
 */
export function getCanonicalSport(key) {
  return CANONICAL_SPORTS.find(s => s.key === key) || CANONICAL_SPORTS.find(s => s.key === 'other')
}
