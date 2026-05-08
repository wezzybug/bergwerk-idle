-- Bergwerk Idle — Stock Prices Migration
-- Füge die stock_prices Tabelle hinzu und initialisiere die 8 Aktien

CREATE TABLE IF NOT EXISTS public.stock_prices (
  stock_index INTEGER PRIMARY KEY,
  stock_id TEXT NOT NULL,
  base_price DOUBLE PRECISION NOT NULL,
  current_price DOUBLE PRECISION NOT NULL,
  prev_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  volatility DOUBLE PRECISION NOT NULL,
  dividend_rate DOUBLE PRECISION NOT NULL,
  trend DOUBLE PRECISION DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Füge die 8 Aktien ein (wird bei first-run aufgerufen)
INSERT INTO public.stock_prices (stock_index, stock_id, base_price, current_price, volatility, dividend_rate)
VALUES 
  (0, 'goldmine', 80, 80, 0.08, 0.001),
  (1, 'coalpit', 40, 40, 0.06, 0.002),
  (2, 'deepcore', 300, 300, 0.12, 0.0008),
  (3, 'irontusk', 150, 150, 0.10, 0.0015),
  (4, 'dragon', 1200, 1200, 0.18, 0.0005),
  (5, 'portal', 5000, 5000, 0.25, 0.0003),
  (6, 'void', 20000, 20000, 0.30, 0.0002),
  (7, 'quantum', 80000, 80000, 0.40, 0.0001)
ON CONFLICT (stock_index) DO NOTHING;

-- Aktualisiere Preise jede Stunde (nur Trigger setzen)
CREATE OR REPLACE FUNCTION public.update_stock_prices()
RETURNS TRIGGER AS $$
DECLARE
  s RECORD;
  base_change DOUBLE PRECISION;
  trend_change DOUBLE PRECISION;
  mean_revert DOUBLE PRECISION;
BEGIN
  FOR s IN SELECT * FROM public.stock_prices LOOP
    base_change := (RANDOM() - 0.48) * s.volatility * 0.5;
    trend_change := (RANDOM() - 0.5) * s.volatility * 0.3;
    mean_revert := (s.base_price - s.current_price) / s.base_price * 0.015;
    s.current_price := GREATEST(s.base_price * 0.05, s.current_price * (1 + base_change + trend_change + mean_revert));
    s.trend := trend_change;
    s.prev_price := s.current_price;
    s.last_updated := NOW();
    UPDATE public.stock_prices SET current_price = s.current_price, prev_price = s.prev_price, trend = s.trend, last_updated = NOW() WHERE stock_index = s.stock_index;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
