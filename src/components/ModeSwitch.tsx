"use client";

import { NETWORK, fmtCount } from "@/lib/network";
import { PRICE_COPY } from "@/lib/haltes-map";

/** Internal identifiers: "mass" = bus stop Non-BRT (user-facing: "Non-BRT"). */
export type Mode = "premium" | "mass";

interface ModeSwitchProps {
  activeMode: Mode;
  onModeChange: (mode: Mode) => void;
}

export default function ModeSwitch({ activeMode, onModeChange }: ModeSwitchProps) {
  return (
    <div className="mode-switch">
      <button
        className={`mode-tab${activeMode === "premium" ? " active" : ""}`}
        onClick={() => onModeChange("premium")}
      >
        <div className="mode-lbl">Mode · Premium</div>
        <div className="mode-title">Lelang Halte BRT</div>
        <div className="mode-count">{fmtCount(NETWORK.brt)} halte · tahunan · lelang</div>
      </button>

      <button
        className={`mode-tab${activeMode === "mass" ? " active" : ""}`}
        onClick={() => onModeChange("mass")}
      >
        <div className="mode-lbl">Mode · Non-BRT</div>
        <div className="mode-title">Langganan Non-BRT</div>
        <div className="mode-count">
          {fmtCount(NETWORK.nonBrt)} bus stop · {PRICE_COPY.nonBrtMonthly}
        </div>
      </button>
    </div>
  );
}
