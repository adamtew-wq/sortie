# ADR-0003: The GitHub repository is the single source of truth

- **Status:** Accepted
- **Date:** 2026-06-15

## Context

Sortie has no backend (see ADR-0002) but still needs durable, syncable storage for the user's data: training history, equipment profiles, baselines, attributes, niggles, and events. The same data must be visible to both consumers — the PWA and Claude Code (see ADR-0001) — and survive across devices and app reinstalls.

## Decision

The **GitHub repository is the single source of truth**. All user data lives in `data/` as committed JSON / JSONL files. The PWA reads and writes these via the GitHub Contents API using the user's PAT; Claude Code reads and writes them directly as repo files. Training history is **append-only** (`data/history.jsonl`, one JSON object per line) so concurrent appends never conflict. Other files (niggles, events) use last-write-wins.

The PWA keeps a **local-storage working copy** for offline use and an **offline commit queue**; on reconnect it flushes queued commits to the repo. The PAT is stored only in device local storage and is never committed or logged.

## Consequences

- **Positive:** One canonical store both interfaces share; full version history of every training day for free. Survives device loss — re-clone or re-install and resync. No database to run.
- **Positive:** Append-only history is conflict-free across devices and the PWA/Claude split.
- **Negative:** Writes require network + a valid PAT; offline writes must be queued and flushed (handled by the sync slice, issue #9). Accepted.
- **Negative:** Storing a PAT in local storage is a security trade-off. Mitigated: `repo` scope only, stored on-device only, never logged, never committed; the user can revoke it at any time.
- **Negative:** GitHub API rate limits apply. Acceptable for single-user, low-frequency writes (a few sessions a day).
