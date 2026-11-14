# AgroShift UZ — Product & Technical Spec (v2)

Read together with `/CLAUDE.md` (working rules). This file is the "what"; CLAUDE.md is the "how".

---

## 1. What we are building

**One sentence:** a web app that helps a farmer in Uzbekistan compare crop rotations for *their* field, using NASA Earth observations plus local soil information, crop characteristics and the farmer's own priorities and constraints.

**Challenge:** NASA Space Apps 2026 — *Field Shift: Adapting Farms with NASA Data*.
The team must re-read the official challenge page and update this list if anything differs. Judges check for:

- At least **3 rotation strategies compared, including the farmer's current one**.
- For each strategy: **why it was suggested, supporting evidence, benefits, information gaps, risks needing local review**.
- **Farmer inputs** for priorities and constraints (**water, equipment, market**).
- **Bare-field periods, vulnerable seasons, pest-cycle breaks**.
- How the tool handles **uncertainty** and where **human judgment** matters.
- **Plain-language explanations** of NDVI, evapotranspiration, soil-moisture anomaly.
- **Satellite vs ground data** and why combining them helps.
- Framing: the tool **supports, not replaces**, the farmer's judgment.
- Patterns from NASA data: temperature, heat stress, rainfall, soil moisture, evaporation, frost risk, extreme precipitation, vegetation stress, long-term water trends.
- Farmer priorities: water use, forage value, nitrogen fixing, erosion reduction, organic matter, market suitability.

**Why ours is different (Uzbekistan focus — keep this visible in the UI and pitch):**
irrigated agriculture (not rain-fed by default), soil salinity, the cotton–wheat system and cotton cluster contracts, double cropping after winter wheat (*takroriy ekin*, e.g. mung bean), the traditional alfalfa–cotton rotation, downstream water shortage on the Amu Darya, Uzbek/Russian UI.

---

## 2. User flow

| Step | Screen | Content |
|---|---|---|
| 1 | **Choose field** | 6 demo-farm buttons + map click anywhere inside Uzbekistan |
| 2 | **Field conditions** | 12-month climate calendar, long-term trends, "what the satellite saw on your field", soil, indicators |
| 3 | **Your farm** | current rotation, priorities, constraints, optional soil test |
| 4 | **Compare rotations** | current + 3 best alternatives: cards, timelines, metrics table |
| 5 | **Stress test** | normal / dry / hot presets + ΔT and Δrain sliders; how rankings change |

Always visible: data-source chips, confidence badges, and the line "This tool supports, not replaces, your judgment and your agronomist's advice."

Mobile (≥360 px): vertical stepper. Desktop: map left, panel right.

---

## 3. Data sources

| Data | Source | Access | Used for | Label in UI |
|---|---|---|---|---|
| Daily Tmax, Tmin, Tmean, precipitation, wind, root-zone soil wetness | **NASA POWER** (community `AG`) | REST, no key | climate calendar, ET0, heat/frost/extremes, trends, scenarios | "NASA POWER (reanalysis, ~50 km)" |
| NDVI 16-day, 250 m | **MODIS MOD13Q1** via ORNL DAAC TESViS web service | REST, no key | vegetation stress, bare periods, long-term trend | "NASA MODIS (satellite, 250 m)" |
| Land cover (IGBP) | **MODIS MCD12Q1** via ORNL DAAC | REST, no key | is this cropland? choosing demo pixels | "NASA MODIS" |
| Soil pH, organic carbon, clay/sand/silt | **SoilGrids v2.0** (ISRIC) | REST (beta) → WCS → manual | soil fit | "SoilGrids (modelled, 250 m)" |
| Elevation / slope | Copernicus DEM via Open-Meteo elevation API | REST, no key | slope → erosion | "Copernicus DEM (non-NASA)" |
| Salinity class | `data/manual/salinity_regions.json` | team-curated | crop salinity yield loss | "estimated — regional reports" |
| Boundaries | geoBoundaries (UZB ADM0/ADM1) or Natural Earth | GeoJSON, simplified | map, point-in-country check | — |
| *Optional:* SMAP soil moisture, ECOSTRESS ET, HLS (Landsat/Sentinel) NDVI | NASA AppEEARS point samples for the 6 demo farms | needs a free Earthdata account; **manual CSV drop** | extra evidence for demo farms | product name |
| *Stretch:* 14-day forecast | Open-Meteo forecast API | REST, no key | "this week" banner only | "Open-Meteo (forecast, non-NASA)" |

