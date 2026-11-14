# AgroShift UZ

A web app that helps farmers in Uzbekistan compare crop rotations for their own field. It uses NASA Earth observations, local soil information, crop characteristics and the farmer's own priorities.
Built for the NASA Space Apps Challenge 2026, challenge *Field Shift: Adapting Farms with NASA Data*.

> **Status: Phase 1 (data).** The data pipeline works and the 6 demo farms are built; the pages are still placeholders.
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
| `npm run prefetch [-- --farms-only] [-- --reselect]` | Downloads raw data into `data/raw/` (network, resumable; see below). `--farms-only` skips the climate cells; `--reselect` re-chooses the demo-farm points |
| `npm run build-data` | `data/raw/` → `public/data/` (offline, seconds) |
| `npm run check-demo` | Offline sanity check of the 6 demo farms; exits 1 if any farm fails |

## Data pipeline

`prefetch` validates every response with zod and keeps what it already has, so after an interruption you just run it again. The MODIS service (ORNL DAAC) is slow (often 20–30 s per request), so the first demo-farm run takes about 1–1.5 hours; the climate cells take a few minutes.

| Output in `public/data/` (committed) | Content |
|---|---|
| `farms/{id}.json` | Each demo farm: daily climate since 2006 (NASA POWER), the MOD13Q1 NDVI series, MCD12Q1 land cover, SoilGrids topsoil, slope, and sources |
| `cells/{id}.json` | Daily climate for each native POWER cell (0.5° × 0.625°) overlapping Uzbekistan |
| `grid.json`, `regions.json`, `boundaries.json` | Cell list; regions with salinity status and the demo farms; simplified outlines |

**Team inputs** (left empty on purpose — never enter a value without a source):
- `data/manual/salinity_regions.json` — salinity class shares per region, from land-reclamation reports. Until it's filled, salinity shows as "unknown — get a soil test".
- `data/manual/soil_fallback.json` — used only if SoilGrids is unavailable.
- `data/regions.json` — `prefetch` writes each demo farm's chosen point and the reason; review that diff.

## Languages

The UI is available in Uzbek (Latin script, default), Russian and English. The language is chosen in this order: `?lang=uz|ru|en` on any page, then the `lang` cookie (set by the switcher in the header), then the browser's `Accept-Language`, then Uzbek. English is the reference dictionary (`locales/en.json`). Missing Uzbek or Russian keys fall back to English, and the dev server logs them.

## Data sources, methods, deploy

These sections are written in Phase 5. Until then see SPEC §3 (data sources) and §5 (calculations).

## AI-use disclosure

This codebase is being written with Claude Code, an AI coding assistant, under the team's direction. The team will finalise this disclosure according to the current Space Apps rules.

## Disclaimer

An independent NASA Space Apps Challenge project; it is not affiliated with or endorsed by NASA. The tool supports, not replaces, the farmer's judgment and their agronomist's advice.
