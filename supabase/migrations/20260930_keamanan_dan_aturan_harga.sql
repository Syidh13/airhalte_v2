-- ============================================================================
-- AirHalte · Migrasi 2026-09-30 · Keamanan RLS + aturan harga (deck v6.1)
-- ----------------------------------------------------------------------------
-- Jalankan di Supabase Dashboard → SQL Editor → New query → Run.
-- Aman diulang (idempotent). Setiap bagian punya BEGIN/COMMIT sendiri, jadi
-- kalau satu bagian gagal, bagian sebelumnya tetap tersimpan.
--
-- Kondisi DB saat migrasi ini ditulis (dicek read-only):
--   haltes.base_price, haltes.current_bid, bids.amount sudah BIGINT (aman).
--   Policy bids_insert_active & subs_insert_active mengizinkan INSERT langsung
--   dari browser (anon key + JWT user), jadi semua validasi harga di API bisa
--   dilewati. Policy companies_update_own tidak membatasi kolom status, jadi
--   perusahaan bisa mengaktifkan dirinya sendiri.
-- ============================================================================


-- ============================================================================
-- BAGIAN 1 · KEAMANAN (wajib)
-- ============================================================================
BEGIN;

-- 1a. Bid & langganan hanya boleh dibuat lewat API server (service role),
--     yang menegakkan harga dasar, periode, jadwal lelang, dan verifikasi NPWP.
DROP POLICY IF EXISTS bids_insert_active ON public.bids;
DROP POLICY IF EXISTS subs_insert_active ON public.subscriptions;

-- 1b. Perusahaan tidak bisa mengubah status verifikasinya sendiri.
--     Berlaku hanya untuk user biasa (JWT 'authenticated'); service_role
--     (API server) dan superadmin tidak dibatasi.
CREATE OR REPLACE FUNCTION public.guard_company_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' OR public.is_superadmin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN
    RAISE EXCEPTION 'Status perusahaan hanya dapat diubah oleh admin TJ.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'Pemilik akun perusahaan tidak dapat diubah.'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status = 'active' AND (
       NEW.npwp IS DISTINCT FROM OLD.npwp
       OR NEW.company_name IS DISTINCT FROM OLD.company_name) THEN
    RAISE EXCEPTION 'Nama perusahaan dan NPWP yang sudah diverifikasi hanya dapat diubah oleh admin TJ.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS companies_guard_write ON public.companies;
CREATE TRIGGER companies_guard_write
  BEFORE INSERT OR UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_company_write();

COMMIT;


-- ============================================================================
-- BAGIAN 2 · ATURAN HARGA DI LEVEL DATABASE (disarankan)
-- Lapisan pengaman kedua di belakang API. Hanya mengecek baris BARU, jadi
-- data lama (bid 36 bulan, langganan 3 bulan berdiskon) tidak terganggu.
-- ============================================================================
BEGIN;

-- 2a. Bid Halte BRT: kontrak 12 bulan, nominal minimal harga dasar
--     (harga dasar di bawah Rp 100 jt dianggap Rp 100 jt).
CREATE OR REPLACE FUNCTION public.enforce_bid_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_floor bigint;
BEGIN
  IF NEW.duration_months IS DISTINCT FROM 12 THEN
    RAISE EXCEPTION 'Kontrak lelang Halte BRT wajib 12 bulan.'
      USING ERRCODE = '23514';
  END IF;

  SELECT greatest(coalesce(h.base_price, 0), 100000000)
    INTO v_floor
    FROM public.haltes h
   WHERE h.id = NEW.halte_id AND h.type = 'brt';

  IF v_floor IS NULL THEN
    RAISE EXCEPTION 'Bid hanya untuk Halte BRT.' USING ERRCODE = '23514';
  END IF;
  IF NEW.amount < v_floor THEN
    RAISE EXCEPTION 'Nominal bid di bawah harga dasar halte.' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bids_enforce_rules ON public.bids;
CREATE TRIGGER bids_enforce_rules
  BEFORE INSERT ON public.bids
  FOR EACH ROW EXECUTE FUNCTION public.enforce_bid_rules();

-- 2b. Langganan Non-BRT: hanya bulanan (1) atau tahunan (12), tanpa diskon,
--     total = tarif bulanan × periode.
CREATE OR REPLACE FUNCTION public.enforce_subscription_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.duration_months NOT IN (1, 12) THEN
    RAISE EXCEPTION 'Periode langganan Non-BRT hanya bulanan (1) atau tahunan (12).'
      USING ERRCODE = '23514';
  END IF;
  IF coalesce(NEW.discount_pct, 0) <> 0 THEN
    RAISE EXCEPTION 'Langganan Non-BRT tidak memakai diskon.' USING ERRCODE = '23514';
  END IF;
  IF NEW.total_price <> NEW.monthly_price * NEW.duration_months THEN
    RAISE EXCEPTION 'Total harga langganan tidak sesuai tarif × periode.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_enforce_rules ON public.subscriptions;
