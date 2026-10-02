@AGENTS.md

# AirHalte — Project Memory

Proyek: **AirHalte** — marketplace naming rights halte Transjakarta.
Owner/dev: Syidh (syidh.illuminaty@gmail.com). UI/UX + suka coding HTML/Tailwind.
Stack: Next.js 16 App Router · TypeScript · Tailwind CSS · Supabase (PostgreSQL + RLS) · MapLibre GL JS.
Workspace: `/Users/Rama/Documents/airhalte/platform`
Repo: `github.com/Syidh13/airhalte` (branch `main`, deploy via Netlify auto-deploy on push).

---

## Working Style (penting)

- **Bahasa**: Indonesia campur dengan istilah teknis Inggris. User suka explanation singkat.
- **Phased delivery**: Kerjakan satu fase, test manual, baru lanjut. JANGAN gabung brief.
- **Commit policy**: JANGAN auto-commit / auto-push. Selalu tunggu lampu hijau eksplisit dari user. Saat lampu hijau, batch commit secara logis (1 commit per modul/fase) sebelum push ke `main`.
- **Tunggu manual test**: User sering bilang "aku udah test manual" — gunakan itu sebagai sinyal lanjut.
- **AskUserQuestion form ditolak** — user lebih suka tanya plain text di chat.

---

## Arsitektur Singkat

```
src/
  app/
    page.tsx                              ← Portal utama (peta + sidebar listing)
    globals.css                           ← Semua CSS (design tokens, components, map)
    (auth)/login, (auth)/signup           ← Auth pages (server-side flow)
    auth/callback/route.ts                ← OAuth + email-confirmation handler
    dashboard/page.tsx                    ← Sponsor portal (Overview/Bids/Subs/Reports)
    superadmin/
      haltes/page.tsx                     ← CRUD halte + Sync Map Data
      auctions/page.tsx                   ← Lelang lifecycle (Phase 6)
      subscriptions/page.tsx              ← Mass subscription module (Phase 6)
      companies/page.tsx                  ← Company list + reset password
      bids/page.tsx                       ← Bid & Langganan tracking
    api/
      register/route.ts                   ← Atomic server-side signup (auth + companies + contacts)
      haltes/[id]/route.ts                ← GET detail (rich fields, lazy fetch)
      haltes/[id]/bids/route.ts           ← Public GET aggregate, auth POST place bid
      haltes/[id]/subscribe/route.ts      ← Public GET history, auth POST subscribe
      haltes/[id]/ridership/route.ts      ← GET estimasi potensi penumpang (statis, lib/ridership.ts)
      nearby/route.ts                     ← Proxy Overpass/OSM "Tempat sekitar" (server-side, wajib User-Agent)
      haltes/availability/route.ts        ← GET polling snapshot (available + is_listed)
      admin/haltes/route.ts               ← Bypass-RLS CRUD via service role
      admin/haltes/[id]/close-auction     ← Pick winner, freeze halte
      admin/auctions/route.ts             ← GET list / POST create
      admin/auctions/[halteId]/route.ts   ← GET un-blind detail / PATCH update
      admin/subscriptions/route.ts        ← GET list mass haltes (status-priority logic)
      admin/subscriptions/[halteId]       ← GET un-blind detail / PATCH list/delist
      admin/users/[id]/reset-password     ← Superadmin reset + force email confirm
      admin/generate-map/route.ts         ← POST regenerate GeoJSON
      dashboard/my-bids/route.ts          ← User's bids
      dashboard/my-subscriptions/route.ts ← User's subscriptions
  components/
    MapView.tsx                           ← Peta utama — dual-source architecture
    DetailPanel.tsx                       ← Right panel saat halte diklik (skeleton + error)
    HalteCard.tsx                         ← Card di sidebar listing
    modals/BidModal.tsx                   ← Place bid (real POST + validation)
    modals/SubscribeModal.tsx             ← Langganan Non-BRT (bulanan/tahunan, tanpa diskon — lib/pricing.ts)
    dashboard/{Overview,Bids,Subscriptions,Reports}Page.tsx
    dashboard/Sidebar.tsx                 ← Halte switcher (real, no mock)
    superadmin/{SuperadminSidebar,MapPicker}.tsx
  data/haltes.ts                          ← Editorial twin: HalteData, PremiumHalte, MassHalte, Tier
  lib/
    haltes-map.ts                         ← Hybrid pipeline: loadMapData, fetchHalteDetail,
                                            projectSidebarCard, useAvailabilityPolling
    haltes.ts                             ← Fallback: getHaltesStreaming() — JANGAN DIHAPUS
    streetView.ts                         ← normalizeStreetViewUrl() Google Maps → embed
    supabase.ts, supabase-admin.ts        ← Anon + service-role clients
    auth.ts                               ← requireSuperadmin / requireActiveCompany guards
    registrations.ts                      ← isValidNpwp + payload validators
    schema.sql                            ← DB schema reference + migration log
  proxy.ts                                ← Next.js 16 middleware convention (was middleware.ts)
  scripts/generate-map-data.ts            ← Bake /public/haltes-map.geojson dari DB
  scripts/generate-ridership.ts           ← GTFS TJ → src/data/halte-ridership.generated.ts
public/
  haltes-map.geojson                      ← Stable layer (~1.4 MB raw, ~153 KB gzipped)
```

