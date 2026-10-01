// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import {
  fmt,
  fmtShort,
  HALTE_METRICS,
  type DashboardHalte,
} from "@/data/dashboardData";

interface DashboardHalteCardProps {
  halte: DashboardHalte;
  onClick?: (id: string) => void;
}

export default function DashboardHalteCard({
  halte,
  onClick,
}: DashboardHalteCardProps) {
  const m = HALTE_METRICS[halte.id];
  if (!m) return null;
  return (
    <button
      type="button"
      className="dash-halte-card"
      onClick={() => onClick?.(halte.id)}
    >
      <div className="dash-halte-card-head">
        <div style={{ minWidth: 0 }}>
          <div className="dash-halte-card-name">{halte.name}</div>
          <div className="dash-halte-card-meta">
            {halte.koridor} · {fmt(halte.pax)} pax/hari
          </div>
        </div>
        <span className="dash-halte-card-tier">{halte.tierName}</span>
      </div>
      <div className="dash-halte-card-stats">
        <div>
          <div className="dash-halte-stat-label">Voice plays/bln</div>
          <div className="dash-halte-stat-value">{fmt(m.voicePlays)}</div>
        </div>
        <div>
          <div className="dash-halte-stat-label">Uptime</div>
          <div className="dash-halte-stat-value">
            {m.uptime}
            <span className="unit">%</span>
          </div>
        </div>
        <div>
          <div className="dash-halte-stat-label">Unique reach</div>
          <div className="dash-halte-stat-value">{fmtShort(m.uniqueReach)}</div>
        </div>
        <div>
          <div className="dash-halte-stat-label">CPM</div>
          <div className="dash-halte-stat-value">Rp {fmt(m.cpm)}</div>
        </div>
      </div>
    </button>
  );
}
