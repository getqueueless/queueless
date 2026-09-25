"use client"

import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

export function WaitComparisonChart({ data }: { data: { hour: string; predicted: number; actual: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-hairline)" />
        <XAxis dataKey="hour" stroke="var(--color-ink-muted)" fontSize={12} />
        <YAxis unit="m" stroke="var(--color-ink-muted)" fontSize={12} />
        <Tooltip
          contentStyle={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-hairline)",
            borderRadius: 8,
            color: "var(--color-ink)",
            fontSize: 13,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 13, color: "var(--color-ink-secondary)" }} />
        <Bar dataKey="actual" name="Actual wait" fill="var(--color-primary-soft)" radius={[4, 4, 0, 0]} />
        <Line dataKey="predicted" name="Predicted wait" stroke="var(--color-primary)" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
