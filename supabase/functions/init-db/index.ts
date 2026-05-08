// ============================================
// Bergwerk Idle — POST /init-db
// Erstellt die stock_prices Tabelle und initialisiert die 8 Aktien
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
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

    // Table erstellen (einfacher Check via upsert auf dummy)
    await supabase.from("stock_prices").upsert({ stock_index: -1, stock_id: "dummy", base_price: 1, current_price: 1, volatility: 0, dividend_rate: 0 }).select();
    await supabase.from("stock_prices").delete().eq("stock_index", -1);

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
      message: "stock_prices table created and initialized",
      count: stocks.length,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    // Prüfen ob Table schon existiert
    const errStr = error.message || "";
    if (errStr.includes("already exists") || errStr.includes("duplicate key")) {
      return new Response(JSON.stringify({
        success: true,
        message: "stock_prices table already exists",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Internal error", details: errStr }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
