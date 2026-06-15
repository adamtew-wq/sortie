# Progression rules

The maths the engine and Claude Code must apply, identically, to set today's loads, paces and durations from yesterday's logged Sessions.

## 1. Spine lift load progression (weights)

Each spine lift (see `session-templates.json` → `weights.*.spine`) carries its own load and a small per-lift state derived from `data/history.jsonl`.

### Success / failure definition

A spine-lift session is **successful** when every prescribed working set hits its target reps at the prescribed load, with the user's logged session RPE ≤ 9. Anything else — a skipped working set, reps short on any set, RPE 10, or load reduced mid-session — is a **failure** at that weight.

### Linear progression

- After every **successful** session at weight `W`: prescribe `W + 2.5 kg` next time.
- For unilateral / single-arm spine variants (none ship today, but the rule applies if added): use `W + 1.25 kg` per side.

### Stall (two failures at the same weight)

- If the lift **fails twice in a row at the same weight** (whether two consecutive sessions of that template, or two attempts separated only by other modalities), declare a **stall**.
- After a stall: prescribe the **same weight** again next time (i.e. **repeat**, do not retreat yet). Reset the failure counter to 0 and the stall counter increments by 1.

### Deload (three stalls)

- If a lift accumulates **three stalls** without an intervening success, trigger a **deload**:
  - Next prescribed load is **90%** of the stalled weight, rounded to the nearest 2.5 kg.
  - The stall counter resets to 0 on the next success.
- Linear progression resumes from the deload weight.

### Pseudocode

```
state = { weight, consecutiveFails, stalls }
on success:
  weight = weight + 2.5
  consecutiveFails = 0
  stalls = 0
on failure:
  consecutiveFails += 1
  if consecutiveFails >= 2:
    stalls += 1
    consecutiveFails = 0
    if stalls >= 3:
      weight = round_to_2_5(weight * 0.90)
      stalls = 0
    # else: repeat the same weight next session
```

## 2. Cardio progression

Cardio sessions carry per-Modality state: a target **pace** (or power, for bike) for each session type, and a target **duration** for steady/long sessions.

### Easy / steady sessions

- Hold pace and duration until **two consecutive** easy/steady sessions at the target are logged with a session RPE ≤ 6.
- On meeting that bar: increase **duration by 5 minutes** *or* **pace by ~1%** (alternate sessions). Do not bump both at once.

### Interval sessions (intervals / tempo / threshold / hill repeats / VO2 / sweet-spot)

- A session is **successful** when every prescribed rep hits its target pace (or power band, ±2%) at the prescribed work:rest ratio.
- After a successful session: add either **one more rep** or **5 seconds per rep** (alternate sessions).
- On a failure (any rep dropped >5% off pace, or work:rest violated): hold the same prescription next time. Two consecutive failures → deload the rep count by 1 *and* reduce target pace by 1%.

### Swim-specific

- Pace is tracked per stroke and per distance (e.g. 100 m front crawl). Threshold sets progress by **dropping interval times by 1 second** per successful session, not by pace percent.

### Bike-specific

- Where the user logs power: progress sweet-spot and VO2 by **+5 W** on the upper bound after a successful session.
- Where the user logs by RPE only: treat the same as run intervals (rep count / per-rep duration).

## 3. Deload week triggers

A whole-week deload (lighter loads, reduced volume, more recovery) triggers when **either** condition is met:

- **Readiness rolling-3 trigger:** three consecutive days of logged Readiness ≤ 2 (out of 5).
- **Spine-lift stall trigger:** any two spine lifts simultaneously sitting at a stall (`stalls ≥ 1`) for two calendar weeks without a successful session.

During a deload week:

- Spine lifts prescribe **80%** of their working weight for one session each, then resume normal progression the following week.
- Cardio volume drops to **70%** of the prior week's logged duration per Modality.
- Conditioning sessions are replaced with `easy` cardio or mobility work.

## 4. Readiness modifiers (interacts with `load-balancing.md`)

Readiness adjusts the *today's prescription* on top of the long-term progression state — it does **not** rewrite the stored progression state. See `load-balancing.md` § "Readiness scaling" for the exact multipliers; this file owns the long-run progression maths.

## 5. Rounding

- Loads round to the nearest **2.5 kg** (the smallest plate pair routinely available). Where the engine produces e.g. 102.625 kg from a 90% deload of 114, prescribe **102.5 kg**.
- Durations round to the nearest **minute**; paces to the nearest **second per km / 100 m**.
