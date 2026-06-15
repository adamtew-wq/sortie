# CLAUDE.md — Sortie's AI operating manual

This file tells Claude Code how to act as Sortie's **AI side door** (see ADR-0001). You are one of two consumers of the Framework — the other is the in-browser PWA engine. Both must produce **identical, schema-valid sessions** by obeying the written spec in `framework/`. You never invent training logic; you execute the spec.

Always read `framework/CONTEXT.md` first — it is the canonical glossary. Use those terms exactly.

---

## Repository map

- `framework/` — the authoritative rules (read-only logic; edit only when explicitly asked to change the rules):
  - `CONTEXT.md` — glossary. Read first.
  - `session-schema.json` — the shape every generated Session must conform to.
  - `exercise-library.json` — catalogue of exercises; each maps to a Modality, movement pattern, and required equipment keys.
  - `session-templates.json` — spine templates (weights) + cardio archetypes; reference exercises by name.
  - `progression-rules.md` — exact load/cardio progression maths, stall and deload triggers.
  - `load-balancing.md` — weekly load caps, hard/easy spacing, Training-load computation, Readiness scaling.
  - `injury-routing.md` — movement-pattern → substitution map for niggles.
  - `rehab-protocols.json` — placeholder rehab protocols to weave in for active niggles.
- `data/` — the user's data (single source of truth; safe to read/append):
  - `equipment.json`, `baselines.json`, `attributes.json`, `niggles.json`, `events.json` — profiles & state.
  - `history.jsonl` — append-only log of completed Sessions (one JSON object per line).
- `app/` — the PWA. `app/engine/` is the deterministic engine; your generation logic must match it.

---

## Task 1 — Generate a Session

When the user asks for "today's session" (or gives constraints like time/location/how they feel):

1. **Gather inputs:** time budget (minutes), Equipment profile key (Home / Military / ad-hoc list), Check-in → Readiness (energy + soreness + sleep), active niggles, today's date. Ask only for what's missing; default sensibly.
2. **Read** `data/history.jsonl` (recent Sessions), `data/attributes.json`, `data/events.json`, `data/niggles.json`, `data/baselines.json`, `data/equipment.json`.
3. **Determine Modality:** compare recent per-Modality Training load against Attribute weights and any active Event overlay; pick the Modality/session type that best closes the gap (`load-balancing.md`).
4. **Select template** from `session-templates.json`; rotate accessories if the 4–6 week cadence is reached; spine lifts persist.
5. **Filter by equipment:** drop any exercise needing kit absent from the active Equipment profile.
6. **Apply progression** (`progression-rules.md`): look up each spine lift's last logged load in `history.jsonl`; advance (+2.5 kg on success), repeat (after a stall), or deload (to 90% after three stalls).
7. **Apply Readiness** (`load-balancing.md`): if low, cut volume/intensity.
8. **Route around niggles** (`injury-routing.md`): exclude affected movement patterns, substitute, and weave the linked Rehab protocol (`rehab-protocols.json`) into warm-up/accessory slots.
9. **Emit** a Session as JSON conforming to `session-schema.json` — warm-up, main work, cooldown, a one-line `rationale`, and metadata (modality, duration, equipment profile, readiness). Then present it readably to the user.

**Hard rules:** never prescribe an exercise needing unavailable equipment; never load a flagged movement pattern; output must validate against `session-schema.json`.

## Task 2 — Log a completed Session

When the user reports what they actually did:

1. Build a log entry: `date` (ISO), `modality`, `duration` (min), `sessionType`, `exercises` (each with actual sets/reps/load, marking skipped sets), session `rpe` (1–10), and `equipmentProfile` used. Match the log extension of `session-schema.json` so the PWA and Claude stay interoperable.
2. **Append** it as a single line to `data/history.jsonl` (one JSON object per line — do not reformat or rewrite existing lines).
3. If a niggle was flagged or cleared during the session, update `data/niggles.json` accordingly (archive cleared niggles, don't delete — preserve history).
4. Commit the change (`data/` is the single source of truth). Keep history append-only so it never conflicts across devices.

## Task 3 — Add or update Framework content

When asked to change the rules (new exercises, adjusted progression, a real rehab protocol from the user's clinician, etc.):

1. Confirm which `framework/` file owns that concept (see map above) and read it.
2. Make the change, keeping JSON valid and terminology aligned with `CONTEXT.md`.
3. Keep `exercise-library.json` equipment keys consistent with `data/equipment.json`.
4. If the change is an architectural decision, record it as a new ADR in `docs/adr/`.
5. After editing, sanity-check by generating 2–3 Sessions and confirming they still validate against `session-schema.json`.

---

## Conventions

- **JSON** files: 2-space indent, valid JSON (no comments, no trailing commas). `history.jsonl` is the sole exception: newline-delimited JSON, append-only.
- **Terminology:** only the glossary terms in `framework/CONTEXT.md`. No synonyms.
- **Determinism:** given the same inputs, framework, and data, you should produce the same Session the PWA engine would. The Framework decides; you interpret.
- **Privacy:** never write a GitHub PAT or any secret into a file or commit.
