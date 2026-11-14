import { describe, expect, it } from "vitest";
import cropsJson from "../data/crops.json";
import rotationsJson from "../data/rotations.json";
import en from "../locales/en.json";
import { cropsFileSchema, indexCrops, kcCurveFor, unverifiedFields } from "@/lib/crops";
import { perennialRuns, rotationIssues, rotationsFileSchema, type RotationYear } from "@/lib/rotations";
import { kcOnDay } from "@/lib/water";

const crops = cropsFileSchema.parse(cropsJson).crops;
const byId = indexCrops(crops);
const rotations = rotationsFileSchema.parse(rotationsJson).rotations;

describe("crops.json draft (SPEC §5.6)", () => {
  it("lists exactly the crops of SPEC §5.6", () => {
    expect(crops.map((c) => c.id)).toEqual([
      "cotton",
      "winter_wheat",
      "winter_barley",
      "maize_grain",
      "maize_silage",
      "rice",
      "sorghum",
      "alfalfa",
      "mung_bean",
      "chickpea",
      "soybean",
      "sunflower",
      "potato",
      "melon",
      "triticale",
    ]);
  });

  it("is a draft: nothing is verified, unchecked values say TODO, and every value group needs a source", () => {
    expect(crops.every((c) => !c.verified)).toBe(true);
    expect(crops.every((c) => unverifiedFields(c).length > 0)).toBe(true);
    const withoutBotanySource = { ...cropsJson.crops[0], sources: cropsJson.crops[0].sources.slice(1) };
    expect(cropsFileSchema.safeParse({ about: "", crops: [withoutBotanySource] }).success).toBe(false);
  });

  it("leaves salinity unknown where no value could be checked", () => {
    expect(byId.get("chickpea")?.salinity).toEqual({ ece_threshold: null, slope_pct_per_dsm: null });
    expect(byId.get("sunflower")?.salinity.ece_threshold).toBeNull();
  });

  it("marks the legumes as nitrogen-fixing and alfalfa as a 2–4 year perennial", () => {
    const fixers = crops.filter((c) => c.n_fixing);
    expect(fixers.map((c) => c.id).sort()).toEqual(["alfalfa", "chickpea", "mung_bean", "soybean"]);
    expect(fixers.every((c) => c.family === "Fabaceae")).toBe(true);
    expect(byId.get("alfalfa")).toMatchObject({ perennial: true, years: { min: 2, max: 4, default: 3 } });
  });

  it("gives every crop role a Kc curve from Kc_ini at sowing to Kc_end at harvest", () => {
    for (const crop of crops) {
      for (const role of ["main", "second"] as const) {
        const curve = kcCurveFor(crop, role);
        if (curve === null) continue;
        expect(kcOnDay(curve, 1), `${crop.id} ${role}`).toBeCloseTo(crop.kc_ini, 10);
        expect(kcOnDay(curve, curve.seasonDays), `${crop.id} ${role}`).toBeCloseTo(crop.kc_end, 10);
      }
    }
  });

  it("writes Uzbek names in Latin script", () => {
    for (const crop of crops) expect(crop.names.uz, crop.id).not.toMatch(/[Ѐ-ӿ]/);
  });
});

describe("rotations.json (SPEC §5.8)", () => {
  it("has the 7 starter templates, all buildable from crops.json", () => {
    expect(rotations.map((r) => r.id)).toEqual([
      "cotton_mono",
      "cotton_wheat",
      "cotton_wheat_mung",
      "alfalfa_cotton_wheat",
      "barley_sorghum",
      "wheat_silage",
      "rainfed_wheat_chickpea",
    ]);
    for (const r of rotations) expect(rotationIssues(r.years, byId), r.id).toEqual([]);
  });

  it("has an English 'why suggested' text for every template", () => {
    const keys = new Set(Object.keys(en));
    for (const r of rotations) expect(keys.has(r.why_key), r.why_key).toBe(true);
  });

  it("marks only the lalmi template as rain-fed", () => {
    expect(rotations.filter((r) => r.conditions.mode === "rainfed").map((r) => r.id)).toEqual(["rainfed_wheat_chickpea"]);
  });
});

describe("rotation checks (also used for the farmer's own rotation)", () => {
  const y = (main: string, second: string | null = null): RotationYear => ({ main, second });

  it("rejects unknown crops and crops in a role they are not grown in", () => {
    expect(rotationIssues([y("cotton", "cotton"), y("banana")], byId).map((i) => i.code)).toEqual(["not_a_second_crop", "unknown_crop"]);
    expect(rotationIssues([y("alfalfa", "mung_bean"), y("alfalfa"), y("cotton")], byId).map((i) => i.code)).toEqual([
      "second_in_perennial_year",
    ]);
  });

  it("counts a perennial stand across the end of the cycle", () => {
    // Alfalfa in the last and the first year is one 2-year stand, because the cycle repeats.
    expect(perennialRuns([y("alfalfa"), y("cotton"), y("cotton"), y("alfalfa")], byId)).toEqual([
      { crop: "alfalfa", startYear: 4, length: 2 },
    ]);
    expect(rotationIssues([y("alfalfa"), y("cotton")], byId)).toEqual([
      { code: "perennial_run_length", year: 1, crop: "alfalfa", length: 1, min: 2, max: 4 },
    ]);
    const fiveYears = [...Array.from({ length: 5 }, () => y("alfalfa")), y("cotton")];
    expect(rotationIssues(fiveYears, byId).map((i) => i.code)).toEqual(["perennial_run_length"]);
    expect(perennialRuns([y("alfalfa"), y("alfalfa")], byId)[0]?.length).toBe(Number.POSITIVE_INFINITY);
  });
});
