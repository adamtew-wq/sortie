# ADR-0001: The Framework is a written specification, not a runtime API

- **Status:** Accepted
- **Date:** 2026-06-15

## Context

Sortie needs a body of training logic — an exercise library, session shapes, progression maths, load-balancing and safety rules. There are two broad ways to hold this logic:

1. As a **runtime service/API**: a hosted endpoint that, given inputs, returns a session. Logic lives in server code.
2. As a **written specification** (`framework/`): JSON + Markdown files that *describe* the rules, which any consumer (the PWA's deterministic engine, or Claude Code) reads and executes.

Two distinct consumers must produce identical sessions: the in-browser PWA engine and Claude Code acting as an AI side door. There is no server (see ADR-0002) and the repo is the database (see ADR-0003).

## Decision

The Framework is a **written specification** stored in `framework/`. It contains no executable runtime; it is the authoritative description of the rules. Both the PWA engine and Claude Code obey it. The engine is a thin deterministic interpreter of the spec; Claude Code reads the same files and simulates the same logic.

## Consequences

- **Positive:** One source of truth for training logic, readable by humans and by an LLM. No server to host, secure, or pay for. The spec can be reviewed and version-controlled like any other doc. Claude Code and the PWA can never silently diverge because they read the same files.
- **Positive:** Non-developers (and the user's clinician) can read and amend the rules.
- **Negative:** The same logic must be honoured in two places (engine code + LLM behaviour). Mitigated by keeping the engine a faithful, minimal interpreter and by validating both against `session-schema.json`.
- **Negative:** Some logic expressible trivially in code must be written unambiguously in prose for the LLM. We accept this cost; ambiguity in `framework/*.md` is treated as a bug.