### 3.1 NASA POWER
- Daily point endpoint: `https://power.larc.nasa.gov/api/temporal/daily/point`
  `?parameters=T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,WS2M,GWETROOT&community=AG&latitude={lat}&longitude={lon}&start=YYYYMMDD&end=YYYYMMDD&format=JSON`
  (only what the engine uses: temperature → ET0/heat/frost, precipitation, wind → erosion, root-zone wetness → anomaly)
- Period: **2006-01-01 → latest available** (20 complete years + current year). If a request is slow or fails, split it by 5-year blocks.
- **Fill value −999 → `null`.** Never average fill values. Count missing days per year; years with >10% missing are excluded from statistics and flagged.
- Read units and the `sources` list from the response metadata and keep them in the output files; show the sources on the About page.
- POWER meteorology is reanalysis at roughly 0.5° × 0.625° (MERRA-2). It is **not a field measurement**, and the MERRA-2 land model does **not** include irrigation — so soil-wetness values describe the un-irrigated background, never "your irrigated field is dry". Say this on the About page.
- Respect rate limits: max 3 parallel requests, small delay, exponential backoff.

### 3.2 MODIS via ORNL DAAC (`https://modis.ornl.gov/rst/api/v1/`)
- First call `/{product}/dates?latitude&longitude` to get valid dates; the subset endpoint caps dates per request (about 10) → chunk.
- `MOD13Q1` band `250m_16_days_NDVI`: scale 0.0001, fill −3000. Keep only pixels with `250m_16_days_pixel_reliability` ≤ 1. Use a small window (`kmAboveBelow=1&kmLeftRight=1`); take the median of valid cropland-like pixels.
- `MCD12Q1` band `LC_Type1` (IGBP): 12 = croplands, 14 = cropland/natural mosaic, 13 = urban, 16 = barren, 17 = water. Use the latest available year; majority class in the window.
- If the newest MODIS dates are missing (the Terra/Aqua missions may be ending), compute trends only on complete years available and say so; do not silently mix sensors.

### 3.3 SoilGrids (three-level fallback)
1. REST `https://rest.isric.org/soilgrids/v2.0/properties/query?lon&lat&property=phh2o&property=soc&property=clay&property=sand&property=silt&depth=0-5cm&depth=5-15cm&depth=15-30cm&value=mean`
   - The API is beta and has had pauses. Valid depths are 0-5, 5-15, 15-30, 30-60, 60-100, 100-200 cm → compute a **thickness-weighted 0–30 cm mean**.
   - Values are integers: divide by the `d_factor` given in the response (pH×10, SOC in dg/kg, texture in g/kg).
2. If REST fails: ISRIC WCS (`maps.isric.org`) GeoTIFF for the Uzbekistan bounding box in EPSG:4326, sampled with the `geotiff` npm package (prefetch only).
3. If both fail: `data/manual/soil_fallback.json`, labelled `estimated`.

### 3.4 Salinity (no global layer exists — do not fake one)
- `data/manual/salinity_regions.json`: per region (14 units), the share of irrigated land by class (none / slight / moderate / strong) **with a `source` field per entry**, filled by the team from published land-reclamation reports. Derive a dominant class.
- A farmer soil test (EC in dS/m) always overrides it.
- If unknown → information gap: "Salinity unknown — get a soil test", and salt-sensitive crops are marked "needs soil test" instead of guessed.

### 3.5 Optional AppEEARS drop (does not block anything)
If a teammate has an Earthdata account: request point samples for the 6 demo farms (e.g. SMAP L3/L4 soil moisture, ECOSTRESS ET, HLS NDVI), save CSVs into `data/raw/appeears/`. `scripts/build-data.ts` ingests them if present and adds them as extra evidence; the app works without them.

---

## 4. Data pipeline

```
scripts/prefetch.ts   (network, resumable)  → data/raw/**            (gitignored)
scripts/build-data.ts (offline, fast)       → public/data/**          (committed, served statically)
scripts/check-demo.ts (offline)             → sanity report for the demo farms
```

