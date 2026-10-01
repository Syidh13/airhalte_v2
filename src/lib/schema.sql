-- ============================================================================
-- AirHalte — database schema for Supabase
-- Run order: paste this whole file into Supabase Dashboard → SQL Editor →
-- New Query → Run. Re-runnable: every CREATE uses IF NOT EXISTS / OR REPLACE
-- where the dialect allows; tear-down requires manual DROP.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: updated_at trigger function. One function reused by all tables that
-- need timestamp tracking (see triggers at the bottom).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- companies — sponsor company profile. auth_user_id links to Supabase Auth
-- and is set during signup; status gates login (only `active` may proceed).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','rejected')),
  company_name  TEXT NOT NULL,
  bidang_usaha  TEXT NOT NULL,
  npwp          TEXT NOT NULL,
  website       TEXT,
  rejection_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS companies_auth_user_id_idx
  ON public.companies(auth_user_id);

-- ----------------------------------------------------------------------------
-- contacts — PIC details, one row per company (in practice).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contacts_company_id_idx
  ON public.contacts(company_id);

-- ----------------------------------------------------------------------------
-- haltes — physical TransJakarta stops. id is a slug so URLs stay stable.
--
-- Listing default policy:
--   Premium (tier='premium'): is_available defaults to true. Auction
--     lifecycle gates the "listed on portal map" state via
--     auction_starts_at + auction_ends_at (managed at /superadmin/auctions).
--   Mass    (tier='mass'):    is_available defaults to false in practice.
--     The seed loader inserts every TJ master halte with `false` so the
--     portal map is empty by default; the superadmin opts haltes in via
--     the Aktifkan toggle at /superadmin/subscriptions. Mirror policy of
--     premium auctions: nothing shows until an operator green-lights it.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.haltes (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  corridor           TEXT,
  lat                DOUBLE PRECISION NOT NULL,
  lng                DOUBLE PRECISION NOT NULL,
  type               TEXT NOT NULL DEFAULT 'non-brt'
                     CHECK (type IN ('brt','non-brt')),
  tier               TEXT NOT NULL DEFAULT 'mass'
                     CHECK (tier IN ('premium','mass')),
  base_price         BIGINT  NOT NULL DEFAULT 0,
  current_bid        BIGINT  NOT NULL DEFAULT 0,
  street_view_url    TEXT,
  is_available       BOOLEAN NOT NULL DEFAULT true,
  -- Auction lifecycle (premium only). NULL = no schedule yet (legacy /
  -- unscheduled). When both set: bids accepted only inside [starts, ends].
  -- "Tutup Lelang" superadmin action sets is_available=false and freezes.
  auction_starts_at  TIMESTAMPTZ,
  auction_ends_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS haltes_tier_idx ON public.haltes(tier);
CREATE INDEX IF NOT EXISTS haltes_corridor_idx ON public.haltes(corridor);

-- ----------------------------------------------------------------------------
-- bids — Premium (BRT) auction bids.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bids (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  halte_id         TEXT NOT NULL REFERENCES public.haltes(id),
  company_id       UUID NOT NULL REFERENCES public.companies(id),
  amount           BIGINT  NOT NULL CHECK (amount > 0),
  duration_months  INTEGER NOT NULL DEFAULT 12 CHECK (duration_months > 0),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','winning','outbid','rejected','won','lost')),
  -- Status semantics:
  --   winning : current highest, auction still open
  --   outbid  : superseded by a higher bid, auction still open
  --   won     : winning bid after auction closed
  --   lost    : non-winning bid after auction closed
  --   pending / rejected : legacy, not used by the active flow
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bids_halte_id_idx ON public.bids(halte_id);
CREATE INDEX IF NOT EXISTS bids_company_id_idx ON public.bids(company_id);

-- ----------------------------------------------------------------------------
-- subscriptions — Mass (non-BRT) flat-rate subscriptions.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  halte_id         TEXT NOT NULL REFERENCES public.haltes(id),
  company_id       UUID NOT NULL REFERENCES public.companies(id),
  duration_months  INTEGER NOT NULL CHECK (duration_months > 0),
  monthly_price    INTEGER NOT NULL CHECK (monthly_price >= 0),
  total_price      INTEGER NOT NULL CHECK (total_price >= 0),
  discount_pct     INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','active','expired','cancelled')),
  starts_at        DATE,
  ends_at          DATE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_company_id_idx
  ON public.subscriptions(company_id);

-- ----------------------------------------------------------------------------
-- favorites — saved haltes per company. Composite uniqueness so a heart
-- toggle is idempotent.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.favorites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  halte_id    TEXT NOT NULL REFERENCES public.haltes(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, halte_id)
);

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS companies_set_updated_at ON public.companies;
CREATE TRIGGER companies_set_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS haltes_set_updated_at ON public.haltes;
CREATE TRIGGER haltes_set_updated_at
  BEFORE UPDATE ON public.haltes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- ROW-LEVEL SECURITY
-- The anon key is shipped to the browser, so RLS is the only thing standing
-- between an attacker and another company's data. Every table is enabled.
-- ============================================================================

ALTER TABLE public.companies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.haltes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bids          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites     ENABLE ROW LEVEL SECURITY;

-- ----- helpers -------------------------------------------------------------
-- A row's owning company id, derived from auth.uid(). Used by every policy
-- that checks "this company belongs to the current user".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS UUID
LANGUAGE SQL STABLE
AS $$
  SELECT id FROM public.companies WHERE auth_user_id = auth.uid() LIMIT 1
$$;

-- Superadmin = `app_metadata.role = 'superadmin'` on the auth.users row.
-- Set via Supabase Dashboard → Authentication → Users → pick user →
-- "Edit User" → app_metadata field → {"role": "superadmin"}. We read
-- through `app_metadata` (not `user_metadata`) because users can edit
-- the latter themselves; only service-role / dashboard can write to
-- the former.
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role'),
    ''
  ) = 'superadmin'
