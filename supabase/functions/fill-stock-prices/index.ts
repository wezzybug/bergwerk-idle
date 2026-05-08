// ============================================
// Bergwerk Idle — GET /fill-stock-prices
// Fügt die 8 Aktien in die Tabelle ein (wenn leer)
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Insert die 8 Aktien
    const { error } = await supabase.from("stock_prices").upsert([
      { stock_index: 0, stock_id: 'goldmine', base_price: 80, current_price: 80, volatility: 0.08, dividend_rate: 0.001 },
      { stock_index: 1, stock_id: 'coalpit', base_price: 40, current_price: 40, volatility: 0.06, dividend_rate: 0.002 },
      { stock_index: 2, stock_id: 'deepcore', base_price: 300, current_price: 300, volatility: 0.12, dividend_rate: 0.0008 },
      { stock_index: 3, stock_id: 'irontusk', base_price: 150, current_price: 150, volatility: 0.10, dividend_rate: 0.0015 },
      { stock_index: 4, stock_id: 'dragon', base_price: 1200, current_price: 1200, volatility: 0.18, dividend_rate: 0.0005 },
      { stock_index: 5, stock_id: 'portal', base_price: 5000, current_price: 5000, volatility: 0.25, dividend_rate: 0.0003 },
      { stock_index: 6, stock_id: 'void', base_price: 20000, current_price: 20000, volatility: 0.30, dividend_rate: 0.0002 },
      { stock_index: 7, stock_id: 'quantum', base_price: 80000, current_price: 80000, volatility: 0.40, dividend_rate: 0.0001 },
    ], { onConflict: "stock_index" });

    if (error) throw error;

    return new Response(JSON.stringify({
      success: true,
      message: "Stock prices filled",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
