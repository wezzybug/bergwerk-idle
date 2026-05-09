// ============================================
// Bergwerk Idle — POST /action
// Server-authoritativ: ALLE Game-Aktionen hier!
// Client schickt action+data, Server berechnet & speichert
// v2: Fixed GPS, jobs sync, gem upgrades, prestige
// ============================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-device-id",
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

// Helper: Batch-Kosten für n Upgrades ab aktuellem Count
function calcBatchUpgradeCost(base: number, mult: number, count: number, qty: number): number {
  let total = 0;
  for (let i = 0; i < qty; i++) {
    total += Math.floor(base * Math.pow(mult, count + i));
  }
  return total;
}

// Helper: berechne Job-Reward (GPS-scaled)
function calcJobReward(baseReward: number, gps: number, prestigeMultiplier: number, duration: number): number {
  const scaledGps = Math.max(1, 1 + Math.log10(Math.max(gps, 1)) * 0.5);
  return Math.floor(baseReward * scaledGps * prestigeMultiplier * (duration / 10));
}

// Helper: berechne Prestige-Gems
function calcPrestigeGems(totalGoldAllTime: number, currentGems: number): number {
  return Math.floor(Math.sqrt(totalGoldAllTime / 1e6));
}

// Helper: berechne Klick-Reward
function calcClickReward(clickPower: number, clickMultiplier: number, prestigeMultiplier: number): number {
  return Math.floor(clickPower * clickMultiplier * prestigeMultiplier);
}

