# Injury routing

How an active Niggle (per `data/niggles.json`) excludes movement patterns and substitutes safer exercises. Both the engine and Claude Code apply this map identically *before* the equipment filter and *before* Readiness scaling.

## Substitution principle

For each active Niggle:

1. Look up its `affectedPatterns` in the table below.
2. **Exclude** any exercise in `framework/exercise-library.json` whose `movementPatterns` intersect the affected set.
3. Try the **preferred substitutes** in order; the first that survives the equipment filter wins.
4. Weave the linked Rehab protocol (from `framework/rehab-protocols.json` or `data/`) into warm-up and (where appropriate) cooldown blocks. Mark each woven block with `"rehab": true`.

If no substitute survives the equipment filter for a given slot, drop the slot rather than force a contraindicated pattern.

---

## knee

**Affected patterns:** `squat`, optionally `hinge` if loaded heavy.

**Avoid:** Back squat, Front squat, Bulgarian split squat, Pistol squat, Reverse / walking lunge, Dumbbell step-up, Box jump, Sled push, Wall ball, Dumbbell thruster.

**Preferred substitutes (in order):**
- Hip-dominant pulls — Romanian deadlift, Single-leg Romanian deadlift, Kettlebell deadlift (light)
- Hip thrust (knee-friendly, glute-dominant)
- Upper-body push/pull work
- Swim or bike (no impact)
- Easy run **only** if the user explicitly clears it (default: no run)

**Weave:** the `knee-basic` Rehab protocol into warm-up.

---

## shoulder

**Affected patterns:** `push`, and `pull` if pain is anterior / impingement-type.

**Avoid:** Bench press, Overhead press, Dumbbell shoulder press, Pike push-up, Dips, Weighted pull-up, Burpee (push phase), Dumbbell thruster, Wall ball.

**Preferred substitutes (in order):**
- Floor-based push — Dumbbell floor press (limits shoulder ROM)
- Horizontal pulls only — Dumbbell row, Single-arm dumbbell row, Inverted row at shallow angle
- Band pull-apart, Face pull (scap-focused)
- Lower-body and core work
- Bike or run (avoid swim until cleared)

**Weave:** the `shoulder-basic` Rehab protocol into warm-up and cooldown.

---

## lower-back

**Affected patterns:** `hinge`, `squat` (loaded), `carry` (heavy).

**Avoid:** Conventional deadlift, Romanian deadlift, Good morning, Back squat, Front squat, Barbell row, Kettlebell swing, Sandbag carry, heavy Farmer's carry.

**Preferred substitutes (in order):**
- Goblet squat (light, to tolerance)
- Hip thrust (back-supported)
- Single-leg Romanian deadlift (light, balance + glute focus)
- Upper-body push/pull from supported positions — Dumbbell floor press, Dumbbell row
- Core anti-extension work — Dead bug, Bird dog, Pallof press, Plank
- Easy bike (avoid running until pain-free walking is restored)

**Weave:** the `lower-back-basic` Rehab protocol into warm-up and cooldown.

---

## hip

**Affected patterns:** `hinge`, `squat`, and unilateral `squat` variants.

**Avoid:** Back squat, Front squat, Conventional deadlift, Romanian deadlift, Bulgarian split squat, Walking lunge, Reverse lunge, heavy Kettlebell swing.

**Preferred substitutes (in order):**
- Goblet squat to a box (depth-limited)
- Hip thrust (glute-bias, hip extension only)
- Single-leg Romanian deadlift (light, controlled)
- Upper-body and core work
- Swim (low impact, hip-friendly) or easy bike

**Weave:** the `lower-back-basic` Rehab protocol — same posterior-chain and hip-mobility battery is the placeholder default until the user supplies a hip-specific protocol.

---

## ankle

**Affected patterns:** `cardio` (running impact), `squat` (deep flexion).

**Avoid:** Easy run, Long run, Tempo run, Interval run, Hill repeats, Treadmill (any), Box jump, Burpee, Jump rope, Bear crawl, deep Back / Front squat.

**Preferred substitutes (in order):**
- Swim (any session type)
- Easy / Tempo bike, Long ride
- Hip thrust, Romanian deadlift, Single-leg Romanian deadlift (seated / supported variants if standing aggravates)
- Upper-body push/pull
- Goblet squat to a high box (range-limited)
- Core work

**Weave:** the `lower-back-basic` Rehab protocol's mobility battery acts as the placeholder ankle warm-up until an ankle-specific protocol is supplied.

---

## Combined niggles

When more than one niggle is active, take the **union** of affected patterns. If the union excludes more than half the patterns the day's Modality needs, switch Modality (per `load-balancing.md` § "Modality selection") rather than ship a thin Session.
