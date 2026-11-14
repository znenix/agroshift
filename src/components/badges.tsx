"use client";

/**
 * Source chips, confidence badges and status badges (SPEC §2, §5.5, §5.12). Status colours are always
 * paired with an icon and a text label, never colour alone.
 */
import type { ReactNode } from "react";
import { sourceIdSchema, type SourceId, type SourceRef } from "@/lib/datafiles";
import { sourceRef } from "@/lib/datasources";
import type { IndicatorStatus } from "@/lib/indicators";
import type { MessageKey } from "@/lib/i18n";
import type { Confidence } from "@/lib/rotations";
import { useI18n } from "./I18nProvider";

export type ChipSource = SourceId | "soil-test" | "crop-table" | "formula-fao56";

const CHIP_KEYS: Readonly<Partial<Record<ChipSource, { label: MessageKey; title: MessageKey }>>> = {
  "soil-test": { label: "source.soil_test", title: "source.soil_test_title" },
  "crop-table": { label: "source.crop_table", title: "source.crop_table_title" },
  "formula-fao56": { label: "source.fao56", title: "source.fao56_title" },
  "team-salinity": { label: "source.team_salinity", title: "source.team_salinity_title" },
  "team-soil": { label: "source.team_soil", title: "source.team_soil_title" },
};

/** "Source: NASA POWER (reanalysis, ~50 km)" — the citation is the tooltip. */
export function SourceChip({
  source,
  refs,
  estimated = false,
  label: labelOverride,
}: {
  source: ChipSource;
  refs: readonly SourceRef[];
  estimated?: boolean;
  /** Replaces the source's short label (e.g. heat: "regional air temperature …"). */
  label?: string;
}) {
  const { t } = useI18n();
  // The field's own reference (with its retrieval date), else the standard description of the source.
  const known = sourceIdSchema.safeParse(source);
  const ref = refs.find((r) => r.id === source) ?? (known.success && CHIP_KEYS[known.data] === undefined ? sourceRef(known.data, null) : undefined);
  const keys = CHIP_KEYS[source];
  const label = labelOverride ?? (keys !== undefined ? t(keys.label) : known.success ? t(`source.name.${known.data}`) : (ref?.label ?? source));
  const title = ref?.citation ?? (keys === undefined ? undefined : t(keys.title));
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center gap-1 rounded-xl border border-sand-300 bg-sand-100 px-2 py-0.5 text-xs text-ink-muted"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
        <ellipse cx="8" cy="4" rx="5" ry="2" />
        <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
      </svg>
      <span className="sr-only">{t("source.label")}: </span>
      <span>{label}</span>
      {estimated && <EstimatedMark />}
    </span>
  );
}

/** Visible mark on every fallback value (CLAUDE.md §1.3). */
export function EstimatedMark() {
  const { t } = useI18n();
  return (
    <span className="rounded bg-status-warning/25 px-1 text-[0.7rem] font-semibold tracking-wide text-ink uppercase" title={t("source.estimated_title")}>
      {t("source.estimated")}
    </span>
  );
}

const CONFIDENCE_BARS: Readonly<Record<Confidence, number>> = { high: 3, medium: 2, low: 1, farmer: 3 };

export function ConfidenceBadge({ level }: { level: Confidence }) {
  const { t } = useI18n();
  const bars = CONFIDENCE_BARS[level];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sand-300 bg-white px-2 py-0.5 text-xs font-medium text-ink">
      {level === "farmer" ? (
        <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="5" r="3" />
          <path d="M2.5 14.5c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 14 12" className="h-3 w-3.5">
          {[0, 1, 2].map((i) => (
            <rect
              key={i}
              x={i * 5}
              y={8 - i * 4}
              width="3.5"
              height={4 + i * 4}
              rx="1"
              className={i < bars ? "fill-water-700" : "fill-sand-300"}
            />
          ))}
        </svg>
      )}
      {t(`confidence.${level}`)}
    </span>
  );
}

const STATUS_STYLE: Readonly<Record<IndicatorStatus, { color: string; icon: ReactNode }>> = {
  good: {
    color: "text-status-good",
    icon: <path d="M4.5 8.5l2.2 2.2 4.8-5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  },
  watch: {
    color: "text-status-warning",
    icon: <path d="M8 4.5v4.2M8 11v.3" fill="none" stroke="#1c1f1a" strokeWidth="1.8" strokeLinecap="round" />,
  },
  concern: {
    color: "text-status-critical",
    icon: <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" />,
  },
  unknown: {
    color: "text-ink-muted",
    icon: (
      <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="white">
        ?
      </text>
    ),
  },
};

export function StatusIcon({ status, className = "size-4" }: { status: IndicatorStatus; className?: string }) {
  const style = STATUS_STYLE[status];
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={`${className} shrink-0 ${style.color}`}>
      {status === "watch" ? <path d="M8 1.5l7 13H1z" fill="currentColor" /> : <circle cx="8" cy="8" r="7" fill="currentColor" />}
      {style.icon}
    </svg>
  );
}

export function StatusBadge({ status, label }: { status: IndicatorStatus; label?: string }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-ink">
      <StatusIcon status={status} />
      {label ?? t(`status.${status}`)}
    </span>
  );
}

/** Small "i" with a plain-language tooltip for technical terms (SPEC §6). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span title={text} className="inline-flex cursor-help align-middle text-ink-muted">
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7v4M8 4.8v.2" strokeLinecap="round" />
      </svg>
      <span className="sr-only">{text}</span>
    </span>
  );
}
