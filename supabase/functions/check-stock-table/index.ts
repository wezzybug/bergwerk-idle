// ============================================
// Bergwerk Idle — GET /check-stock-table
// Prüft ob stock_prices Table existiert
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

    // Prüfen ob Table existiert
    const { data: tables } = await supabase.from("stock_prices").select("count", { count: "exact", head: true });
    return new Response(JSON.stringify({ 
      success: true, 
      exists: true,
      count: tables?.[0]?.count || 0,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    if (error.message.includes("not found") || error.message.includes("not exist")) {
      return new Response(JSON.stringify({ success: true, exists: false, error: "Table not found" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
