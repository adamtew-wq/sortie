# Load balancing

How the engine and Claude Code keep the week balanced across Modalities and scale today's Prescription by Readiness.

## 1. Training-load computation

Training load is computed **per Modality, per logged Session** from `data/history.jsonl`:

```
load(session) = volumeFactor × intensityFactor × durationMinutes
```

Where:

- **weights:** `volumeFactor` = total working reps × prescribed load (in kg) ÷ 1000; `intensityFactor` = session RPE ÷ 7. Carry / core / rehab blocks are excluded from `volumeFactor`.
- **run / bike:** `volumeFactor` = 1; `intensityFactor` = session RPE ÷ 7 (Z2 ≈ 0.5, threshold ≈ 1.0, VO2 ≈ 1.4).
- **swim:** `volumeFactor` = total metres ÷ 1000; `intensityFactor` as for run.
- **conditioning:** `volumeFactor` = 1; `intensityFactor` = session RPE ÷ 6 (conditioning skews intense).

The **weekly Training-load per Modality** is the sum of `load(session)` for sessions whose date falls in the last 7 days.

## 2. Weekly caps (per Modality, per ISO week)

These caps prevent any one Modality from crowding the others. Caps are expressed as session counts and as total minutes; whichever is hit first ends that Modality's allocation for the week.

| Modality | Max sessions / week | Max minutes / week |
|---|---|---|
| weights | 4 | 240 |
| run | 4 | 240 |
| swim | 3 | 150 |
| bike | 3 | 240 |
| conditioning | 3 | 120 |

When a cap would be breached, the engine selects the next-best Modality (per Attribute weights minus current Training load) instead.

## 3. Hard / easy spacing

To prevent overlapping high-stress days:

- **No two heavy same-pattern sessions in a row.** A "heavy" session is a spine-lift session with no readiness cut, or a Modality session at RPE ≥ 8. Patterns map to the movement patterns of the spine lifts (squat, hinge, push, pull).
  - Example: heavy `lower` (squat + hinge) yesterday → today must be upper, cardio, conditioning, or an `easy` lower session.
- **At least one easy day between two threshold-or-above cardio sessions.** Threshold-or-above = tempo, threshold, VO2, intervals, sweet-spot, hill repeats.
- **Conditioning is always a hard day** for the purposes of spacing — treat it like a threshold cardio session for the next-day check.

## 4. Modality selection (per day)

1. Take the active Attributes (per-Attribute weights from `data/attributes.json`).
2. Apply the Event overlay (per `data/events.json`) — relevant Modalities get a multiplier of `1 + (taperBoost)`; taper boost ramps from 0 → 0.5 over the final 4 weeks before the event date.
3. Subtract this week's Training load per Modality (normalised to its weekly minutes cap).
4. The Modality with the largest **(weighted want − current load)** gap, *after applying hard/easy spacing and weekly caps*, wins.
5. The session type within that Modality is chosen by the rotation: spine-template slot for weights (round-robin since last session of that type); cardio archetype per current block's emphasis.

## 5. Readiness scaling

Today's Readiness (from the Check-in) modifies the day's Prescription **without** touching the long-run progression state in `progression-rules.md`.

| Readiness | Volume multiplier | Intensity multiplier | Substitutions |
|---|---|---|---|
| 5 (excellent) | 1.0 | 1.0 | none |
| 4 (good) | 1.0 | 1.0 | none |
| 3 (ok) | 0.85 | 0.95 | drop the last accessory if it pushes duration over budget |
| 2 (low) | 0.70 | 0.90 | replace conditioning / intervals with `easy` cardio of the same Modality |
| 1 (poor) | 0.50 | 0.80 | swap weights for mobility + Z2 cardio; cap duration at 25 min |

Volume multiplier applies to **sets** for weights and **duration / rep count** for cardio/conditioning. Intensity multiplier applies to **load** for weights and to **target pace / power** for cardio.

Rounding: post-multiplier loads round to the nearest 2.5 kg; durations round to the nearest minute.

## 6. Interaction with niggles

When a niggle is active (`data/niggles.json`):

- The affected movement pattern is excluded *before* template selection (see `injury-routing.md`).
- The matching Rehab protocol (per `framework/rehab-protocols.json` or `data/`) is woven into warm-up and cooldown — these blocks count toward duration but **not** toward Training load.
- Readiness multipliers still apply on top.
