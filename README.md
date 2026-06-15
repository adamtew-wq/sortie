# Sortie

**AI-driven adaptive training session generator for military athletes.** Daily sessions on demand — weights, run, swim, bike, conditioning — zero decision fatigue.

Open the app, do a 5-second check-in, and Sortie tells you exactly what to train today: the right modality, the right loads, routed around your niggles, biased toward your goals and any upcoming event. Tap through the session to log it. That's the whole loop.

## Two interfaces, one source of truth

Sortie is a **static, no-build-step project** hosted on GitHub Pages. There is no server and no database — the GitHub repository *is* the database. Everything in `data/` is intentionally committed.

There are two ways to interact with it:

1. **The PWA** (`app/`) — an installable phone app. This is the daily driver: check-in → suggestion → log. Works offline; syncs to the repo when online.
2. **Claude Code as the AI side door** — open this repo in Claude Code (e.g. on mobile) and ask it to generate or log a session. Because it reads the same `framework/` spec and `data/` files, it produces the same sessions the PWA does. Use it when you want a conversation, a one-off variation, or to bulk-edit your framework/data.

Both obey the written rules in `framework/`. Neither invents training logic — they execute the spec.

## Repository layout

| Path | What it holds |
|---|---|
| `framework/` | The written spec: exercise library, session schema, templates, progression & safety rules. The rules engine, in prose + JSON. |
| `data/` | Single source of truth for *your* data: history, profiles, baselines, goals, niggles, events. All committed. |
| `app/` | The installable PWA: deterministic engine + UI + service worker. |
| `docs/adr/` | Architecture Decision Records — why the project is built the way it is. |
| `CLAUDE.md` | The AI's operating manual: how to generate a session, log one, and edit the framework. |

## Setup

1. **Fork** this repo to your own GitHub account (it must stay accessible to your PAT). Keep it public for free GitHub Pages, or private if you prefer.
2. **Enable GitHub Pages**: repo → Settings → Pages → deploy from `main` branch, `/` (root). Your app will be served at `https://<you>.github.io/sortie/app/`. *(Enable once `app/` has content — see issue #4.)*
3. **Generate a Personal Access Token**: GitHub → Settings → Developer settings → Personal access tokens. Give it `repo` scope so the app can read/write your `data/` files. Keep it secret — it lives only in your phone's local storage.
4. **Add to home screen**: open the Pages URL on your phone, then "Add to Home Screen" (iOS Safari) or "Install app" (Android Chrome). It runs full-screen and offline.
5. In the app's settings, paste your GitHub username, repo name (`sortie`), and PAT to connect. (See issue #9.)

## Seeding your data

Before the engine can prescribe correct loads, seed `data/` with your real equipment, baselines, attributes, and any niggles. The fastest way is to open the repo in Claude Code and ask it to run the onboarding interview (issue #3), or edit the `data/*.json` files directly. The committed files ship with clearly-marked **placeholder** values — replace them with yours.

## Status

This project is built in vertical slices tracked as GitHub issues. See the [issues list](https://github.com/adamtew-wq/sortie/issues) for the current state.
