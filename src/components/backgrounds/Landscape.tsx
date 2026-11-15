/**
 * Layers of the field landscape illustration (decorative, aria-hidden). All layers share one 1200 × 400
 * scene: low warm sun on the right, far ranges hazy and blue (atmospheric perspective), near hills and
 * fields darker and more saturated, crop rows that curve with the land and catch the light on their sunny
 * side (two-tone), and soft long shadows falling to the left. Shapes are smooth curves only.
 */
import { useId } from "react";
import { FIELD, mixHex } from "./palette";

export const SCENE_VIEWBOX = "0 0 1200 400";
/** Where the crop rows meet on the horizon, and the horizon line of the field. */
const VP = { x: 540, y: 262 };
const BOTTOM = 400;

export const TONES = {
  skyWarm: mixHex(FIELD.sky, FIELD.wheatGold, 0.38),
  farthest: mixHex(FIELD.deepGreen, FIELD.sky, 0.8),
  far: mixHex(FIELD.deepGreen, FIELD.sky, 0.62),
  hillTop: mixHex(FIELD.fieldGreen, FIELD.sky, 0.3),
  hillBase: mixHex(FIELD.fieldGreen, FIELD.deepGreen, 0.15),
  fieldFar: mixHex(FIELD.lightGreen, FIELD.sky, 0.35),
  fieldNear: mixHex(FIELD.lightGreen, FIELD.fieldGreen, 0.35),
  rowLit: mixHex(FIELD.lightGreen, FIELD.wheatGold, 0.28),
  rowShade: mixHex(FIELD.fieldGreen, FIELD.deepGreen, 0.3),
  frontLit: mixHex(FIELD.lightGreen, FIELD.wheatGold, 0.4),
  frontShade: mixHex(FIELD.fieldGreen, FIELD.deepGreen, 0.35),
  sunCore: mixHex(FIELD.wheatGold, "#ffffff", 0.45),
} as const;

/** Edge k of the crop rows: from the bottom edge, curving left with the land, into the vanishing point. */
function rowEdge(xBottom: number): { start: string; control: string; end: string } {
  const bend = -150; // rows sweep to the left as they recede, following the slope of the land
  const cx = VP.x + (xBottom - VP.x) * 0.42 + bend;
  const cy = VP.y + (BOTTOM - VP.y) * 0.38;
  const ex = VP.x + (xBottom - VP.x) * 0.012;
  return { start: `${xBottom.toFixed(0)} ${BOTTOM}`, control: `${cx.toFixed(0)} ${cy.toFixed(0)}`, end: `${ex.toFixed(1)} ${VP.y}` };
}

/** The lit faces of the ridges: the right half of each row (sun on the right); the left half stays in shade. */
function litFaces(count: number, spread: number): string {
  const lit: string[] = [];
  const step = (2 * spread) / count;
  for (let i = 0; i < count; i++) {
    const x0 = VP.x - spread + step * i;
    const [m, b] = [rowEdge(x0 + step * 0.5), rowEdge(x0 + step)];
    lit.push(`M${m.start}Q${m.control} ${m.end}L${b.end}Q${b.control} ${b.start}Z`);
  }
  return lit.join("");
}

const ROWS_LIT = litFaces(26, 1700);
const FRONT_LIT = litFaces(12, 1500);

type LayerProps = { className?: string; style?: React.CSSProperties };
const svgProps = (p: LayerProps) => ({
  className: p.className,
  style: p.style,
  viewBox: SCENE_VIEWBOX,
  preserveAspectRatio: "xMidYMax slice",
  "aria-hidden": true as const,
  focusable: "false" as const,
});

/** The low sun with a soft, wide glow. `scale` > 1 makes it larger and stronger (stress-test heat). */
export function Sun({ scale = 1, ...p }: LayerProps & { scale?: number }) {
  const id = useId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <radialGradient id={`${id}-glow`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={FIELD.wheatGold} stopOpacity="0.8" />
          <stop offset="0.18" stopColor={FIELD.wheatGold} stopOpacity="0.45" />
          <stop offset="0.5" stopColor={FIELD.wheatGold} stopOpacity="0.14" />
          <stop offset="1" stopColor={FIELD.wheatGold} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="bg-fill" style={{ transform: `scale(${scale})`, transformOrigin: "820px 150px" }}>
        <circle cx="820" cy="150" r="300" fill={`url(#${id}-glow)`} />
        <circle cx="820" cy="150" r="34" fill={TONES.sunCore} opacity="0.45" />
        <circle cx="820" cy="150" r="22" fill={TONES.sunCore} />
      </g>
    </svg>
  );
}

/** Two hazy mountain ranges, the farther one lighter and bluer. */
export function FarMountains(p: LayerProps) {
  const id = useId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <linearGradient id={`${id}-mist`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TONES.skyWarm} stopOpacity="0" />
          <stop offset="1" stopColor={TONES.skyWarm} stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <path
        d="M0 214C80 190 150 176 240 186S400 160 500 176 660 150 770 170 950 156 1050 176 1160 172 1200 166V300H0Z"
        fill={TONES.farthest}
      />
      <rect y="170" width="1200" height="60" fill={`url(#${id}-mist)`} />
      <path d="M0 232C110 206 220 208 320 220S520 196 640 214 860 198 960 216 1130 204 1200 212V300H0Z" fill={TONES.far} />
      <rect y="206" width="1200" height="50" fill={`url(#${id}-mist)`} />
    </svg>
  );
}

