"use client";

/**
 * A subtle, decorative background per /field step (aria-hidden, behind everything, 14 % opacity), in the
 * same illustration language as the landing landscape: 1 patchwork of fields from above, 2 soft sky with
 * drifting clouds, 3 curved two-tone furrow rows, 4 contour strips of green and wheat (rotation), 5 the
 * landscape reacting to the stress-test scenario, 6 cloudy sky. Steps crossfade in 400 ms; scenario colours
 * change in 600 ms; clouds drift in 60–90 s; prefers-reduced-motion stops all of it (globals.css).
 * Visual only: it reads the step and the scenario, never changes them.
 */
import { useId } from "react";
import { DriftingClouds, FarMountains, FieldRows, ForegroundRows, NearHills, Sun, TONES } from "./Landscape";
import { FIELD, mixHex, scenarioColours } from "./palette";

const fill = "absolute inset-0 h-full w-full";

function Patchwork() {
  const id = useId();
  // Plots of a 240 × 240 tile, drawn with softly rounded corners; light falls from the top right.
  const plots: ReadonlyArray<[number, number, number, number, string]> = [
    [0, 0, 74, 54, FIELD.fieldGreen],
    [80, 0, 56, 54, FIELD.wheatGold],
    [142, 0, 98, 54, FIELD.lightGreen],
    [0, 60, 50, 78, FIELD.lightGreen],
    [56, 60, 104, 36, mixHex(FIELD.deepGreen, FIELD.fieldGreen, 0.4)],
    [56, 102, 104, 36, FIELD.wheatGold],
    [166, 60, 74, 78, FIELD.fieldGreen],
    [0, 144, 112, 96, mixHex(FIELD.wheatGold, FIELD.lightGreen, 0.35)],
    [118, 144, 54, 96, FIELD.fieldGreen],
    [178, 144, 62, 44, FIELD.lightGreen],
    [178, 194, 62, 46, mixHex(FIELD.deepGreen, FIELD.fieldGreen, 0.4)],
  ];
  return (
    <svg className={fill} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`${id}-plots`} width="240" height="240" patternUnits="userSpaceOnUse" patternTransform="rotate(-9)">
          <rect width="240" height="240" fill={FIELD.sand} />
          {plots.map(([x, y, w, h, c]) => (
            <rect key={`${x}-${y}`} x={x + 2} y={y + 2} width={w - 4} height={h - 4} rx="10" fill={c} />
          ))}
        </pattern>
        <linearGradient id={`${id}-light`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="1" stopColor={FIELD.deepGreen} stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-plots)`} />
      <rect width="100%" height="100%" fill={`url(#${id}-light)`} />
    </svg>
  );
}

/** Contour strips: alternating crop and wheat bands that follow a gentle slope (the rotation symbol). */
function ContourStrips() {
  const bands: Array<{ d: string; c: string }> = [];
  const colours = [FIELD.fieldGreen, FIELD.lightGreen, FIELD.wheatGold, FIELD.lightGreen];
  for (let k = -2; k < 16; k++) {
    const y = k * 60;
    const wave = (dy: number) => `M0 ${y + dy}C300 ${y + dy - 70} 700 ${y + dy + 60} 1200 ${y + dy - 30}`;
    bands.push({ d: `${wave(0)}V${y + 100}H0Z`, c: colours[((k % 4) + 4) % 4] ?? FIELD.lightGreen });
  }
  return (
    <svg className={fill} viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {bands.map((b, i) => (
        <path key={i} d={b.d} fill={b.c} />
      ))}
    </svg>
  );
}

function Scene({ deltaT, rainFactor }: { deltaT: number; rainFactor: number }) {
  const c = scenarioColours(deltaT, rainFactor);
  return (
    <div className="absolute inset-0">
      {/* Sky colour transitions (600 ms); the warm glow towards the horizon stays on top of it. */}
      <div className="bg-fill absolute inset-0" style={{ backgroundColor: c.sky }} />
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${FIELD.wheatGold}00 30%, ${FIELD.wheatGold}55 100%)` }} />
      <Sun className={fill} scale={1 + c.hot * 0.6} />
      <FarMountains className={fill} />
      <NearHills className={fill} />
      <FieldRows className={fill} lit={c.between} shade={c.rows} />
      <ForegroundRows className={fill} lit={mixHex(c.between, c.rows, 0.35)} shade={mixHex(c.rows, FIELD.deepGreen, 0.3)} />
    </div>
  );
}

const SKY_CLOUDS = [
  { top: "8%", left: "6vw", width: "34vw", seconds: 80, delay: -15, opacity: 0.9 },
  { top: "30%", left: "56vw", width: "28vw", seconds: 66, delay: -40, opacity: 0.8 },
  { top: "58%", left: "22vw", width: "30vw", seconds: 88, delay: -60, opacity: 0.7 },
] as const;
const GREY_CLOUDS = [
  { top: "2%", left: "0vw", width: "48vw", seconds: 90, delay: -5, opacity: 0.9 },
  { top: "18%", left: "44vw", width: "52vw", seconds: 74, delay: -30, opacity: 0.85 },
  { top: "40%", left: "10vw", width: "44vw", seconds: 82, delay: -55, opacity: 0.8 },
  { top: "62%", left: "54vw", width: "46vw", seconds: 68, delay: -20, opacity: 0.75 },
  { top: "80%", left: "16vw", width: "40vw", seconds: 86, delay: -70, opacity: 0.7 },
] as const;

export function FieldBackdrop({ step, deltaT, rainFactor }: { step: number; deltaT: number; rainFactor: number }) {
  const layers: ReadonlyArray<{ n: number; node: React.ReactNode }> = [
    { n: 1, node: <Patchwork /> },
    {
      n: 2,
      node: (
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${mixHex(FIELD.sky, FIELD.deepGreen, 0.12)}, ${FIELD.sky} 55%, ${mixHex(FIELD.sky, FIELD.sand, 0.5)})` }}>
          <DriftingClouds clouds={SKY_CLOUDS} />
        </div>
      ),
    },
    {
      n: 3,
      node: (
        // Close-up: the horizon sits just above the top edge, so the curved rows fill the screen.
        <div className="absolute inset-x-0 bottom-0 -top-[70%]">
          <div className={fill} style={{ background: TONES.fieldFar }} />
          <FieldRows className={fill} />
        </div>
      ),
    },
    { n: 4, node: <ContourStrips /> },
    { n: 5, node: <Scene deltaT={deltaT} rainFactor={rainFactor} /> },
    {
      n: 6,
      node: (
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${mixHex(FIELD.sky, FIELD.sand, 0.3)}, ${FIELD.sky})` }}>
          <DriftingClouds tone={mixHex(FIELD.sky, FIELD.deepGreen, 0.55)} clouds={GREY_CLOUDS} />
        </div>
      ),
    },
  ];
  return (
    <div aria-hidden="true" className="field-backdrop pointer-events-none fixed inset-0 -z-10 min-h-lvh overflow-hidden">
      {layers.map(({ n, node }) => (
        <div key={n} className="field-backdrop-layer absolute inset-0" style={{ opacity: n === step ? 1 : 0 }}>
          {node}
        </div>
      ))}
    </div>
  );
}
