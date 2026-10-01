// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import { fmt, fmtShort, HALTE_METRICS, SPONSOR } from "@/data/dashboardData";

export default function HaltesPage() {
  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Per-Halte Performance</div>
          <h1 className="dash-page-title">Perbandingan antar halte.</h1>
          <p className="dash-page-subtitle">
            Side-by-side comparison {SPONSOR.haltes.length} halte yang Anda
            sponsor.
          </p>
        </div>
      </div>
      <div className="dash-card">
        <table className="dash-data-table">
          <thead>
            <tr>
              <th>Halte</th>
              <th className="num">Pax/hari</th>
              <th className="num">Voice plays</th>
              <th className="num">TJ App opens</th>
              <th className="num">Unique reach</th>
              <th className="num">CPM</th>
              <th className="num">Uptime</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {SPONSOR.haltes.map((h) => {
              const x = HALTE_METRICS[h.id];
              const statusClass =
                x.uptime >= 99 ? "ok" : x.uptime >= 97 ? "warn" : "err";
              const statusLabel =
                x.uptime >= 99
                  ? "Sehat"
                  : x.uptime >= 97
                    ? "Perhatian"
                    : "Masalah";
              return (
                <tr key={h.id}>
                  <td>
                    <div className="strong">{h.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                      {h.koridor}
                    </div>
                  </td>
                  <td className="num">{fmt(h.pax)}</td>
                  <td className="num">{fmt(x.voicePlays)}</td>
                  <td className="num">{fmt(x.tjAppPushOpens)}</td>
                  <td className="num">{fmtShort(x.uniqueReach)}</td>
                  <td className="num strong">Rp {fmt(x.cpm)}</td>
                  <td className="num">{x.uptime}%</td>
                  <td>
                    <span className={`dash-status-pill ${statusClass}`}>
                      <span className="dot" />
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
