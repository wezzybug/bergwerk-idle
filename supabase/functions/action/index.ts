// ============================================
// Bergwerk Idle — POST /action
// Server-authoritativ: ALLE Game-Aktionen hier!
// Client schickt action+data, Server berechnet & speichert
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, content-type, x-device-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Rate limit helper
async function checkRateLimit(supabase: any, userId: string, action: string, maxPerHour: number = 60): Promise<boolean> {
  const { data: rateOk } = await supabase.rpc("check_rate_limit", {
    p_user_id: userId, p_action: action, p_max_per_window: maxPerHour, p_window_seconds: 3600,
  });
  return rateOk === true;
}

// Helper: berechne Upgrade-Kosten
function calcUpgradeCost(base: number, mult: number, count: number): number {
  return Math.floor(base * Math.pow(mult, count));
}

// Helper: berechne Job-Reward
function calcJobReward(baseReward: number, gps: number, prestigeMultiplier: number): number {
  if (gps <= 0) return baseReward;
  return Math.floor(baseReward * Math.max(1, 1 + Math.log10(gps) * 0.5) * prestigeMultiplier);
}

// Helper: berechne Prestige-Gems
function calcPrestigeGems(totalGoldAllTime: number): number {
  return Math.floor(totalGoldAllTime / 1e7);
}

