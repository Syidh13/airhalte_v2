"use client";

import { NETWORK, fmtCount } from "@/lib/network";
import { AVAILABILITY_POLL_INTERVAL_MS, PRICE_COPY } from "@/lib/haltes-map";

// Hanya fakta yang dapat dipertanggungjawabkan (deck v6.1) — tidak ada
// metrik transaksi fiktif. Angka dibaca dari lib/network.ts, lib/pricing.ts
// dan interval polling; ganti dengan data live bila endpoint statistik ada.
const tickerItems: {
  label: string;
  value?: string;
  delta?: string;
  live?: boolean;
  up?: boolean;
}[] = [
  { label: "HALTE BRT", value: `${fmtCount(NETWORK.brt)} titik` },
  { label: "BUS STOP NON-BRT", value: `${fmtCount(NETWORK.nonBrt)} titik` },
  { label: "LELANG HALTE BRT", value: `Harga dasar ${PRICE_COPY.premiumFrom}` },
  { label: "LANGGANAN PREMIUM", value: "Tahunan, lewat lelang" },
  { label: "NON-BRT", value: `${PRICE_COPY.nonBrtMonthly} · ${PRICE_COPY.nonBrtYearly}` },
  { label: "TRANSAKSI", value: "Khusus perusahaan terverifikasi NPWP" },
  {
    label: "KETERSEDIAAN",
    value: `Diperbarui setiap ${AVAILABILITY_POLL_INTERVAL_MS / 1000} detik`,
  },
];

export default function Ticker() {
  const items = [...tickerItems, ...tickerItems];

  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker-inner">
        {items.map((item, i) => (
          <span className="ticker-item" key={i}>
            {item.live ? (
              <span className="tick-live">LIVE</span>
            ) : null}
            <span className="tick-lbl">{item.label}</span>
            {item.value && (
              <span className={`tick-val${item.up ? " tick-up" : ""}`}>
                {item.value}
              </span>
            )}
            {item.delta && (
              <span className="tick-up">{item.delta}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
