import { describe, expect, it } from "vitest";
import { decodeSeries, encodeSeries } from "@/lib/encode";

describe("Int16 × 10 base64 series (SPEC §4.2, §9)", () => {
  it("round-trips values at 0.1 resolution, including negatives and missing days", () => {
    const values = [-12.34, 0, 45.67, null, 0.04, -0.05, 3276.7, null];
    // −0.05 × 10 rounds to −0, which Int16 stores as plain 0.
    expect(decodeSeries(encodeSeries(values))).toEqual([-12.3, 0, 45.7, null, 0, 0, 3276.7, null]);
  });

  it("is compact: two bytes per day", () => {
    const year = Array.from({ length: 7620 }, (_, i) => (i % 40) - 10);
    const encoded = encodeSeries(year);
    expect(encoded.length).toBe(Math.ceil((7620 * 2) / 3) * 4);
    expect(decodeSeries(encoded)).toEqual(year);
  });

  it("refuses values that do not fit and corrupt input", () => {
    expect(() => encodeSeries([3300])).toThrow(RangeError);
    expect(() => encodeSeries([Number.NaN])).toThrow(RangeError);
    expect(() => decodeSeries("AAAA")).toThrow(RangeError); // 3 bytes: not a whole number of Int16 values
  });
});
