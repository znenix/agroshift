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
