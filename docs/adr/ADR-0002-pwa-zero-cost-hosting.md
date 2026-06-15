# ADR-0002: Ship as a PWA on zero-cost static hosting

- **Status:** Accepted
- **Date:** 2026-06-15

## Context

Sortie is a personal training tool that must be usable on a phone, in a gym, often with poor or no connectivity. It must be cheap to run indefinitely (ideally free), require no account system, and install to a home screen so it feels like a native app. The user is a single athlete, not a customer base.

Options considered:

1. **Native app** (iOS/Android): app-store friction, build toolchains, developer accounts, per-platform code.
2. **Hosted web app + backend**: ongoing cost, server maintenance, auth, a database to run.
3. **Progressive Web App on static hosting**: installable, offline-capable, no backend, free to host.

## Decision

Sortie ships as a **Progressive Web App** served as static files from **GitHub Pages** (zero cost). It uses a service worker to cache the app shell for offline use, a web manifest for home-screen installation, and runs all session-generation logic client-side. There is no build step — plain HTML/CSS/JS so the source served is the source written.

## Consequences

- **Positive:** Free hosting, no servers, installs to the home screen on iOS and Android, works offline in the gym. No build tooling to maintain; the repo is directly deployable.
- **Positive:** All computation is local and private; data only leaves the device to sync with the user's own GitHub repo.
- **Negative:** No server means no central place for secrets — the GitHub PAT must live in device local storage (see ADR-0003). Accepted; the token is the user's own and never leaves the device except to call GitHub's API.
- **Negative:** No build step rules out heavyweight frameworks/bundlers. We embrace vanilla JS and dependency-free rendering (e.g. inline SVG/canvas for charts).