/** Rolling near hills, lit from the right, with a soft shadow on their left flanks. */
export function NearHills(p: LayerProps) {
  const id = useId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <linearGradient id={`${id}-hill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={TONES.hillTop} />
          <stop offset="1" stopColor={TONES.hillBase} />
        </linearGradient>
        <linearGradient id={`${id}-side`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor={FIELD.deepGreen} stopOpacity="0" />
          <stop offset="1" stopColor={FIELD.deepGreen} stopOpacity="0.28" />
        </linearGradient>
      </defs>
      <path d="M0 252C150 228 290 230 410 246S690 222 830 238 1070 230 1200 244V320H0Z" fill={`url(#${id}-hill)`} />
      <path d="M0 252C150 228 290 230 410 246S690 222 830 238 1070 230 1200 244V320H0Z" fill={`url(#${id}-side)`} />
    </svg>
  );
}

/** The field with curved two-tone crop rows; haze near the horizon blends them into the distance. */
export function FieldRows({ lit = TONES.rowLit, shade = TONES.rowShade, far = TONES.fieldFar, ...p }: LayerProps & { lit?: string; shade?: string; far?: string }) {
  const id = useId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <clipPath id={`${id}-land`}>
          <path d={`M0 266C300 254 760 252 1200 262V${BOTTOM}H0Z`} />
        </clipPath>
        <linearGradient id={`${id}-haze`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.655" stopColor={far} stopOpacity="0.92" />
          <stop offset="0.76" stopColor={far} stopOpacity="0.35" />
          <stop offset="0.9" stopColor={far} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-cast`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor={FIELD.deepGreen} stopOpacity="0" />
          <stop offset="1" stopColor={FIELD.deepGreen} stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-land)`}>
        <rect y="240" width="1200" height="160" className="bg-fill" style={{ fill: shade }} />
        <path d={ROWS_LIT} className="bg-fill" style={{ fill: lit }} />
        <rect width="1200" height={BOTTOM} fill={`url(#${id}-haze)`} />
        <path d="M0 262C220 258 420 266 640 262C460 276 240 284 0 300Z" fill={`url(#${id}-cast)`} />
      </g>
    </svg>
  );
}

/** Foreground: a few large, darker rows on a gentle rise, with long shadows stretching left. */
export function ForegroundRows({ lit = TONES.frontLit, shade = TONES.frontShade, ...p }: LayerProps & { lit?: string; shade?: string }) {
  const id = useId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <clipPath id={`${id}-rise`}>
          <path d="M0 362C300 344 720 342 1200 358V400H0Z" />
        </clipPath>
        <linearGradient id={`${id}-shadow`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor={FIELD.deepGreen} stopOpacity="0" />
          <stop offset="1" stopColor={FIELD.deepGreen} stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}-rise)`}>
        <rect y="330" width="1200" height="70" className="bg-fill" style={{ fill: shade }} />
        <path d={FRONT_LIT} className="bg-fill" style={{ fill: lit }} />
        <rect y="330" width="1200" height="70" fill={`url(#${id}-shadow)`} />
      </g>
      {/* The crest of the rise catches the low sun. */}
      <path d="M0 362C300 344 720 342 1200 358" fill="none" stroke={FIELD.wheatGold} strokeOpacity="0.55" strokeWidth="2.5" />
    </svg>
  );
}

/** Very light film grain (feTurbulence) so flat fills do not look plastic; static, 5 % strength. */
export function Grain(p: LayerProps) {
  const id = useId();
  return (
    <svg className={p.className} style={p.style} aria-hidden="true" focusable="false">
      <filter id={`${id}-grain`}>
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch" />
        <feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 0 1" />
      </filter>
      <rect width="100%" height="100%" filter={`url(#${id}-grain)`} />
    </svg>
  );
}

/** Soft clouds that drift across in 60–90 s (globals.css), each a few overlapping soft ellipses. */
export function DriftingClouds({ tone = "#ffffff", clouds }: { tone?: string; clouds: ReadonlyArray<{ top: string; left: string; width: string; seconds: number; delay: number; opacity: number }> }) {
  const id = useId();
  return (
    <>
      {clouds.map((c, i) => (
        <div
          key={i}
          className="cloud-drift absolute"
          style={{ top: c.top, left: c.left, width: c.width, opacity: c.opacity, animationDuration: `${c.seconds}s`, animationDelay: `${c.delay}s`, ["--x" as string]: c.left }}
        >
          <svg viewBox="0 0 200 60" className="block h-auto w-full" aria-hidden="true" focusable="false">
            <defs>
              <radialGradient id={`${id}-c${i}`} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor={tone} stopOpacity="1" />
                <stop offset="0.7" stopColor={tone} stopOpacity="0.85" />
                <stop offset="1" stopColor={tone} stopOpacity="0" />
              </radialGradient>
            </defs>
            <g fill={`url(#${id}-c${i})`}>
              <ellipse cx="100" cy="36" rx="96" ry="22" />
              <ellipse cx="78" cy="28" rx="46" ry="24" />
              <ellipse cx="124" cy="24" rx="40" ry="22" />
            </g>
          </svg>
        </div>
      ))}
    </>
  );
}