---

## Map Architecture (PENTING — jangan diutak-atik)

Dual-source GeoJSON di MapView (lihat `MapView.tsx`):
- `haltes-premium-src` — ~272 halte BRT, HTML chip markers (clusterRadius 60)
- `haltes-mass-src` — ~7.300 halte non-BRT, GPU circles (clusterRadius 90)
- `CLUSTER_MAX_ZOOM = 15`

**Mode switch = visibility toggle** (`setLayoutProperty`), BUKAN `setData`. Bikin instant.

Hybrid data pipeline (3 sumber):
1. **Stable** baked `loadMapData()` → `/haltes-map.geojson` — id/name/mode/tier/lat/lng. Sekali per session.
2. **Realtime** `useAvailabilityPolling(true)` → `/api/haltes/availability` tiap 10s. Overlay merge `available` + `is_listed`.
3. **Detail** lazy `fetchHalteDetail(id)` saat klik → `/api/haltes/[id]`.

**Filter policy on map (Phase 5+6)**:
- Premium → tampil hanya kalau auction window aktif (`is_listed=true`, derived server-side dari `auction_starts_at <= now < auction_ends_at` AND `is_available=true`).
- Mass → tampil hanya kalau `is_available=true` AND tidak ada subscription aktif (joined via `supabaseAdmin` di availability route).
- Mass haltes default `is_available=false` (delisted by default — superadmin must activate via `/superadmin/subscriptions`).

`syncUnclusteredMarkers` pakai `activeHalteIdRef` (bukan prop langsung) supaya callback stabil dan mode effect tidak jalan ulang per klik.

`mapEpoch` (counter, naik setiap instance map selesai memasang source) menggantikan boolean `sourcesReady`. Fast Refresh mempertahankan state tapi menjalankan ulang effect; boolean yang sudah `true` tidak memicu setData lagi → peta kosong. Source/layer AirHalte dipasang di event `style.load` (bukan `load`, yang menunggu semua tile basemap), dan chip HTML disinkronkan ulang setelah event `render`. Catatan: di tab browser yang tersembunyi, rAF berhenti sehingga MapLibre tidak menggambar sampai tab terlihat — itu perilaku browser, bukan bug.

---

## Auction Lifecycle (Phase 6)

`bids` table statuses: `pending` / `winning` / `outbid` / `won` / `lost` / `rejected`.
`bids.amount` adalah **BIGINT** (originally INTEGER — bermasalah untuk Tier S Rp 5M+).

Auction flow:
1. Superadmin create di `/superadmin/auctions` — set `auction_starts_at`/`auction_ends_at` di halte.
2. User lihat halte di peta (filtered by `is_listed`), klik → BidModal.
3. POST `/api/haltes/[id]/bids` — validate min increment, persist bid, demote previous winner ke `outbid`.
4. Admin click "Tutup Lelang" → POST `/api/admin/haltes/[id]/close-auction` — pick highest bid, set `won`, demote others ke `lost`, freeze halte (`is_available=false`).
5. Idempotent: jika tidak ada bid, returns `ok:true, winner:null`.

