import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { inr } from "@/lib/format";

export function FinanceChart({ series }: { series: any[] }) {
  const data = series.map((s) => ({
    label: s.label,
    Billed: Number(s.billed),
    "Cash collected": Number(s.cash_collected),
    Expenses: Number(s.expenses),
    Surplus: Number(s.operating_surplus),
  }));
  return (
    <div className="h-72 w-full overflow-x-clip">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e6de" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#5b6b63" }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 12, fill: "#5b6b63" }} tickLine={false} axisLine={false} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} width={56} />
          <Tooltip formatter={(v: number) => inr(v)} contentStyle={{ borderRadius: 12, border: "1px solid #e2e6de", fontSize: 13 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Billed" fill="#1b7255" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Cash collected" fill="#b5d118" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Bar dataKey="Expenses" fill="#e26d3d" radius={[6, 6, 0, 0]} maxBarSize={28} />
          <Line type="monotone" dataKey="Surplus" stroke="#0b2f23" strokeWidth={2} dot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HBarChart({ rows, valueKey, labelKey, color = "#1b7255", money = false }: { rows: any[]; valueKey: string; labelKey: string; color?: string; money?: boolean }) {
  const data = rows.map((r) => ({ name: r[labelKey], value: Number(r[valueKey]) }));
  return (
    <div style={{ height: Math.max(160, data.length * 38) }} className="w-full overflow-x-clip">
      <ResponsiveContainer>
        <ComposedChart layout="vertical" data={data} margin={{ left: 10, right: 20 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: "#11201a" }} tickLine={false} axisLine={false} />
          <Tooltip formatter={(v: number) => (money ? inr(v) : v)} contentStyle={{ borderRadius: 12, fontSize: 13 }} />
          <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} maxBarSize={22} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
