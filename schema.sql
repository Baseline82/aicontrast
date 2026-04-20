-- ============================================================
--  AIFinder — Supabase Schema
--  Run this in the Supabase SQL Editor (once).
-- ============================================================

-- 1. TABLE ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tools (
  id            SERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  emoji         TEXT        NOT NULL DEFAULT '🤖',
  category      TEXT        NOT NULL,
  tags          TEXT[]      NOT NULL DEFAULT '{}',
  badge         TEXT,                                 -- 'new' | 'top' | 'popular' | 'free' | NULL
  short_desc    TEXT        NOT NULL DEFAULT '',
  long_desc     TEXT        NOT NULL DEFAULT '',
  rating        NUMERIC(3,1) NOT NULL DEFAULT 0,
  reviews       INTEGER     NOT NULL DEFAULT 0,
  year          INTEGER     NOT NULL DEFAULT 2024,
  popularity    INTEGER     NOT NULL DEFAULT 0,
  website       TEXT        NOT NULL DEFAULT '',
  pros          TEXT[]      NOT NULL DEFAULT '{}',
  cons          TEXT[]      NOT NULL DEFAULT '{}',
  breakdown     JSONB       NOT NULL DEFAULT '{}',
  domain        TEXT,                                 -- used for logo lookup (e.g. 'openai.com')
  logo_url      TEXT,                                 -- optional custom logo override
  approved      BOOLEAN     NOT NULL DEFAULT TRUE,    -- FALSE = pending admin review
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. UNIQUE CONSTRAINT + INDEXES ──────────────────────────
ALTER TABLE public.tools DROP CONSTRAINT IF EXISTS tools_name_unique;
ALTER TABLE public.tools ADD CONSTRAINT tools_name_unique UNIQUE (name);

CREATE INDEX IF NOT EXISTS tools_category_idx  ON public.tools (category);
CREATE INDEX IF NOT EXISTS tools_approved_idx  ON public.tools (approved);
CREATE INDEX IF NOT EXISTS tools_rating_idx    ON public.tools (rating DESC);
CREATE INDEX IF NOT EXISTS tools_popularity_idx ON public.tools (popularity DESC);

-- Full-text search index across name + short_desc
CREATE INDEX IF NOT EXISTS tools_fts_idx ON public.tools
  USING gin(to_tsvector('english', name || ' ' || short_desc || ' ' || long_desc));

-- 3. UPDATED_AT TRIGGER ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tools_updated_at ON public.tools;
CREATE TRIGGER tools_updated_at
  BEFORE UPDATE ON public.tools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. ROW-LEVEL SECURITY ────────────────────────────────────
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;

-- Anyone can read approved tools
CREATE POLICY "Public can read approved tools"
  ON public.tools FOR SELECT
  USING (approved = TRUE);

-- Service-role key (used by admin + discovery scripts) bypasses RLS
-- No additional policies needed for service role.

-- 5. OPTIONAL: pending_notifications TABLE ─────────────────
--    Stores newly discovered tools waiting for admin approval
CREATE TABLE IF NOT EXISTS public.pending_tools (
  id            SERIAL PRIMARY KEY,
  data          JSONB       NOT NULL,   -- raw tool data from discovery
  source        TEXT,                   -- 'producthunt' | 'gpt' | 'manual'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.pending_tools ENABLE ROW LEVEL SECURITY;
-- Only service-role can read/write pending tools (admin uses service key)
