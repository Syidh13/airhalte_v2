// TIDAK DIPAKAI — template lama, aman dihapus.
// Dashboard data layer — Kopi Kenangan demo persona
// Refer to CLAUDE_Dashboard.md section 2 for persona spec.

export interface DashboardHalte {
  id: string;
  name: string;
  address: string;
  koridor: string;
  tier: "S" | "A" | "B" | "C" | "D" | "Mass";
  tierName: string;
  pax: number;
  since: string;
  monthlyFee: number;
}

export interface HalteMetrics {
  voicePlays: number;
  ledImpressions: number;
  tjAppPush: number;
  tjAppPushOpens: number;
  tjAppCardViews: number;
  ctrClicks: number;
  uniqueReach: number;
  totalImpressions: number;
  cpm: number;
  uptime: number;
  incidents: number;
}

export interface AggregatedMetrics extends HalteMetrics {
  totalSpend: number;
  halteCount: number;
}

export const SPONSOR = {
  name: "Kopi Kenangan",
  tier: "Mass" as const,
  contractStart: "2026-02-01",
  haltes: [
    {
      id: "kemang",
      name: "Halte Kemang Timur",
      address: "Jl. Kemang Timur Raya, Jaksel",
      koridor: "Non-BRT · Jaksel",
      tier: "D" as const,
      tierName: "Volume Play",
      pax: 5200,
      since: "2026-02-01",
      monthlyFee: 5_000_000,
    },
    {
      id: "pondok",
      name: "Halte Pondok Kopi",
      address: "Jl. Pondok Kopi Raya, Jaktim",
      koridor: "Non-BRT · Jaktim",
      tier: "D" as const,
      tierName: "Volume Play",
      pax: 4500,
      since: "2026-02-15",
      monthlyFee: 5_000_000,
    },
    {
      id: "buaran",
      name: "Halte Buaran",
      address: "Jl. Raden Inten II, Jaktim",
      koridor: "Non-BRT · Jaktim",
      tier: "D" as const,
      tierName: "Volume Play",
      pax: 5200,
      since: "2026-03-01",
      monthlyFee: 5_000_000,
    },
  ] satisfies DashboardHalte[],
};

export const HALTE_METRICS: Record<string, HalteMetrics> = {
  kemang: {
    voicePlays: 2880,
    ledImpressions: 2880,
    tjAppPush: 23400,
    tjAppPushOpens: 2106,
    tjAppCardViews: 18720,
    ctrClicks: 421,
    uniqueReach: 156000,
    totalImpressions: 624000,
    cpm: 8013,
    uptime: 99.2,
    incidents: 2,
  },
  pondok: {
    voicePlays: 2880,
    ledImpressions: 2880,
    tjAppPush: 20250,
    tjAppPushOpens: 1823,
    tjAppCardViews: 16200,
    ctrClicks: 364,
    uniqueReach: 135000,
    totalImpressions: 540000,
    cpm: 9259,
    uptime: 100,
    incidents: 0,
  },
  buaran: {
    voicePlays: 2880,
    ledImpressions: 2880,
    tjAppPush: 23400,
    tjAppPushOpens: 2340,
    tjAppCardViews: 19890,
    ctrClicks: 491,
    uniqueReach: 156000,
    totalImpressions: 624000,
    cpm: 8013,
    uptime: 98.5,
    incidents: 3,
  },
};

export function getAggregated(filter: string = "all"): AggregatedMetrics {
  const ids =
    filter === "all" ? SPONSOR.haltes.map((h) => h.id) : [filter];
  const sum = (k: keyof HalteMetrics) =>
    ids.reduce((a, id) => a + (HALTE_METRICS[id]?.[k] ?? 0), 0);
  const avg = (k: keyof HalteMetrics) => sum(k) / ids.length;
  return {
    voicePlays: sum("voicePlays"),
    ledImpressions: sum("ledImpressions"),
    tjAppPush: sum("tjAppPush"),
    tjAppPushOpens: sum("tjAppPushOpens"),
    tjAppCardViews: sum("tjAppCardViews"),
    ctrClicks: sum("ctrClicks"),
    uniqueReach: sum("uniqueReach"),
    totalImpressions: sum("totalImpressions"),
    cpm: avg("cpm"),
    uptime: avg("uptime"),
    incidents: sum("incidents"),
    totalSpend: ids.length * 5_000_000,
    halteCount: ids.length,
  };
}

export interface DailyPoint {
  date: string;
  value: number;
  isWeekend: boolean;
}

// Deterministic 30-day series — weekday peak, weekend -22%, 2 simulated incidents
export function gen30d(baseValue: number): DailyPoint[] {
  const today = new Date("2026-04-23");
  const out: DailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dow = d.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const noise = Math.sin(i * 0.7) * 0.08 + Math.cos(i * 1.3) * 0.05;
    let v = baseValue * (1 + noise);
    if (isWeekend) v *= 0.78;
    if (i === 11 || i === 5) v *= 0.82;
    out.push({
      date: d.toISOString().slice(0, 10),
      value: Math.round(v),
      isWeekend,
    });
  }
  return out;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString("id-ID");
}

export function fmtShort(n: number): string {
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + "K";
  return Math.round(n).toString();
}

export function fmtIDR(n: number): string {
  if (n >= 1_000_000_000)
    return "Rp " + (n / 1_000_000_000).toFixed(1).replace(".0", "") + " M";
  if (n >= 1_000_000)
    return "Rp " + (n / 1_000_000).toFixed(1).replace(".0", "") + " jt";
  return "Rp " + fmt(n);
}

export function getHalteName(id: string): string {
  const h = SPONSOR.haltes.find((x) => x.id === id);
  return h ? h.name : id;
}
