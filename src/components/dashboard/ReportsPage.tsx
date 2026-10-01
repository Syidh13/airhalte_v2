"use client";

/**
 * Laporan & Tagihan — belum ada datanya (belum ada integrasi pembayaran
 * maupun data penayangan). Halaman ini sengaja hanya menampilkan satu
 * baris jujur, tanpa angka contoh atau janji fitur.
 */
export default function ReportsPage() {
  return (
    <div className="dash-page">
      <div className="dash-page-header">
        <div className="dash-page-title-block">
          <div className="dash-page-kicker">Laporan &amp; Tagihan</div>
          <h1 className="dash-page-title">Laporan &amp; tagihan.</h1>
        </div>
      </div>

      <div className="dash-card dash-empty-card">
        Laporan dan tagihan belum tersedia. Status penawaran dan langganan Anda
        dapat dilihat di Ringkasan.
      </div>
    </div>
  );
}
