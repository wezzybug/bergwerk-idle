-- Stock Prices Tabelle (aktuelle Preise auf dem Server)
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
