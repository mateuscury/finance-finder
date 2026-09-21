"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { toCoordinate } from "./coordinate";
import { useReducedMotion } from "./motion";

export interface DonutSlice {
  key: string;
  label: string;
  /** The decimal string of the slice's value; a coordinate only here. */
  value: string;
  /** The share as a person reads it, e.g. "45,67%". */
  shareLabel: string;
  /** The value as a person reads it. */
  valueLabel: string;
}

/** Muted tones from the tokens; the first slice takes the accent. */
const TONES = ["var(--accent)", "var(--text-muted)", "var(--pos)", "var(--neg)", "var(--border-hairline)"];

/** Allocation donut (SPEC §9 screen 1, screen 3): direct labels in the legend beside it, not on the chart. */
export function Donut({ slices, size = 160 }: { slices: DonutSlice[]; size?: number }) {
  const reduced = useReducedMotion();
  const data = slices.map((s) => ({ ...s, v: toCoordinate(s.value) }));
  return (
    <div className="donut">
      <div style={{ width: size, height: size }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="v"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              stroke="var(--bg)"
              strokeWidth={1}
              isAnimationActive={!reduced}
            >
              {data.map((d, i) => (
                <Cell key={d.key} fill={TONES[i % TONES.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ payload }) => {
                const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                return p ? (
                  <div className="chart-tip">
                    {p.label} <span className="figure">{p.shareLabel}</span>
                  </div>
                ) : null;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.key}>
            <span className="swatch" style={{ background: TONES[i % TONES.length] }} aria-hidden="true" /> {d.label}{" "}
            <span className="figure muted">{d.shareLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
