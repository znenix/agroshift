import { describe, expect, it } from "vitest";
import { mannKendall, normalCdf, senSlope, trend } from "@/lib/trends";

describe("Sen's slope and Mann–Kendall (SPEC §5.4, §9)", () => {
  it("finds a significant rise in a steadily increasing series", () => {
    const r = trend(Array.from({ length: 10 }, (_, i) => ({ t: 2006 + i, value: i + 1 })));
    // S = n(n−1)/2 = 45, Var = 10·9·25/18 = 125, Z = (45 − 1)/√125 = 3.9355
    expect(r).toMatchObject({ n: 10, slope: 1, s: 45, varS: 125, significant: true, direction: "rising" });
    expect(r?.z).toBeCloseTo(3.9355, 4);
    expect(r?.p).toBeLessThan(0.001);
  });

  it("matches a hand-computed series with a tie, and calls it no clear trend", () => {
    // x = 5, 3, 4, 4, 6: S = 3; Var = (5·4·15 − 2·1·9)/18 = 15.667; Z = (3 − 1)/√15.667 = 0.5053; p = 0.613.
    // Pairwise slopes −2, −0.5, −0.333, 0, 0.25, 0.5, 1, 1, 1, 2 → Sen's slope = 0.375.
    const r = trend([5, 3, 4, 4, 6].map((value, t) => ({ t, value })), 0.05, 5);
    expect(r?.s).toBe(3);
    expect(r?.varS).toBeCloseTo(15.6667, 4);
    expect(r?.z).toBeCloseTo(0.5053, 4);
    expect(r?.p).toBeCloseTo(0.6134, 3);
    expect(r?.slope).toBeCloseTo(0.375, 10);
    expect(r?.significant).toBe(false);
    expect(r?.direction).toBe("no_clear_trend");
  });

  it("reports a falling series and ignores missing values", () => {
    const values = [10, 9.5, null, 8.7, 8.1, 7.9, null, 7.2, 6.8, 6.1, 5.9, 5.2];
    const r = trend(values.map((value, i) => ({ t: 2006 + i, value })));
    expect(r?.n).toBe(10);
    expect(r?.direction).toBe("falling");
    expect(r?.slope).toBeLessThan(0);
  });

  it("treats a flat series as no trend and refuses too few points", () => {
    const flat = trend(Array.from({ length: 12 }, (_, i) => ({ t: i, value: 3 })));
    expect(flat).toMatchObject({ s: 0, p: 1, slope: 0, significant: false, direction: "no_clear_trend" });
    expect(trend([1, 2, 3].map((value, t) => ({ t, value })))).toBeNull();
  });

  it("uses real time steps for the slope and time order for the test", () => {
    expect(senSlope([2006, 2008, 2012], [1, 2, 4])).toBeCloseTo(0.5, 10);
    expect(mannKendall([1, 2, 3]).s).toBe(3);
    expect(mannKendall([3, 2, 1]).s).toBe(-3);
  });

  it("computes the normal CDF accurately", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
  });
});