Subscription flow (Mass):
1. Superadmin activate di `/superadmin/subscriptions`.
2. User klik halte (filtered by available + no active sub), SubscribeModal pilih durasi.
3. POST `/api/haltes/[id]/subscribe` — server-side race protection (re-check overlap sebelum insert, 23505/23P01 → 409). Periode hanya 1 atau 12 bulan, tanpa diskon, tarif dari `lib/pricing.ts` (Rp 3 jt/bulan).
4. Subscription `status='active'` sampai `ends_at`. Admin bisa list/delist halte tanpa mempengaruhi sub aktif.

---

## API Caching & Auth Guards

- `/api/haltes/availability`, `/api/admin/auctions`, `/api/admin/subscriptions` → `Cache-Control: no-store, must-revalidate` (jangan ganti — bekas `max-age=5` bikin polling stale).
- `/api/haltes/[id]` → `public, max-age=10, stale-while-revalidate=20` (dulu 60/300 → CTA basi beberapa menit setelah lelang ditutup).
- Setelah `setData` di MapView, panggil `map.triggerRepaint()` untuk paksa re-render.

Auth guards di `lib/auth.ts`:
- `requireSuperadmin()` — cek `user.app_metadata.role === 'superadmin'`. Pakai di semua `/api/admin/*`.
- `requireActiveCompany()` — cek `companies.status === 'active'`. Pakai di endpoints user-facing.

---

## Database notes