CREATE TRIGGER subscriptions_enforce_rules
  BEFORE INSERT ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_rules();

-- 2c. Harga dasar Halte BRT minimal Rp 100 jt (record uji 'test' dikecualikan).
ALTER TABLE public.haltes DROP CONSTRAINT IF EXISTS haltes_brt_min_base_price;
ALTER TABLE public.haltes
  ADD CONSTRAINT haltes_brt_min_base_price
  CHECK (type <> 'brt' OR id = 'test' OR base_price >= 100000000);

COMMIT;


-- ============================================================================
-- BAGIAN 3 · BERSIHKAN DATA CONTOH (disarankan sebelum demo ke direksi)
-- Tidak ada baris yang dihapus. Data uji hanya ditandai supaya tidak tampil
-- sebagai transaksi nyata.
-- SEKALI JALAN: dicatat di airhalte_meta.migrations. Kalau skrip ini
-- dijalankan ulang nanti, bagian ini dilewati supaya harga dasar yang sudah
-- diatur TJ per halte tidak tertimpa lagi ke Rp 100 jt.
-- (Schema airhalte_meta tidak diekspos ke API publik Supabase.)
-- ============================================================================
BEGIN;

CREATE SCHEMA IF NOT EXISTS airhalte_meta;
CREATE TABLE IF NOT EXISTS airhalte_meta.migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM airhalte_meta.migrations
              WHERE name = '20260930_reset_data_contoh') THEN
    RAISE NOTICE 'Bagian 3 sudah pernah dijalankan, dilewati.';
    RETURN;
  END IF;

  -- 3a. Harga dasar Halte BRT: nilai seed template (Rp 2 M / Rp 5 M) → Rp 100 jt,
  --     harga minimum resmi di deck. TJ bisa mengubah per halte di panel admin.
  UPDATE public.haltes
     SET base_price = 100000000
   WHERE type = 'brt' AND id <> 'test' AND base_price <> 100000000;

  -- 3b. Record uji 'test' disembunyikan dari peta & admin.
  UPDATE public.haltes SET is_available = false, current_bid = 0 WHERE id = 'test';

  -- 3c. Bid uji skema lama (kontrak 36 bulan, nominal di bawah harga dasar
  --     baru) diarsipkan sebagai 'rejected', status lama yang tidak dipakai
  --     alur aktif.
  UPDATE public.bids SET status = 'rejected' WHERE duration_months <> 12;

  -- 3d. current_bid halte disamakan dengan bid 'winning' yang masih aktif
  --     (0 kalau tidak ada). Ini juga membersihkan sisa bid dari lelang lama
  --     yang dibuka ulang (mis. Bendungan Hilir Rp 7,2 M).
  UPDATE public.haltes h
     SET current_bid = coalesce((
           SELECT max(b.amount) FROM public.bids b
            WHERE b.halte_id = h.id AND b.status = 'winning'), 0)
   WHERE h.type = 'brt';

  -- 3e. Langganan yang periodenya sudah lewat ditandai 'expired'.
  UPDATE public.subscriptions
     SET status = 'expired'
   WHERE status = 'active' AND ends_at < current_date;

  INSERT INTO airhalte_meta.migrations (name) VALUES ('20260930_reset_data_contoh');
END;
$$;

COMMIT;


-- ============================================================================
-- BAGIAN 4 · ANTI DOUBLE-BOOKING LANGGANAN (disarankan)
-- Dua langganan aktif/pending tidak boleh tumpang tindih di titik yang sama.
-- API sudah mengecek ini dan mengubah pelanggaran (23P01) jadi pesan 409.
-- ============================================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_no_overlap;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_no_overlap
  EXCLUDE USING gist (
    halte_id WITH =,
    daterange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('active', 'pending'));

COMMIT;


-- ============================================================================
-- BAGIAN 5 · CEK HASIL (read-only)
-- ============================================================================
SELECT
  (SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname IN ('bids_insert_active', 'subs_insert_active'))   AS policy_insert_tersisa,   -- harus 0
  (SELECT count(*) FROM public.haltes
    WHERE type = 'brt' AND id <> 'test' AND base_price < 100000000)      AS brt_di_bawah_minimum,    -- harus 0
  (SELECT count(*) FROM public.haltes
    WHERE type = 'brt' AND id <> 'test')                                 AS jumlah_halte_brt,        -- 270
  (SELECT count(*) FROM public.haltes WHERE type = 'non-brt')            AS jumlah_bus_stop_non_brt, -- 7306
  (SELECT is_available FROM public.haltes WHERE id = 'test')             AS test_masih_tampil,       -- false
  (SELECT count(*) FROM public.bids WHERE status = 'winning')            AS bid_aktif,
  (SELECT count(*) FROM public.subscriptions WHERE status = 'active')    AS langganan_aktif;
