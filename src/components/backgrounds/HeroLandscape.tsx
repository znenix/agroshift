"use client";

/**
 * Landing hero landscape (decorative, aria-hidden), in a band below the hero text so no strong colour sits
 * behind text. Five depth layers — sky with a low warm sun, hazy far ranges, near hills, the field, and
 * foreground rows — move at different speeds on scroll (transform only, at most 30 px); clouds drift slowly;
 * a faint grain keeps the fills from looking plastic. prefers-reduced-motion: everything stays still.
 */
import { useEffect, useRef } from "react";
import { DriftingClouds, FarMountains, FieldRows, ForegroundRows, Grain, NearHills, Sun, TONES } from "./Landscape";
import { FIELD } from "./palette";

/** Parallax speed per layer (share of the scroll distance); the nearest layer moves at most 30 px. */
const SPEED = { sun: 0.03, far: 0.06, near: 0.11, field: 0.17, front: 0.25 } as const;
const MAX_SHIFT_PX = 30;

const CLOUDS = [
  { top: "6%", left: "8vw", width: "22%", seconds: 84, delay: -20, opacity: 0.85 },
  { top: "18%", left: "52vw", width: "16%", seconds: 70, delay: -45, opacity: 0.7 },
  { top: "2%", left: "74vw", width: "19%", seconds: 90, delay: -10, opacity: 0.6 },
] as const;

export function HeroLandscape() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (el === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      el.style.setProperty("--hero-scroll", String(Math.min(window.scrollY, MAX_SHIFT_PX / SPEED.front)));
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
  const fill = "parallax absolute inset-0 h-full w-full";
  return (
    <div ref={root} aria-hidden="true" className="hero-landscape pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-[clamp(190px,34vw,330px)] overflow-hidden">
      {/* Sky: from the page's sand into clear sky, warming towards the low sun at the horizon. */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(to bottom, ${FIELD.sand}00 0%, ${FIELD.sky} 38%, ${TONES.skyWarm} 66%, ${TONES.skyWarm} 100%)` }} />
      <DriftingClouds clouds={CLOUDS} />
      <Sun className={fill} style={layer(SPEED.sun)} />
      <FarMountains className={fill} style={layer(SPEED.far)} />
      <NearHills className={fill} style={layer(SPEED.near)} />
      <FieldRows className={fill} style={layer(SPEED.field)} />
      <ForegroundRows className={fill} style={layer(SPEED.front)} />
      <Grain className="grain absolute inset-0 h-full w-full" />
    </div>
  );
}
