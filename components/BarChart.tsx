"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface Bar {
  label: string;
  value: number;
  /** Renders in a neutral colour, for "not a value" buckets like "never". */
  muted?: boolean;
  tooltip?: ReactNode;
}

interface BarChartProps {
  bars: Bar[];
  height?: number;
  xLabel?: string;
  yLabel?: string;
  formatValue?: (v: number) => string;
  /** Show the value above each bar (only sensible for few bars). */
  labelBars?: boolean;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

/** Path for a bar with 4px rounded top corners, anchored flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function BarChart({
  bars,
  height = 220,
  xLabel,
  yLabel,
  formatValue = (v) => v.toLocaleString(),
  labelBars = false,
}: BarChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = Math.max(1, ...bars.map((b) => b.value));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const m = { top: labelBars ? 20 : 10, right: 8, bottom: xLabel ? 42 : 26, left: 44 };
  const plotW = width - m.left - m.right;
  const plotH = height - m.top - m.bottom;
  const slot = plotW / Math.max(1, bars.length);
  const gap = Math.min(2 + slot * 0.15, 12);
  const barW = Math.max(1, slot - gap);
  const y = (v: number) => m.top + plotH - (v / top) * plotH;
  const labelEvery = Math.ceil(bars.length / Math.max(1, Math.floor(plotW / 28)));

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={yLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = m.left + i * slot + gap / 2;
          const h = (b.value / top) * plotH;
          const active = hover === i;
          return (
            <g key={b.label}>
              <path
                d={barPath(x, y(b.value), barW, h)}
                fill={b.muted ? "var(--series-muted)" : "var(--series-1)"}
                opacity={hover === null || active ? 1 : 0.55}
              />
              {labelBars && b.value > 0 && (
                <text
                  x={x + barW / 2}
                  y={y(b.value) - 5}
                  textAnchor="middle"
                  className="fill-ink-2 text-[11px] tabular"
                >
                  {formatValue(b.value)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={m.top + plotH + 16}
                  textAnchor="middle"
                  className="fill-muted text-[11px] tabular"
                >
                  {b.label}
                </text>
              )}
              <rect
                x={m.left + i * slot}
                y={m.top}
                width={slot}
                height={plotH + 20}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
        <line
          x1={m.left}
          x2={width - m.right}
          y1={m.top + plotH}
          y2={m.top + plotH}
          stroke="var(--muted)"
          strokeWidth={1}
        />
        {xLabel && (
          <text x={m.left + plotW / 2} y={height - 4} textAnchor="middle" className="fill-ink-2 text-xs">
            {xLabel}
          </text>
        )}
      </svg>
      {hover !== null && bars[hover] && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
          style={{
            left: Math.min(width - 160, Math.max(0, m.left + hover * slot + slot / 2 - 60)),
            top: Math.max(0, y(bars[hover].value) - 48),
          }}
        >
          {bars[hover].tooltip ?? (
            <>
              <div className="font-medium">{bars[hover].label}</div>
              <div className="text-ink-2 tabular">{formatValue(bars[hover].value)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
