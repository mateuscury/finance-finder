"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toCoordinate } from "./coordinate";
import { useReducedMotion } from "./motion";

export interface BarPoint {
  key: string;
  label: string;
  /** The decimal string; a coordinate only here. */
  value: string;
  /** The value as a person reads it. */
  valueLabel: string;
}

/** Horizontal contribution bars (SPEC §9 screen 4): --pos / --neg per sign, the formatted value in the tooltip. */
export function Bars({ points, height }: { points: BarPoint[]; height?: number }) {
  const reduced = useReducedMotion();
  const data = points.map((p) => ({ ...p, v: toCoordinate(p.value) }));
  return (
    <div style={{ width: "100%", height: height ?? Math.max(120, 28 * data.length + 24) }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={140}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => (v.length > 20 ? `${v.slice(0, 19)}…` : v)}
          />
          <Bar dataKey="v" isAnimationActive={!reduced} radius={1}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.v < 0 ? "var(--neg)" : "var(--pos)"} />
            ))}
          </Bar>
          <Tooltip
            cursor={{ fill: "var(--bg-subtle)" }}
            content={({ payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return p ? (
                <div className="chart-tip">
                  {p.label} <span className="figure">{p.valueLabel}</span>
                </div>
              ) : null;
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
