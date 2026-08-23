/**
 * A price line small enough to live inside a card.
 *
 * PLAIN SVG, NOT RECHARTS — deliberately. This component renders inside the
 * home page's first screen, which makes it the LCP element: the number the
 * Quality tab measures against Google's 2.5s p75 threshold. Recharts would
 * pull a charting library and a ResponsiveContainer into the critical path to
 * draw four points, and would have to mount on the client before the line
 * exists at all. This is a few hundred bytes of markup that arrive already
 * drawn, with no JavaScript involved.
 *
 * It is decoration for a number that is stated in text beside it, so it is
 * aria-hidden: a screen reader gets the percentage and the years, which is the
 * whole content. A "chart" announced as an unlabelled image is noise.
 */
export default function Sparkline({
  points,
  width = 72,
  height = 26,
  className = "",
  rising,
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
  /** colours the line; when omitted it is inferred from first vs last */
  rising?: boolean;
}) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series has span 0 and would divide by zero into NaN coordinates —
  // an invisible line and a console full of SVG errors. It draws mid-height.
  const span = max - min || 1;
  const pad = 2;
  const w = width - pad * 2;
  const h = height - pad * 2;

  const coords = points.map((v, i) => {
    const x = pad + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
    const y = pad + h - ((v - min) / span) * h;
    return [x, y] as const;
  });

  const up = rising ?? points[points.length - 1] >= points[0];
  const stroke = up ? "#0d9488" : "#e11d48";
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* the newest point, marked — the eye needs to know which end is today */}
      <circle cx={lastX} cy={lastY} r={2.1} fill={stroke} />
    </svg>
  );
}
