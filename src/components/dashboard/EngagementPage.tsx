// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import { fmt, fmtShort, getAggregated } from "@/data/dashboardData";
import KPICard from "./KPICard";

interface EngagementPageProps {
  currentHalte: string;
}

export default function EngagementPage({ currentHalte }: EngagementPageProps) {
  const m = getAggregated(currentHalte);
  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Engagement</div>
          <h1 className="dash-page-title">Audience engagement.</h1>
          <p className="dash-page-subtitle">
            Interaksi audience dengan brand Anda via TJ App — push open rate,
            CTR, behavior.
          </p>
        </div>
      </div>
      <div className="dash-kpi-grid">
        <KPICard
          label="Push open rate"
          value="9.2"
          unit="%"
          delta={{ value: "+0.8pp", direction: "up", suffix: "vs benchmark" }}
        />
        <KPICard
          label="App card views"
          value={fmtShort(m.tjAppCardViews)}
          delta={{ value: "+5.1%", direction: "up" }}
        />
        <KPICard
          label="Click-through rate"
          value="2.1"
          unit="%"
          delta={{ value: "+0.3pp", direction: "up" }}
        />
        <KPICard
          label="Total clicks"
          value={fmt(m.ctrClicks)}
          delta={{ value: "+6.7%", direction: "up" }}
        />
      </div>
      <div className="dash-card">
        <div className="dash-empty-state">
          <div className="dash-empty-state-title">
            Deep-dive engagement coming soon
          </div>
          <p>
            Future: funnel visualization (push → open → view → click), audience
            segmentation by dwell time, hour-of-day heatmap.
          </p>
        </div>
      </div>
    </div>
  );
}
