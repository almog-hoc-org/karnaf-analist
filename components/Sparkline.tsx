/**
 * A small price chart — with axes, so it reads as a chart and not a squiggle.
 *
 * PLAIN SVG, NOT RECHARTS — deliberately. This renders inside the home page's
 * first screen, which makes it the LCP element: the number the Quality tab
 * measures against Google's 2.5s p75 threshold. Recharts would pull a charting
 * library and a ResponsiveContainer into the critical path to draw four points,
 * and would have to mount on the client before the line exists at all. This is
 * a few hundred bytes of markup that arrive already drawn, with no JavaScript.
 *
 * THE AXES WERE ADDED BECAUSE A BARE LINE IS NOT A CHART (operator, 8/2026).
 * Without a baseline the eye has no zero and no frame, so a 4% rise and a 40%
 * rise look identical — the line always spans the full height, because it is
 * scaled to its own min and max. The axes do not fix the scaling (a sparkline
 * has to fill its box to be legible at this size), but they say plainly that
 * there IS a frame, and on wider screens they carry the values that bound it.
 *
 * It stays aria-hidden: every number it encodes — the change, the years, the
 * price — is stated in text beside it. A "chart" announced to a screen reader
 * as an unlabelled image is noise.
 */

const AXIS = "#cbd5e1"; // slate-300 — present, not competing with the line
const AXIS_TEXT = "#94a3b8"; // slate-400

export default function Sparkline({
  points,
  labels,
  width = 72,
  height = 26,
  className = "",
  rising,
  showValues = false,
}: {
  points: number[];
  /** x-axis labels, same length as points — only the ends are drawn */
  labels?: Array<string | number>;
  width?: number;
  height?: number;
  className?: string;
  /** colours the line; when omitted it is inferred from first vs last */
  rising?: boolean;
  /** draw the end labels — only where there is room for them (desktop) */
  showValues?: boolean;
}) {
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series has span 0 and would divide by zero into NaN coordinates —
  // an invisible line and a console full of SVG errors. It draws mid-height.
  const span = max - min || 1;

  // Room for the axes themselves, plus a text gutter when labels are drawn.
  const padTop = 4;
  const padRight = showValues ? 14 : 3;
  const padBottom = showValues ? 12 : 4;
  const padLeft = showValues ? 30 : 5;

  const w = width - padLeft - padRight;
  const h = height - padTop - padBottom;
  const x0 = padLeft;
  const y0 = padTop + h; // baseline

  const coords = points.map((v, i) => {
    const x = x0 + (i / (points.length - 1)) * w;
    const y = padTop + h - ((v - min) / span) * h;
    return [x, y] as const;
  });

  const up = rising ?? points[points.length - 1] >= points[0];
  const stroke = up ? "#0d9488" : "#e11d48";
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = coords[coords.length - 1];
  const short = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      /* The page is RTL, and an SVG inherits that: `text-anchor: end` becomes
         "the logical end", which in RTL is the LEFT side. The year label at the
         right edge therefore ran off the canvas and rendered as a single stray
         digit. SVG coordinates are numeric, not logical — so this subtree is
         pinned to LTR and the anchors mean what they say. */
      direction="ltr"
      aria-hidden
      focusable="false"
    >
      {/* y axis and x axis — one path, two strokes' worth of markup */}
      <path
        d={`M ${x0} ${padTop} L ${x0} ${y0} L ${x0 + w} ${y0}`}
        fill="none"
        stroke={AXIS}
        strokeWidth={0.75}
      />
      {/* a tick under every year, so the reader can count the points */}
      {coords.map(([x], i) => (
        <line key={i} x1={x} y1={y0} x2={x} y2={y0 + 2} stroke={AXIS} strokeWidth={0.75} />
      ))}

      {showValues && (
        <>
          {/* y bounds: the top label hangs from the top of the plot, the bottom
              one sits ON the baseline, so together they read as the range the
              line is scaled to. */}
          <text x={x0 - 4} y={padTop + 5} textAnchor="end" fontSize="7.5" fill={AXIS_TEXT}>{short(max)}</text>
          <text x={x0 - 4} y={y0 + 2.5} textAnchor="end" fontSize="7.5" fill={AXIS_TEXT}>{short(min)}</text>
          {labels && labels.length === points.length && (
            <>
              <text x={x0} y={height - 3} textAnchor="middle" fontSize="7.5" fill={AXIS_TEXT}>{labels[0]}</text>
              <text x={x0 + w} y={height - 3} textAnchor="middle" fontSize="7.5" fill={AXIS_TEXT}>
                {labels[labels.length - 1]}
              </text>
            </>
          )}
        </>
      )}

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
