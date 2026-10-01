// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

interface ActivityItem {
  type: "ok" | "warn" | "info";
  title: string;
  meta: string;
  time: string;
}

const ACTIVITIES: ActivityItem[] = [
  {
    type: "ok",
    title: "Voice announcer — 96 plays tercatat",
    meta: "Halte Kemang Timur · bus Koridor 9",
    time: "2 jam lalu",
  },
  {
    type: "info",
    title: "TJ App push batch dikirim — 780 user",
    meta: "Geo-fence 500m dari Halte Buaran",
    time: "4 jam lalu",
  },
  {
    type: "ok",
    title: "Monthly report April siap di-download",
    meta: "PDF lengkap dengan audit log",
    time: "Kemarin",
  },
  {
    type: "warn",
    title: "Incident: voice announcer di Halte Buaran",
    meta: "Downtime 45 menit · sudah resolved",
    time: "5 hari lalu",
  },
  {
    type: "ok",
    title: "Pembayaran bulanan diproses",
    meta: "Rp 9.000.000 · 3 halte × Rp 3jt",
    time: "1 Apr",
  },
];

export default function ActivityLog() {
  return (
    <div className="dash-activity-list">
      {ACTIVITIES.map((a, i) => (
        <div key={i} className="dash-activity-row">
          <div className={`dash-activity-dot ${a.type}`} />
          <div className="dash-activity-content">
            <div className="dash-activity-title">{a.title}</div>
            <div className="dash-activity-meta">{a.meta}</div>
          </div>
          <div className="dash-activity-time">{a.time}</div>
        </div>
      ))}
    </div>
  );
}
