/**
 * Data sources referenced by the built files and the UI source chips. Citations contain only what
 * the providers state; the exact acknowledgement texts are checked against their docs in Phase 5.
 */
import {
  ELEVATION_SOURCE_LABEL,
  MODIS_SOURCE_LABEL,
  POWER_SOURCE_LABEL,
  SOILGRIDS_SOURCE_LABEL,
} from "./constants";
import type { SourceId, SourceRef } from "./datafiles";

const SOURCES: Readonly<Record<SourceId, Omit<SourceRef, "id" | "retrieved">>> = {
  "nasa-power": {
    label: POWER_SOURCE_LABEL,
    citation: "NASA Langley Research Center (LaRC) POWER Project, Daily API, community AG (meteorology from MERRA-2 and GEOS-IT).",
    url: "https://power.larc.nasa.gov/",
  },
  "modis-ornl": {
    label: MODIS_SOURCE_LABEL,
    citation:
      "MOD13Q1 (MODIS/Terra Vegetation Indices 16-Day L3 Global 250 m) and MCD12Q1 (MODIS/Terra+Aqua Land Cover Type Yearly L3 Global 500 m), via the ORNL DAAC MODIS/VIIRS land product subsets web service.",
    url: "https://modis.ornl.gov/",
  },
  soilgrids: {
    label: SOILGRIDS_SOURCE_LABEL,
    citation:
      "Poggio, L. et al. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. SOIL 7, 217–240. doi:10.5194/soil-7-217-2021 (CC BY 4.0).",
    url: "https://soilgrids.org/",
  },
  "copernicus-dem": {
    label: ELEVATION_SOURCE_LABEL,
    citation: "Copernicus DEM GLO-90, via the Open-Meteo Elevation API (CC BY 4.0).",
    url: "https://open-meteo.com/en/docs/elevation-api",
  },
  geoboundaries: {
    label: "geoBoundaries",
    citation:
      "geoBoundaries gbOpen UZB ADM0 and ADM1 (Runfola, D. et al. 2020, PLoS ONE 15(4): e0231866). Boundary data © OpenStreetMap contributors, ODbL 1.0.",
    url: "https://www.geoboundaries.org/",
  },
  "team-salinity": {
    label: "estimated — regional reports",
    citation: "Team-curated regional salinity table (data/manual/salinity_regions.json); each region cites its report.",
    url: "",
  },
  "team-soil": {
    label: "estimated",
    citation: "Team-curated regional soil fallback (data/manual/soil_fallback.json); each region cites its source.",
    url: "",
  },
};

export function sourceRef(id: SourceId, retrieved: string | null): SourceRef {
  return { id, ...SOURCES[id], retrieved };
}
