// ============================================
// Bergwerk Idle — POST /sync
// Server-authoritative Game-State Sync
// Device-ID Auth (kein Login nötig)
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Device-ID → User Mapping (ohne echtes Auth)
async function getOrCreateUser(supabase: any, deviceId: string): Promise<{ id: string; isShadowBanned: boolean }> {
  // Bestehenden User suchen
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, is_shadow_banned")
    .eq("device_id", deviceId)
    .single();

  if (profile) {
    // last_login updaten
    await supabase
      .from("profiles")
      .update({ last_login: new Date().toISOString() })
      .eq("id", profile.id);
    return { id: profile.id, isShadowBanned: profile.is_shadow_banned };
  }

  // Neuen User anlegen
  const { data: newProfile, error } = await supabase
    .from("profiles")
    .insert({ device_id: deviceId })
    .select()
    .single();

  if (error || !newProfile) {
    throw new Error("Failed to create user: " + (error?.message || "unknown"));
  }

  // Game State initialisieren
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

      const { id: userId, isShadowBanned } = await getOrCreateUser(supabase, deviceId);

      // Game State laden
      const { data: state } = await supabase
        .from("game_state")
        .select("*")
        .eq("user_id", userId)
        .single();

      // Upgrades laden
      const { data: upgrades } = await supabase
        .from("upgrades")
        .select("*")
        .eq("user_id", userId);

      // Achievements laden
      const { data: achievements } = await supabase
        .from("achievements")
        .select("achievement_id, unlocked_at")
        .eq("user_id", userId);

      // Aktive Ad-Boosts laden
      const { data: adBoosts } = await supabase
        .from("ad_watches")
        .select("ad_type, expires_at")
        .eq("user_id", userId)
        .gt("expires_at", new Date().toISOString());

      return new Response(JSON.stringify({
        success: true,
        user_id: userId,
        state: state || {},
        upgrades: upgrades || [],
        achievements: achievements || [],
        ad_boosts: adBoosts || [],
        shadow_banned: isShadowBanned,
        server_time: new Date().toISOString(),
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

      // --- RATE LIMIT ---
      const { data: rateOk } = await supabase.rpc("check_rate_limit", {
        p_user_id: userId, p_action: "sync", p_max_per_window: 60, p_window_seconds: 60,
      });
      if (rateOk === false) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // --- PLAUSIBILITÄTS-CHECK ---
      const { data: currentState } = await supabase
        .from("game_state")
        .select("gold, gps, prestige_multiplier, last_save")
        .eq("user_id", userId)
        .single();

      if (currentState && body.gold !== undefined) {
        const gps = body.gps || currentState.gps || 0;
        const prestige = body.prestige_multiplier || currentState.prestige_multiplier || 1;
        const maxGps = Math.max(gps * prestige * 3, 100);
        const elapsed = Math.max((Date.now() - new Date(currentState.last_save).getTime()) / 1000, 0);
        const maxGoldGain = maxGps * elapsed + (body.gold_actions || 0) * 1000;
        const goldDiff = body.gold - currentState.gold;

        if (goldDiff > maxGoldGain * 1.5) {
          await supabase.from("cheat_flags").insert({
            user_id: userId,
            flag_type: "implausible_gold",
            severity: goldDiff > maxGoldGain * 5 ? "high" : "medium",
            details: { gold_diff: goldDiff, max_allowed: maxGoldGain, elapsed },
          });
        }
      }

      // --- GAME STATE SPEICHERN ---
      const gameData: Record<string, any> = {
        user_id: userId,
        last_save: new Date().toISOString(),
      };
      // Nur Felder updaten die mitkommen (keine 0-Werte überschreiben)
      const fields = ["gold", "total_gold", "total_gold_all_time", "gems", "prestige_multiplier",
        "click_power", "click_multiplier", "gps", "total_clicks", "total_upgrades_bought",
        "easter_1m", "easter_1b"];
      for (const f of fields) {
        if (body[f] !== undefined) gameData[f] = body[f];
      }

      const { error: upsertErr } = await supabase
        .from("game_state")
        .upsert(gameData, { onConflict: "user_id" });

      if (upsertErr) {
        return new Response(JSON.stringify({ error: "Save failed", details: upsertErr.message }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // --- UPGRADES SPEICHERN (falls mitgeliefert) ---
      if (body.upgrades && Array.isArray(body.upgrades)) {
        for (const upg of body.upgrades) {
          await supabase.from("upgrades").upsert({
            user_id: userId,
            upgrade_type: upg.type,
            upgrade_index: upg.index,
            count: upg.count,
          }, { onConflict: "user_id,upgrade_type,upgrade_index" });
        }
      }

      // --- ANALYTICS ---
      await supabase.from("analytics_events").insert({
        user_id: userId,
        event_type: "sync",
        event_data: {
          gold: body.gold, gps: body.gps, prestige: body.prestige_multiplier,
          session_duration: body.session_duration || 0,
        },
        session_id: body.session_id || null,
      });

      return new Response(JSON.stringify({
        success: true,
        server_time: new Date().toISOString(),
        shadow_banned: isShadowBanned,
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