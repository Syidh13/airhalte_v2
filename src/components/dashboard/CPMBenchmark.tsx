// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import { fmt } from "@/data/dashboardData";

interface CPMBenchmarkProps {
  yourCPM: number;
}

export default function CPMBenchmark({ yourCPM }: CPMBenchmarkProps) {
  const benchmarks = [
    { lbl: "Anda (AirHalte)", value: Math.round(yourCPM), isYou: true },
    { lbl: "Radio FM", value: 18000, isYou: false },
    { lbl: "Billboard", value: 22000, isYou: false },
    { lbl: "Digital (Meta)", value: 38000, isYou: false },
  ];
  const max = Math.max(...benchmarks.map((b) => b.value));

  return (
    <>
      <div className="dash-cpm-bars">
        {benchmarks.map((b) => (
          <div key={b.lbl} className="dash-cpm-bar-row">
            <div className={`dash-cpm-bar-label${b.isYou ? " you" : ""}`}>
              {b.lbl}
            </div>
            <div className="dash-cpm-bar-track">
              <div
                className={`dash-cpm-bar-fill${b.isYou ? "" : " dim"}`}
                style={{ width: `${(b.value / max) * 100}%` }}
              />
            </div>
            <div className={`dash-cpm-bar-value${b.isYou ? " you" : ""}`}>
              Rp {fmt(b.value)}
            </div>
          </div>
        ))}
      </div>
      <div className="dash-cpm-summary">
        <strong>{(18000 / yourCPM).toFixed(1)}× lebih murah</strong> dari radio
        FM,{" "}
        <strong>{(38000 / yourCPM).toFixed(1)}× lebih murah</strong> dari iklan
        digital Meta/Google.
      </div>
    </>
  );
}
