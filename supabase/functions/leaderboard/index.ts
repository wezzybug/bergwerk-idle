// ============================================
// Bergwerk Idle — GET /leaderboard
// Top-Spieler nach Gold, Prestige, etc.
// v2: Added display_name support
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    const type = url.searchParams.get("type") || "gold"; // gold, prestige, clicks
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "10"), 50);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Shadow-gebannte User ausschließen
    const { data: bannedIds } = await supabase
      .from("profiles")
      .select("id")
      .eq("is_shadow_banned", true);
    const bannedList = (bannedIds || []).map((b: any) => b.id);

    let query = supabase
      .from("game_state")
      .select("user_id, total_gold_all_time, prestige_multiplier, total_clicks, gps, gold, gems")
      .range(offset, offset + limit - 1);

    // Sortierung
    switch (type) {
      case "prestige":
        query = query.order("prestige_multiplier", { ascending: false });
        break;
      case "clicks":
        query = query.order("total_clicks", { ascending: false });
        break;
      default:
        query = query.order("total_gold_all_time", { ascending: false });
    }

    const { data: states, error } = await query;

    if (error) {
      return new Response(JSON.stringify({ error: "Query failed", details: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Usernames holen für Display
    const userIds = (states || []).map((s: any) => s.user_id);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, device_id")
      .in("id", userIds);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));

    // Leaderboard zusammenbauen
    const leaderboard = (states || [])
      .filter((s: any) => !bannedList.includes(s.user_id))
      .map((s: any, i: number) => {
        const profile = profileMap.get(s.user_id);
        const displayName = profile?.display_name || (profile?.device_id ? profile.device_id.substring(0, 8) + "..." : "???");
        return {
          rank: offset + i + 1,
          user_id: s.user_id.slice(0, 8) + "...",
          display_name: displayName,
          total_gold: s.total_gold_all_time,
          prestige: s.prestige_multiplier,
          total_clicks: s.total_clicks,
          gps: s.gps,
        };
      });

    return new Response(JSON.stringify({
      success: true,
      type,
      leaderboard,
      server_time: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});