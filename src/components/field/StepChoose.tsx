"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";
import { useI18n } from "@/components/I18nProvider";
import type { RegionsFile } from "@/lib/datafiles";

export type DemoFarm = RegionsFile["demo_farms"][number];
/** How a point was chosen: a map click, the browser's location, or typed coordinates. */
export type PointVia = "map" | "location" | "coordinates";
/** The selected map point: its region (null if none was found) and its distance to the climate cell's centre. */
export interface PointInfo {
  lat: number;
  lon: number;
  regionNames: { uz: string; ru: string; en: string } | null;
  /** NASA POWER cell id and the distance to its centre. */
  cell: string;
  km: number;
}

// MapLibre runs in the browser only (CLAUDE.md §2).
const FieldMap = dynamic(() => import("./FieldMap"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[420px] animate-pulse rounded-lg bg-sand-100 sm:h-[480px]" />,
});

/** Step 1 (SPEC §2): demo farms whose data is built, or any point inside Uzbekistan (map click or coordinates). */
export function StepChoose({
  farms,
  selectedId,
  point,
  pointInfo,
  notice,
  onChoose,
  onPoint,
}: {
  farms: readonly DemoFarm[];
  selectedId: string | null;
  point: { lat: number; lon: number } | null;
  pointInfo: PointInfo | null;
  /** Set when the last chosen point was outside Uzbekistan. */
  notice: PointVia | null;
  onChoose: (id: string) => void;
  onPoint: (lat: number, lon: number, via: PointVia) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <section aria-labelledby="choose-title" className="space-y-4">
      <div>
        <h2 id="choose-title" className="text-2xl font-semibold text-forest-900">
          {t("field.choose.title")}
        </h2>
        <p className="mt-1 text-ink-muted">{t("field.choose.lead")}</p>
      </div>
      <div className="flex flex-wrap items-start gap-3">
        <LocateButton onPoint={(lat, lon) => onPoint(lat, lon, "location")} />
      </div>
      {notice !== null && (
        <p role="alert" className="rounded-md border border-status-warning bg-status-warning/15 px-3 py-2">
          {t(notice === "location" ? "locate.outside" : "map.error.outside")}
        </p>
      )}
      {pointInfo !== null && (
        <p className="rounded-md border border-sand-300 bg-white px-3 py-2 text-sm tabular-nums">
          <span className="font-medium">{t("map.selected_point")}: </span>
          {t("point.where", {
            lat: pointInfo.lat.toFixed(3),
            lon: pointInfo.lon.toFixed(3),
            region: pointInfo.regionNames?.[locale] ?? t("point.region_unknown"),
            cell: pointInfo.cell,
            km: Math.round(pointInfo.km),
          })}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="min-w-0">
          <FieldMap farms={farms} selectedFarm={selectedId} point={point} onPickFarm={onChoose} onPickPoint={(lat, lon) => onPoint(lat, lon, "map")} />
        </div>
        <div className="space-y-4">
          <ul className="grid gap-3">
            {farms.map((farm) => {
              const selected = farm.id === selectedId;
              return (
                <li key={farm.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(farm.id)}
                    aria-pressed={selected}
                    className="flex w-full flex-col items-start gap-1 rounded-lg border border-sand-300 bg-white px-4 py-3 text-left shadow-sm hover:border-forest-900 aria-pressed:border-2 aria-pressed:border-forest-900"
                  >
                    <span className="text-lg font-semibold text-forest-900">{farm.names[locale]}</span>
                    <span className="text-sm text-ink-muted">{t("field.choose.near", { city: farm.city[locale] })}</span>
                    <span className="text-xs text-ink-muted tabular-nums">
                      {farm.lat.toFixed(3)}° N, {farm.lon.toFixed(3)}° E
                    </span>
                    {selected && <span className="text-xs font-semibold text-forest-900">{t("field.choose.selected")}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-sm text-ink-muted">{t("field.choose.more_coming")}</p>
          <CoordinateForm initial={point} onSubmit={(lat, lon) => onPoint(lat, lon, "coordinates")} />
        </div>
      </div>
    </section>
  );
}

type LocateState = "idle" | "locating" | "denied" | "unavailable" | "timeout" | "unsupported";

/** "My location": the browser's geolocation (asked only on click); every failure gets a sentence, never a silent stop. */
function LocateButton({ onPoint }: { onPoint: (lat: number, lon: number) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<LocateState>("idle");
  const locate = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState("unsupported");
      return;
    }
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState("idle");
        onPoint(position.coords.latitude, position.coords.longitude);
      },
      (error) => setState(error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable"),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={locate}
        disabled={state === "locating"}
        className="rounded border border-forest-900 bg-white px-4 py-2 font-medium text-forest-900 hover:bg-sand-100 disabled:opacity-60"
      >
        <span aria-hidden>⌖ </span>
        {t(state === "locating" ? "locate.locating" : "locate.button")}
      </button>
      {state !== "idle" && state !== "locating" && (
        <p role="alert" className="text-sm">
          {t(`locate.${state}`)}
        </p>
      )}
    </div>
  );
}

/** Keyboard-friendly alternative to clicking the map. */
function CoordinateForm({ initial, onSubmit }: { initial: { lat: number; lon: number } | null; onSubmit: (lat: number, lon: number) => void }) {
  const { t } = useI18n();
  const id = useId();
  const [lat, setLat] = useState(initial === null ? "" : String(initial.lat));
  const [lon, setLon] = useState(initial === null ? "" : String(initial.lon));
  const latN = Number(lat);
  const lonN = Number(lon);
  const valid = lat.trim() !== "" && lon.trim() !== "" && Number.isFinite(latN) && Number.isFinite(lonN);
  return (
    <form
      className="space-y-2 rounded-lg border border-sand-300 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(latN, lonN);
      }}
    >
      <p className="font-medium">{t("map.coordinates")}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor={`${id}-lat`} className="flex flex-col gap-1 text-sm">
          {t("map.lat")}
          <input id={`${id}-lat`} name="lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} className="w-28 rounded border border-sand-300 px-2 py-1.5 tabular-nums" />
        </label>
        <label htmlFor={`${id}-lon`} className="flex flex-col gap-1 text-sm">
          {t("map.lon")}
          <input id={`${id}-lon`} name="lon" inputMode="decimal" value={lon} onChange={(e) => setLon(e.target.value)} className="w-28 rounded border border-sand-300 px-2 py-1.5 tabular-nums" />
        </label>
        <button type="submit" disabled={!valid} className="rounded bg-forest-900 px-4 py-2 font-medium text-sand-50 disabled:opacity-50">
          {t("map.analyse_point")}
        </button>
      </div>
    </form>
  );
}
