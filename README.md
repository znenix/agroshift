# AgroShift UZ

A web app that helps farmers in Uzbekistan compare crop rotations for their own field. It uses NASA Earth observations, local soil information, crop characteristics and the farmer's own priorities.
Built for the NASA Space Apps Challenge 2026, challenge *Field Shift: Adapting Farms with NASA Data*.

> **Status: Phase 0 (scaffold).** The pages are placeholders and the data pipeline is not implemented yet.
> Product and technical spec: [`docs/SPEC.md`](docs/SPEC.md). Working rules: [`CLAUDE.md`](CLAUDE.md). Small decisions: [`DECISIONS.md`](DECISIONS.md).

## Setup

You need Node.js 20.9 or newer (Node 22 or 24 recommended; Node 20 is end-of-life) and npm.

```bash
npm install
npm run dev        # http://localhost:3000
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint (Next.js rules + project rules: no `any`, no `@ts-ignore`, no `!`, no React in `src/lib`) |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit` |
| `npm test` | Vitest (`tests/*.test.ts`) |
| `npm run check` | All of the above in order: run after every phase |
| `npm run prefetch [-- --farms-only]` | *Phase 1.* Downloads NASA POWER, MODIS, SoilGrids and elevation data into `data/raw/` (network, resumable). `--farms-only` fetches only the 6 demo farms |
| `npm run build-data` | *Phase 1.* `data/raw/` → `public/data/` (offline) |
| `npm run check-demo` | *Phase 1–2.* Offline sanity check of the 6 demo farms |

The three data scripts are stubs for now: they print "not implemented" and exit with code 1.

## Languages

The UI is available in Uzbek (Latin script, default), Russian and English. The language is chosen in this order: `?lang=uz|ru|en` on any page, then the `lang` cookie (set by the switcher in the header), then the browser's `Accept-Language`, then Uzbek. English is the reference dictionary (`locales/en.json`). Missing Uzbek or Russian keys fall back to English, and the dev server logs them.

## Data sources, methods, deploy

These sections are written in Phase 5. Until then see SPEC §3 (data sources) and §5 (calculations).

## AI-use disclosure

This codebase is being written with Claude Code, an AI coding assistant, under the team's direction. The team will finalise this disclosure according to the current Space Apps rules.

## Disclaimer

An independent NASA Space Apps Challenge project; it is not affiliated with or endorsed by NASA. The tool supports, not replaces, the farmer's judgment and their agronomist's advice.
