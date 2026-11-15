# AgroShift UZ

A web app that helps farmers in Uzbekistan compare crop rotations for their own field. It uses NASA Earth observations, local soil information, crop characteristics and the farmer's own priorities.
Built for the NASA Space Apps Challenge 2026, challenge *Field Shift: Adapting Farms with NASA Data*.

> Product and technical spec: [`docs/SPEC.md`](docs/SPEC.md). Working rules: [`CLAUDE.md`](CLAUDE.md). Every small decision and assumption: [`DECISIONS.md`](DECISIONS.md).

## What it does

`/field` walks through five steps:

1. **Choose field.** Pick a demo farm, click anywhere on the map, use **My location**, or type coordinates.
2. **Field conditions.**
   - 20 years of climate (NASA POWER), heat and frost days, and long-term trends.
   - What the satellite saw on the field (MODIS NDVI, with bare periods).
   - Soil, and traffic-light indicators with sources and confidence levels.
3. **Your farm.** Current rotation, priorities (0–3), constraints (water supply, irrigation method, contract share, crops you can't sell) and an optional soil test.
4. **Compare rotations.**
   - Your rotation plus the 3 best alternatives. Each card shows why it is suggested, evidence, benefits, risks, information gaps and confidence.
   - A calendar of each rotation and a table of all metrics.
   - A satellite check of your answer, and crop-by-crop fit.
5. **Stress test.**
   - Normal, Dry year (rain −30 %) and Hot (+2 °C) presets, or custom ΔT and Δrain.
   - The whole calculation re-runs in the browser and the ranking animates. Labelled "What-if test, not a forecast".

`/about` lists data sources with citations, methods, assumptions, limitations, a glossary and the AI-use disclosure.

## Setup

You need Node.js 20.9 or newer (22 or 24 recommended) and npm.

```bash
npm install
npm run dev        # http://localhost:3000
```

The built data in `public/data/` is committed, so the app works without running the data pipeline.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run lint` | ESLint (Next.js rules + project rules: no `any`, no `@ts-ignore`, no `!`, no React in `src/lib`) |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit` |
| `npm test` | Vitest (`tests/*.test.ts`) |
| `npm run check` | All of the above in order |
| `npm run prefetch [-- --farms-only] [-- --reselect]` | Downloads raw data into `data/raw/` (network, resumable). `--farms-only` skips the climate cells; `--reselect` re-chooses the demo-farm points |
| `npm run build-data` | `data/raw/` → `public/data/` (offline, seconds) |
| `npm run check-demo` | Offline sanity check of the demo farms; exits 1 if any farm fails |

`predev` and `prebuild` copy MapLibre's web worker from `node_modules` into `public/maplibre/` (gitignored), because the bundler does not emit it.

## Data pipeline

- **Robust to interruption.** `prefetch` validates every response with zod and keeps what it already has, so after an interruption you just run it again.
- **Slow MODIS service.** The MODIS service (ORNL DAAC) is slow and often answers 502/503, so a demo farm can take an hour or more. The climate cells take a few minutes.

| Output in `public/data/` (committed) | Content |
|---|---|
| `farms/{id}.json` | Each demo farm: daily climate since 2006 (NASA POWER), the MOD13Q1 NDVI series, MCD12Q1 land cover, SoilGrids topsoil, slope, and sources |
| `cells/{id}.json` | Daily climate for each native POWER cell (0.5° × 0.625°) overlapping Uzbekistan; map points use these |
| `grid.json`, `regions.json`, `boundaries.json` | Cell indicators for the map layers; regions with salinity status and the demo farms; simplified outlines |
| `meta.json` | POWER API versions and access dates of every source (shown on `/about`) |

**Map points.** These use prepared data only: the point's NASA POWER cell (`cells/{id}.json`) and its region's salinity estimate. Soil, NDVI, the satellite check and slope are shown as information gaps ("available for demo farms"). The app no longer calls `GET /api/point?lat&lon`, our live route; it is kept for later. The browser never calls upstream APIs.
- **What it fetches:** land cover, the last 3 seasons of NDVI, soil and slope.
- **Timeouts:** 8 s per upstream and 40 s overall.
- **Failures:** whatever fails is shown as an information gap.

**Team inputs** (left empty on purpose — never enter a value without a source):
- `data/manual/salinity_regions.json` — salinity class shares per region, from land-reclamation reports. Until it's filled, salinity shows as "unknown — get a soil test".
- `data/manual/soil_fallback.json` — used only if SoilGrids is unavailable.
- `data/crops.json` — values marked `verified: false` / `TODO` need an agronomist's review; the app marks them "estimated".

## Data sources

NASA datasets and services:
- **NASA POWER** Daily API, community AG (MERRA-2; GEOS-IT for recent months). "The data was obtained from National Aeronautics and Space Administration (NASA) Langley Research Center's Prediction Of Worldwide Energy Resources (POWER) project funded through the NASA Earth Science Division." The POWER project asks users to send it a reference or link to work that uses its data (see power.larc.nasa.gov/docs/referencing/).
- **MODIS MOD13Q1 v061**. Didan, K. (2021), NASA LP DAAC, doi:10.5067/MODIS/MOD13Q1.061.
- **MODIS MCD12Q1 v061**. Friedl, M. & Sulla-Menashe, D. (2022), NASA LP DAAC, doi:10.5067/MODIS/MCD12Q1.061.
- **ORNL DAAC TESViS** RESTful Web Service (2018), doi:10.3334/ORNLDAAC/1600, used to fetch the MODIS subsets.

Partner and other data:
- **SoilGrids 2.0**. Poggio, L. et al. (2021), SOIL 7, 217–240, doi:10.5194/soil-7-217-2021. CC BY 4.0.
- **Copernicus DEM GLO-90**. ESA, doi:10.5270/ESA-c5d3d65, served via the Open-Meteo Elevation API (CC BY 4.0).
- **geoBoundaries** gbOpen UZB ADM0/ADM1. Runfola, D. et al. (2020), PLoS ONE 15(4): e0231866. © OpenStreetMap contributors, ODbL.
- **Basemap**: © OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors; fallback © CARTO.

Methods are FAO-56 (Hargreaves ET0, Kc curves), Brouwer & Heibloem (effective rain), Maas & Hoffman / FAO-29 (salinity), Sen's slope and Mann–Kendall (trends), and delta-change scenarios. Details, assumptions and limitations are on `/about` and in `DECISIONS.md`.

## Languages

The UI is available in Uzbek (Latin script, default), Russian and English.
- **Language order:** `?lang=uz|ru|en` on any page, then the `lang` cookie (set by the header switcher), then the browser's `Accept-Language`, then Uzbek.
- **Reference dictionary:** English (`locales/en.json`).
- **Missing keys:** Uzbek or Russian keys that are missing fall back to English, and the dev server logs them.
- **Proofreading:** Uzbek and Russian were drafted with AI and must be proofread by native speakers. Use [`docs/i18n-proofread.md`](docs/i18n-proofread.md).

## Deploy (Vercel)

1. Push the repository to GitHub (public, as Space Apps requires). `public/data/` must be committed.
2. On vercel.com: **Add New → Project**, import the repository. The framework preset is detected as Next.js; keep the defaults (`npm run build`, Node 22 or 24).
3. No environment variables are needed. Optional, stretch goal only: `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` for `/api/explain`.
4. Deploy. Then open `/field?farm=karakalpakstan&step=4`, `/field?lat=40.348&lon=71.787&step=2` and `/about` on a phone and a laptop.

`/api/point` declares `maxDuration = 60` seconds; that fits Vercel's limits. Its responses are cached at the edge: 7 days when complete, 5 minutes when partial.

## AI-use disclosure

The code and most texts were written with Claude (Anthropic) through Claude Code, directed and reviewed by the team.
- **Crop parameters:** the draft values in `data/crops.json` were compiled with AI assistance and are marked "estimated" until an agronomist reviews them.
- **Everything else:** all other numbers come from the cited data and documented formulas, never from an AI model.
- **Translations:** Uzbek and Russian texts were drafted with AI.

The team must check this disclosure against the current Space Apps rules before submitting.

## Disclaimer

An independent NASA Space Apps Challenge project; it is not affiliated with or endorsed by NASA. The tool supports, not replaces, the farmer's judgment and their agronomist's advice.
