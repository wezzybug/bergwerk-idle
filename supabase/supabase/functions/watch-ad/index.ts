// ============================================
// Bergwerk Idle — POST /watch-ad
// Werbung schauen → Boost registrieren
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AD_BOOST_DURATIONS: Record<string, number> = {
  click_boost: 300,   // 5 Minuten
  gps_boost: 600,     // 10 Minuten
  gold_boost: 180,    // 3 Minuten
  job_skip: 0,        // Sofort
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

    const deviceId = req.headers.get("x-device-id");
    if (!deviceId) {
      return new Response(JSON.stringify({ error: "x-device-id header required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // User finden
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, is_shadow_banned")
      .eq("device_id", deviceId)
      .single();

    if (!profile) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = profile.id;

    // Rate limit: max 10 ads pro Stunde
    const { data: rateOk } = await supabase.rpc("check_rate_limit", {
      p_user_id: userId, p_action: "watch_ad", p_max_per_window: 10, p_window_seconds: 3600,
    });
    if (rateOk === false) {
      return new Response(JSON.stringify({ error: "Too many ad watches" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const adType = body.ad_type;

    if (!AD_BOOST_DURATIONS[adType]) {
      return new Response(JSON.stringify({ error: "Invalid ad type", valid_types: Object.keys(AD_BOOST_DURATIONS) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prüfen ob bereits ein aktiver Boost dieses Typs existiert
    const now = new Date();
    const { data: activeBoosts } = await supabase
      .from("ad_watches")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("ad_type", adType)
      .gt("expires_at", now.toISOString());

    if (activeBoosts && activeBoosts.length > 0) {
      // Boost verlängern statt neuen erstellen
      const currentExpiry = new Date(activeBoosts[0].expires_at);
      const duration = AD_BOOST_DURATIONS[adType];
      const newExpiry = new Date(Math.max(currentExpiry.getTime(), now.getTime()) + duration * 1000);

      await supabase
        .from("ad_watches")
        .update({ expires_at: newExpiry.toISOString() })
        .eq("id", activeBoosts[0].id);

      return new Response(JSON.stringify({
        success: true,
        ad_type: adType,
        expires_at: newExpiry.toISOString(),
        extended: true,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Neuen Boost erstellen
    const duration = AD_BOOST_DURATIONS[adType];
    const expiresAt = new Date(now.getTime() + duration * 1000);

    const { error: insertErr } = await supabase.from("ad_watches").insert({
      user_id: userId,
      ad_type: adType,
      expires_at: expiresAt.toISOString(),
    });

    if (insertErr) {
      return new Response(JSON.stringify({ error: "Failed to register ad watch", details: insertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Analytics
    await supabase.from("analytics_events").insert({
      user_id: userId,
      event_type: "watch_ad",
      event_data: { ad_type: adType, duration },
    });

    return new Response(JSON.stringify({
      success: true,
      ad_type: adType,
      expires_at: expiresAt.toISOString(),
      extended: false,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});