"use client";

/**
 * Step 1 map (SPEC §6): OpenFreeMap basemap with CARTO as fallback; if both fail, a plain background.
 * Uzbekistan and its regions are always drawn from our own GeoJSON, so the map works without tiles.
 * Demo-farm markers, click anywhere to analyse a point, and optional climate-cell layers with a legend.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import MapGL, { Layer, Marker, NavigationControl, Source, type MapLayerMouseEvent, type StyleSpecification } from "react-map-gl/maplibre";
import { useI18n } from "@/components/I18nProvider";
import { boundariesFileSchema, gridFileSchema, type BoundariesFile, type GridFile } from "@/lib/datafiles";
import { formatNumber } from "@/lib/i18n";
import { GRID_LAYERS, gridFeatures, type GridLayerId } from "@/lib/maplayers";
import { fetchStatic } from "@/lib/staticdata";
import type { DemoFarm } from "./StepChoose";

const STYLES: ReadonlyArray<string | StyleSpecification> = [
  "https://tiles.openfreemap.org/styles/positron",
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#f3ecdc" } }] },
];
const UZ_VIEW = { longitude: 64.5, latitude: 41.4, zoom: 4.6 };

// The worker is served from our own origin (scripts/copy-maplibre-worker.mjs copies it before dev/build).
setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/** URL of a failed request in a MapLibre error event, if any. */
function failedUrl(error: unknown): string | null {
  return typeof error === "object" && error !== null && "url" in error && typeof error.url === "string" ? error.url : null;
}

export interface FieldMapProps {
  farms: readonly DemoFarm[];
  selectedFarm: string | null;
  point: { lat: number; lon: number } | null;
  onPickFarm: (id: string) => void;
  onPickPoint: (lat: number, lon: number) => void;
}

