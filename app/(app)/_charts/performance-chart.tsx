"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toCoordinate } from "./coordinate";
import { useReducedMotion } from "./motion";

export interface PerformanceChartSeries {
  key: string;
  label: string;
  /** The portfolio line takes the accent; every benchmark is muted. */
  accent?: boolean;
}

export interface PerformanceChartPoint {
  /** The x label, already formatted. */
  x: string;
  /** Per series key: the decimal string (a coordinate only here) and its formatted label; null is a gap. */
  values: Record<string, { y: string; label: string; stale?: boolean } | null>;
}

interface Row {
  x: string;
  labels: Record<string, string>;
  stale: string[];
  [seriesKey: string]: unknown;
}

/**
 * SPEC §10 "Charts": thin strokes, no heavy gridlines, direct labels over
 * legends where feasible — each line's name and last value sit in a row
 * above the chart, readable by assistive technology — benchmark lines
 * muted, the portfolio line the accent. Coordinates are the only numbers
 * (decision 35); every printed figure arrives as a string. The axis ticks
 * are a scale, not a figure: one decimal in the locale's percent form.
 */
export function PerformanceChart({
  series,
  points,
  locale,
  height = 280,
}: {
  series: PerformanceChartSeries[];
  points: PerformanceChartPoint[];
  locale: string;
  height?: number;
}) {
  const reduced = useReducedMotion();
  const data: Row[] = points.map((p) => {
    const row: Row = { x: p.x, labels: {}, stale: [] };
    for (const s of series) {
      const v = p.values[s.key];
      row[s.key] = v ? toCoordinate(v.y) : null;
      row.labels[s.key] = v ? v.label : "—";
      if (v?.stale) row.stale.push(s.key);
    }
    return row;
  });
  const lastLabels = data[data.length - 1]?.labels ?? {};
  const tick = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  return (
    <div className="line-chart">
      <ul className="line-legend">
        {series.map((s) => (
          <li key={s.key}>
            <span
              className="swatch"
              style={{ background: s.accent ? "var(--accent)" : "var(--text-muted)" }}
              aria-hidden="true"
            />{" "}
            {s.label} <span className="figure muted">{lastLabels[s.key] ?? "—"}</span>
          </li>
        ))}
      </ul>
      <div style={{ width: "100%", height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border-hairline)" strokeDasharray="2 4" />
            <XAxis
              dataKey="x"
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-hairline)" }}
              minTickGap={48}
            />
            <YAxis
              domain={["dataMin", "dataMax"]}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => tick.format(v)}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.accent ? "var(--accent)" : "var(--text-muted)"}
                strokeWidth={s.accent ? 1.75 : 1}
                dot={false}
                connectNulls={false}
                isAnimationActive={!reduced}
              />
            ))}
            <Tooltip
              cursor={{ stroke: "var(--border-hairline)" }}
              content={({ payload, label }) => {
                const row = payload?.[0]?.payload as Row | undefined;
                if (!row) return null;
                return (
                  <div className="chart-tip">
                    <div className="muted">{String(label)}</div>
                    {series.map((s) => (
                      <div key={s.key}>
                        {s.label}: <span className="figure">{row.labels[s.key]}</span>
                        {row.stale.includes(s.key) ? " ⚠" : ""}
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
