// TIDAK DIPAKAI — template lama, aman dihapus.
"use client";

export default function DeliveryPage() {
  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Delivery Channels</div>
          <h1 className="dash-page-title">Delivery per channel.</h1>
          <p className="dash-page-subtitle">
            Detail pemutaran dan tampilan sponsor Anda di setiap channel. Data
            diambil langsung dari log sistem Transjakarta.
          </p>
        </div>
      </div>
      <div className="dash-card">
        <div className="dash-empty-state">
          <div className="dash-empty-state-title">
            Akan tersedia di iterasi berikutnya
          </div>
          <p>
            View ini akan menampilkan: log pemutaran harian per channel, uptime
            incident timeline, audit trail detail, dan download CSV raw data.
          </p>
        </div>
      </div>
    </div>
  );
}
