// ===== STOCKS =====
function buyStock(i,qty){SERVER.action('buy_stock',{index:i,qty:qty}).then(r=>{if(r&&r.success){gold=r.gold;update();renderStocks();}});}
function sellStock(i,qty){SERVER.action('sell_stock',{index:i,qty:qty}).then(r=>{if(r&&r.success){gold=r.gold;update();renderStocks();}});}
function sellAllStock(i){SERVER.action('sell_stock',{index:i,qty:stockState[i].shares}).then(r=>{if(r&&r.success){gold=r.gold;update();renderStocks();}});}