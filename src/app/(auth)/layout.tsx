import type { ReactNode } from "react";
import Link from "next/link";
import Logo from "@/components/brand/Logo";
import { NETWORK, NETWORK_TOTAL, fmtCount } from "@/lib/network";
import { NON_BRT_MONTHLY_PRICE } from "@/lib/pricing";

/** 3_000_000 → "Rp 3 jt" */
function rupiahJt(n: number): string {
  return `Rp ${(n / 1_000_000).toLocaleString("id-ID")} jt`;
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <section className="auth-form-pane">
        <Link href="/" className="auth-logo" aria-label="Kembali ke beranda">
          <Logo height={30} />
          <span className="auth-logo-tag">by Transjakarta</span>
        </Link>

        <main className="auth-form-wrap">{children}</main>

        <footer className="auth-foot">
          <span>© 2026 PT Transportasi Jakarta</span>
          <span className="auth-foot-sep">·</span>
          <Link href="/">Beranda</Link>
        </footer>
      </section>

      <aside className="auth-brand-pane" aria-hidden="true">
        <div className="auth-brand-grid" />
        <div className="auth-brand-content">
          <div className="auth-brand-kicker">§ MARKETPLACE PENAMAAN HALTE</div>
          <h2 className="auth-brand-title">
            Nama brand Anda di <em>halte Transjakarta</em>.
          </h2>
          <p className="auth-brand-sub">
            {fmtCount(NETWORK_TOTAL)} titik Transjakarta: Halte BRT lewat
            lelang, bus stop Non-BRT dengan tarif tetap. Dengarkan simulasi
            pengumuman suara dengan nama brand Anda sebelum menyewa.
          </p>

          <div className="auth-brand-stats">
            <div className="auth-brand-stat">
              <div className="auth-brand-stat-num">{fmtCount(NETWORK.brt)}</div>
              <div className="auth-brand-stat-lbl">Halte BRT · Premium</div>
            </div>
            <div className="auth-brand-stat-sep" />
            <div className="auth-brand-stat">
              <div className="auth-brand-stat-num">{fmtCount(NETWORK.nonBrt)}</div>
              <div className="auth-brand-stat-lbl">Bus stop Non-BRT</div>
            </div>
            <div className="auth-brand-stat-sep" />
            <div className="auth-brand-stat">
              <div className="auth-brand-stat-num">
                {rupiahJt(NON_BRT_MONTHLY_PRICE)}
              </div>
              <div className="auth-brand-stat-lbl">Non-BRT per titik/bulan</div>
            </div>
          </div>

          <blockquote className="auth-brand-quote">
            &ldquo;Pemberhentian berikutnya. Halte Tosari, [Nama Brand Anda].
            Mohon bersiap untuk turun.&rdquo;
            <cite>— simulasi pengumuman suara</cite>
          </blockquote>
        </div>
      </aside>
    </div>
  );
}
