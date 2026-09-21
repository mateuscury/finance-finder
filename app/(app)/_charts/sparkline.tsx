"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { toCoordinate } from "./coordinate";
import { useReducedMotion } from "./motion";

export interface SparkPoint {
  /** The x label, already formatted. */
  x: string;
  /** The decimal string; becomes a coordinate here and nowhere else. */
  y: string;
  /** The value as a person reads it; the tooltip prints this, never the number. */
  label: string;
  stale?: boolean;
}

/**
 * The Overview's sparkline (SPEC §9 screen 1): thin stroke, no axes, no
 * gridlines, the portfolio line in the accent. Coordinates are the one
 * place a decimal string becomes a number (decision 35).
 */
export function Sparkline({ points, height = 64 }: { points: SparkPoint[]; height?: number }) {
  const reduced = useReducedMotion();
  const data = points.map((p) => ({ x: p.x, y: toCoordinate(p.y), label: p.label, stale: p.stale ?? false }));
  return (
    <div style={{ width: "100%", height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          {/* A sparkline spans the data, not zero: a 3 % move must be visible. */}
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Area
            type="monotone"
            dataKey="y"
            stroke="var(--accent)"
            strokeWidth={1.5}
            fill="var(--accent)"
            fillOpacity={0.08}
            isAnimationActive={!reduced}
            dot={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--border-hairline)" }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!p) return null;
              return (
                <div className="chart-tip">
                  <span className="muted">{p.x}</span> <span className="figure">{p.label}</span>
                  {p.stale ? <span className="muted"> ⚠</span> : null}
                </div>
              );
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