$$;

-- ----- companies -----------------------------------------------------------
DROP POLICY IF EXISTS companies_select_own ON public.companies;
CREATE POLICY companies_select_own ON public.companies
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_superadmin());

DROP POLICY IF EXISTS companies_insert_self ON public.companies;
CREATE POLICY companies_insert_self ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS companies_update_own ON public.companies;
CREATE POLICY companies_update_own ON public.companies
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid() OR public.is_superadmin())
  WITH CHECK (auth_user_id = auth.uid() OR public.is_superadmin());

-- ----- contacts ------------------------------------------------------------
DROP POLICY IF EXISTS contacts_select_own ON public.contacts;
CREATE POLICY contacts_select_own ON public.contacts
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() OR public.is_superadmin());

DROP POLICY IF EXISTS contacts_insert_own ON public.contacts;
CREATE POLICY contacts_insert_own ON public.contacts
  FOR INSERT TO authenticated
  WITH CHECK (company_id = public.current_company_id());

DROP POLICY IF EXISTS contacts_update_own ON public.contacts;
CREATE POLICY contacts_update_own ON public.contacts
  FOR UPDATE TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ----- haltes (public read) ------------------------------------------------
DROP POLICY IF EXISTS haltes_select_all ON public.haltes;
CREATE POLICY haltes_select_all ON public.haltes
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS haltes_write_admin ON public.haltes;
CREATE POLICY haltes_write_admin ON public.haltes
  FOR ALL TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- ----- bids ----------------------------------------------------------------
DROP POLICY IF EXISTS bids_select_own ON public.bids;
CREATE POLICY bids_select_own ON public.bids
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() OR public.is_superadmin());

-- Tidak ada policy INSERT untuk bids: bid hanya dibuat lewat API server
-- (service role) yang menegakkan harga dasar, jadwal lelang, dan verifikasi.
-- Lihat supabase/migrations/20260930_keamanan_dan_aturan_harga.sql.
DROP POLICY IF EXISTS bids_insert_active ON public.bids;

DROP POLICY IF EXISTS bids_update_admin ON public.bids;
CREATE POLICY bids_update_admin ON public.bids
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- ----- subscriptions -------------------------------------------------------
DROP POLICY IF EXISTS subs_select_own ON public.subscriptions;
CREATE POLICY subs_select_own ON public.subscriptions
  FOR SELECT TO authenticated
  USING (company_id = public.current_company_id() OR public.is_superadmin());

-- Tidak ada policy INSERT untuk subscriptions: langganan hanya dibuat lewat
-- API server (service role) dengan tarif dari src/lib/pricing.ts.
DROP POLICY IF EXISTS subs_insert_active ON public.subscriptions;

DROP POLICY IF EXISTS subs_update_admin ON public.subscriptions;
CREATE POLICY subs_update_admin ON public.subscriptions
  FOR UPDATE TO authenticated
  USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- ----- favorites -----------------------------------------------------------
DROP POLICY IF EXISTS favorites_all_own ON public.favorites;
CREATE POLICY favorites_all_own ON public.favorites
  FOR ALL TO authenticated
  USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

-- ============================================================================
-- MIGRATION — Phase 2 (auction lifecycle)
-- For an existing database that was provisioned before Phase 2 was merged,
-- run the block below in Supabase SQL Editor to add the new auction columns
-- and expand the bids.status enum. Idempotent — re-running is a no-op.
-- For a fresh install, the CREATE TABLE statements above already include
-- everything, so this migration block runs but changes nothing.
-- ============================================================================
ALTER TABLE public.haltes
  ADD COLUMN IF NOT EXISTS auction_starts_at TIMESTAMPTZ;
ALTER TABLE public.haltes
  ADD COLUMN IF NOT EXISTS auction_ends_at   TIMESTAMPTZ;
-- Akhir kontrak pemenang lelang (diisi saat lelang ditutup, +12 bulan).
ALTER TABLE public.haltes
  ADD COLUMN IF NOT EXISTS contract_ends_at  TIMESTAMPTZ;

ALTER TABLE public.bids DROP CONSTRAINT IF EXISTS bids_status_check;
ALTER TABLE public.bids
  ADD CONSTRAINT bids_status_check
  CHECK (status IN ('pending','winning','outbid','rejected','won','lost'));

-- ============================================================================
-- MIGRATION 2026-09-30: keamanan RLS + aturan harga (deck v6.1)
-- Trigger guard status perusahaan, aturan bid/langganan di level DB,
-- harga dasar BRT minimal Rp 100 jt, dan anti double-booking langganan ada di
-- supabase/migrations/20260930_keamanan_dan_aturan_harga.sql.
-- Jalankan file itu setelah file ini.
-- ============================================================================
