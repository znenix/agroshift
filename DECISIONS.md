# Decisions

Small implementation choices taken without asking (CLAUDE.md §1.2), one line each, grouped by phase.

## Phase 0 — scaffold (2026-11-14)

- **Next.js 16.4.6 with `cacheComponents: false`.** SPEC §7 reads the `lang` cookie on the server to render `<html lang>` with no flash; under Cache Components that needs Suspense or `/[lang]` URLs. Next 17 is expected to make Cache Components mandatory, so revisit this before any major upgrade.
- **`agentRules: false` in `next.config.ts`.** CLAUDE.md is the single agent-rules file; without this, `next dev` writes an `AGENTS.md`. The bundled, version-matched Next docs are in `node_modules/next/dist/docs/`; read them before using a Next API for the first time here.
- **TypeScript 5.9.** npm `latest` is 7.0, but typescript-eslint (inside eslint-config-next) supports TypeScript < 6.1.
- **ESLint 9.** npm `latest` is 10, but eslint-config-next's React, import and jsx-a11y plugins support ESLint ≤ 9; npm prints a deprecation notice for 9.
- **Vitest 4.1.** Vitest 5 needs Node ≥ 22.12, and CLAUDE.md says Node 20+. Node 20 itself reached end-of-life on 2026-04-30, so use Node 22 or 24 locally.
- **maplibre-gl 6 + react-map-gl 8.1** (8.1 is developed against maplibre-gl ^6). Installed now together with Recharts; first used in Phase 3.
- **`?lang=` is handled by `src/proxy.ts`** (Next's renamed middleware). It runs only when the URL has `lang`, stores the cookie, and 307-redirects to the URL without the parameter. It makes no data calls; we read CLAUDE.md §2 "Route Handlers only" as applying to live data calls.
- **Language switcher.** The browser sets the cookie and calls `router.refresh()`, which keeps client state such as the farmer's inputs. No Server Actions.
- **Dictionaries.** Flat JSON with dotted keys (`crop.reason.salinity_loss`); `en.json` defines the key type; `{name}` placeholders; numeric parameters go through `Intl.NumberFormat`, falling back to `en`. An empty string counts as a missing translation.
- **Client dictionaries.** Client components receive the active dictionary plus `en` (for fallback) through `<I18nProvider>` props; dictionaries are never bundled into client JS.
- **Uzbek Latin spelling.** Uses the official oʻ/gʻ letters (U+02BB) and the tutuq belgisi ʼ (U+02BC); a test rejects Cyrillic in `uz.json`. All uz and ru strings still need proofreading by a native speaker.
- **External browser fetches.** The map basemap (OpenFreeMap/CARTO tiles, styles and glyphs) is the only external fetch the browser makes; every data API goes through `/api/*` (resolves CLAUDE.md §1.8 vs §2).
- **System font stack instead of `next/font/google`.** The build needs no network and the browser makes no font request.
- **Light theme only for now** (readable outdoors; the spec has no dark mode). Earthy colour tokens live in `globals.css`; text/background pairs are ≥ 4.5:1.
- **Pipeline scripts are stubs until Phase 1 and exit with code 1**, so nobody mistakes "not implemented" for success. `npm run prefetch --farms-only` (without `--`) also works, via `npm_config_farms_only`.
- **Extra script `npm run check`** runs lint + typecheck + test + build. It works in Windows PowerShell 5.1, which has no `&&`.
- **`typecheck` runs `next typegen` first,** because `next-env.d.ts` and the route types (`LayoutProps`, `PageProps`) are generated and gitignored.
- **`vitest.config.mts`.** Gives an ESM config without setting `"type": "module"` for the whole package.
- **`.gitattributes` normalises line endings to LF** (Windows and macOS dev machines, Linux builds).
- **Folders.** The folders from CLAUDE.md §3 exist now (with `.gitkeep` where empty). `src/lib` modules are created in the phase that implements them, not as empty stubs.
- **ESLint enforces CLAUDE.md §1.7** (`no-explicit-any`, `ban-ts-comment`, `no-non-null-assertion`) **and §3** (`src/lib` may not import React, Next or UI code).
- **`agroshift-spec.zip` is gitignored.** It is the handed-over spec bundle; its two files are committed as `CLAUDE.md` and `docs/SPEC.md`.
- **`npm audit` reports 7 moderate issues; left as is.** They are one advisory (minimatch DoS, GHSA-g3hv-75wg-m249) inside typescript-eslint, which is dev-only lint tooling and never shipped. There is no non-breaking fix, and forcing a major-version override risks breaking lint.

## Team decisions (confirmed 2026-11-14)

- **Climate cells use POWER's native 0.5° × 0.625° grid** (SPEC §4.1 updated). A point's cell is the native cell containing it, so its POWER climate is exact; every cell that overlaps the Uzbekistan polygon is prefetched.
- **Dry-year preset = rain −30 % only.** Daily precipitation is scaled by 0.7, then the whole engine re-runs. The dry-year (P90) water need is a separate metric shown in every scenario, not part of the preset. This supersedes "uses dry-year water need" in SPEC §5.11.
- **Shorter NDVI record where the download was unfinished.** Fergana, Karakalpakstan, Khorezm and Tashkent fetch MOD13Q1 from 2016-01-01 only, to save time on the slow ORNL service. Samarkand and Surxondaryo, already complete, keep 2006 →. The period is recorded per farm in `data/raw/farms/{id}/meta.json` (`ndvi_start`) and as `ndvi.period` in each farm file; `check-demo` flags it as a WARN, and seasonal curves and trends must use it. Requests stay on the 2006-based grid, so files already on disk are reused.
- **Climate cells download in parallel with the farm NDVI** (different servers, each at most 3 parallel requests in one process).
- **crops.json keeps its approximate TODO values** (verified: false); chickpea and sunflower salinity stay empty as an information gap.
- **The demo follows the satellite.** Each demo farm has a `demo_rotation`, the default farmer answer. Karakalpakstan = cotton every year; the others stay cotton → wheat. The "please check" message stays for real mismatches.
- **Heat is a warning only, never a blocker.** It is labelled "regional air temperature; irrigated fields are usually cooler", with confidence low. It is shown in crop fit and rotations but not used in the ranking.
- **Cotton sowing (ASSUMPTION, local practice):** once the 7-day mean reaches 16 °C, and not before 15 April (new optional `not_before` on spring rules). Medians fall on 15–19 April on all six farms. No temperature alone could achieve this: at 18 °C Surxondaryo still sows on 2 April.
- **pH on calcareous soils (ASSUMPTION, local practice):** cotton, wheat, barley, sorghum, alfalfa and mung bean get an optimum of at least 8.2 and an absolute limit of 8.8–9.0, so pH 7.8–8.2 is not penalised (8.3 scores about 85–88).

## Phase 1 — data (2026-11-14)

**Demo-farm selection**
- **Region constraint.** Candidates must lie inside the demo farm's own region (geoBoundaries ADM1) as well as within 25 km of the city. Termez, Fergana and Urgench are near borders, and the Khorezm farm should be in Khorezm.
- **"High summer NDVI" (ASSUMPTION).** A July–August composite median ≥ 0.5 in at least one of 2023–2025, over reliable cropland pixels.
- **Search order (ASSUMPTION).** Candidates within 1 km of one that already failed are skipped, since their ±1 km windows mostly overlap, so "nearest" is accurate to about 1 km. At most 30 are checked; after that the script stops and reports instead of relaxing the rule. Tashkent's first 4 fringe pixels, 8.7–9.6 km out, all peaked at NDVI ≈ 0.41.
- **MODIS requests use runs of consecutive composites.** The subset endpoint returns every composite between the start and end dates, so a run of 10 non-adjacent dates is rejected with HTTP 400.
- **Search method.** One large MCD12Q1 window per city (±26 km), with the ±1 km majority computed locally for every 500 m pixel. The chosen point's own ±1 km window is then fetched again and must agree.

**MODIS pixels**
- **Cropland-like pixels.** A 250 m NDVI pixel counts as cropland-like when the 500 m MCD12Q1 pixel containing it is class 12 or 14. The latest land-cover year (2025) masks every year — a simplification, since fields can change use.
- **Row order and geometry.** ORNL rows run north → south (verified by a one-pixel shift test). Pixels are matched by sinusoidal coordinates, not by index.
- **NDVI date.** Each composite is dated by the start of its 16-day period.

**Climate**
- **Tmean = (Tmax + Tmin) / 2** (FAO-56 eq. 9). T2M stays in the raw files only; daily values are stored at 0.1 resolution (Int16 × 10).
- **Year exclusion uses Tmax, Tmin and precipitation.** Wind and GWETROOT are kept as monthly means of complete months with ≤ 10 % missing days.
- **The series ends at the latest day with any value.** POWER returned fill values for the last 3 days on 2026-11-14.
- **Cells.** Every native cell that overlaps the full-resolution country polygon is kept (exact rectangle–polygon test), so border fields still get their own cell. Cell id `y{j}x{i}`.

**Soil, terrain, boundaries**
- **Soil.** All five properties come from SoilGrids, or none do (no mixing). The team fallback table is used only when its row has a source; otherwise the soil is `unknown`. The level-2 WCS fallback is not built: REST worked for all farms, and it would need the `geotiff` package.
- **Slope.** Copernicus GLO-90 via Open-Meteo, with neighbours 100 m away (ASSUMPTION). Resolution is 0.5 % because elevations are whole metres.
- **Boundaries.** geoBoundaries gbOpen (ODbL 1.0, so "© OpenStreetMap contributors" goes in the footer). The browser gets a 0.005° simplification in `public/data/boundaries.json`, a file SPEC §4.2 doesn't list.

**Code organisation**
- **New `src/lib` modules beyond CLAUDE.md §3:** `dates.ts`, `http.ts`, `elevation.ts`, `datafiles.ts` (schemas of the built files) and `datasources.ts` (citations).

**Raw data and provenance**
- **Raw files hold the zod-validated responses.** Date lists and POWER refresh after 7 days. `retrieved` is the raw file's download date, so rebuilds are reproducible.
- **Polite access.** At most 3 parallel requests per service, with retry and exponential backoff; ORNL returned 502/504 under load. The User-Agent names the project only.

**Team inputs and checks**
- **Empty templates.** `data/manual/salinity_regions.json` and `soil_fallback.json` are created empty for the team; no values were entered.
- **`check-demo` thresholds were fixed before looking at the data:** NDVI ≥ 70 % of composites in every year 2006–2025 and ≥ 80 % overall, plus all 20 climate years usable.

## Phase 2 — engines (started 2026-11-14, alongside the Phase 1 download)

**Water**
- **Net irrigation need is balanced per calendar month,** as in FAO CROPWAT: monthly deficits ETc − Peff are summed, and a wet month's surplus is not carried forward. This refines SPEC §5.2's Σ ETc − Σ Peff, which would let winter rain cover spring deficits.
- **Effective rainfall uses the whole month's rain total,** then is prorated by the season's share of that month (the formula is defined for monthly totals). The CROPWAT "FAO/AGLW" variant (70 mm, −24) is noted but not used.
- **Kc values are not climate-adjusted** (FAO-56 eq. 62). In Uzbekistan's dry summers this probably underestimates Kc_mid and water need; it is listed as an information gap.
- **Kc day 1 = the sowing day** (FAO-56 eq. 66).
- **A crop-year with any missing day is left out, not gap-filled.** POWER has no missing days at the demo farms.
- **Dry-year percentile.** P90 uses linear interpolation (Hyndman & Fan type 7).

**Trends**
- **Mann–Kendall** uses the normal approximation with tie and continuity corrections and no autocorrelation correction (an information gap). The minimum is 8 points (ASSUMPTION); Sen's slope uses the real time steps.

**crops.json**
- **Sowing rule and season length are given per role** (main crop / second crop), because several crops can be either; the SPEC's single rule cannot express that.
- **Field names.** Salinity, temperature and pH are grouped objects (`salinity.ece_threshold`, `temperature.opt_min_c`, …).
- **Provenance.** `sources` lists each value group with its source. "TODO" means no checked source, and the schema rejects any value group without an entry.
- **Draft values.** FAO-56 Table 12 Kc and Maas & Hoffman salinity values are recalled from the standard tables and marked "verify". Stage splits, temperatures, pH, calendars, heat windows and the indicative classes are approximate and marked TODO.
- **Unknown salinity.** Chickpea and sunflower salinity tolerance is `null` (no value I could vouch for), so the app shows an information gap.
- **Cover crop and rice.** The winter cover crop is triticale (forage/cover, cut green; Kc proxied from winter wheat). Rice water need excludes paddy flooding and percolation (stated in its notes).

**rotations.json**
- **Year convention.** Year i is the crop year in which its main crop is harvested; autumn-sown crops are sown in the previous calendar year. Perennial runs may wrap around the end of the cycle.
- **Template details.** Template 4's second crop after wheat is mung bean. Display names are built from crop names; the "why suggested" texts are i18n keys (English now, uz/ru in Phase 5).

**Climate and crop calendar**
- **"P80" frost dates are dates safe in 80 % of years:** the 80th percentile of last spring frosts and the 20th percentile of first autumn frosts. A frost-free winter counts as "no frost before 30 June", so it never makes the safe date earlier.
- **Sowing (ASSUMPTION).** The first day in the window when the trailing 7-day mean Tmean crosses the crop's threshold. Windows: spring crops 1 Feb–30 Jun of the harvest year; autumn crops 15 Aug–15 Dec of the year before. A second crop is sown `gap_days` after the previous harvest.

**Crop fit**
- **Temperature fit uses active-growth days only** (Tmean ≥ 5 °C), so winter rest does not count against winter cereals (ASSUMPTION).
- **Season fit (frost-sensitive crops only):** harvest ≥ 20 days before the safe first-frost date scores 100, 0 days scores 40, and later is a hard blocker (ASSUMPTION).
- **Frost thresholds.** "Light" frost tolerance means damage at Tmin ≤ −2 °C; hardy crops are not checked for frost after sowing.
- **Slope.** A slope over 8 % is a hard blocker for annual crops (ASSUMPTION: crops.json has no slope-limit field, so this is one shared limit).
- **Salinity.** "Needs soil test" applies when salinity is unknown and the crop is salt-sensitive (Maas–Hoffman threshold < 3 dS/m) or its tolerance is unknown. Regional salinity classes map to ECe 1/3/6/12 dS/m (ASSUMPTION).
- **Reasons carry crop ids;** the UI swaps in the crop name in the reader's language.

**Rotation metrics**
- **Timeline.** The typical-year timeline uses each crop's median sowing and harvest days over the record. Bare days come from that calendar, and the cycle wraps.
- **Water need.** Per crop year, the cycle-average of each position's seasonal net need, then average and P90 over the years. In rain-fed mode it is the crop water deficit (no efficiency applied).
- **Erosion index (indicative):** bare days × wind factor (monthly WS2M / 3 m/s, clamped 0.5–2) × slope factor (1 + slope % / 5), per year.
- **Organic matter (indicative):** a perennial year scores 1. Otherwise residue points (low 0.1, med 0.4, high 0.6) plus 0.2 for deep roots, capped at 1 per year.
- **Pest break:** the longest run of crop seasons from one plant family around the cycle. A cycle that never leaves a family (e.g. a cereal + cereal double crop) counts as a monoculture.
- **Vulnerability:** the mean, over crop seasons, of the share of years with heat in the sensitive window, frost in the season, or a ≥ 20 mm rain day in the last 14 days before harvest (ASSUMPTION window).

**Ranking**
- **Fixed ranges.** Metrics map to 0–1 on the fixed ranges in `METRIC_RANGES` (ASSUMPTION values).
- **Priority groups.** Soil health = bare days, erosion, organic matter, N fixing and pest break; low risk = vulnerability and salinity loss. Income is not ranked, since it needs the farmer's own yields and prices.
- **Unreliable water** adds +1 ("sometimes short") or +2 ("often short") to the water-saving weight, capped at 3.
- **Card confidence** is the lowest confidence among the weighted metrics. Farmer inputs are excluded, and simplicity counts as high.

**Real-data review (2026-11-14, on the 4 farms built so far)**
- **Fixed: frost after sowing** now means frost while the crop is young (sowing to the end of the FAO-56 development stage). It had counted autumn frosts before harvest, which duplicated the separate season-vs-first-frost blocker of SPEC §5.7.
- **Fixed: the water range is now 0–25,000 m³/ha**, a physical bound: Kc ≈ 1 all year, ET0 ≈ 1,500 mm, furrow 0.6. The first guess, 2,000–14,000, put nearly every real rotation at the worst end.
- **Not tuned, reported instead:**
  - Heat flags on almost every crop. MERRA-2 has no irrigation, so oasis Tmax is likely warm-biased.
  - Early sowing in the south: Surxondaryo cotton is sown about 7 March by the approximate 14 °C rule.
  - The approximate pH ranges penalise calcareous soils (pH 7.9 gives a pH fit of 60).
  - Satellite check: at Karakalpakstan and Khorezm the satellite sees a summer crop every year 2023–2025, so the answer "cotton → wheat" shows a mismatch. Samarkand and Surxondaryo are mixed pixels that never look bare.
- **POWER provenance.** Meteorology is MERRA-2 through at least 29 Sep 2026 and GEOS-IT near-real-time from about 1 Oct 2026, so all 2006–2025 statistics come from a single product.

**check-demo**
- **"≥ 4 rotations shown" uses the SPEC §10 demo farmer:** current rotation cotton → wheat, water and soil-health weights 3, water often short, furrow irrigation, no allocation or contract constraint.

**NDVI engine**
- **Thresholds.** "Green" means NDVI ≥ 0.3 (ASSUMPTION); 0.2–0.3 is not judged; bare is < 0.2 (SPEC).
- **Judged window.** A crop is judged "green" only from mid-development to the end of mid-season. December–February is never judged as "crop expected but bare", because resting crops look bare.
- **Mismatch rule (ASSUMPTION).** A mismatch must last at least 3 composites. The farmer is not asked which cycle year the field is in; the best-matching phase is used.
- **Growing-season mean** needs at least 8 April–September composites (ASSUMPTION).

**grid.json**
- **Per-cell indicators** over the usable years 2006–2025: mean heat days ≥ 35 and ≥ 40 °C, frost-free days, aridity (Σ P / Σ ET0), mean rain, and the rain trend (Sen's slope per decade with the Mann–Kendall p-value).

## Phase 3 — UI (2026-11-14)

- **Flow state in the URL.** `/field?farm=&step=` via `history.pushState`, so a step can be linked and Back works; answers are kept per farm in memory (not persisted).
- **Default answers (neutral, not tuned).** Current rotation = the farm's `demo_rotation`; every priority 1; water "sometimes short"; irrigated, furrow; no allocation, contract or soil test. The presenter sets the SPEC §10 answers live.
- **Card notes (ASSUMPTION thresholds, `src/lib/compare.ts`).** A benefit or risk is shown from 500 m³/ha water, 20 bare days, 0.1 organic-matter index and 20 erosion points; crop risks from 20 % frost-while-young and 10 % salinity loss.
- **Frost risk on a card only for main crops.** Crop-fit frost statistics describe the main-crop season; a crop grown as a second crop has its own frost check (an exclusion), so its main-season frost share is not shown there.
- **Indicator "Vegetation trend": no clear trend = "Watch"** (neither good nor bad), falling = concern, rising = good.
- **"Estimated" mark.** Fallback and draft values carry a visible mark: `source.estimated` = "estimated" in en, to be "taxminiy" in uz (Phase 5). Crop-table values with `verified: false` carry it too.
- **Timeline.** One row per cycle year inside each card (rather than one long row per rotation), so 6-year rotations stay readable; bare soil hatched; perennials drawn lighter outside their active season.
- **Charts.** Units are in chart titles, not on the axis ticks; lines carry short direct labels (Max, Min, ET0) plus a legend; every chart has a table view.
- **Mobile check.** Headless Edge enforces a minimum window width of about 500 px, so the layout was checked at 500 px; a true 360 px check needs device emulation (to do before the demo).

## Phase 4 — stress test (2026-11-14)

- **Step 5 "Stress test"** (SPEC §5.11): presets Normal / Dry year (rain −30 %) / Hot (+2 °C) and sliders ΔT 0…+4 °C (0.5) and Δrain −30…+30 % (5). The engine re-runs in the browser about 100 ms after the last change (measured 30–60 ms per run on a real farm).
- **What it shows.** The ranking of all feasible rotations in the scenario: score and dry-year water, each with its change from the observed climate, and the rank move. Also: rotations that become infeasible, a climate table (observed vs scenario) and the sowing and harvest shifts of the farmer's main crops.
- **Rank animation.** FLIP with the Web Animations API: rows stay in rank order in the DOM, so screen readers read the new order. It is off under `prefers-reduced-motion`.
- **While recalculating,** the last computed scenario stays on screen (dimmed) instead of flashing back to the observed climate.
- **Scenario state** lives in memory for the session and is not in the URL.
- **Observation, not tuned.** At Karakalpakstan (about 106 mm of rain a year) the dry-year preset barely changes the irrigation need, because rain is a tiny share of the water balance. Hot +2 °C raises the dry-year need by about 700–1,300 m³/ha. With neutral priorities the order of rotations does not change.

## Phase 4 — map and map points (2026-11-14)

- **/api/point** (SPEC §8): 8 s per upstream, a 40 s overall deadline, partial results with gaps. Complete answers are cached 7 days; partial answers 5 minutes, so missing parts can be retried. Climate comes from the static POWER cell.
- **Points rounded to 0.001°** (~100 m) for caching. A map point starts from cotton–wheat (ASSUMPTION, SPEC §1).
- **No cropland pixel in the 1 km window** → no NDVI curve (`not_cropland` gap).
- **Satellite check gives no verdict below 8 judged composites** (ASSUMPTION). This fixes a silent "agrees" when there was no data.
- **MapLibre 6 worker** is copied to public/maplibre/ before dev/build (`scripts/copy-maplibre-worker.mjs`), because Turbopack does not emit it.
- **Map layer classes:** heat days 10/30/60/90 and frost-free days 180/200/220/240 (ASSUMPTION); aridity uses the UNEP classes; rain trend is grey unless p < 0.05.

## Phase 5 — about, i18n, deploy prep (2026-11-14)

- **Citations checked against the sources** (doi.org and the providers' pages, 2026-11-14), not written from memory.
  - MOD13Q1, MCD12Q1, TESViS (doi:10.3334/ORNLDAAC/1600), SoilGrids, geoBoundaries, Copernicus DEM (doi:10.5270/ESA-c5d3d65).
  - Maas & Hoffman, Sen, Mann.
  - NASA POWER's reference is quoted verbatim from its referencing page.
- **POWER data reference.** The "Daily vX version on YYYY/MM/DD" line is filled from `public/data/meta.json`, which build-data writes (API versions and access dates per source).
- **About-page numbers** (missing-day rule, efficiencies, percentile, NDVI thresholds, fit categories) are read from `src/lib/constants.ts`, so the text cannot drift from the code.
- **uz/ru texts drafted with AI**, complete for all keys. `docs/i18n-proofread.md` (`node scripts/i18n-proofread.mjs`) is the side-by-side list for the native speakers, with open points:
  - USDA texture names versus the Kachinsky classification.
  - Russian plurals.
- **Source names on chips** are translated (`source.name.*`); the citations (tooltips, About page) stay in English, as published.
- **Russian sentences ending in a date** have no final period, because abbreviated months already end with one ("6 окт.").

## Team decisions — 2026-11-15

- **Cotton season ~170 days** (ASSUMPTION, local practice): mid-April sowing to defoliation and harvest in Sept–Oct (crops.json; was 175).
  - Karakalpakstan "cotton every year" still shows "please check": MODIS sees the field green 30 Sep → 16 Nov in 2023 and 2025, after the modelled cotton season. Not tuned.
- **Demo answers follow the satellite:** Tashkent, Fergana and Samarkand use `wheat_silage`, the existing "winter wheat + summer second crop every year" template. The satellite check now agrees on all three.
- **Regional salinity** (`data/manual/salinity_regions.json`): dominant class only, marked estimated and regional; a soil test overrides it. No shares per class are entered, because the sources give none.
  - The template and build-data accept an explicit `dominant_class` when a source is given.
  - Karakalpakstan and Khorezm: moderate. Source: FAO Water Report 15 (1997), checked — about 95 % of downstream land saline or worse in 1994.
  - Tashkent region and Samarkand: slight. Sources: Kulmatov (2014), doi:10.4236/jwarp.2014.61006, checked (3.6 % and 5.4 %), plus FAO (upstream < 10 %).
  - Fergana and Surxondaryo: slight. Source: FAO (upstream < 10 %).
  - The other 8 regions stay unknown.
  - **Left out:** the ScienceDirect article S0378377421007216 resolves (Crossref) to Khasanov et al. (2022), *Agricultural Water Management*, doi:10.1016/j.agwat.2021.107444, about **Syrdarya Province**. The 78 % / 95 % figures for Karakalpakstan and Khorezm could not be verified there (paywalled), so it is not cited in the app; the team can add it after checking.
- **360 px phone layout** checked with device emulation (no horizontal overflow on any step or on /about). The map fits Uzbekistan's bounds instead of a fixed zoom; the stress-test rows and card evidence stack on narrow screens.

## Seventh demo farm: Kashkadarya (2026-11-15, team request)

- **Point.** Same rule as the other farms: nearest MCD12Q1 cropland pixel within 25 km of Karshi (38.86 N, 65.79 E), inside UZ-QA, with a July–August NDVI of at least 0.5. Chosen: 38.8729 N, 65.7293 E, 5.4 km away, class 12 in 22 of 25 pixels, peak 0.50 on 2025-08-29. The 5 nearer candidates peaked at 0.45–0.47. The reason is in `data/regions.json`.
- **NDVI from 2016-01-01**, like the farms whose download was unfinished (`NDVI_SHORT_RECORD_START`).
- **`npm run prefetch -- --farm=<id>`** limits the download to one farm. The other six farms were not fetched again, and their built files are byte-identical.
- **Default rotation `alfalfa_cotton_wheat`** (the demo follows the satellite). MODIS 2023–2025: it agrees in 39 composites and differs in 0. `wheat_silage` (25/3) and `barley_sorghum` (22/3) also agree; `cotton_wheat` gives "please check" (green 25 Jun → 2 Jan 2024).
  - Caveat: the field never looks bare (NDVI 0.3–0.5 all year), so the 3-year window cannot tell an alfalfa phase from a mixed or perennial pixel.
- **Salinity stays unknown.** No source could be verified:
  - FAO Water Report 15 gives < 10 % only for the "upper reaches" and does not name Kashkadarya.
  - Kulmatov (2014) does not name it.
  - Doniyorov & Kuvatov (2024, doi:10.25077/aijans.v5.i2.58-64.2024) describe one moderately saline trial site, not the region.
  - Matyakubov et al. (2025, BIO Web of Conferences 151, 04021, doi:10.1051/bioconf/202515104021) may hold regional figures, but the publisher returned HTTP 403, so it was not read.

## "Any point" mode (2026-11-15, team request)

- **Map points use prepared data only.** No live ORNL or SoilGrids call:
  - Climate: the point's native POWER cell (static file).
  - Region: point-in-polygon on the simplified ADM1 outlines in `public/data/boundaries.json`.
  - Salinity: that region's entry, or unknown.
  - Soil, land cover, NDVI, the satellite check and slope are "not available for this point yet — available for demo farms" gaps. Nothing is copied from a nearby demo farm.
  - `/api/point` stays in the code but is no longer called.
- **Entry points.** On step 1: a map click, "My location" (browser geolocation, asked only on click) and typed coordinates. A point outside Uzbekistan stays on step 1 with a message. A point in a sliver of the simplified outline that no region covers is treated as outside. Denied, unavailable, timed-out and unsupported geolocation each get their own sentence.
- **Missing slope.** Without slope, erosion is computed as for flat ground and the steep-slope check is skipped. This was already the behaviour when slope could not be fetched; the gap text now says so.
- **Confidence.** The vegetation-trend and slope indicators drop to "low" when their input is missing. Soil and salinity were already low, so demo farms are unaffected.
- **Location line.** It shows the region name and the distance from the point to its POWER cell's centre (at most about 40 km).
