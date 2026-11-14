"use client";

/**
 * Recharts charts of the field-conditions step (SPEC §6). Loaded lazily and client-side only (see
 * ./LazyCharts.tsx). Rules (dataviz): one y-axis per chart, legend for ≥ 2 series plus direct labels,
 * tooltips on every mark, thin 2 px lines, recessive grid; every chart has a table view next to it.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART, SERIES } from "./palette";

const AXIS_TICK = { fill: CHART.muted, fontSize: 12 };
const TOOLTIP_STYLE = { borderRadius: 6, borderColor: CHART.grid, fontSize: 13, color: CHART.ink };
const legendText = (value: string) => <span style={{ color: CHART.ink }}>{value}</span>;

export interface MonthDatum {
  month: string;
  [series: string]: string | number | null;
}

export interface SeriesSpec {
  key: string;
  name: string;
  /** Short name for the direct label at the end of a line (the legend carries the full name). */
  short?: string;
  slot: number;
}

function formatValue(value: unknown, digits: number): string {
  return typeof value === "number" ? value.toFixed(digits) : "–";
}

/** Direct label at the end of a line (December), in text ink beside the coloured mark. */
function EndLabel({ data, series }: { data: readonly MonthDatum[]; series: SeriesSpec }) {
  const last = data[data.length - 1];
  const y = last?.[series.key];
  if (last === undefined || typeof y !== "number") return null;
  return (
    <ReferenceDot
      x={last.month}
      y={y}
      r={0}
      ifOverflow="visible"
      label={{ value: series.short ?? series.name, position: "right", fill: CHART.ink, fontSize: 12 }}
    />
  );
}

export function MonthlyLineChart({ data, series, unit, digits = 1 }: { data: MonthDatum[]; series: SeriesSpec[]; unit: string; digits?: number }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} />
        <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => `${formatValue(value, digits)}${unit}`} />
        <Legend verticalAlign="top" align="left" iconType="plainline" formatter={legendText} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
        {series.map((s) => (
          <Line
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stroke={SERIES[s.slot - 1]}
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: SERIES[s.slot - 1] }}
            activeDot={{ r: 5, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls={false}
          />
        ))}
        {series.map((s) => (
          <EndLabel key={`label-${s.key}`} data={data} series={s} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Bars plus one line on the same unit (rain bars, ET0 line): still a single y-axis. */
export function MonthlyBarLineChart({ data, bar, line, unit }: { data: MonthDatum[]; bar: SeriesSpec; line: SeriesSpec; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 48, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} />
        <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => `${formatValue(value, 0)}${unit}`} />
        <Legend verticalAlign="top" align="left" formatter={legendText} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
        <Bar dataKey={bar.key} name={bar.name} fill={SERIES[bar.slot - 1]} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Line
          dataKey={line.key}
          name={line.name}
          stroke={SERIES[line.slot - 1]}
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: SERIES[line.slot - 1] }}
          isAnimationActive={false}
        />
        <EndLabel data={data} series={line} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function MonthlyBarsChart({ data, series, unit }: { data: MonthDatum[]; series: SeriesSpec[]; unit: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} barGap={2}>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: CHART.grid }} />
        <YAxis width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => `${formatValue(value, 1)} ${unit}`} />
        <Legend verticalAlign="top" align="left" formatter={legendText} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={SERIES[s.slot - 1]} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface NdviDatum {
  doy: number;
  recent: number | null;
  record: number | null;
}

/**
 * NDVI seasonal curve: recent years (series 3, green) over the whole record (grey context), the
 * bare-soil threshold as a dashed rule and bare periods as hatched areas.
 */
export function NdviCurveChart({
  data,
  bare,
  monthTicks,
  labels,
}: {
  data: NdviDatum[];
  bare: ReadonlyArray<{ from: number; to: number }>;
  monthTicks: ReadonlyArray<{ doy: number; label: string }>;
  labels: { recent: string; record: string; threshold: string; bare: string };
}) {
  const tickLabel = new Map(monthTicks.map((m) => [m.doy, m.label]));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <defs>
          <pattern id="ndvi-bare-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={CHART.surface} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={CHART.bare} strokeWidth="2" />
          </pattern>
        </defs>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        {bare.map((b) => (
          <ReferenceArea
            key={`${b.from}-${b.to}`}
            x1={b.from}
            x2={b.to}
            y1={0}
            y2={1}
            fill="url(#ndvi-bare-hatch)"
            fillOpacity={1}
            ifOverflow="hidden"
            label={{ value: labels.bare, position: "insideTop", fill: CHART.muted, fontSize: 12 }}
          />
        ))}
        <XAxis
          dataKey="doy"
          type="number"
          domain={[1, 366]}
          ticks={monthTicks.map((m) => m.doy)}
          tickFormatter={(doy: number) => tickLabel.get(doy) ?? ""}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={{ stroke: CHART.grid }}
        />
        <YAxis domain={[0, 1]} ticks={[0, 0.2, 0.4, 0.6, 0.8, 1]} width={40} tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <ReferenceLine
          y={0.2}
          stroke={CHART.muted}
          strokeDasharray="4 4"
          label={{ value: labels.threshold, position: "insideBottomLeft", fill: CHART.muted, fontSize: 12 }}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelFormatter={(doy) => (typeof doy === "number" ? (monthTicks.findLast((m) => m.doy <= doy)?.label ?? "") : "")}
          formatter={(value) => formatValue(value, 2)}
        />
        <Legend verticalAlign="top" align="left" iconType="plainline" formatter={legendText} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
        <Line dataKey="record" name={labels.record} stroke={CHART.context} strokeWidth={2} strokeDasharray="2 3" dot={false} isAnimationActive={false} />
        <Line
          dataKey="recent"
          name={labels.recent}
          stroke={SERIES[2]}
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 0, fill: SERIES[2] }}
          activeDot={{ r: 5, stroke: CHART.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