### 4.1 What gets prefetched
- **Climate cells:** POWER's native MERRA-2 grid, 0.5° latitude × 0.625° longitude (cell centres at latitude −90 + 0.5·j, longitude −180 + 0.625·i), keeping every cell that overlaps the Uzbekistan polygon (212 cells: 156 with their centre inside the country, 56 along the border) — POWER daily, 2006→now. POWER returns the value of the native cell that contains the requested point (checked 2026-11-14: identical values at 42.46° N 59.10° E and 59.68° E, different at 59.70° E, across the 59.6875° cell edge), so §4.3 reads a field's climate from the cell that contains it, which is exact for POWER. *(Changed from a 0.5° grid, which mixed neighbouring cells; team decision 2026-11-14.)*
- **6 demo farms:** Tashkent, Fergana, Samarkand, Surxondaryo (Termez), Karakalpakstan (Nukus), Khorezm (Urgench).
  - **Do not use city-centre coordinates** (they are urban land cover). The script searches candidate points within 25 km of each city and picks the nearest one whose `MCD12Q1` class is 12 or 14 with a high summer NDVI; it records the chosen coordinates and the reason in `data/regions.json`.
  - For demo farms: POWER daily, full MOD13Q1 NDVI series (2006→now), land cover, SoilGrids, elevation + 4 neighbours for slope.
- *Stretch:* growing-season NDVI for grid cells (3 composites per year) for a national NDVI-trend layer.

### 4.2 Built files (`public/data/`)
- `cells/{cellId}.json` — daily Tmax, Tmin, P for 2006→now encoded as Int16 (×10) base64 strings, plus monthly mean wind and GWETROOT, missing-day counts, metadata (sources, units, period). Target < 120 KB per file.
- `farms/{farmId}.json` — everything above + NDVI series, land cover, soil, slope, sources.
- `grid.json` — per cell: precomputed summary indicators for map layers (heat days, frost-free days, aridity index, rainfall trend).
- `regions.json` — region list (uz/ru/en names, demo-farm coords, salinity class + source).

