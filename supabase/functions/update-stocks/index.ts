// ============================================
// Bergwerk Idle — GET /update-stocks
// Aktualisiert alle Aktienkurse (cron oder manuell)
// Random Walk mit Mean Reversion
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const STOCK_DEFS = [
  { stock_index: 0, base_price: 80, volatility: 0.08 },
  { stock_index: 1, base_price: 40, volatility: 0.06 },
  { stock_index: 2, base_price: 300, volatility: 0.12 },
  { stock_index: 3, base_price: 150, volatility: 0.10 },
  { stock_index: 4, base_price: 1200, volatility: 0.18 },
  { stock_index: 5, base_price: 5000, volatility: 0.25 },
  { stock_index: 6, base_price: 20000, volatility: 0.30 },
  { stock_index: 7, base_price: 80000, volatility: 0.40 },
];

function randomWalk(currentPrice: number, basePrice: number, volatility: number): { newPrice: number; trend: number } {
  // Random walk with mean reversion
  const meanReversion = (basePrice - currentPrice) / basePrice * 0.05;
  const randomChange = (Math.random() - 0.5) * 2 * volatility;
  const change = randomChange + meanReversion;
  const newPrice = Math.max(basePrice * 0.1, currentPrice * (1 + change));
  const trend = change;
  return { newPrice: Math.round(newPrice * 100) / 100, trend: Math.round(trend * 1000) / 1000 };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get current stock prices
    const { data: currentPrices, error: fetchError } = await supabase
      .from("stock_prices")
      .select("stock_index, current_price, base_price, volatility")
      .order("stock_index");

    if (fetchError || !currentPrices || currentPrices.length === 0) {
      // Initialize if empty
      const inserts = STOCK_DEFS.map(s => ({
        stock_index: s.stock_index,
        stock_id: ["goldmine", "coalpit", "deepcore", "irontusk", "dragon", "portal", "void", "quantum"][s.stock_index],
        base_price: s.base_price,
        current_price: s.base_price,
        prev_price: s.base_price,
        volatility: s.volatility,
        dividend_rate: [0.001, 0.002, 0.0008, 0.0015, 0.0005, 0.0003, 0.0002, 0.0001][s.stock_index],
        trend: 0,
      }));

      const { error: insertError } = await supabase.from("stock_prices").insert(inserts);
      if (insertError) {
        return new Response(JSON.stringify({ error: "Failed to initialize stocks", details: insertError.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, action: "initialized", count: inserts.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update each stock price
    const updates = [];
    for (const stock of currentPrices) {
      const def = STOCK_DEFS[stock.stock_index] || { base_price: stock.base_price, volatility: stock.volatility };
      const { newPrice, trend } = randomWalk(stock.current_price, def.base_price || stock.base_price, def.volatility || stock.volatility);

      updates.push({
        stock_index: stock.stock_index,
        prev_price: stock.current_price,
        current_price: newPrice,
        trend,
        last_updated: new Date().toISOString(),
      });
    }

    // Batch update
    for (const u of updates) {
      await supabase.from("stock_prices").update({
        prev_price: u.prev_price,
        current_price: u.current_price,
        trend: u.trend,
        last_updated: u.last_updated,
      }).eq("stock_index", u.stock_index);
    }

    return new Response(JSON.stringify({
      success: true,
      action: "updated",
      count: updates.length,
      prices: updates.map(u => ({ index: u.stock_index, prev: u.prev_price, current: u.current_price, trend: u.trend })),
      server_time: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});