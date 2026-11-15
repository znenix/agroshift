"use client";

/**
 * A subtle, decorative background per /field step (aria-hidden, behind everything, 14 % opacity):
 * 1 patchwork of fields from above, 2 soft sky with clouds, 3 furrow rows, 4 green / wheat-gold strips
 * (rotation), 5 a field that reacts to the stress-test scenario, 6 cloudy sky. Steps crossfade in 400 ms;
 * the scenario colours change in 600 ms; prefers-reduced-motion turns both off (globals.css).
 * Visual only: it reads the step and the scenario, never changes them.
 */
import { useId } from "react";
import { Furrows } from "./Furrows";
import { FIELD, scenarioColours } from "./palette";

function Patchwork() {
  const id = useId();
  const plots: ReadonlyArray<[number, number, number, number, string]> = [
    [0, 0, 70, 50, FIELD.fieldGreen],
    [74, 0, 52, 50, FIELD.wheatGold],
    [130, 0, 90, 50, FIELD.lightGreen],
    [0, 54, 46, 72, FIELD.lightGreen],
    [50, 54, 98, 34, FIELD.deepGreen],
    [50, 92, 98, 34, FIELD.wheatGold],
    [152, 54, 68, 72, FIELD.fieldGreen],
    [0, 130, 104, 90, FIELD.wheatGold],
    [108, 130, 50, 90, FIELD.fieldGreen],
    [162, 130, 58, 40, FIELD.lightGreen],
    [162, 174, 58, 46, FIELD.deepGreen],
  ];
  return (
    <svg className="h-full w-full" focusable="false">
      <defs>
        <pattern id={`${id}-plots`} width="224" height="224" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
          <rect width="224" height="224" fill={FIELD.sand} />
          {plots.map(([x, y, w, h, c]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} rx="3" fill={c} />
          ))}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-plots)`} />
    </svg>
  );
}

function Clouds({ count, tone }: { count: number; tone: string }) {
  const clouds: ReadonlyArray<[number, number, number]> = [
    [12, 14, 1.1],
    [58, 9, 0.8],
    [82, 26, 1.3],
    [30, 38, 0.9],
    [70, 52, 1],
    [8, 62, 1.2],
    [46, 74, 0.8],
    [88, 80, 1.1],
  ];
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
      {clouds.slice(0, count).map(([x, y, s]) => (
        <g key={`${x}-${y}`} transform={`translate(${x} ${y}) scale(${s})`} fill={tone}>
          <ellipse cx="0" cy="0" rx="9" ry="3" />
          <ellipse cx="4" cy="-2" rx="5" ry="3" />
          <ellipse cx="-4" cy="-1" rx="4" ry="2.4" />
        </g>
      ))}
    </svg>
  );
}

function ScenarioField({ deltaT, rainFactor }: { deltaT: number; rainFactor: number }) {
  const { hot, rows, between, sky } = scenarioColours(deltaT, rainFactor);
  return (
    <div className="absolute inset-0">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" focusable="false">
        <rect width="1200" height="800" className="bg-fill" style={{ fill: sky }} />
        <g className="bg-fill" style={{ transform: `scale(${1 + hot * 0.45})`, transformOrigin: "960px 150px", opacity: 0.55 + hot * 0.45 }}>
          <circle cx="960" cy="150" r="90" fill={FIELD.wheatGold} opacity="0.35" />
          <circle cx="960" cy="150" r="55" fill={FIELD.wheatGold} />
        </g>
      </svg>
      <div className="absolute inset-x-0 bottom-0" style={{ top: "42%" }}>
        <Furrows dark={rows} light={between} className="h-full w-full" />
      </div>
    </div>
  );
}

export function FieldBackdrop({ step, deltaT, rainFactor }: { step: number; deltaT: number; rainFactor: number }) {
  const layers: ReadonlyArray<{ n: number; node: React.ReactNode }> = [
    { n: 1, node: <Patchwork /> },
    {
      n: 2,
      node: (
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${FIELD.sky}, ${FIELD.sand})` }}>
          <Clouds count={4} tone="#ffffff" />
        </div>
      ),
    },
    {
      n: 3,
      node: (
        <div className="absolute inset-x-0 bottom-0 top-0">
          <Furrows dark={FIELD.fieldGreen} light={FIELD.lightGreen} className="h-full w-full" />
        </div>
      ),
    },
    {
      n: 4,
      node: (
        <div
          className="absolute inset-0"
          style={{ background: `repeating-linear-gradient(100deg, ${FIELD.fieldGreen} 0 64px, ${FIELD.lightGreen} 64px 80px, ${FIELD.wheatGold} 80px 144px, ${FIELD.lightGreen} 144px 160px)` }}
        />
      ),
    },
    { n: 5, node: <ScenarioField deltaT={deltaT} rainFactor={rainFactor} /> },
    {
      n: 6,
      node: (
        <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, #8fa3ad, ${FIELD.sky})` }}>
          <Clouds count={8} tone="#6f8590" />
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
