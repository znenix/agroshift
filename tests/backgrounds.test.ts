/** Decorative backgrounds: the step 5 field reacts to the scenario presets (visual only). */
import { describe, expect, it } from "vitest";
import { FIELD, mixHex, scenarioColours } from "@/components/backgrounds/palette";

describe("step 5 backdrop colours", () => {
  it("Normal keeps the green field and the plain sky", () => {
    expect(scenarioColours(0, 1)).toMatchObject({ dry: 0, hot: 0, rows: FIELD.fieldGreen, between: FIELD.lightGreen, sky: FIELD.sky });
  });

  it("Dry year (rain −30 %) turns the field yellow-brown; Hot (+2 °C) warms the sky", () => {
    const dry = scenarioColours(0, 0.7);
    expect(dry.dry).toBe(1);
    expect(dry.rows).toBe("#9c7a3c");
    expect(dry.between).toBe(FIELD.wheatGold);
    expect(dry.sky).toBe(FIELD.sky);
    const hot = scenarioColours(2, 1);
    expect(hot.hot).toBe(1);
    expect(hot.rows).toBe(FIELD.fieldGreen);
    expect(hot.sky).not.toBe(FIELD.sky);
    expect(scenarioColours(4, 1).hot).toBe(1);
    expect(scenarioColours(0, 1.3).dry).toBe(0); // more rain stays green
  });

  it("mixes colours linearly", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#102030", "#102030", 0.3)).toBe("#102030");
  });
});
