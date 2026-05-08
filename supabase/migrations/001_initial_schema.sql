-- ============================================
-- Bergwerk Idle — Supabase Datenbank-Schema
-- EINFACHE VERSION — kein Auth-Dependency
-- ============================================

-- Extension für UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PLAYERS (statt auth.users — standalone)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ DEFAULT NOW(),
  is_shadow_banned BOOLEAN DEFAULT FALSE
);

-- 2. GAME STATE (der wahre Gold-Stand)
CREATE TABLE IF NOT EXISTS public.game_state (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  gold DOUBLE PRECISION DEFAULT 0,
  total_gold DOUBLE PRECISION DEFAULT 0,
  total_gold_all_time DOUBLE PRECISION DEFAULT 0,
  gems INTEGER DEFAULT 0,
  prestige_multiplier DOUBLE PRECISION DEFAULT 1.0,
  click_power DOUBLE PRECISION DEFAULT 1.0,
  click_multiplier DOUBLE PRECISION DEFAULT 1.0,
  gps DOUBLE PRECISION DEFAULT 0,
  total_clicks BIGINT DEFAULT 0,
  total_upgrades_bought INTEGER DEFAULT 0,
  easter_1m BOOLEAN DEFAULT FALSE,
  easter_1b BOOLEAN DEFAULT FALSE,
  last_save TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. UPGRADES
CREATE TABLE IF NOT EXISTS public.upgrades (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  upgrade_type TEXT NOT NULL CHECK (upgrade_type IN ('click', 'auto', 'gem')),
  upgrade_index INTEGER NOT NULL,
  count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, upgrade_type, upgrade_index)
);

-- 4. JOBS
CREATE TABLE IF NOT EXISTS public.jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_index INTEGER NOT NULL,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  payout DOUBLE PRECISION DEFAULT 0,
  UNIQUE(user_id, job_index)
);

-- 5. STOCK HOLDINGS
CREATE TABLE IF NOT EXISTS public.stock_holdings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  stock_index INTEGER NOT NULL,
  shares INTEGER DEFAULT 0,
  avg_buy_price DOUBLE PRECISION DEFAULT 0,
  UNIQUE(user_id, stock_index)
);

-- 6. STOCK TRADES
CREATE TABLE IF NOT EXISTS public.stock_trades (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  stock_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. AD WATCHES
CREATE TABLE IF NOT EXISTS public.ad_watches (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ad_type TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  watched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. ACHIEVEMENTS
CREATE TABLE IF NOT EXISTS public.achievements (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- 9. ANALYTICS
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. CHEAT FLAGS
CREATE TABLE IF NOT EXISTS public.cheat_flags (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'low',
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_game_state_updated ON public.game_state(updated_at);
CREATE INDEX IF NOT EXISTS idx_analytics_user_time ON public.analytics_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cheat_flags_user ON public.cheat_flags(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_trades_user ON public.stock_trades(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ad_watches_expires ON public.ad_watches(expires_at);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Rate-Limit-Check
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id UUID,
  p_action TEXT,
  p_max_per_window INTEGER DEFAULT 30,
  p_window_seconds INTEGER DEFAULT 60
) RETURNS BOOLEAN AS $$
DECLARE
  action_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO action_count
  FROM public.analytics_events
  WHERE user_id = p_user_id
    AND event_type = p_action
    AND created_at > NOW() - (p_window_seconds || ' seconds')::INTERVAL;

  IF action_count > p_max_per_window THEN
    INSERT INTO public.cheat_flags (user_id, flag_type, severity, details)
    VALUES (p_user_id, 'rate_limit', 'medium',
      jsonb_build_object('action', p_action, 'count', action_count, 'max', p_max_per_window));
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS game_state_updated ON public.game_state;
CREATE TRIGGER game_state_updated BEFORE UPDATE ON public.game_state
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();