- Schema reference: `src/lib/schema.sql` — tidak auto-applied; migrasi via Supabase SQL Editor manual.
- RLS aktif di `companies`, `contacts`, `subscriptions`, `bids`. Service role bypass via `supabaseAdmin`.
- `is_superadmin()` SQL function harus deployed di DB (`CREATE OR REPLACE FUNCTION public.is_superadmin()`) — kalau hilang, RLS policies break.
- Email confirmation di Supabase **OFF saat ini** (untuk testing). Reminder: nyalain balik sebelum produksi (Task #16) + setup custom SMTP (Resend/SendGrid, Task #13).

---

## Bugs Fixed (untuk audit trail)

- **bids.amount overflow**: ALTER TABLE bids ALTER COLUMN amount TYPE BIGINT.
- **Mock account leak**: dihapus `MOCK_ACCOUNTS` dari `src/lib/auth.ts`, hint demo di login dihapus.
- **Signup broken (RLS + email confirm)**: refactor ke server-side `/api/register` pakai `supabaseAdmin` (atomic auth + companies + contacts insert + rollback on error).
- **gotrue-js lock orphan dari Strict Mode**: disabled `reactStrictMode` di `next.config.ts`.
- **MapView markers hilang setelah navigation / Fast Refresh**: `sourcesReady` diganti `mapEpoch` + teardown lengkap di cleanup (lihat bagian peta di atas).
- **Availability polling stale**: ganti Cache-Control `max-age=5` → `no-store, must-revalidate` + `triggerRepaint`.
- **Admin/subscriptions miscategorize delisted-but-tenanted**: di `route.ts`, status priority sekarang `active > delisted > available` (bukan `is_available > active`). Halte yang di-delist sambil masih ada tenant active tetap muncul di "Sedang Disewa".

---

## Pending / Roadmap

1. **Phase 7** — Subscription tracking detail (buyer info, voice, payment proof, invoice).
2. **Phase 8** — Payment integration (Midtrans / Xendit).
3. **Email confirmation** — nyalain balik di Supabase + setup Resend/SendGrid SMTP, fix redirect setelah confirm.
4. **Role management UI** di superadmin panel (Task #11).
5. **Audit non-superadmin button visibility** — pastikan tombol superadmin tidak muncul untuk user biasa (Task #10).
6. **Migrate middleware.ts → proxy.ts** — DONE (deleted middleware.ts, ada proxy.ts).

---

## Aturan Bisnis & Sumber Angka (deck v6.1, per 30 Sep 2026)

- Semua angka harga & periode ada di `src/lib/pricing.ts` (Non-BRT Rp 3 jt/titik/bulan, bulanan/tahunan tanpa diskon; Halte BRT harga dasar minimal Rp 100 jt/tahun, lelang, kontrak 12 bulan). Jangan hardcode angka di komponen.
- Jumlah titik untuk copy statis ada di `src/lib/network.ts` (270 BRT + 7.306 Non-BRT = 7.576).
- Tidak ada lagi tier S/A/B/C/D, kontrak 3 tahun, eksklusif radius, diskon, atau analitik audiens palsu. Data twin `src/data/haltes.ts` hanya fixture lama (deprecated) — jangan dipakai untuk state komersial.
- **Potensi penumpang = estimasi rata-rata, bukan tap-in** (disetujui owner 2 Okt 2026). Rumus di `src/lib/ridership.ts`: pelanggan TJ 2025 per kelompok layanan (BRT & Non-BRT / Mikrotrans / Transjabodetabek) ÷ 365 ÷ perjalanan terjadwal kelompok itu × bus yang berhenti di titik. Data per titik dari `npm run generate:ridership` (GTFS resmi TJ). UI wajib badge "Estimasi" + "Cara hitung". Jalankan ulang generator setelah GTFS TJ berubah atau setelah `generate:map`.
- Logo: `src/components/brand/Logo.tsx` (SVG, currentColor). Aset statis di `public/brand/`, favicon lewat `src/app/icon.svg`.
- Migrasi DB keamanan + aturan harga: `supabase/migrations/20260930_keamanan_dan_aturan_harga.sql` — SUDAH dijalankan di project Supabase produksi pada 30 Sep 2026 (policy insert langsung bids/subscriptions dihapus, trigger guard status perusahaan, aturan bid/langganan di DB, harga dasar BRT jadi Rp 100 jt, data uji diarsipkan). Bagian bersih-data dicatat di `airhalte_meta.migrations` dan tidak akan jalan ulang.
- CSS baru per fitur di `src/styles/{brand,map,commerce,portal}.css` (diimpor setelah globals.css).

---

## Hal-hal yang Jangan Diulangi

- Jangan ubah MapView jadi single-source → balik lag.
- Mode premium HTML markers — jangan utak-atik.
- `clusterRadius: 60` premium, `90` mass; `CLUSTER_MAX_ZOOM = 15` — jangan diubah tanpa test.
- Drag di MapPicker: JANGAN tambah `pickedLat/pickedLng` ke dep array sync effect.
- Jangan hapus `lib/haltes.ts` — fallback + editorial twin.
- Jangan auto-commit. Tunggu lampu hijau eksplisit.
- `bids.amount`, `haltes.base_price`, `haltes.current_bid` MUST stay BIGINT — nominal lelang bisa miliaran rupiah.

---

## Troubleshooting Dev Mode

- **Peta blank**: akar masalah lama (state `sourcesReady` tidak ter-reset saat Fast Refresh) sudah diperbaiki per 30 Sep 2026. Kalau chunk MapLibre gagal dimuat, peta menampilkan overlay "Muat ulang peta". Peringatan console "Style peta belum siap setelah 5 dtk" berarti style/tile openfreemap lambat atau terblokir.
- **Pattern sering kambuh**: pakai `npm run dev:safe` (webpack mode, sedikit lebih lambat tapi predictable).
- **AdBlock CSP block MapLibre**: disable AdBlock untuk `localhost:3000`.
- **Strict Mode disabled** di `next.config.ts` (gotrue-js lock issue). Re-enable saat Supabase client diupgrade.
- Kalau RLS error 400 di /superadmin: cek `is_superadmin()` SQL function masih ada di DB.

---

## QA snapshot (27 Apr 2026)

State terakhir di-test sebelum commit batch:
- Sponsor dashboard: 5 bids (3 winning, 1 outbid, 1 lost), 2 subs (AEON Mall + Marketing Gallery).
- Superadmin counters: Lelang 271 (3 aktif, 4 selesai, 264 belum dijadwalkan), Langganan 7306 (4 tersedia, 2 sedang disewa, 7300 tidak aktif).
- TypeScript clean (0 error). ESLint warnings pre-existing (react-hooks/set-state-in-effect, bukan regresi).
- Working tree saat memory ini ditulis: 28 modified + 13 new + 1 deleted, belum committed.
