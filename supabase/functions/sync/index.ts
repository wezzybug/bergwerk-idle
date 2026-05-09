// ============================================
// Bergwerk Idle — /sync
// GET: Game State laden, POST: Game State speichern
// Device-ID Auth (kein Login nötig)
// v2: Fixed job sync format (active, start_time, cooldown_end)
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

async function getOrCreateUser(supabase: any, deviceId: string): Promise<{ id: string; isShadowBanned: boolean }> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_shadow_banned")
    .eq("device_id", deviceId)
    .single();

  if (profile) {
    await supabase.from("profiles").update({ last_login: new Date().toISOString() }).eq("id", profile.id);
    return { id: profile.id, isShadowBanned: profile.is_shadow_banned };
  }

  const { data: newProfile, error } = await supabase
    .from("profiles").insert({ device_id: deviceId }).select().single();

  if (error || !newProfile) throw new Error("Failed to create user: " + (error?.message || "unknown"));
  await supabase.from("game_state").insert({ user_id: newProfile.id });
  return { id: newProfile.id, isShadowBanned: false };
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

    // === GET: Game State laden ===
    if (req.method === "GET") {
      const url = new URL(req.url);
      const deviceId = url.searchParams.get("device_id");
      if (!deviceId) {
        return new Response(JSON.stringify({ error: "device_id required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { id: userId } = await getOrCreateUser(supabase, deviceId);

      const { data: state } = await supabase.from("game_state").select("*").eq("user_id", userId).single();
      const { data: upgrades } = await supabase.from("upgrades").select("*").eq("user_id", userId);
      const { data: achievements } = await supabase.from("achievements").select("achievement_id, unlocked_at").eq("user_id", userId);
      const { data: adBoosts } = await supabase.from("ad_watches").select("ad_type, expires_at").eq("user_id", userId).gt("expires_at", new Date().toISOString());
      const { data: jobs } = await supabase.from("jobs").select("job_index, count, status, start_time, duration_ms, cooldown_end").eq("user_id", userId);
      const { data: stocks } = await supabase.from("stock_holdings").select("stock_index, shares, avg_buy_price").eq("user_id", userId);
      const { data: stockPrices } = await supabase.from("stock_prices").select("stock_index, current_price, prev_price, trend").order("stock_index");

      // Process active boosts
      let activeBoost = null;
      let boostEnd = null;
      let activeAdBoost = null;
      if (adBoosts && adBoosts.length > 0) {
        // Use the latest ad boost
        const latest = adBoosts[adBoosts.length - 1];
        activeAdBoost = { type: latest.ad_type === 'click_boost' ? 'click' : latest.ad_type === 'gps_boost' ? 'auto' : 'gold', end: new Date(latest.expires_at).getTime() };
      }

      return new Response(JSON.stringify({
        success: true, user_id: userId,
        state: state || {}, upgrades: upgrades || [], achievements: achievements || [],
        ad_boosts: adBoosts || [], jobs: jobs || [], stocks: stocks || [],
        stock_prices: stockPrices || [],
        shadow_banned: false, server_time: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // === POST: Game State speichern ===
    if (req.method === "POST") {
      const deviceId = req.headers.get("x-device-id");
      if (!deviceId) {
        return new Response(JSON.stringify({ error: "x-device-id header required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { id: userId, isShadowBanned } = await getOrCreateUser(supabase, deviceId);
      const body = await req.json();

      // Rate limit
      const { data: rateOk } = await supabase.rpc("check_rate_limit", {
        p_user_id: userId, p_action: "sync", p_max_per_window: 60, p_window_seconds: 60,
      });
      if (rateOk === false) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Plausibilitäts-Check
      const { data: currentState } = await supabase.from("game_state").select("gold, gps, prestige_multiplier, last_save").eq("user_id", userId).single();
      if (currentState && body.gold !== undefined) {
        const gps = body.gps || currentState.gps || 0;
        const prestige = body.prestige_multiplier || currentState.prestige_multiplier || 1;
        const maxGps = Math.max(gps * prestige * 3, 100);
        const elapsed = Math.max((Date.now() - new Date(currentState.last_save).getTime()) / 1000, 0);
        const maxGoldGain = maxGps * elapsed + (body.gold_actions || 0) * 1000;
        const goldDiff = body.gold - currentState.gold;
        if (goldDiff > maxGoldGain * 1.5) {
          await supabase.from("cheat_flags").insert({
            user_id: userId, flag_type: "implausible_gold",
            severity: goldDiff > maxGoldGain * 5 ? "high" : "medium",
            details: { gold_diff: goldDiff, max_allowed: maxGoldGain, elapsed },
          });
        }
      }

      // Game State speichern
      const gameData: Record<string, any> = { user_id: userId, last_save: new Date().toISOString() };
      const fields = ["gold", "total_gold", "total_gold_all_time", "gems", "prestige_multiplier",
        "click_power", "click_multiplier", "gps", "total_clicks", "total_upgrades_bought",
        "easter_1m", "easter_1b"];
      for (const f of fields) { if (body[f] !== undefined) gameData[f] = body[f]; }

      const { error: upsertErr } = await supabase.from("game_state").upsert(gameData, { onConflict: "user_id" });
      if (upsertErr) {
        return new Response(JSON.stringify({ error: "Save failed", details: upsertErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Upgrades speichern
      if (body.upgrades && Array.isArray(body.upgrades)) {
        for (const upg of body.upgrades) {
          await supabase.from("upgrades").upsert({
            user_id: userId, upgrade_type: upg.type, upgrade_index: upg.index, count: upg.count,
          }, { onConflict: "user_id,upgrade_type,upgrade_index" });
        }
      }

      // Jobs speichern
      if (body.jobs && Array.isArray(body.jobs)) {
        for (const j of body.jobs) {
          await supabase.from("jobs").upsert({
            user_id: userId, job_index: j.index, count: j.count || 0,
          }, { onConflict: "user_id,job_index" });
        }
      }

      // Stock Holdings speichern
      if (body.stocks && Array.isArray(body.stocks)) {
        for (const s of body.stocks) {
          await supabase.from("stock_holdings").upsert({
            user_id: userId, stock_index: s.index, shares: s.shares || 0, avg_buy_price: s.avg_buy || 0,
          }, { onConflict: "user_id,stock_index" });
        }
      }

      // Analytics
      await supabase.from("analytics_events").insert({
        user_id: userId, event_type: "sync",
        event_data: { gold: body.gold, gps: body.gps, prestige: body.prestige_multiplier, session_duration: body.session_duration || 0 },
        session_id: body.session_id || null,
      });

      return new Response(JSON.stringify({
        success: true, server_time: new Date().toISOString(), shadow_banned: isShadowBanned,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});