// Helper: berechne Klick-Reward
function calcClickReward(clickPower: number, clickMultiplier: number, prestigeMultiplier: number): number {
  return clickPower * clickMultiplier * prestigeMultiplier;
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
    const body = await req.json();
    const action = body.action;
    const timestamp = new Date();

    // Rate limit für alle actions (max 60 pro Stunde)
    const rateOk = await checkRateLimit(supabase, userId, action, 60);
    if (!rateOk) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Game State laden
    const { data: state } = await supabase.from("game_state").select("*").eq("user_id", userId).single();
    const gold = state?.gold || 0;
    const gps = state?.gps || 0;
    const clickPower = state?.click_power || 1;
    const clickMultiplier = state?.click_multiplier || 1;
    const prestigeMultiplier = state?.prestige_multiplier || 1;
    const totalGoldAllTime = state?.total_gold_all_time || 0;

    // Action-Dispatcher
    let response: any;

    switch (action) {
      case "mine": {
        // Rate limit: max 3000 mines pro Stunde (1 Anfrage alle 1.2s)
        const mineOk = await checkRateLimit(supabase, userId, "mine", 3000);
        if (!mineOk) {
          return new Response(JSON.stringify({ error: "Mine rate limit exceeded" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const reward = calcClickReward(clickPower, clickMultiplier, prestigeMultiplier);
        const newGold = gold + reward;
        const newTotalClicks = (state?.total_clicks || 0) + 1;

        // Game State updaten
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          total_gold: (state?.total_gold || 0) + reward,
          total_gold_all_time: totalGoldAllTime + reward,
          total_clicks: newTotalClicks,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true,
          action: "mine",
          reward: reward,
          gold: newGold,
          total_clicks: newTotalClicks,
        };
        break;
      }

      case "buy_click_upgrade": {
        const index = body.index;
        if (typeof index !== "number" || index < 0 || index >= 6) {
          return new Response(JSON.stringify({ error: "Invalid upgrade index" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: upgrade } = await supabase
          .from("upgrades")
          .select("count")
          .eq("user_id", userId)
          .eq("upgrade_type", "click")
          .eq("upgrade_index", index)
          .single();

        const count = upgrade?.count || 0;
        const clickUpgrades = [
          { base: 15, mult: 1.55, power: 1 },
          { base: 120, mult: 1.55, power: 3 },
          { base: 1000, mult: 1.55, power: 10 },
          { base: 8000, mult: 1.55, power: 40 },
          { base: 75000, mult: 1.55, power: 200 },
          { base: 600000, mult: 1.55, power: 1000 },
        ];
        const cost = calcUpgradeCost(clickUpgrades[index].base, clickUpgrades[index].mult, count);

        if (gold < cost) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Upgrade kaufen
        const costClickPower = clickUpgrades[index].power;
        const newUpgradeCount = count + 1;
        await supabase.from("upgrades").upsert({
          user_id: userId,
          upgrade_type: "click",
          upgrade_index: index,
          count: newUpgradeCount,
        }, { onConflict: "user_id,upgrade_type,upgrade_index" });

        // Gold abziehen + update total_upgrades_bought
        const newGold = gold - cost;
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          total_gold: (state?.total_gold || 0) - cost,
          total_gold_all_time: totalGoldAllTime,
          total_upgrades_bought: (state?.total_upgrades_bought || 0) + 1,
          click_power: clickPower + costClickPower,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true,
          action: "buy_click_upgrade",
          index: index,
          cost: cost,
          gold: newGold,
          click_power: clickPower + costClickPower,
          upgrade_count: newUpgradeCount,
        };
        break;
      }

      case "buy_auto_upgrade": {
        const index = body.index;
        if (typeof index !== "number" || index < 0 || index >= 9) {
          return new Response(JSON.stringify({ error: "Invalid upgrade index" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: upgrade } = await supabase
          .from("upgrades")
          .select("count")
          .eq("user_id", userId)
          .eq("upgrade_type", "auto")
          .eq("upgrade_index", index)
          .single();

        const count = upgrade?.count || 0;
        const autoUpgrades = [
          { base: 25, mult: 1.45, gps: 1 },
          { base: 200, mult: 1.45, gps: 5 },
          { base: 1200, mult: 1.45, gps: 20 },
          { base: 8000, mult: 1.45, gps: 80 },
          { base: 60000, mult: 1.45, gps: 350 },
          { base: 500000, mult: 1.45, gps: 1500 },
          { base: 4000000, mult: 1.45, gps: 7000 },
          { base: 35000000, mult: 1.45, gps: 30000 },
          { base: 300000000, mult: 1.45, gps: 150000 },
        ];
        const cost = calcUpgradeCost(autoUpgrades[index].base, autoUpgrades[index].mult, count);

        if (gold < cost) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const costGps = autoUpgrades[index].gps;
        const newUpgradeCount = count + 1;
        await supabase.from("upgrades").upsert({
          user_id: userId,
          upgrade_type: "auto",
          upgrade_index: index,
          count: newUpgradeCount,
        }, { onConflict: "user_id,upgrade_type,upgrade_index" });

        const newGold = gold - cost;
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          total_gold: (state?.total_gold || 0) - cost,
          total_gold_all_time: totalGoldAllTime,
          total_upgrades_bought: (state?.total_upgrades_bought || 0) + 1,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true,
          action: "buy_auto_upgrade",
          index: index,
          cost: cost,
          gold: newGold,
          upgrade_count: newUpgradeCount,
        };
        break;
      }

      case "buy_gem_upgrade": {
        const index = body.index;
        if (typeof index !== "number" || index < 0 || index >= 4) {
          return new Response(JSON.stringify({ error: "Invalid gem upgrade index" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const gems = state?.gems || 0;
        const gemUpgrades = [
          { base: 3, mult: 3, max: Infinity },
          { base: 5, mult: 3, max: Infinity },
          { base: 8, mult: 3, max: 10 },
          { base: 5, mult: 4, max: 5 },
        ];
        const cost = calcUpgradeCost(gemUpgrades[index].base, gemUpgrades[index].mult, state?.[`gem_count_${index}`] || 0);

        if (gems < cost) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gems" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // TODO: Gems speichern (braucht ne Spalte in game_state oder separate gems-Tabelle)
        response = { success: false, error: "Gem upgrades not implemented yet" };
        break;
      }

      case "start_job": {
        const jobId = body.job_id;
        if (!jobId || typeof jobId !== "string") {
          return new Response(JSON.stringify({ error: "job_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const jobs = [
          { id: "sweep", duration: 10, reward: 30 },
          { id: "haul", duration: 30, reward: 150 },
          { id: "explore", duration: 60, reward: 600 },
          { id: "boss", duration: 120, reward: 2500 },
          { id: "blast", duration: 240, reward: 10000 },
          { id: "excavate", duration: 600, reward: 50000 },
        ];
        const job = jobs.find(j => j.id === jobId);
        if (!job) {
          return new Response(JSON.stringify({ error: "Invalid job" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Job starten
        await supabase.from("jobs").upsert({
          user_id: userId,
          job_index: jobs.indexOf(job),
          start_time: timestamp.toISOString(),
          duration_ms: job.duration * 1000,
          status: "running",
        }, { onConflict: "user_id,job_index" });

        response = {
          success: true,
          action: "start_job",
          job_id: jobId,
          duration: job.duration,
        };
        break;
      }

      case "claim_job": {
        const jobId = body.job_id;
        if (!jobId || typeof jobId !== "string") {
          return new Response(JSON.stringify({ error: "job_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const jobs = [
          { id: "sweep", base_reward: 30 },
          { id: "haul", base_reward: 150 },
          { id: "explore", base_reward: 600 },
          { id: "boss", base_reward: 2500 },
          { id: "blast", base_reward: 10000 },
          { id: "excavate", base_reward: 50000 },
        ];
        const job = jobs.find(j => j.id === jobId);
        if (!job) {
          return new Response(JSON.stringify({ error: "Invalid job" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Job abrufen
        const { data: jobData } = await supabase
          .from("jobs")
          .select("job_index, count")
          .eq("user_id", userId)
          .eq("job_index", jobs.indexOf(job))
          .single();

        const count = jobData?.count || 0;
        const reward = calcJobReward(job.base_reward, gps, prestigeMultiplier);
        const newGold = gold + reward;

        // Job updaten + Gold addieren
        await supabase.from("jobs").upsert({
          user_id: userId,
          job_index: jobs.indexOf(job),
          count: count + 1,
        }, { onConflict: "user_id,job_index" });

        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          total_gold: (state?.total_gold || 0) + reward,
          total_gold_all_time: totalGoldAllTime + reward,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true,
          action: "claim_job",
          job_id: jobId,
          reward: reward,
          gold: newGold,
        };
        break;
      }

      case "buy_stock": {
        const index = body.index;
        const qty = body.qty || 1;
        if (typeof index !== "number" || index < 0 || index >= 8) {
          return new Response(JSON.stringify({ error: "Invalid stock index" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: stockPrice } = await supabase.from("stock_prices").select("current_price").eq("stock_index", index).single();
        if (!stockPrice) {
          return new Response(JSON.stringify({ error: "Stock not found" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const price = stockPrice.current_price;
        const feeRate = 0.05;
        const total = price * qty * (1 + feeRate);

        if (gold < total) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: holding } = await supabase.from("stock_holdings").select("shares, avg_buy_price").eq("user_id", userId).eq("stock_index", index).single();
        const oldShares = holding?.shares || 0;
        const oldAvg = holding?.avg_buy_price || 0;
        const newShares = oldShares + qty;
        const newAvg = oldShares > 0 ? ((oldShares * oldAvg) + (qty * price)) / newShares : price;

        await supabase.from("stock_holdings").upsert({user_id: userId, stock_index: index, shares: newShares, avg_buy_price: newAvg}, {onConflict: "user_id,stock_index"});
        await supabase.from("stock_trades").insert({user_id: userId, stock_index: index, type: "buy", quantity: qty, price: price, total: total});
        const newGold = gold - total;
        await supabase.from("game_state").upsert({user_id: userId, gold: newGold, total_gold: (state?.total_gold || 0) - total, total_gold_all_time: totalGoldAllTime, last_save: timestamp.toISOString()}, {onConflict: "user_id"});

        response = {success: true, action: "buy_stock", index: index, qty: qty, price: price, total: total, gold: newGold, shares: newShares, avg_buy_price: newAvg};
        break;
      }

      case "sell_stock": {
        const index = body.index;
        const qty = body.qty || 0;
        if (typeof index !== "number" || index < 0 || index >= 8) {
          return new Response(JSON.stringify({ error: "Invalid stock index" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: stockPrice } = await supabase.from("stock_prices").select("current_price").eq("stock_index", index).single();
        if (!stockPrice) {
          return new Response(JSON.stringify({ error: "Stock not found" }), {
            status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const price = stockPrice.current_price;
        const feeRate = 0.05;

        const { data: holding } = await supabase.from("stock_holdings").select("shares, avg_buy_price").eq("user_id", userId).eq("stock_index", index).single();
        const shares = holding?.shares || 0;

        if (shares < qty) {
          return new Response(JSON.stringify({ success: false, error: "Not enough shares" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const revenue = price * qty * (1 - feeRate);
        const newShares = shares - qty;
        const newAvg = newShares > 0 ? holding?.avg_buy_price || 0 : 0;

        await supabase.from("stock_holdings").upsert({user_id: userId, stock_index: index, shares: newShares, avg_buy_price: newAvg}, {onConflict: "user_id,stock_index"});
        await supabase.from("stock_trades").insert({user_id: userId, stock_index: index, type: "sell", quantity: qty, price: price, total: revenue});

        const newGold = gold + revenue;
        await supabase.from("game_state").upsert({user_id: userId, gold: newGold, total_gold: (state?.total_gold || 0) + revenue, total_gold_all_time: totalGoldAllTime, last_save: timestamp.toISOString()}, {onConflict: "user_id"});

        response = {success: true, action: "sell_stock", index: index, qty: qty, price: price, revenue: revenue, gold: newGold, shares: newShares, avg_buy_price: newAvg};
        break;
      }

      case "prestige": {
        // Check ob 10M Gold erreicht
        if (totalGoldAllTime < 1e7) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold for prestige (need 10M)" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newGems = calcPrestigeGems(totalGoldAllTime);
        const newPrestigeMultiplier = 1 + (state?.gems || 0) * 0.1;

        // Reset all
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: 0,
          total_gold: 0,
          total_gold_all_time: 0,
          gps: 0,
          click_power: 1,
          click_multiplier: 1,
          prestige_multiplier: newPrestigeMultiplier + newGems * 0.1,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        // Upgrades zurücksetzen
        await supabase.from("upgrades").delete().eq("user_id", userId);
        // Jobs zurücksetzen
        await supabase.from("jobs").delete().eq("user_id", userId);
        // Aktien zurücksetzen
        await supabase.from("stock_holdings").delete().eq("user_id", userId);

        response = {
          success: true,
          action: "prestige",
          new_gems: newGems,
          new_prestige_multiplier: newPrestigeMultiplier + newGems * 0.1,
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action", valid_actions: [
          "mine", "buy_click_upgrade", "buy_auto_upgrade", "buy_gem_upgrade",
          "start_job", "claim_job", "buy_stock", "sell_stock", "prestige"
        ] }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    return new Response(JSON.stringify(response), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Internal error", details: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
