// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import type { ReactNode } from "react";

interface KPICardProps {
  label: string;
  icon?: ReactNode;
  value: ReactNode;
  unit?: string;
  delta?: { value: string; direction: "up" | "down" | "flat"; suffix?: string };
}

export default function KPICard({ label, icon, value, unit, delta }: KPICardProps) {
  return (
    <div className="dash-kpi-card">
      <div className="dash-kpi-label">
        {icon}
        {label}
      </div>
      <div className="dash-kpi-value">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {delta && (
        <div className={`dash-kpi-delta ${delta.direction}`}>
          {delta.direction === "up" && (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path fill="currentColor" d="M5 2l4 5H1z" />
            </svg>
          )}
          {delta.direction === "down" && (
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path fill="currentColor" d="M5 8L1 3h8z" />
            </svg>
          )}
          {delta.value} {delta.suffix && <span className="vs">{delta.suffix}</span>}
        </div>
      )}
    </div>
  );
}
