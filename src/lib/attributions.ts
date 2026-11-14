/**
 * Data and service attributions for the About page and footer (SPEC §6, §11). Citations were checked
 * against doi.org and the providers' pages on 2026-11-14; they are quoted, never translated.
 */
import type { SourceId } from "./datafiles";
import type { MessageKey } from "./i18n";

export interface Attribution {
  id: string;
  name: string;
  /** What the app uses it for (translated). */
  use: MessageKey;
  citation: string;
  licence: string | null;
  url: string;
  /** NASA dataset or service (SPEC §11: list of NASA and partner datasets). */
  nasa: boolean;
  /** Source id in the built data, for the access dates in meta.json. */
  sourceId?: SourceId;
}

/** NASA POWER's requested reference, verbatim from power.larc.nasa.gov/docs/referencing/. */
export const POWER_REFERENCE =
  "The data was obtained from National Aeronautics and Space Administration (NASA) Langley Research Center's Prediction Of Worldwide Energy Resources (POWER) project funded through the NASA Earth Science Division.";

/** POWER's data reference template, filled with the Daily API version and access date. */
export const powerDataReference = (version: string, date: string): string =>
  `The data was obtained from the POWER Project's Daily ${version} version on ${date.replaceAll("-", "/")}.`;

export const ATTRIBUTIONS: readonly Attribution[] = [
  {
    id: "power",
    name: "NASA POWER (Prediction Of Worldwide Energy Resources), Daily API, community AG",
    use: "about.use.power",
    citation: POWER_REFERENCE,
    licence: null,
    url: "https://power.larc.nasa.gov/",
    nasa: true,
    sourceId: "nasa-power",
  },
  {
    id: "mod13q1",
    name: "NASA MODIS MOD13Q1 v061 — Vegetation Indices 16-Day 250 m",
    use: "about.use.mod13q1",
    citation: "Didan, K. (2021). MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061 [Dataset]. NASA Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MOD13Q1.061",
    licence: null,
    url: "https://doi.org/10.5067/MODIS/MOD13Q1.061",
    nasa: true,
    sourceId: "modis-ornl",
  },
  {
    id: "mcd12q1",
    name: "NASA MODIS MCD12Q1 v061 — Land Cover Type Yearly 500 m",
    use: "about.use.mcd12q1",
    citation: "Friedl, M., & Sulla-Menashe, D. (2022). MODIS/Terra+Aqua Land Cover Type Yearly L3 Global 500m SIN Grid V061 [Dataset]. NASA Land Processes Distributed Active Archive Center. https://doi.org/10.5067/MODIS/MCD12Q1.061",
    licence: null,
    url: "https://doi.org/10.5067/MODIS/MCD12Q1.061",
    nasa: true,
    sourceId: "modis-ornl",
  },
  {
    id: "ornl",
    name: "ORNL DAAC TESViS RESTful Web Service (MODIS land product subsets)",
    use: "about.use.ornl",
    citation: "ORNL DAAC. (2018). Terrestrial Ecology Subsetting & Visualization Services (TESViS) RESTful Web Service (Version 2.1). ORNL Distributed Active Archive Center. https://doi.org/10.3334/ORNLDAAC/1600",
    licence: null,
    url: "https://doi.org/10.3334/ORNLDAAC/1600",
    nasa: true,
    sourceId: "modis-ornl",
  },
  {
    id: "soilgrids",
    name: "SoilGrids 2.0 (ISRIC)",
    use: "about.use.soilgrids",
    citation: "Poggio, L., de Sousa, L. M., Batjes, N. H., Heuvelink, G. B. M., Kempen, B., Ribeiro, E., & Rossiter, D. (2021). SoilGrids 2.0: producing soil information for the globe with quantified spatial uncertainty. SOIL, 7(1), 217–240. https://doi.org/10.5194/soil-7-217-2021",
    licence: "CC BY 4.0",
    url: "https://soilgrids.org/",
    nasa: false,
    sourceId: "soilgrids",
  },
  {
    id: "copernicus-dem",
    name: "Copernicus DEM GLO-90 (2021 release), via the Open-Meteo Elevation API",
    use: "about.use.dem",
    citation: "Copernicus DEM — Global and European Digital Elevation Model, European Space Agency (ESA), Copernicus programme. https://doi.org/10.5270/ESA-c5d3d65. Elevation served by Open-Meteo (open-meteo.com).",
    licence: "Open-Meteo data: CC BY 4.0",
    url: "https://open-meteo.com/en/docs/elevation-api",
    nasa: false,
    sourceId: "copernicus-dem",
  },
  {
    id: "geoboundaries",
    name: "geoBoundaries gbOpen — Uzbekistan ADM0 and ADM1",
    use: "about.use.geoboundaries",
    citation: "Runfola, D., et al. (2020). geoBoundaries: A global database of political administrative boundaries. PLoS ONE, 15(4), e0231866. https://doi.org/10.1371/journal.pone.0231866. Boundary data © OpenStreetMap contributors.",
    licence: "ODbL 1.0",
    url: "https://www.geoboundaries.org/",
    nasa: false,
    sourceId: "geoboundaries",
  },
  {
    id: "basemap",
    name: "OpenFreeMap (basemap), CARTO Positron (fallback)",
    use: "about.use.basemap",
    citation: "© OpenFreeMap, © OpenMapTiles, data © OpenStreetMap contributors; fallback basemap © CARTO.",
    licence: "OpenStreetMap data: ODbL 1.0",
    url: "https://openfreemap.org/",
    nasa: false,
  },
];

/** Method references (formulas in src/lib/; SPEC §5). */
export const METHOD_REFERENCES: readonly string[] = [
  "Allen, R. G., Pereira, L. S., Raes, D., & Smith, M. (1998). Crop evapotranspiration — Guidelines for computing crop water requirements. FAO Irrigation and Drainage Paper 56. FAO, Rome.",
  "Ayers, R. S., & Westcot, D. W. (1985). Water quality for agriculture. FAO Irrigation and Drainage Paper 29 Rev. 1. FAO, Rome (Maas & Hoffman salt-tolerance values).",
  "Maas, E. V., & Hoffman, G. J. (1977). Crop salt tolerance — current assessment. Journal of the Irrigation and Drainage Division, 103(2), 115–134. https://doi.org/10.1061/JRCEA4.0001137",
  "Brouwer, C., & Heibloem, M. (1986). Irrigation Water Management: Irrigation Water Needs. FAO Training Manual 3. FAO, Rome.",
  "Sen, P. K. (1968). Estimates of the regression coefficient based on Kendall's tau. Journal of the American Statistical Association, 63(324), 1379–1389. https://doi.org/10.1080/01621459.1968.10480934",
  "Mann, H. B. (1945). Nonparametric tests against trend. Econometrica, 13(3), 245–259. https://doi.org/10.2307/1907187; Kendall, M. G. (1975). Rank Correlation Methods. Griffin, London.",
];
