// ============================================
// Bergwerk Idle — POST /init-stock-prices
// Initialisiert die stock_prices Tabelle
// Nur fuer第一次 Setup
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Table erstellen
    await supabase.rpc("execute_sql", {
      sql: `
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
      `
    });

    // Daten einfügen
    const stocks = [
      { stock_index: 0, stock_id: 'goldmine', base_price: 80, current_price: 80, volatility: 0.08, dividend_rate: 0.001 },
      { stock_index: 1, stock_id: 'coalpit', base_price: 40, current_price: 40, volatility: 0.06, dividend_rate: 0.002 },
      { stock_index: 2, stock_id: 'deepcore', base_price: 300, current_price: 300, volatility: 0.12, dividend_rate: 0.0008 },
      { stock_index: 3, stock_id: 'irontusk', base_price: 150, current_price: 150, volatility: 0.10, dividend_rate: 0.0015 },
      { stock_index: 4, stock_id: 'dragon', base_price: 1200, current_price: 1200, volatility: 0.18, dividend_rate: 0.0005 },
      { stock_index: 5, stock_id: 'portal', base_price: 5000, current_price: 5000, volatility: 0.25, dividend_rate: 0.0003 },
      { stock_index: 6, stock_id: 'void', base_price: 20000, current_price: 20000, volatility: 0.30, dividend_rate: 0.0002 },
      { stock_index: 7, stock_id: 'quantum', base_price: 80000, current_price: 80000, volatility: 0.40, dividend_rate: 0.0001 },
    ];

    for (const s of stocks) {
      await supabase.from("stock_prices").upsert(s, { onConflict: "stock_index" });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "stock_prices initialized",
      count: stocks.length,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