Static files are served by the CDN: no server function, no runtime file writes (Vercel's filesystem is read-only at runtime).

### 4.3 Runtime composition — one function
`getFieldProfile(lat, lon): Promise<FieldProfile>` in `src/lib/profile.ts` (client side):
1. Point outside Uzbekistan (polygon test) → friendly message, stop.
2. Demo farm within 2 km → load `farms/{id}.json`. Done.
3. Otherwise: climate from the **nearest cell file** (same reanalysis cell, so this is exact for POWER), plus `GET /api/point?lat&lon` for land cover, recent NDVI, soil and slope at the exact point.
4. If `/api/point` fails or times out → use nearest demo/grid sample, label "from a point X km away — low confidence".
5. Keep the last successful profile in `localStorage` for offline viewing.

---

## 5. Calculations (pure TypeScript in `src/lib/`, no React imports, fully unit-tested)

All thresholds and coefficients live in `src/lib/constants.ts`, each with a comment giving its source or the word `ASSUMPTION`. The About page lists every assumption.

### 5.1 Climate statistics (from daily series)
- 12-month climatology: mean Tmax, Tmin, Tmean, P (mm), ET0 (mm), wind.
- Heat days: Tmax ≥ 35 °C and ≥ 40 °C. Frost days: Tmin ≤ 0 °C. Extreme rain days: P ≥ 20 mm (constant).
- **Last spring frost / first autumn frost** per year (Tmin ≤ 0 °C), their mean and 80th percentile; frost-free season length.
- Aridity index = annual P / annual ET0.
- **Soil-moisture anomaly:** monthly GWETROOT z-score vs its own 2006–2025 climatology (label "model-based, no irrigation").

### 5.2 Water
- **ET0, Hargreaves (FAO-56 eq. 52):** `ET0 = 0.0023 × (Tmean + 17.8) × sqrt(Tmax − Tmin) × Ra`, with Ra (mm/day) from FAO-56 eq. 21 for the latitude and day of year. Chosen because it needs only temperature, so it responds correctly to the ΔT scenario. Document as an approximation.
- **Effective rainfall** (Brouwer & Heibloem 1986, FAO Irrigation Water Management Manual 3) per month: `P > 75 mm → 0.8P − 25`, else `0.6P − 10`, minimum 0. Verify constants.
- **Crop water use:** daily Kc curve from FAO-56 (Kc_ini, Kc_mid, Kc_end and stage fractions) → ETc = Kc × ET0.
- **Net irrigation need** = Σ ETc − Σ Peff over the crop season. **Gross need** = net / irrigation efficiency (farmer picks method: furrow / sprinkler / drip; efficiencies in constants, marked ASSUMPTION).
- Unit for farmers: **m³ per hectare** (1 mm = 10 m³/ha). Show the average year and the **dry year (90th percentile)** across the record.
- Not included (state as information gap): salt-leaching water, canal losses.

### 5.3 Vegetation (NDVI)
- Seasonal curve: median NDVI per 16-day composite over the last 3 years and over the full record.
- **Bare periods:** composites with NDVI < 0.2 (constant) → "field typically bare from … to …".
- Long-term trend of growing-season (Apr–Sep) mean NDVI.
- **"What the satellite saw":** for the current rotation the farmer enters, compare expected crop-cover periods with observed green/bare periods. If they disagree (e.g. satellite sees green in July–August but the farmer says the field is bare after wheat) → show "Satellite and your answer differ — please check", never auto-correct. This is the satellite-vs-ground feature judges ask for.
- Note in UI: a 250 m pixel can mix several fields.

### 5.4 Trends and uncertainty
- Trend = **Sen's slope**; significance = **Mann–Kendall** test (p < 0.05). Show "rising / falling / no clear trend". Never call a non-significant slope a trend.
- Apply to: annual P, summer mean Tmax, heat days, frost-free length, growing-season NDVI, GWETROOT.

### 5.5 Field indicators (traffic lights with icon + text, not colour only)
Water stress, heat stress, frost risk, extreme rain, vegetation trend, soil (pH, organic carbon, texture), salinity, slope.
Each: value, unit, status, short explanation, source chip, confidence. **No single composite "suitability score"** — judges reward transparency, and a farmer can act on individual indicators.

### 5.6 Crop data — `data/crops.json`
Crops (annuals unless noted): cotton, winter wheat, winter barley, maize (grain), maize (silage), rice, sorghum, **alfalfa (perennial, 2–4 years)**, **mung bean**, chickpea (rain-fed zones), soybean, sunflower, potato, melon, plus one winter cover crop (e.g. rye or triticale).
Orchards and vineyards are **not** in the rotation engine (they are not rotated); mention this on the About page.

Fields per crop:
- `id`, `names {uz, ru, en}`, `family` (for pest breaks), `perennial`, `years` (perennials)
- Sowing rule: `{type:"spring", tmean_above_c}` | `{type:"autumn", tmean_below_c}` | `{type:"after_previous", gap_days}`; `season_days`
- FAO-56: `kc_ini`, `kc_mid`, `kc_end`, `stage_fractions [ini, dev, mid, late]`
- Temperature: EcoCrop optimal and absolute min/max
- `heat_threshold_c` + `heat_sensitive_window` (days after sowing, e.g. flowering); `frost_tolerance` (`none | light | hardy`)
- Salinity (FAO-29 / Maas–Hoffman): `ece_threshold`, `slope_pct_per_dsm`
- pH optimal and absolute range
- `root_depth` (shallow / medium / deep), `n_fixing`, `residue` (low / med / high), `forage_value` (none / low / med / high), `drought_tolerance`
- `sources[]`, `verified: false`

**Never invent citations.** If unsure of a value's source, write `"source": "TODO"` and keep `verified: false`. The UI shows "values pending agronomist review" while any crop is unverified.

### 5.7 Crop fit (supporting tab)
Per crop: trapezoidal fit for temperature, pH, salinity, season length vs frost-free period; overall fit = **minimum** of sub-fits (limiting factor, EcoCrop style).
Categories: Recommended (≥ 70, no blockers), Risky (40–69 or soft blocker), Not suitable (< 40 or hard blocker).
- Hard blockers: season does not fit before the P80 first autumn frost; salinity yield loss ≥ 50 %; slope above crop limit.
- Soft blockers: salinity yield loss 10–50 %; heat in the sensitive window in ≥ 30 % of years; frost after sowing in ≥ 20 % of years.
Every reason is an i18n key + numbers, e.g. `crop.reason.salinity_loss` `{crop:"cotton", loss:18}`.

### 5.8 Rotations — `data/rotations.json` + `src/lib/rotations.ts`
A rotation = list of years; each year has a `main` crop and an optional `second` crop (sown after the main harvest). Perennials occupy consecutive years. The cycle repeats, so the timeline must wrap correctly across years (winter wheat is sown in October and harvested next June).

Starter templates (team verifies; each has `why_key`, `tags`, `conditions`, `sources`, `verified:false`):
1. Cotton every year (monoculture) — common baseline.
2. Cotton → winter wheat (field bare after the wheat harvest).
3. Cotton → winter wheat + mung bean second crop (*takroriy ekin*).
4. Alfalfa (3 yrs) → cotton → cotton → winter wheat (+ second crop) — traditional soil-restoring rotation.
5. Winter barley/wheat + sorghum second crop → for saline or water-short fields.
6. Winter wheat + silage maize second crop → forage / livestock farms.
7. Rain-fed (lalmi) zones: winter wheat → chickpea.

**Farmer's current rotation:** pick a template or build one with a simple year-by-year crop picker.

**Feasibility checks (exclude and say why):**
- Second crop cannot mature before the P80 first autumn frost (under the active scenario).
- Required crop share not met (cotton cluster contract input).
- Equipment or market constraint (crop not sellable / cannot be harvested).
- If the farmer gives an annual water allocation (m³/ha): dry-year gross need exceeds it.

### 5.9 Rotation metrics (per average year of the cycle)
| Metric | How | Confidence |
|---|---|---|
| Irrigation water need (avg + dry year, m³/ha) | §5.2 summed over the cycle | medium |
| Bare-soil days per year | from the timeline | high (calendar) |
| Erosion exposure | bare days × slope factor × windy months (WS2M) | low–medium |
| Nitrogen fixing | share of seasons with an N-fixing crop | indicative |
| Organic matter / soil structure | perennial years, deep roots, residue class | indicative |
| Pest-cycle break | longest run of the same plant family; monoculture flagged | indicative |
| Heat / frost / harvest-rain vulnerability | % of historical years with stress inside each crop's sensitive window | medium |
| Salinity yield loss | Maas–Hoffman per crop, weighted by seasons | low unless soil test given |
| Forage value | from crops | indicative |
| Market suitability | **farmer input only** (sellable yes/no, optional 1–5 rating); never invented | farmer |
| Income | only if the farmer enters yield and price; otherwise shown as an information gap | farmer |

### 5.10 Ranking by farmer priorities
- Priority sliders (0–3): water saving, soil health, forage, income/market, low risk, simplicity.
- Water-supply reliability (reliable / sometimes short / often short) automatically raises the water-saving weight.
- Each metric is normalised to 0–1 with **fixed documented ranges** (not relative to the other candidates), then weighted. Show the raw metrics, not only the total.
- Show: current rotation + the **3 best feasible alternatives**; the rest under "more options".
- Each card answers: **Why suggested · Evidence (numbers + source chips) · Benefits · Risks needing local review · Information gaps · Confidence**.

### 5.11 Scenarios — delta-change method
- Presets: Normal (record as observed), Dry year (rain −30 %, uses dry-year water need), Hot (+2 °C). Custom sliders: ΔT 0…+4 °C (step 0.5), Δrain −30…+30 % (step 5).
- Apply ΔT to every daily Tmax/Tmin and scale daily P by (1 + Δrain), then **re-run the whole engine** (ET0, sowing dates, frost dates, stress frequencies, water need, feasibility, ranking). Debounce ~100 ms.
- Show score/metric deltas and animate rotations changing rank. Label: "What-if test, not a forecast."

### 5.12 Uncertainty and human judgment
- Every metric carries `confidence: high | medium | low | farmer`.
- Card-level confidence = lowest confidence among its key metrics.
- Panel "Where your judgment matters most": market, equipment, local pests, water allocation, soil test, values pending agronomist review.
- Glossary with plain-language explanations: NDVI, evapotranspiration, soil-moisture anomaly, reanalysis, salinity (EC), frost-free season, rotation, double cropping.

---

## 6. UI

- **Pages:** `/` landing (3-sentence pitch, "Try a demo farm", "Open the map"), `/field` (the 5-step flow), `/about` (data sources, methods, assumptions, limitations, glossary, AI-use disclosure, "not endorsed by NASA").
- **Charts (Recharts):** climate calendar (bars P, lines Tmax/Tmin, ET0), heat/frost month strip, NDVI seasonal curve with bare-period shading, trend charts with "significant / not significant" note, rotation timelines (Gantt-like, 1 row per rotation, bare gaps hatched, stress months highlighted), metric comparison table.
- **Map (MapLibre):** OpenFreeMap style, CARTO as fallback; if tiles fail, draw the Uzbekistan GeoJSON on a plain background so the app still works. Demo-farm markers. *Phase 4:* grid layers (heat days, frost-free days, aridity, rainfall trend) with legends and colour-blind-safe sequential palettes.
- **Design:** earthy palette (deep green, sand, sky blue); status colours always paired with an icon and text; large numbers; tooltips for every technical term; skeleton loaders; empty and error states; contrast ≥ 4.5 : 1; keyboard navigable; aria labels.
- **Attribution footer:** NASA POWER acknowledgement (use the official text from the POWER docs), ORNL DAAC citation (doi:10.3334/ORNLDAAC/1600), SoilGrids (Poggio et al. 2021, CC BY 4.0), © OpenStreetMap contributors, OpenFreeMap / CARTO, Open-Meteo (CC BY 4.0, used for elevation), geoBoundaries / Natural Earth.
- **No NASA logos** and no implied NASA endorsement.

---

## 7. i18n
- `locales/uz.json` (Uzbek **Latin**), `ru.json`, `en.json`; typed `t(key, params)`; missing keys fall back to `en` and are logged in dev.
- Initial language: `?lang=` param → `lang` cookie → `Accept-Language` (uz/ru/en) → fallback **uz**. Store choice in a cookie (read on the server → no hydration flash).
- English must be complete (global judges). Uzbek and Russian texts must be proofread by a native speaker on the team.
- Numbers via `Intl.NumberFormat` with the locale (fallback `en`).

---

## 8. API routes (only for live calls; everything else is static)
| Route | Purpose | Cache |
|---|---|---|
| `GET /api/point?lat&lon` | land cover, last 3 seasons of NDVI, soil, slope at an arbitrary point; 8 s timeout per upstream; partial results allowed with `estimated` flags | 7 days |
| `GET /api/forecast?lat&lon` *(stretch)* | Open-Meteo 14-day forecast | 1 hour |
| `POST /api/explain` *(stretch)* | plain-language summary | none, rate-limited |

- Validate input with zod; reject points outside the Uzbekistan polygon with 400.
- Errors: `{ error: { code, message } }`.
- `/api/explain`: if `ANTHROPIC_API_KEY` is set, call the Anthropic Messages API with `ANTHROPIC_MODEL` (e.g. `claude-haiku-5-5`), sending **only computed numbers** and the language; instruct the model to use only those numbers and to write 4 short sentences. Otherwise use templates. Never expose the key.

---

## 9. Tests (Vitest) — at least 15 cases
POWER parser (−999 → null; missing-year exclusion) · Int16/base64 round-trip · extraterrestrial radiation Ra against the FAO-56 worked example + Hargreaves ET0 on a hand-computed case · effective-rainfall formula · Kc curve and net irrigation need · frost dates on a synthetic series · Sen's slope + Mann–Kendall on known series · NDVI bare-period detection · Maas–Hoffman yield loss · crop fit categories at boundaries (39/40, 69/70) · second-crop infeasible when frost comes early · timeline wrap for winter wheat · bare-days for monoculture vs double crop · ranking changes when water weight changes · +2 °C scenario shifts sowing earlier and raises ET0.

---

## 10. Definition of done
- `npm run build` passes; all tests green; deployed URL works on phone and laptop.
- Demo farms load the full flow in < 2 s from static files.
- `scripts/check-demo.ts` passes (every demo farm has complete data and ≥ 4 rotations shown).
- **Demo script (30 s):** open the app → "Karakalpakstan demo farm" → field conditions (heat in July, field bare after wheat harvest as seen by the satellite, salinity estimated) → current rotation "cotton → wheat", priorities "water + soil health", water "often short" → 4 rotations compared with reasons → "Dry year" preset → ranking updates → switch language uz → en.
- **Do not tune weights or data to make the demo look dramatic.** If results look wrong, check units and data first, then report.

---

## 11. Submission checklist (team, not Claude Code)
- Demo: **video ≤ 30 s or ≤ 7 slides** — going over disqualifies from global judging.
- Public code repository; all links public and working.
- Clear list of NASA and partner datasets used (copy from the About page).
- Every required field on the project page; terms checkbox.
- AI-use disclosure according to the current Space Apps rules.
- Check your local event's exact deadline.

---

## 12. Out of scope (mention as future work in the pitch)
Telegram bot for farmers · field-level 30 m analysis (HLS / Landsat) for all points · ECOSTRESS / OpenET field evapotranspiration · GRACE-FO groundwater trends · snowpack-based irrigation water outlook for the Amu Darya / Syr Darya · real market prices · district-level salinity data · growing-degree-day maturity models · agronomist validation with local farmers.
