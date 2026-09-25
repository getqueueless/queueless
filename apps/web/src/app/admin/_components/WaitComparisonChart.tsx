"use client"

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

// Series colours come from admin.module.css (--chart-actual is the AA display
// cyan, --chart-predicted the brand slate, lightened in dark). Legend and
// tooltip text stay in ink so no series colour is ever used as small text.
const inkLabel = (value: string) => <span style={{ color: "var(--color-ink-secondary)" }}>{value}</span>

export function WaitComparisonChart({ data }: { data: { hour: string; predicted: number; actual: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} accessibilityLayer margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-hairline)" />
        <XAxis dataKey="hour" stroke="var(--color-hairline-strong)" tick={{ fill: "var(--color-ink-muted)" }} tickLine={false} fontSize={12} />
        <YAxis unit="m" stroke="var(--color-hairline-strong)" tick={{ fill: "var(--color-ink-muted)" }} tickLine={false} axisLine={false} fontSize={12} />
        <Tooltip
          contentStyle={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-hairline)",
            borderRadius: 8,
            boxShadow: "var(--shadow-card)",
            fontSize: 13,
          }}
          labelStyle={{ color: "var(--color-ink)", fontWeight: 600 }}
          itemStyle={{ color: "var(--color-ink-secondary)" }}
        />
        <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} formatter={inkLabel} />
        <Bar dataKey="actual" name="Actual wait" fill="var(--chart-actual)" radius={[4, 4, 0, 0]} maxBarSize={48} />
        <Line
          dataKey="predicted"
          name="Predicted wait"
          stroke="var(--chart-predicted)"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "var(--color-surface)", stroke: "var(--chart-predicted)", strokeWidth: 2 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
