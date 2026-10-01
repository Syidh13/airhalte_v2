// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

import { fmtShort } from "@/data/dashboardData";

export type ChannelKey = "voice" | "led" | "push" | "card";

interface ChannelRowProps {
  name: string;
  desc: string;
  count: number;
  unit: string;
  channelKey: ChannelKey;
  qualityLabel: string;
}

const ICONS: Record<ChannelKey, React.ReactNode> = {
  voice: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10v4a1 1 0 0 0 1 1h3l4 4V5L7 9H4a1 1 0 0 0-1 1z" />
      <path d="M16 8a4 4 0 0 1 0 8" />
      <path d="M19 5a7 7 0 0 1 0 14" />
    </svg>
  ),
  led: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="4" width="20" height="12" rx="2" />
      <path d="M6 20h12M12 16v4" />
    </svg>
  ),
  push: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h0.01" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  ),
};

export default function ChannelRow({
  name,
  desc,
  count,
  unit,
  channelKey,
  qualityLabel,
}: ChannelRowProps) {
  return (
    <div className="dash-channel-row">
      <div className="dash-channel-info">
        <div className="dash-channel-icon">{ICONS[channelKey]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dash-channel-name">{name}</div>
          <div className="dash-channel-count">{desc}</div>
          <div className="dash-channel-quality">
            <span className="qd" />
            {qualityLabel}
          </div>
        </div>
      </div>
      <div>
        <div className="dash-channel-value">{fmtShort(count)}</div>
        <div className="dash-channel-unit">{unit}</div>
      </div>
    </div>
  );
}
