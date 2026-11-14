# CLAUDE.md — AgroShift UZ

NASA Space Apps 2026 project, challenge **"Field Shift: Adapting Farms with NASA Data"**.
A web app that helps farmers in Uzbekistan **compare crop rotations** for their field using NASA Earth observations, local soil information, crop characteristics and their own priorities.

**Full product and technical spec: `docs/SPEC.md` — read it before every phase.** This file holds the working rules.

---

## 1. Working rules

1. **Hackathon time is short** (event 14–15 November). Deliver in the phase order below; every phase must end in a working, demoable state. Never start a later phase while an earlier one is broken.
2. **Stop and ask** only when something changes scope or the spec is contradictory/impossible. For small implementation choices, decide, write one line in `DECISIONS.md`, and continue.
3. **Honesty about data (non-negotiable):**
   - Every number in the UI comes from data or from a documented formula in `src/lib/`.
   - Every value carries a source label; fallback values are visibly marked **"taxminiy / estimated"**.
   - NASA data here is historical/observational. Never present it as a forecast. Scenarios are labelled "what-if".
   - Never invent data, citations or prices. Unknown → `null` + an "information gap" shown to the user.
   - Do not tune weights or data to make the demo look dramatic.
4. **Uzbekistan reality:** default mode is **irrigated**. Salinity, water shortage, cotton–wheat systems and double cropping are central (see SPEC §1).
5. After each phase run: `npm run lint && npm run typecheck && npm test && npm run build`. All must pass. Then commit with a clear message and report: what works, what is stubbed, open questions.
6. Keep dependencies minimal; ask before adding anything not listed in §2 (small utilities are fine).
7. TypeScript `strict`; no `any`, no `@ts-ignore`, no non-null assertions on external data. Validate all external responses with zod.
8. Never commit secrets. Never call external APIs from the browser except our own `/api/*` and static files.

## 2. Fixed stack (do not substitute)

| Area | Choice |
|---|---|
| Framework | Next.js latest stable, App Router, `src/` directory, TypeScript strict |
| Styling | Tailwind CSS |
| Map | MapLibre GL JS via `react-map-gl/maplibre`, OpenFreeMap style (CARTO fallback); load client-side only (dynamic import, no SSR) |
| Charts | Recharts (lazy-loaded) |
| Validation | zod |
| i18n | JSON dictionaries in `/locales` + typed `t()` + cookie-based language (SPEC §7) |
| Tests | Vitest |
| Scripts | TypeScript run with `tsx` |
| Server | Next.js Route Handlers only, for live calls (SPEC §8) |
| Deploy | Vercel (the team logs in and deploys; you prepare config + README steps) |
| Node / npm | Node 20+ / npm |

## 3. Repository layout

```
src/app/            pages (/, /field, /about) + api/ route handlers
src/components/     UI components (map, steps, charts, cards, badges, LanguageSwitcher, SourceChip)
src/lib/            pure logic: power.ts, modis.ts, soil.ts, geo.ts, profile.ts, climate.ts, water.ts,
                    ndvi.ts, trends.ts, crops.ts, rotations.ts, ranking.ts, scenario.ts, constants.ts,
                    encode.ts, i18n.ts, types.ts
data/crops.json, data/rotations.json, data/regions.json
data/manual/        salinity_regions.json, soil_fallback.json   (team-curated, with sources)
data/raw/           prefetch output (gitignored)
public/data/        built static data: cells/, farms/, grid.json, regions.json (committed)
locales/            uz.json (Latin), ru.json, en.json
scripts/            prefetch.ts, build-data.ts, check-demo.ts
tests/              *.test.ts
docs/SPEC.md        full spec
DECISIONS.md        small decisions taken without asking
README.md           setup, scripts, data sources, deploy, AI-use disclosure
```

`src/lib/` must not import React. Engines run in the browser (fast, works offline, powers the scenario sliders) and in tests.

## 4. Commands (create in Phase 0)

```
npm run dev | build | start | lint | typecheck | test
npm run prefetch     # network; resumable; --farms-only flag for demo farms
npm run build-data   # offline; data/raw → public/data
npm run check-demo   # offline sanity check of demo farms
```

## 5. Phases (stop and report after each)

| Phase | Goal | Rough budget |
|---|---|---|
| **0 Scaffold** | project, tooling, layout, i18n skeleton, empty pages, scripts above | 1 h |
| **1 Data** | POWER + MODIS + SoilGrids clients with zod; prefetch **6 demo farms** first, then climate cells; build-data; check-demo | 4–5 h |
| **2 Engines** | climate stats, water, NDVI, trends, crops.json, rotations.json, crop fit, rotation metrics, ranking + tests | 5 h |
| **3 MVP UI** ← minimum demo | `/field` flow steps 1–4 for demo farms; landing; source chips; confidence badges | 6–8 h |
| **4** | Stress-test step (presets + sliders, animated rank changes); map click for any point via `/api/point`; grid layers | 4–5 h |
| **5** | i18n complete (en full, uz/ru proofread list), `/about` (sources, methods, assumptions, glossary, disclosure), README, deploy prep | 3 h |
| **6 Stretch** | forecast banner, explain button, PWA manifest, NDVI trend layer, AppEEARS ingest | if time |

If time runs short, cut from the bottom. Phases 0–3 are never cut.

## 6. Definition of done
See `docs/SPEC.md` §10 (demo script) and §11 (submission checklist — team task).
