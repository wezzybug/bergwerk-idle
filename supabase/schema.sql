-- ============================================
-- Bergwerk Idle — Supabase Datenbank-Schema
-- Phase 1: Server-Authoritative Backend
-- ============================================

-- 1. USERS (via Supabase Auth — anon/device-ID)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT,
  device_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ DEFAULT NOW(),
  is_shadow_banned BOOLEAN DEFAULT FALSE,
  prestige_level INTEGER DEFAULT 0
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

-- 3. UPGRADES (gekaufte Upgrades)
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

-- 5. STOCK TRADES
CREATE TABLE IF NOT EXISTS public.stock_trades (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  stock_index INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  quantity INTEGER NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  fee DOUBLE PRECISION DEFAULT 0,
  total DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. STOCK HOLDINGS (aktueller Aktienbesitz)
CREATE TABLE IF NOT EXISTS public.stock_holdings (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  stock_index INTEGER NOT NULL,
  shares INTEGER DEFAULT 0,
  avg_buy_price DOUBLE PRECISION DEFAULT 0,
  UNIQUE(user_id, stock_index)
);

-- 7. AD WATCHES (Werbung-Tracking)
CREATE TABLE IF NOT EXISTS public.ad_watches (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ad_type TEXT NOT NULL CHECK (ad_type IN ('click_boost', 'gps_boost', 'gold_boost', 'job_skip')),
  watched_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
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
  flag_type TEXT NOT NULL CHECK (flag_type IN ('rate_limit', 'implausible_gold', 'implausible_gps', 'prestige_too_fast', 'click_spam', 'api_abuse')),
  severity TEXT NOT NULL DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- Nur der eigene User darf seine Daten lesen/schreiben
-- ============================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upgrades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cheat_flags ENABLE ROW LEVEL SECURITY;

-- Policy: User liest nur eigene Daten
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users read own game_state" ON public.game_state FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own upgrades" ON public.upgrades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own jobs" ON public.jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own stock_trades" ON public.stock_trades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own stock_holdings" ON public.stock_holdings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own ad_watches" ON public.ad_watches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own achievements" ON public.achievements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own analytics" ON public.analytics_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users read own cheat_flags" ON public.cheat_flags FOR SELECT USING (auth.uid() = user_id);

-- Policy: User schreibt nur eigene Daten
CREATE POLICY "Users insert own game_state" ON public.game_state FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own game_state" ON public.game_state FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own upgrades" ON public.upgrades FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own upgrades" ON public.upgrades FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own jobs" ON public.jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own jobs" ON public.jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own stock_trades" ON public.stock_trades FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users insert own stock_holdings" ON public.stock_holdings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own stock_holdings" ON public.stock_holdings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users insert own ad_watches" ON public.ad_watches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users insert own achievements" ON public.achievements FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users insert own analytics" ON public.analytics_events FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service Role bypasses RLS (default in Supabase)

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

-- Anti-Cheat: Prüft ob ein User zu viele Aktionen in kurzer Zeit macht
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
      jsonb_build_object('action', p_action, 'count', action_count, 'max', p_max_per_window, 'window_s', p_window_seconds));
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER game_state_updated BEFORE UPDATE ON public.game_state
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

CREATE TRIGGER upgrades_updated BEFORE UPDATE ON public.upgrades
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();