export default function FieldMap({ farms, selectedFarm, point, onPickFarm, onPickPoint }: FieldMapProps) {
  const { t, locale } = useI18n();
  const [styleIndex, setStyleIndex] = useState(0);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [boundaries, setBoundaries] = useState<BoundariesFile | null>(null);
  const [grid, setGrid] = useState<GridFile | null>(null);
  const [layerId, setLayerId] = useState<GridLayerId | "none">("none");
  const [hover, setHover] = useState<{ id: string; value: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetchStatic("/data/boundaries.json", boundariesFileSchema).then((b) => live && setBoundaries(b), () => undefined);
    fetchStatic("/data/grid.json", gridFileSchema).then((g) => live && setGrid(g), () => undefined);
    return () => {
      live = false;
    };
  }, []);

  const layer = GRID_LAYERS.find((l) => l.id === layerId) ?? null;
  const cells = useMemo(() => (grid === null || layer === null ? null : gridFeatures(grid, layer)), [grid, layer]);
  const country = useMemo(() => (boundaries === null ? null : { type: "Feature" as const, properties: {}, geometry: boundaries.country }), [boundaries]);
  const regions = useMemo(
    () =>
      boundaries === null
        ? null
        : { type: "FeatureCollection" as const, features: boundaries.regions.map((r) => ({ type: "Feature" as const, properties: { id: r.id }, geometry: r.geometry })) },
    [boundaries],
  );

  const onClick = (e: MapLayerMouseEvent) => onPickPoint(e.lngLat.lat, e.lngLat.lng);
  const onMove = (e: MapLayerMouseEvent) => {
    const props = e.features?.[0]?.properties;
    const id = props?.id;
    const value = props?.value;
    setHover(typeof id === "string" && typeof value === "number" ? { id, value } : null);
  };
  const valueText = (v: number) =>
    layer?.id === "rain_trend"
      ? t(layer.classes[v]?.label ?? "map.trend.none")
      : `${formatNumber(v, locale, { maximumFractionDigits: layer?.id === "aridity" ? 2 : 0 })}${layer?.unit ? ` ${t(layer.unit)}` : ""}`;

  return (
    <div className="space-y-2">
      <div className="relative h-[420px] overflow-hidden rounded-lg border border-sand-300 sm:h-[480px]">
        <MapGL
          key={styleIndex}
          initialViewState={UZ_VIEW}
          mapStyle={STYLES[styleIndex] ?? STYLES[STYLES.length - 1]}
          onLoad={() => setStyleLoaded(true)}
          onError={(e) => {
            // Only a failing style document falls back to the next basemap; tile and glyph errors are ignored.
            const style = STYLES[styleIndex];
            if (!styleLoaded && typeof style === "string" && failedUrl(e.error) === style && styleIndex < STYLES.length - 1) {
              setStyleIndex((i) => i + 1);
            }
          }}
          onClick={onClick}
          onMouseMove={onMove}
          interactiveLayerIds={cells === null ? [] : ["grid-fill"]}
          cursor="crosshair"
          style={{ width: "100%", height: "100%" }}
          attributionControl={{ compact: true }}
        >
          <NavigationControl position="top-left" showCompass={false} />
          {cells !== null && (
            <Source id="grid" type="geojson" data={cells}>
              <Layer id="grid-fill" type="fill" paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.7 }} />
              <Layer id="grid-line" type="line" paint={{ "line-color": "#fbf8f1", "line-width": 0.5 }} />
            </Source>
          )}
          {regions !== null && (
            <Source id="regions" type="geojson" data={regions}>
              <Layer id="regions-line" type="line" paint={{ "line-color": "#4a5446", "line-width": 0.8, "line-opacity": 0.6 }} />
            </Source>
          )}
          {country !== null && (
            <Source id="country" type="geojson" data={country}>
              <Layer id="country-line" type="line" paint={{ "line-color": "#1f3d2b", "line-width": 2 }} />
            </Source>
          )}
          {farms.map((f) => (
            <Marker
              key={f.id}
              longitude={f.lon}
              latitude={f.lat}
              anchor="bottom"
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                onPickFarm(f.id);
              }}
            >
              <span
                title={f.names[locale]}
                className={`block cursor-pointer rounded-full border-2 border-white px-2 py-0.5 text-xs font-semibold shadow ${f.id === selectedFarm ? "bg-forest-900 text-sand-50" : "bg-sand-50 text-forest-900"}`}
              >
                {f.names[locale]}
              </span>
            </Marker>
          ))}
          {point !== null && (
            <Marker longitude={point.lon} latitude={point.lat} anchor="bottom">
              <svg aria-label={t("map.selected_point")} viewBox="0 0 24 32" className="h-8 w-6 drop-shadow">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#1d5f8a" />
                <circle cx="12" cy="12" r="4.5" fill="#fbf8f1" />
              </svg>
            </Marker>
          )}
        </MapGL>
      </div>
      <p className="text-sm text-ink-muted">{t("map.click_hint")}</p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t("map.layers")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["none", ...GRID_LAYERS.map((l) => l.id)] as const).map((id) => (
            <label key={id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-sand-300 bg-white px-3 py-1 text-sm has-checked:border-forest-900 has-checked:bg-forest-100">
              <input type="radio" name="map-layer" className="accent-forest-900" checked={layerId === id} onChange={() => setLayerId(id)} />
              {id === "none" ? t("map.layer.none") : t(GRID_LAYERS.find((l) => l.id === id)?.title ?? "map.layer.none")}
            </label>
          ))}
        </div>
      </fieldset>

      {layer !== null && grid !== null && (
        <div className="space-y-1 rounded-lg border border-sand-300 bg-white p-3 text-sm">
          <p className="font-medium">
            {t(layer.title)} · {t("map.legend_period", { from: String(grid.period.from), to: String(grid.period.to) })}
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {layer.classes.map((c, i) => (
              <li key={i} className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-sand-300" style={{ background: c.color }} />
                {c.label !== undefined
                  ? t(c.label)
                  : c.from === null
                    ? `< ${formatNumber(c.to ?? 0, locale)}`
                    : c.to === null
                      ? `≥ ${formatNumber(c.from, locale)}`
                      : `${formatNumber(c.from, locale)}–${formatNumber(c.to, locale)}`}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-muted">{t(layer.id === "rain_trend" ? "map.trend_note" : layer.id === "heat_days" ? "source.heat_label" : "map.layer_note")}</p>
          <p aria-live="polite" className="min-h-5 tabular-nums">
            {hover !== null && t("map.hover", { cell: hover.id, value: valueText(hover.value) })}
          </p>
        </div>
      )}
    </div>
  );
}
