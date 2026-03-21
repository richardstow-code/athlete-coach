# Sport Normalisation

`src/lib/sportUtils.js` provides canonical sport identification across the app.

## Canonical Sports List

| Key | Label | Metric |
|-----|-------|--------|
| `running` | Running | km |
| `cycling` | Cycling | km |
| `swimming` | Swimming | km |
| `triathlon` | Triathlon | mixed |
| `strength` | Strength | sessions |
| `hiking` | Hiking | km |
| `trail_running` | Trail Running | km |
| `rowing` | Rowing | km |
| `yoga` | Yoga | sessions |
| `crossfit` | CrossFit | sessions |
| `other` | Other | sessions |

## Aliases

Common user-typed variants map to canonical keys:

- `run`, `runs`, `runing`, `marathon`, `half marathon`, `road running` → `running`
- `bike`, `biking`, `bicycle`, `road cycling`, `mtb`, `mountain biking` → `cycling`
- `swim`, `swiming` → `swimming`
- `tri` → `triathlon`
- `weights`, `weight training`, `gym`, `lifting`, `weightlifting`, `powerlifting`, `bodybuilding` → `strength`
- `hike` → `hiking`
- `trail`, `trail run` → `trail_running`
- `erg` → `rowing`

## API

### `normaliseSport(input: string): string`
Takes any user-supplied sport string and returns the canonical key. Resolution order:
1. Alias lookup (exact match on lower-cased input)
2. Canonical key/label exact match
3. Partial match (input contains key, or key contains input)
4. Falls back to `'other'`

### `getCanonicalSport(key: string): object`
Returns the full canonical sport object `{ key, label, metric }` for a given key. Falls back to the `'other` object.

## Where Normalisation Is Applied

- **Onboarding sports step** (`Onboarding.jsx`): `addSport()` calls `normaliseSport()` before adding to state. Users see the canonical label immediately (e.g. "runing" → "Running"). Sports are deduplicated by canonical key, not raw input.
- **athlete_sports table**: rows now store both `sport_key` (canonical) and `display_name` (canonical label), alongside the original `sport_raw` (user's typed text).

## Adding New Sports

1. Add a new object to `CANONICAL_SPORTS` in `sportUtils.js`
2. Add any expected typos/aliases to `ALIASES`
3. Update the `SPORT_CHIPS` array in `Onboarding.jsx` if the sport should appear as a quick-pick chip