// Helper: berechne GPS from auto upgrades
const AUTO_UPGRADES = [
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

const CLICK_UPGRADES = [
  { base: 15, mult: 1.55, power: 1 },
  { base: 120, mult: 1.55, power: 3 },
  { base: 1000, mult: 1.55, power: 10 },
  { base: 8000, mult: 1.55, power: 40 },
  { base: 75000, mult: 1.55, power: 200 },
  { base: 600000, mult: 1.55, power: 1000 },
];

const GEM_UPGRADES = [
  { base: 1, mult: 2, max: 10 },  // Klick-Multi
  { base: 1, mult: 2, max: 10 },  // GPS-Multi
  { base: 2, mult: 2, max: 5 },   // Offline-Eff
  { base: 3, mult: 2, max: 5 },   // Glück
];

const JOBS_DEF = [
  { id: "sweep", duration: 10, reward: 30, cooldown: 5 },
  { id: "haul", duration: 30, reward: 150, cooldown: 10 },
  { id: "explore", duration: 60, reward: 600, cooldown: 15 },
  { id: "boss", duration: 120, reward: 2500, cooldown: 20 },
  { id: "blast", duration: 240, reward: 10000, cooldown: 30 },
  { id: "excavate", duration: 600, reward: 50000, cooldown: 60 },
];

async function recalcGPS(supabase: any, userId: string): Promise<number> {
  const { data: upgrades } = await supabase
    .from("upgrades")
    .select("upgrade_index, count")
    .eq("user_id", userId)
    .eq("upgrade_type", "auto");

  let gps = 0;
  if (upgrades) {
    for (const u of upgrades) {
      if (AUTO_UPGRADES[u.upgrade_index]) {
        gps += AUTO_UPGRADES[u.upgrade_index].gps * u.count;
      }
    }
  }
  return gps;
}

async function recalcClickPower(supabase: any, userId: string): Promise<number> {
  const { data: upgrades } = await supabase
    .from("upgrades")
    .select("upgrade_index, count")
    .eq("user_id", userId)
    .eq("upgrade_type", "click");

  let clickPower = 1; // base
  if (upgrades) {
    for (const u of upgrades) {
      if (CLICK_UPGRADES[u.upgrade_index]) {
        clickPower += CLICK_UPGRADES[u.upgrade_index].power * u.count;
      }
    }
  }
  return clickPower;
}

async function recalcGemMultipliers(supabase: any, userId: string): Promise<{ clickMultiplier: number; gpsMultiplier: number }> {
  const { data: upgrades } = await supabase
    .from("upgrades")
    .select("upgrade_index, count")
    .eq("user_id", userId)
    .eq("upgrade_type", "gem");

  let clickMultiplier = 1;
  let gpsMultiplier = 1;
  if (upgrades) {
    for (const u of upgrades) {
      if (u.upgrade_index === 0) clickMultiplier += 0.5 * u.count; // Klick-Multi
      if (u.upgrade_index === 1) gpsMultiplier += 0.5 * u.count;  // GPS-Multi
    }
  }
  return { clickMultiplier, gpsMultiplier };
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
    const totalGold = state?.total_gold || 0;
    const totalClicks = state?.total_clicks || 0;
    const totalUpgradesBought = state?.total_upgrades_bought || 0;
    const gems = state?.gems || 0;

    // Action-Dispatcher
    let response: any;

    switch (action) {
      // ==================== MINE ====================
      case "mine": {
        const mineOk = await checkRateLimit(supabase, userId, "mine", 3000);
        if (!mineOk) {
          return new Response(JSON.stringify({ error: "Mine rate limit exceeded" }), {
            status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const reward = calcClickReward(clickPower, clickMultiplier, prestigeMultiplier);
        const newGold = gold + reward;
        const newTotalClicks = totalClicks + 1;

        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          total_gold: totalGold + reward,
          total_gold_all_time: totalGoldAllTime + reward,
          total_clicks: newTotalClicks,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        // Achievement checks
        if (newTotalClicks >= 10) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'click10' }, { onConflict: "user_id,achievement_id" });
        if (newTotalClicks >= 100) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'click100' }, { onConflict: "user_id,achievement_id" });
        if (newTotalClicks >= 1000) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'click1k' }, { onConflict: "user_id,achievement_id" });
        if (newTotalClicks >= 10000) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'click10k' }, { onConflict: "user_id,achievement_id" });
        if (totalGoldAllTime + reward >= 1000) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'gold1k' }, { onConflict: "user_id,achievement_id" });
        if (totalGoldAllTime + reward >= 1e6) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'gold1m' }, { onConflict: "user_id,achievement_id" });
        if (totalGoldAllTime + reward >= 1e7) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'gold10m' }, { onConflict: "user_id,achievement_id" });
        if (totalGoldAllTime + reward >= 1e9) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'gold1b' }, { onConflict: "user_id,achievement_id" });
        if (totalGoldAllTime + reward >= 1e12) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'gold1t' }, { onConflict: "user_id,achievement_id" });

        response = {
          success: true,
          action: "mine",
          reward,
          gold: newGold,
          total_gold: totalGold + reward,
          total_gold_all_time: totalGoldAllTime + reward,
          total_clicks: newTotalClicks,
        };
        break;
      }

      // ==================== CLICK UPGRADE (supports quantity) ====================
      case "buy_click_upgrade": {
        const index = body.data?.index ?? body.index;
        const qty = Math.min(body.data?.quantity ?? 1, 10000);
        if (typeof index !== "number" || index < 0 || index >= CLICK_UPGRADES.length) {
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
        const cost = calcBatchUpgradeCost(CLICK_UPGRADES[index].base, CLICK_UPGRADES[index].mult, count, qty);

        if (gold < cost) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newClickPower = clickPower + CLICK_UPGRADES[index].power * qty;
        const newUpgradeCount = count + qty;

        await supabase.from("upgrades").upsert({
          user_id: userId,
          upgrade_type: "click",
          upgrade_index: index,
          count: newUpgradeCount,
        }, { onConflict: "user_id,upgrade_type,upgrade_index" });

        const newGold = gold - cost;
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          click_power: newClickPower,
          total_upgrades_bought: totalUpgradesBought + qty,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        // Achievement check: total_upgrades_bought
        if ((totalUpgradesBought + qty) >= 50) await supabase.from("achievements").upsert({
          user_id: userId, achievement_id: 'upgrade50',
        }, { onConflict: "user_id,achievement_id" });

        response = {
          success: true,
          action: "buy_click_upgrade",
          index, quantity: qty, cost,
          gold: newGold,
          click_power: newClickPower,
          upgrade_count: newUpgradeCount,
        };
        break;
      }

      // ==================== AUTO UPGRADE (supports quantity) ====================
      case "buy_auto_upgrade": {
        const index = body.data?.index ?? body.index;
        const qty = Math.min(body.data?.quantity ?? 1, 10000);
        if (typeof index !== "number" || index < 0 || index >= AUTO_UPGRADES.length) {
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
        const cost = calcBatchUpgradeCost(AUTO_UPGRADES[index].base, AUTO_UPGRADES[index].mult, count, qty);

        if (gold < cost) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newUpgradeCount = count + qty;

        await supabase.from("upgrades").upsert({
          user_id: userId,
          upgrade_type: "auto",
          upgrade_index: index,
          count: newUpgradeCount,
        }, { onConflict: "user_id,upgrade_type,upgrade_index" });

        const newGps = await recalcGPS(supabase, userId);

        const newGold = gold - cost;
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          gps: newGps,
          total_upgrades_bought: totalUpgradesBought + qty,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        // Achievement check
        if ((totalUpgradesBought + qty) >= 50) await supabase.from("achievements").upsert({ user_id: userId, achievement_id: 'upgrade50' }, { onConflict: "user_id,achievement_id" });

        response = {
          success: true,
          action: "buy_auto_upgrade",
          index, quantity: qty, cost,
          gold: newGold,
          gps: newGps,
          upgrade_count: newUpgradeCount,
        };
        break;
      }

      // ==================== GEM UPGRADE ====================
      case "buy_gem_upgrade": {
        const index = body.data?.index ?? body.index;
        if (typeof index !== "number" || index < 0 || index >= GEM_UPGRADES.length) {
          return new Response(JSON.stringify({ error: "Invalid gem upgrade index" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const { data: upgrade } = await supabase
          .from("upgrades")
          .select("count")
          .eq("user_id", userId)
          .eq("upgrade_type", "gem")
          .eq("upgrade_index", index)
          .single();

        const count = upgrade?.count || 0;
        const maxCount = GEM_UPGRADES[index].max;

        if (count >= maxCount) {
          return new Response(JSON.stringify({ success: false, error: "Max level reached" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const cost = calcUpgradeCost(GEM_UPGRADES[index].base, GEM_UPGRADES[index].mult, count);

        if (gems < cost) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gems" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newUpgradeCount = count + 1;
        const newGems = gems - cost;

        await supabase.from("upgrades").upsert({
          user_id: userId,
          upgrade_type: "gem",
          upgrade_index: index,
          count: newUpgradeCount,
        }, { onConflict: "user_id,upgrade_type,upgrade_index" });

        // Recalculate gem multipliers
        const { clickMultiplier: newCm, gpsMultiplier: newGm } = await recalcGemMultipliers(supabase, userId);

        await supabase.from("game_state").upsert({
          user_id: userId,
          gems: newGems,
          click_multiplier: newCm,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true,
          action: "buy_gem_upgrade",
          index,
          cost,
          gems: newGems,
          click_multiplier: newCm,
          upgrade_count: newUpgradeCount,
        };
        break;
      }

      // ==================== START JOB ====================
      case "start_job": {
        const jobId = body.data?.job_id ?? body.job_id;
        if (!jobId || typeof jobId !== "string") {
          return new Response(JSON.stringify({ error: "job_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const job = JOBS_DEF.find(j => j.id === jobId);
        if (!job) {
          return new Response(JSON.stringify({ error: "Invalid job" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const jobIndex = JOBS_DEF.indexOf(job);
        const now = Date.now();

        // Check if already running
        const { data: existingJob } = await supabase
          .from("jobs")
          .select("status, start_time")
          .eq("user_id", userId)
          .eq("job_index", jobIndex)
          .single();

        if (existingJob && existingJob.status === "running") {
          const startTime = new Date(existingJob.start_time).getTime();
          const elapsed = now - startTime;
          if (elapsed < job.duration * 1000) {
            return new Response(JSON.stringify({ error: "Job already running", remaining: Math.ceil((job.duration * 1000 - elapsed) / 1000) }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }

        // Check cooldown
        if (existingJob && existingJob.start_time) {
          // cooldown check handled by client, server allows restart if time passed
        }

        await supabase.from("jobs").upsert({
          user_id: userId,
          job_index: jobIndex,
          start_time: new Date(now).toISOString(),
          duration_ms: job.duration * 1000,
          status: "running",
          count: 0,
        }, { onConflict: "user_id,job_index" });

        response = {
          success: true,
          action: "start_job",
          job_id: jobId,
          duration: job.duration,
          start_time: now,
        };
        break;
      }

      // ==================== CLAIM JOB ====================
      case "claim_job": {
        const jobId = body.data?.job_id ?? body.job_id;
        if (!jobId || typeof jobId !== "string") {
          return new Response(JSON.stringify({ error: "job_id required" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const job = JOBS_DEF.find(j => j.id === jobId);
        if (!job) {
          return new Response(JSON.stringify({ error: "Invalid job" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const jobIndex = JOBS_DEF.indexOf(job);

        const { data: jobData } = await supabase
          .from("jobs")
          .select("count, start_time, duration_ms, status")
          .eq("user_id", userId)
          .eq("job_index", jobIndex)
          .single();

        if (!jobData || jobData.status !== "running") {
          return new Response(JSON.stringify({ success: false, error: "No active job" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Check if job is done
        const startTime = new Date(jobData.start_time).getTime();
        const durationMs = jobData.duration_ms || job.duration * 1000;
        const now = Date.now();
        const elapsed = now - startTime;

        if (elapsed < durationMs) {
          return new Response(JSON.stringify({ success: false, error: "Job not done yet", remaining: Math.ceil((durationMs - elapsed) / 1000) }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const reward = calcJobReward(job.reward, gps, prestigeMultiplier, job.duration);
        const newGold = gold + reward;
        const newCount = (jobData.count || 0) + 1;
        const cooldownEnd = new Date(now + job.cooldown * 1000).toISOString();

        await supabase.from("jobs").upsert({
          user_id: userId,
          job_index: jobIndex,
          count: newCount,
          status: "cooldown",
          start_time: null,
          duration_ms: null,
          cooldown_end: cooldownEnd,
        }, { onConflict: "user_id,job_index" });

        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: newGold,
          total_gold: totalGold + reward,
          total_gold_all_time: totalGoldAllTime + reward,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true,
          action: "claim_job",
          job_id: jobId,
          reward,
          gold: newGold,
          total_gold: totalGold + reward,
          total_gold_all_time: totalGoldAllTime + reward,
          cooldown_end: cooldownEnd,
        };
        break;
      }

      // ==================== BUY STOCK ====================
      case "buy_stock": {
        const index = body.data?.index ?? body.index;
        const qty = (body.data?.qty ?? body.qty) || 1;
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

        await supabase.from("stock_holdings").upsert({
          user_id: userId, stock_index: index, shares: newShares, avg_buy_price: newAvg,
        }, { onConflict: "user_id,stock_index" });

        await supabase.from("stock_trades").insert({
          user_id: userId, stock_index: index, type: "buy", quantity: qty, price, total,
        });

        const newGold = gold - total;
        await supabase.from("game_state").upsert({
          user_id: userId, gold: newGold, last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true, action: "buy_stock", index, qty, price, total,
          gold: newGold, shares: newShares, avg_buy_price: newAvg,
        };
        break;
      }

      // ==================== SELL STOCK ====================
      case "sell_stock": {
        const index = body.data?.index ?? body.index;
        const qty = (body.data?.qty ?? body.qty) || 0;
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
        const newAvg = newShares > 0 ? (holding?.avg_buy_price || 0) : 0;

        await supabase.from("stock_holdings").upsert({
          user_id: userId, stock_index: index, shares: newShares, avg_buy_price: newAvg,
        }, { onConflict: "user_id,stock_index" });

        await supabase.from("stock_trades").insert({
          user_id: userId, stock_index: index, type: "sell", quantity: qty, price, total: revenue,
        });

        const newGold = gold + revenue;
        await supabase.from("game_state").upsert({
          user_id: userId, gold: newGold,
          total_gold: totalGold + revenue,
          total_gold_all_time: totalGoldAllTime + revenue,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        response = {
          success: true, action: "sell_stock", index, qty, price, revenue,
          gold: newGold, shares: newShares, avg_buy_price: newAvg,
          total_gold: totalGold + revenue, total_gold_all_time: totalGoldAllTime + revenue,
        };
        break;
      }

      // ==================== BUY BOOST (gold → temp boost) ====================
      case "buy_boost": {
        const boostType = body.data?.boost_type ?? body.boost_type;
        let boostCost = 0;
        let boostDuration = 0;
        let boostEffect = "";

        switch (boostType) {
          case "gps_2h": boostCost = 100000; boostDuration = 7200; boostEffect = "auto"; break;
          case "click_1h": boostCost = 50000; boostDuration = 3600; boostEffect = "click"; break;
          case "lucky": {
            if (gold < 1000) {
              return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
                status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
              });
            }
            const luckyBonus = Math.floor(Math.random() * 49500) + 500;
            const newGold = gold - 1000 + luckyBonus;
            await supabase.from("game_state").upsert({
              user_id: userId, gold: newGold, last_save: timestamp.toISOString(),
            }, { onConflict: "user_id" });
            response = { success: true, action: "buy_boost", reward: luckyBonus, gold: newGold };
            break;
          }
          default:
            return new Response(JSON.stringify({ error: "Unknown boost type" }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }

        if (boostType !== "lucky") {
          if (gold < boostCost) {
            return new Response(JSON.stringify({ success: false, error: "Not enough gold" }), {
              status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
          const newGold = gold - boostCost;
          const boostEnd = new Date(Date.now() + boostDuration * 1000);
          await supabase.from("game_state").upsert({
            user_id: userId, gold: newGold,
            active_boost: boostEffect, boost_end: boostEnd.toISOString(),
            last_save: timestamp.toISOString(),
          }, { onConflict: "user_id" });
          response = {
            success: true, action: "buy_boost",
            boost: boostEffect, boost_end: boostEnd.getTime(),
            gold: newGold,
          };
        }
        break;
      }

      // ==================== PRESTIGE ====================
      case "prestige": {
        if (totalGoldAllTime < 1e7) {
          return new Response(JSON.stringify({ success: false, error: "Not enough gold for prestige (need 10M total)" }), {
            status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const newGems = calcPrestigeGems(totalGoldAllTime, gems);
        const totalGems = gems + newGems;
        const newPrestigeMultiplier = 1 + totalGems * 0.1;

        // Full reset
        await supabase.from("game_state").upsert({
          user_id: userId,
          gold: 0,
          total_gold: 0,
          total_gold_all_time: 0,
          gps: 0,
          click_power: 1,
          click_multiplier: 1,
          prestige_multiplier: newPrestigeMultiplier,
          gems: totalGems,
          total_clicks: 0,
          total_upgrades_bought: 0,
          last_save: timestamp.toISOString(),
        }, { onConflict: "user_id" });

        // Reset upgrades
        await supabase.from("upgrades").delete().eq("user_id", userId);
        // Reset jobs
        await supabase.from("jobs").delete().eq("user_id", userId);
        // Reset stock holdings
        await supabase.from("stock_holdings").delete().eq("user_id", userId);

        response = {
          success: true,
          action: "prestige",
          new_gems: totalGems,
          new_prestige_multiplier: newPrestigeMultiplier,
          total_gold_all_time: 0,
        };
        break;
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action", valid_actions: [
          "mine", "buy_click_upgrade", "buy_auto_upgrade", "buy_gem_upgrade", "buy_boost",
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