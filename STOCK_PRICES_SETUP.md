# Bergwerk Idle — Stock Prices Setup Anleitung

## Was fehlt:
Die `stock_prices` Tabelle existiert aber ist **leer** – die 8 Aktien wurden nicht eingefügt.

## Warum:
Supabase Edge Functions haben **Schema Cache Issues** – die Table existiert aber wird nicht erkannt.

## Lösung:
Führe diesen SQL Code im **Supabase Dashboard SQL Editor** aus:

```sql
-- Daten einfügen
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
```

## Link zum Dashboard:
https://supabase.com/dashboard/project/xmiqereagqyufyiodsmj/editor

## Nach dem Ausführen:
1. `/sync` Aufruf testen – `stock_prices` sollten jetzt gefüllt sein
2. `buy_stock(0, 5)` testen – should work
3. `sell_stock(0, 2)` testen – should work

---

## Status:
- Edge Functions deployed: ✅
- Table created: ✅ (per `check-stock-table`)
- Table filled: ❌ (braucht Dashboard SQL Editor)

---

## Alternative (falls Dashboard nicht funktioniert):
- Warte bis Supabase Schema Cache aktualisiert ist
- Oder nutze Supabase CLI mit Docker
