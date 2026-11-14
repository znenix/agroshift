"use client";

/** Recharts is loaded only in the browser and only when a chart is shown (CLAUDE.md §2). */
import dynamic from "next/dynamic";

function ChartSkeleton() {
  return <div aria-hidden className="h-[260px] w-full animate-pulse rounded-md bg-sand-100" />;
}

// next/dynamic needs the options as an object literal at every call site.
export const MonthlyLineChart = dynamic(() => import("./FieldCharts").then((m) => m.MonthlyLineChart), { ssr: false, loading: ChartSkeleton });
export const MonthlyBarLineChart = dynamic(() => import("./FieldCharts").then((m) => m.MonthlyBarLineChart), { ssr: false, loading: ChartSkeleton });
export const MonthlyBarsChart = dynamic(() => import("./FieldCharts").then((m) => m.MonthlyBarsChart), { ssr: false, loading: ChartSkeleton });
export const NdviCurveChart = dynamic(() => import("./FieldCharts").then((m) => m.NdviCurveChart), { ssr: false, loading: ChartSkeleton });
