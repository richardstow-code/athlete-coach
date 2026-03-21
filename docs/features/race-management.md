# Race Management

Races are stored as a JSONB array in `athlete_settings.races`. Each entry has:

```json
{
  "name": "Munich Marathon",
  "date": "2026-10-11",
  "type": "Run",
  "distance": "42.2",
  "target": "3:00:00",
  "elevation_m": 180
}
```

The `elevation_m` field is optional (null or absent = flat/unknown). Backward compatibility: old entries may have `elevation` instead of `elevation_m` — code reads both.

---

## Elevation Classification

`src/lib/elevationUtils.js` exports `classifyElevation(elevationM, distanceKm)`:

| Classification | Gain/km | Example (marathon) | Weekly elev target |
|---|---|---|---|
| `flat` | < 5m/km | < 210m | 100–300m (incidental) |
| `rolling` | 5–15m/km | 210–630m | 200–500m base, 400–600m peak |
| `hilly` | 15–30m/km | 630–1260m | 400–700m base, 800–1200m peak |
| `mountainous` | > 30m/km | > 1260m | 600–1000m base, 1500–2500m peak |

Examples:
- **Munich Marathon** (180m / 42.2km = 4.3m/km) → **flat** — pace is the focus
- **Edinburgh Marathon** (450m / 42.2km = 10.7m/km) → **rolling**
- **Jungfrau Marathon** (1800m / 42.2km = 42.7m/km) → **mountainous**
- **Standard gran fondo** (2500m / 160km = 15.6m/km) → **hilly**

---

## Where Elevation Is Used

### Race Setup (Settings.jsx)
- Elevation field shown for race types: Run, Trail Run, Bike, Skimo, Triathlon
- Help text: "Check your race's official course profile. Leave blank if flat or unknown."
- Displayed in race card as `↑ Xm` (hidden if 0 or null)

### Plan Generation (planGenerator.js)
- `classifyElevation()` determines the profile for the target race
- Weekly elevation targets (base + peak phase) are injected into the Claude prompt
- Claude is instructed to ramp elevation progressively and assign `elevation_target_m` to hilly sessions

### Coaching Context (buildContext.js)
- Race summary includes elevation: `"Munich Marathon · 42.2km | target 3:00:00 | ↑ 180m (flat)"`
- ELEVATION TRACKING block added when a race is set:
  - Current week's elevation vs weekly target
  - Status: ✓ on track / ⚠ below target / ↑ above target

### Activity Feedback (strava-webhook.js)
- Webhook fetches race elevation + last-7-days activities at the point of each new activity
- Feedback prompt includes: session elevation, weekly cumulative, race classification, target range
- Graceful fallback if DB fetch fails

---

## Adding a New Race Type with Elevation

1. Add the type to the `includes([...])` check in Settings.jsx race form
2. No other changes needed — elevation flows through automatically via `classifyElevation()`
