"use client";

/**
 * Gantt-like calendar of one rotation (SPEC §6): one row per cycle year, crops coloured by plant family
 * (fixed slots), bare soil hatched. Every mark has a tooltip and the same content is listed as text.
 */
import { useId } from "react";
import { useI18n } from "@/components/I18nProvider";
import { CROPS, FAMILY_SLOT } from "@/lib/catalog";
import { cropName, dayMonth, monthShort } from "@/lib/format";
import type { RotationEvaluation } from "@/lib/rotations";
import { CHART, seriesColor } from "@/components/charts/palette";

const YEAR = 365;
const LABEL_W = 64;
const PLOT_W = 560;
const ROW_H = 34;
const BAR_H = 14;
const TOP = 18;
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

interface Segment {
  from: number;
  to: number;
}

const mod = (v: number, n: number) => ((v % n) + n) % n;

/** Splits an inclusive cycle-day interval (may start < 0 or end ≥ cycle) into pieces inside [0, cycle). */
function onCycle(start: number, end: number, cycle: number): Segment[] {
  const length = end - start + 1;
  if (length >= cycle) return [{ from: 0, to: cycle - 1 }];
  const s = mod(start, cycle);
  return s + length <= cycle ? [{ from: s, to: s + length - 1 }] : [{ from: s, to: cycle - 1 }, { from: 0, to: s + length - 1 - cycle }];
}

/** Pieces of a segment per cycle year (row index and day of that year). */
function byRow(segment: Segment): Array<{ row: number; from: number; to: number }> {
  const pieces = [];
  for (let row = Math.floor(segment.from / YEAR); row <= Math.floor(segment.to / YEAR); row++) {
    const from = Math.max(segment.from, row * YEAR) - row * YEAR;
    const to = Math.min(segment.to, row * YEAR + YEAR - 1) - row * YEAR;
    pieces.push({ row, from, to });
  }
  return pieces;
}

const x = (day: number) => LABEL_W + (day / YEAR) * PLOT_W;

export function RotationTimeline({ evaluation }: { evaluation: RotationEvaluation }) {
  const { t, locale } = useI18n();
  const hatch = `bare-hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rows = evaluation.years.length;
  const cycle = rows * YEAR;
  const height = TOP + rows * ROW_H;
  const families = new Set<string>();
  const bars = evaluation.timeline.flatMap((slot, i) => {
    const crop = CROPS.get(slot.cropId);
    if (crop === undefined) return [];
    families.add(crop.family);
    const color = seriesColor(FAMILY_SLOT[crop.family] ?? 0);
    const name = cropName(slot.cropId, locale);
    const active = slot.active;
    const title =
      active === undefined
        ? `${name}: ${dayMonth(slot.start + 1, locale)} – ${dayMonth(slot.end + 1, locale)}`
        : `${name}: ${dayMonth(active.start + 1, locale)} – ${dayMonth(active.end + 1, locale)}`;
    const pieces = onCycle(slot.start, slot.end, cycle).flatMap(byRow);
    const activePieces = active === undefined ? [] : onCycle(active.start, active.end, cycle).flatMap(byRow);
    const labelPiece = [...(active === undefined ? pieces : activePieces)].sort((a, b) => b.to - b.from - (a.to - a.from))[0];
    return [{ key: `${slot.role}-${slot.year}-${i}`, color, name, title, pieces, activePieces, perennial: active !== undefined, labelPiece }];
  });
  const bare = evaluation.metrics.bareSpells.flatMap((spell) => onCycle(spell.from, spell.to, cycle).flatMap(byRow));
  const rowY = (row: number) => TOP + row * ROW_H + (ROW_H - BAR_H) - 4;

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${LABEL_W + PLOT_W + 8} ${height}`} className="w-full" role="img" aria-label={t("compare.timeline")}>
        <defs>
          <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={CHART.surface} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={CHART.bare} strokeWidth="2" />
          </pattern>
        </defs>
        {MONTH_STARTS.map((d, m) => (
          <g key={d}>
            <line x1={x(d)} x2={x(d)} y1={TOP - 4} y2={height} stroke={CHART.grid} strokeWidth="1" />
            <text x={x(d) + 2} y={11} fontSize="10" fill={CHART.muted}>
              {monthShort(m + 1, locale)}
            </text>
          </g>
        ))}
        {Array.from({ length: rows }, (_, row) => (
          <text key={row} x={0} y={rowY(row) + BAR_H - 2} fontSize="11" fill={CHART.ink}>
            {t("farm.year", { n: row + 1 })}
          </text>
        ))}
        {bare.map((p, i) => (
          <rect key={`bare-${i}`} x={x(p.from)} y={rowY(p.row)} width={Math.max(1, x(p.to + 1) - x(p.from))} height={BAR_H} fill={`url(#${hatch})`} stroke={CHART.bare} strokeWidth="0.5">
            <title>{`${t("family.bare")}: ${dayMonth(p.from + 1, locale)} – ${dayMonth(p.to + 1, locale)}`}</title>
          </rect>
        ))}
        {bars.map((bar) => (
          <g key={bar.key}>
            {bar.pieces.map((p, i) => (
              <rect
                key={i}
                x={x(p.from) + 1}
                y={rowY(p.row)}
                width={Math.max(1, x(p.to + 1) - x(p.from) - 2)}
                height={BAR_H}
                rx="3"
                fill={bar.color}
                fillOpacity={bar.perennial ? 0.4 : 1}
              >
                <title>{bar.title}</title>
              </rect>
            ))}
            {bar.activePieces.map((p, i) => (
              <rect key={`a-${i}`} x={x(p.from) + 1} y={rowY(p.row)} width={Math.max(1, x(p.to + 1) - x(p.from) - 2)} height={BAR_H} rx="3" fill={bar.color}>
                <title>{bar.title}</title>
              </rect>
            ))}
            {bar.labelPiece !== undefined && (
              <text x={x(bar.labelPiece.from) + 3} y={rowY(bar.labelPiece.row) - 3} fontSize="10.5" fill={CHART.ink}>
                {bar.name}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {[...families].map((family) => (
          <span key={family} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-4 rounded-sm" style={{ background: seriesColor(FAMILY_SLOT[family] ?? 0) }} />
            {isFamily(family) ? t(`family.${family}`) : family}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden viewBox="0 0 16 10" className="h-2.5 w-4">
            <rect width="16" height="10" fill={`url(#${hatch})`} stroke={CHART.bare} strokeWidth="1" />
          </svg>
          {t("family.bare")}
        </span>
      </figcaption>
      <ul className="sr-only">
        {bars.map((bar) => (
          <li key={bar.key}>{bar.title}</li>
        ))}
      </ul>
    </figure>
  );
}

type FamilyName = "Malvaceae" | "Poaceae" | "Fabaceae" | "Asteraceae" | "Solanaceae" | "Cucurbitaceae";
const FAMILY_KEYS: ReadonlySet<string> = new Set<FamilyName>(["Malvaceae", "Poaceae", "Fabaceae", "Asteraceae", "Solanaceae", "Cucurbitaceae"]);

function isFamily(family: string): family is FamilyName {
  return FAMILY_KEYS.has(family);
}
