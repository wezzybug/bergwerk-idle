-- Bergwerk Idle — Migration 003: Fix jobs table + add missing columns
-- Run in Supabase Dashboard SQL Editor

-- Add missing columns to jobs table
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'available'
  CHECK (status IN ('available', 'running', 'cooldown'));
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS duration_ms BIGINT;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS cooldown_end TIMESTAMPTZ;

-- Add display_name to profiles for leaderboard
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Make jobs constraint use ON CONFLICT properly
-- (user_id, job_index) should be unique for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_user_job ON public.jobs(user_id, job_index);

-- Verify stock_prices table has the right columns
ALTER TABLE public.stock_prices ADD COLUMN IF NOT EXISTS prev_price DOUBLE PRECISION DEFAULT 0;
ALTER TABLE public.stock_prices ADD COLUMN IF NOT EXISTS trend DOUBLE PRECISION DEFAULT 0;
ALTER TABLE public.stock_prices ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ DEFAULT NOW();

-- Add gem_count columns to game_state for faster gem upgrade queries
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS active_boost TEXT;
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS boost_end TIMESTAMPTZ;
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS market_event TEXT;
ALTER TABLE public.game_state ADD COLUMN IF NOT EXISTS market_event_end TIMESTAMPTZ;