# Sortie — Canonical Glossary (CONTEXT.md)

This is the **single source of terminology** for Sortie. Every file, UI string, ADR, commit, and Claude Code interaction must use these terms with exactly these meanings. No synonyms, no drift. If a concept isn't here, it doesn't exist in Sortie's domain language yet — add it here first.

---

**Session**
A single, self-contained training unit generated for a given day: a warm-up block, a main-work block, and a cooldown block, plus metadata (modality, duration, rationale, equipment profile used, readiness score). A Session is what the engine emits and what the user logs. It is conformant to `framework/session-schema.json`.

**Modality**
A category of training. Sortie has exactly five: `weights`, `run`, `swim`, `bike`, `conditioning`. Every Session belongs to one Modality.

**Attribute**
A persistent training objective with a relative priority weight (e.g. strength, aerobic base, 5k speed, swim fitness, body composition). Attributes express *what the user is training toward over the long run* and bias Modality selection. Stored in `data/attributes.json`.

**Event overlay**
A dated, named focus (e.g. a fitness test, a race, a deployment) that temporarily biases Session suggestions toward relevant Modalities/Attributes and tapers volume in the final week. It layers *on top of* Attribute balancing and expires automatically the day after the event date. Stored in `data/events.json`.

**Check-in**
The 5-second daily input the user gives on opening the app: energy (1–5), soreness (none/upper/lower/full), sleep (poor/ok/good). The Check-in produces the day's Readiness score.

**Readiness**
A score derived from the Check-in (energy + soreness + sleep) that scales the day's Prescription intensity and volume. Low Readiness → shorter/lighter Session; high Readiness → full Prescription.

**Training load**
A computed measure of accumulated training stress, derived per-Modality from logged Sessions (volume × intensity × duration, per `framework/load-balancing.md`). Used to balance Modalities over the week and to detect imbalance.

**Equipment profile**
A named inventory of available kit (e.g. Home, Military) that constrains which exercises a Session may use. An ad-hoc profile is a one-off subset selected for a single Session. Stored in `data/equipment.json`; keys are referenced by `framework/exercise-library.json`.

**Niggle / injury**
A flagged physical complaint with one or more affected movement patterns, a severity, a date flagged, and an optional linked Rehab protocol. While active, a Niggle causes the engine to exclude affected patterns and auto-weave the linked Rehab protocol into Sessions. Stored in `data/niggles.json`. ("Niggle" and "injury" are used interchangeably; severity distinguishes them in practice.)

**Rehab protocol**
A named set of remedial exercises (name, sets, reps/duration, cue) linked to an injury type, designed to be woven into Sessions or run standalone. Placeholder protocols ship in `framework/rehab-protocols.json`; user-/clinician-specific protocols are seeded in `data/`.

**Spine**
The slow-rotating core of the training plan: the persistent spine lifts (e.g. back squat, deadlift, bench press, overhead press, weighted pull-up) and the spine Session templates. The Spine progresses linearly and persists; accessories rotate around it every 4–6 weeks.

**Framework**
The written rules engine in `framework/`: exercise library, Session schema, templates, progression rules, load balancing, injury routing, and rehab protocols. The Framework is authoritative — both the PWA engine and Claude Code must obey it. It is *not* a runtime API; it is a specification (see ADR-0001).

**Prescription**
The concrete, dated instruction a Session contains: the specific exercises, sets, reps/duration, and loads prescribed for the user today. Distinct from the Session as a whole — the Prescription is the "what to actually do" payload that the user confirms or edits while logging.
