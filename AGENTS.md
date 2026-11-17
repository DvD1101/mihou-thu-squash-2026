# MiHoo Squash League Project

This repository is the production handoff for the 2026 Tsinghua nine-school squash league. It must remain usable from a new coding-agent harness without ChatGPT-specific tooling.

## Current production

- Event UI: `https://www.mihoosquash.com/events/2026-thu-nine-school/`
- Admin route: `https://www.mihoosquash.com/events/2026-thu-nine-school/admin/<private-token>`
- Root path is reserved for the future MiHoo homepage.
- Hosting: Cloudflare Worker `mihoo-squash-2026`
- Database: Cloudflare D1 `mihoo_event_state`
- Zone: `mihoosquash.com`
- Legacy Netlify project is an inactive backup. Do not write event data there.

## Safe workflow

```bash
npm ci
npm test
npm run start
```

Local Node mode uses `DATA_DIR`, defaulting to `work/data`.

Cloudflare mode:

```bash
npm run cloudflare:dev
npm run cloudflare:deploy
```

The `ADMIN_TOKEN` Worker secret must be set outside source control:

```bash
npx wrangler secret put ADMIN_TOKEN
```

`CLOUDFLARE_API_TOKEN` is only needed for non-interactive API operations. Never commit it.

## Architecture

- `public/src/model.js`: event, roster, group, and unit data structures.
- `public/src/engine.js`: random draw, standings, brackets, advancement, corrections, team points, seed and batch operations.
- `public/src/schedule.js`: four-court schedule, dependencies, rest windows, and conflict validation.
- `public/src/xlsx.js`: browser-side `.xlsx` import/export and ZIP implementation.
- `public/src/ui.js`: admin and viewer UI.
- `public/src/main.js`: state synchronization, command dispatch, save retries, import/export.
- `worker/index.js`: production Worker, D1 versioned snapshot, static assets, path routing.
- `netlify/functions/api.cjs`: legacy Netlify Blobs adapter.
- `server.mjs`: offline/local Node server and SSE adapter.

## Required invariants

1. Do not rank solely by Excel order. Group and knockout draws use cryptographically secure Fisher-Yates shuffling.
2. New-player groups are four round-robin groups; top two advance to an eight-player knockout.
3. Advanced groups have 24 players and exactly eight seeds. The eight seeds occupy eight different round-of-16 slots.
4. Multiple seeds from the same participating unit are allowed.
5. Correcting an upstream result must detect and explicitly clear dependent downstream results.
6. Third-place matches receive semifinal losers.
7. The event uses four courts and must never schedule between 12:00 and 14:00.
8. Viewer writes must be rejected server-side.
9. Preserve the private admin path and keep it out of public pages and source.

## Data safety

- Never edit production D1 directly during live scoring unless restoring a verified backup.
- Before migrations or structural changes, export the full JSON state.
- Cloudflare writes are version-checked and the client automatically merges concurrent updates.
- Netlify is a backup only. Do not resume its builds or write to its Blobs copy.

## Tests

`npm test` covers:

- 84-player roster and 128-match generation.
- group ranking and manual tie resolution.
- seed placement and repeated units.
- third-place routing and downstream result invalidation.
- four-court scheduling.
- Worker and local server permissions.
- UI rendering smoke tests.

Run browser smoke tests only against an isolated data directory or with explicit user permission. They contain admin actions.
