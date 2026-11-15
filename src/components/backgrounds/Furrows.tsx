/**
 * Crop rows converging to a vanishing point on the horizon (perspective furrows), drawn in a 1200 × 300
 * box: alternating bands from the horizon (y = 0) to the bottom edge. Decorative only.
 */
const ROWS = 18;
const SPREAD = 1600; // half-width of the rows at the bottom edge

export function Furrows({ dark, light, className, style }: { dark: string; light: string; className?: string; style?: React.CSSProperties }) {
  const bands: string[] = [];
  for (let i = 0; i < ROWS; i++) {
    const x0 = 600 - SPREAD + ((2 * SPREAD) / ROWS) * i;
    const x1 = x0 + (2 * SPREAD) / ROWS / 2;
    // From two points on the bottom edge to a narrow slit at the vanishing point.
    bands.push(`M${x0.toFixed(0)} 300L${x1.toFixed(0)} 300L${(600 + (x1 - 600) * 0.02).toFixed(1)} 0L${(600 + (x0 - 600) * 0.02).toFixed(1)} 0Z`);
  }
  return (
    <svg viewBox="0 0 1200 300" preserveAspectRatio="none" className={className} style={style} aria-hidden="true" focusable="false">
      <rect width="1200" height="300" style={{ fill: light }} className="bg-fill" />
      <path d={bands.join("")} style={{ fill: dark }} className="bg-fill" />
    </svg>
  );
}
