function getPrestigeGems(){return Math.floor(totalGoldAllTime/1e7);}
function doPrestige(){
  SERVER.action('prestige').then(r=>{
    if(r&&r.success){
      gems=r.new_gems;prestigeMultiplier=r.new_prestige_multiplier;
      gold=0;totalGold=0;totalGoldAllTime=0;gps=0;clickPower=1;clickMultiplier=1;totalClicks=0;totalUpgradesBought=0;
      activeBoost=null;boostEnd=0;currentEvent=null;eventEnd=0;easter1M=false;easter1B=false;
      CLICK_UPGRADES.forEach(u=>u.count=0);AUTO_UPGRADES.forEach(u=>u.count=0);
      activeJobs={};jobCooldowns={};marketEvent=null;marketEventEnd=0;
      stockState.forEach(s=>{s.shares=0;s.avgBuy=0;s.trend=0;});
      initStocks();applyGemUpgrades();update();renderAll();switchTab('prestige');spawnParticles();
      ANALYTICS.trackPrestige(r.new_gems,0);
    }
  });
}
