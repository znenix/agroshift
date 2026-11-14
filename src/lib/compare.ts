/**
 * What each rotation card says (SPEC §5.10): benefits against the farmer's current rotation, risks that
 * need local review, and information gaps. Every line is an i18n key plus numbers.
 */
import type { Analysis } from "./analysis";
import { rotationCrops } from "./catalog";
import type { Reason } from "./crops";
import type { RotationEvaluation } from "./rotations";

/** ASSUMPTION: the smallest differences worth a sentence. */
const WATER_DIFF_M3 = 500;
const BARE_DIFF_DAYS = 20;
const ORGANIC_DIFF = 0.1;
const EROSION_DIFF = 20;

export interface CardNotes {
  benefits: Reason[];
  risks: Reason[];
  gaps: Reason[];
}

const hundreds = (v: number) => Math.round(v / 100) * 100;
const pct = (share: number) => Math.round(share * 100);

export function cardNotes(evaluation: RotationEvaluation, analysis: Analysis): CardNotes {
  const m = evaluation.metrics;
  const c = analysis.current.metrics;
  const isCurrent = evaluation.id === analysis.current.id;
  const benefits: Reason[] = [];
  const risks: Reason[] = [];
  const gaps: Reason[] = [];

  if (!isCurrent) {
    if (m.water.dryYearM3PerHa !== null && c.water.dryYearM3PerHa !== null) {
      const saved = c.water.dryYearM3PerHa - m.water.dryYearM3PerHa;
      if (saved >= WATER_DIFF_M3) benefits.push({ key: "benefit.less_water", params: { value: hundreds(saved) } });
      else if (-saved >= WATER_DIFF_M3) risks.push({ key: "risk.more_water", params: { value: hundreds(-saved) } });
    }
    if (c.bareDaysPerYear - m.bareDaysPerYear >= BARE_DIFF_DAYS) {
      benefits.push({ key: "benefit.fewer_bare_days", params: { value: c.bareDaysPerYear - m.bareDaysPerYear } });
    }
    if (m.nFixingShare > c.nFixingShare) benefits.push({ key: "benefit.legume", params: {} });
    if (m.organicMatter - c.organicMatter >= ORGANIC_DIFF) benefits.push({ key: "benefit.organic", params: {} });
    if (!Number.isFinite(c.longestFamilyRun) && Number.isFinite(m.longestFamilyRun)) benefits.push({ key: "benefit.pest_break", params: {} });
    if (c.erosionIndex !== null && m.erosionIndex !== null && c.erosionIndex - m.erosionIndex >= EROSION_DIFF) {
      benefits.push({ key: "benefit.less_erosion", params: {} });
    }
  }

  if (!Number.isFinite(m.longestFamilyRun)) risks.push({ key: "risk.monoculture", params: {} });
  const currentCrops = new Set(rotationCrops(analysis.current.years).map((crop) => crop.id));
  // Crop-fit frost statistics describe the main-crop season; second crops have their own frost check (exclusion).
  const mainCrops = new Set(evaluation.years.map((y) => y.main));
  for (const crop of rotationCrops(evaluation.years)) {
    const fit = analysis.fits.find((f) => f.cropId === crop.id);
    if (mainCrops.has(crop.id) && fit?.stats.frostShare != null && fit.stats.frostShare >= 0.2) {
      risks.push({ key: "risk.frost", params: { crop: crop.id, value: pct(fit.stats.frostShare) } });
    }
    if (fit?.stats.salinityLossPct != null && fit.stats.salinityLossPct >= 10) {
      risks.push({ key: "risk.salinity", params: { crop: crop.id, value: Math.round(fit.stats.salinityLossPct) } });
    }
    if (!isCurrent && !currentCrops.has(crop.id)) risks.push({ key: "risk.market", params: { crop: crop.id } });
  }
  if (m.vulnerability.harvestRain !== null && m.vulnerability.harvestRain >= 0.1) {
    risks.push({ key: "risk.harvest_rain", params: { value: pct(m.vulnerability.harvestRain) } });
  }
  if (m.vulnerability.heat !== null && m.vulnerability.heat >= 0.3) {
    risks.push({ key: "risk.heat", params: { value: pct(m.vulnerability.heat) } });
  }

  if (analysis.soil.ece === null) gaps.push({ key: "gap.salinity", params: {} });
  if (rotationCrops(evaluation.years).some((crop) => !crop.verified)) gaps.push({ key: "gap.pending_review", params: {} });
  if (m.marketRating === null) gaps.push({ key: "gap.market", params: {} });
  gaps.push({ key: "gap.income", params: {} }, { key: "gap.water_extras", params: {} });
  return { benefits, risks, gaps };
}
