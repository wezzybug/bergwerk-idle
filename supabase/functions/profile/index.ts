// ============================================
// Bergwerk Idle — POST /profile
// Set display_name for leaderboard display
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

async function getOrCreateUser(supabase: any, deviceId: string): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("device_id", deviceId)
    .single();

  if (profile) return profile.id;

  const { data: newProfile, error } = await supabase
    .from("profiles").insert({ device_id: deviceId }).select().single();

  if (error || !newProfile) throw new Error("Failed to create user");
  await supabase.from("game_state").insert({ user_id: newProfile.id });
  return newProfile.id;
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[<>]/g, "").substring(0, 20) || "Bergmann";
}

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

    const body = await req.json();
    const displayName = body.display_name;

    if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
      return new Response(JSON.stringify({ error: "display_name required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = await getOrCreateUser(supabase, deviceId);
    const sanitized = sanitizeName(displayName);

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: sanitized })
      .eq("id", userId);

    if (error) {
      return new Response(JSON.stringify({ error: "Update failed", details: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      display_name: sanitized,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});