"use client";

/**
 * Landing hero landscape (decorative, aria-hidden): sky glow, sun, distant mountains and crop rows
 * converging to the horizon. It fills a band below the hero text, so no strong colour sits behind text.
 * On scroll the layers move at different speeds (transform only, at most a few dozen pixels); with
 * prefers-reduced-motion everything stays still. If it fails to render, the plain sand page remains.
 */
import { useEffect, useRef } from "react";
import { Furrows } from "./Furrows";
import { FIELD } from "./palette";

/** Parallax speed per layer (share of the scroll distance), and the largest shift in px. */
const SPEED = { sun: 0.06, far: 0.1, near: 0.16, rows: 0.24 } as const;
const MAX_SHIFT_PX = 48;

export function HeroLandscape() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (el === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      el.style.setProperty("--hero-scroll", String(Math.min(window.scrollY, MAX_SHIFT_PX / SPEED.rows)));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

  const layer = (speed: number): React.CSSProperties => ({ transform: `translate3d(0, calc(var(--hero-scroll, 0) * ${speed}px), 0)` });
  return (
    <div ref={root} aria-hidden="true" className="hero-landscape pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[clamp(150px,30vw,280px)] overflow-hidden">
      {/* Horizon glow: sand above, sky blue down to the mountains. */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${FIELD.sand}00 0%, ${FIELD.sky} 55%, ${FIELD.sky} 100%)` }} />
      <svg className="parallax absolute inset-0 h-full w-full" style={layer(SPEED.sun)} viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" focusable="false">
        <circle cx="930" cy="92" r="54" fill={FIELD.wheatGold} opacity="0.25" />
        <circle cx="930" cy="92" r="34" fill={FIELD.wheatGold} />
      </svg>
      <svg className="parallax absolute inset-0 h-full w-full" style={layer(SPEED.far)} viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" focusable="false">
        <path
          d="M0 170L90 128L170 150L270 96L360 136L450 110L560 150L660 84L770 132L860 104L960 146L1060 100L1140 128L1200 112V230H0Z"
          fill={FIELD.deepGreen}
          opacity="0.28"
        />
      </svg>
      <svg className="parallax absolute inset-0 h-full w-full" style={layer(SPEED.near)} viewBox="0 0 1200 300" preserveAspectRatio="xMidYMax slice" focusable="false">
        <path d="M0 188Q150 150 320 176T640 170T960 166T1200 172V240H0Z" fill={FIELD.fieldGreen} opacity="0.75" />
      </svg>
      {/* Crop rows from the horizon (y ≈ 190 of 300) to the bottom edge. */}
      <div className="parallax absolute inset-x-0 bottom-0" style={{ ...layer(SPEED.rows), top: "60%" }}>
        <Furrows dark={FIELD.fieldGreen} light={FIELD.lightGreen} className="h-[calc(100%+48px)] w-full" />
      </div>
    </div>
  );
}
