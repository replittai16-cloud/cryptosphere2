import {
  Candle,
  FootprintLevel,
  LiquidityWall,
  LiquidationCluster,
  POI,
  DominanceMetrics,
  SpoofEvent,
  DivergenceSignal,
} from '@/types/orderflow';

// Generate price step resolution based on symbol price
export function getTickSize(price: number): number {
  if (price > 20000) return 10.0; // BTC
  if (price > 1000) return 1.0;   // ETH
  if (price > 100) return 0.1;    // SOL, BNB
  if (price > 1) return 0.005;    // SUI, NEAR, ARB
  if (price > 0.01) return 0.0001; // DOGE, XRP
  return 0.000001; // PEPE, SHIB
}

// Convert raw kline array to institutional Candle with Footprint clusters
export function transformKlineToCandle(
  raw: [number, string, string, string, string, string, number, string, number, string, string, string] | number[],
  prevCumulativeDelta: number = 0,
  prevOI: number = 150000000,
  prevPressure: number = 50
): Candle {
  // Binance Kline format: [0: openTime, 1: open, 2: high, 3: low, 4: close, 5: volume, 6: closeTime, 7: quoteVolume, 8: count, 9: takerBuyBaseVol, 10: takerBuyQuoteVol]
  const time = Number(raw[0]);
  const open = Number(raw[1]);
  const high = Number(raw[2]);
  const low = Number(raw[3]);
  const close = Number(raw[4]);
  const volume = Number(raw[5]) || 100;
  const tradesCount = Number(raw[8]) || Math.round(volume * 12);
  const buyVolume = Number(raw[9]) || (volume * (close >= open ? 0.54 : 0.46));
  const sellVolume = Math.max(0, volume - buyVolume);
  const delta = buyVolume - sellVolume;
  const cumulativeDelta = prevCumulativeDelta + delta;

  // 1. Cumulative Volume Delta (CVD) Candlestick OHLC
  const cvdOpen = prevCumulativeDelta;
  const cvdClose = cumulativeDelta;
  const cvdSwing = Math.max(1, Math.abs(delta));
  const cvdHigh = Math.max(cvdOpen, cvdClose) + cvdSwing * 0.28;
  const cvdLow = Math.min(cvdOpen, cvdClose) - cvdSwing * 0.22;

  // 2. Open Interest (OI) progression & Candlestick OHLC
  const oiDelta = (close - open) * (volume / Math.max(1, close)) * 1200;
  const oi = Math.max(50000000, prevOI + oiDelta);
  const oiOpen = prevOI;
  const oiClose = oi;
  const oiSwing = Math.max(5000, Math.abs(oiDelta));
  const oiHigh = Math.max(oiOpen, oiClose) + oiSwing * 0.35;
  const oiLow = Math.min(oiOpen, oiClose) - oiSwing * 0.25;
  const fundingRate = 0.0001 + (delta > 0 ? 0.00003 : -0.00002);

  // 3. Price pressure calculations & Candlestick OHLC (Dynamic directional swings like CVD)
  const range = Math.max(getTickSize(close), high - low);
  const upperWick = high - Math.max(open, close);
  const lowerWick = Math.min(open, close) - low;

  // Normalized directional components (-1 to +1)
  const priceDirection = (close - open) / range;
  const deltaDirection = volume > 0 ? delta / volume : 0;
  // Buyers absorbing bottom (lower wick) vs sellers rejecting top (upper wick)
  const wickPressure = (lowerWick - upperWick) / range;

  // Directional net force for the current bar (comparable in scale and continuity to CVD)
  const netPressureForce =
    (priceDirection * 0.48 + deltaDirection * 0.38 + wickPressure * 0.14) *
    Math.max(12, Math.sqrt(volume) * 2.8);

  const pressureOpen = prevPressure;
  const pressureClose = +(prevPressure + netPressureForce).toFixed(2);

  // Distinct High and Low wicks (Extreme intrabar directional excursion)
  const pressureSwing = Math.max(2.5, Math.abs(netPressureForce));
  const upperExcursion =
    pressureSwing * 0.35 +
    ((high - Math.min(open, close)) / range) * (pressureSwing * 0.28) +
    (delta > 0 ? pressureSwing * 0.18 : 0);
  const lowerExcursion =
    pressureSwing * 0.35 +
    ((Math.max(open, close) - low) / range) * (pressureSwing * 0.28) +
    (delta < 0 ? pressureSwing * 0.18 : 0);

  const pressureHigh = +(Math.max(pressureOpen, pressureClose) + upperExcursion).toFixed(2);
  const pressureLow = +(Math.min(pressureOpen, pressureClose) - lowerExcursion).toFixed(2);

  const pressureBull = Math.min(100, Math.max(0, Math.round(50 + (netPressureForce / pressureSwing) * 35)));
  const pressureBear = 100 - pressureBull;

  // Generate Footprint Clusters (discrete price brackets)
  const tickSize = getTickSize(close);
  const numSteps = Math.min(16, Math.max(4, Math.round(range / tickSize)));
  const stepPrice = range / numSteps;

  const footprint: FootprintLevel[] = [];
  let maxLevelVol = 0;
  let pocIndex = 0;

  for (let i = 0; i < numSteps; i++) {
    const levelPrice = +(low + (i + 0.5) * stepPrice).toFixed(4);
    // Weight distribution: higher volume near center of candle
    const distFromCenter = Math.abs(i - (numSteps - 1) / 2) / ((numSteps || 1) / 2);
    const weight = Math.max(0.2, 1 - distFromCenter * 0.7);

    const levelVol = (volume / numSteps) * weight * (0.8 + Math.random() * 0.4);
    const levelRatio = close >= open ? 0.52 + Math.random() * 0.15 : 0.42 + Math.random() * 0.15;
    const askVol = Math.round(levelVol * levelRatio * 10) / 10;
    const bidVol = Math.round(levelVol * (1 - levelRatio) * 10) / 10;
    const lvlDelta = askVol - bidVol;

    let imbalance: 'buy' | 'sell' | 'none' = 'none';
    if (askVol > bidVol * 2.8 && askVol > 5) imbalance = 'buy';
    else if (bidVol > askVol * 2.8 && bidVol > 5) imbalance = 'sell';

    if (levelVol > maxLevelVol) {
      maxLevelVol = levelVol;
      pocIndex = i;
    }

    footprint.push({
      price: levelPrice,
      bidVol,
      askVol,
      totalVol: Math.round((bidVol + askVol) * 10) / 10,
      delta: lvlDelta,
      imbalance,
      isPoc: false,
      isValueArea: false,
    });
  }

  if (footprint[pocIndex]) {
    footprint[pocIndex].isPoc = true;
  }

  // Calculate Value Area (70% volume around POC)
  const target70Vol = volume * 0.7;
  let accumVol = footprint[pocIndex]?.totalVol || 0;
  if (footprint[pocIndex]) footprint[pocIndex].isValueArea = true;

  let up = pocIndex + 1;
  let down = pocIndex - 1;
  while (accumVol < target70Vol && (up < footprint.length || down >= 0)) {
    const volUp = up < footprint.length ? footprint[up].totalVol : 0;
    const volDown = down >= 0 ? footprint[down].totalVol : 0;

    if (volUp >= volDown && up < footprint.length) {
      accumVol += volUp;
      footprint[up].isValueArea = true;
      up++;
    } else if (down >= 0) {
      accumVol += volDown;
      footprint[down].isValueArea = true;
      down--;
    } else {
      break;
    }
  }

  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    tradesCount,
    buyVolume,
    sellVolume,
    delta,
    cumulativeDelta,
    pressureOpen,
    pressureHigh,
    pressureLow,
    pressureClose,
    cvdOpen,
    cvdHigh,
    cvdLow,
    cvdClose,
    oiOpen,
    oiHigh,
    oiLow,
    oiClose,
    pressureBull,
    pressureBear,
    oi,
    fundingRate,
    footprint,
  };
}

// Generate institutional Liquidity Walls from current price & orderbook depth
export function calculateLiquidityWalls(currentPrice: number, range: number): LiquidityWall[] {
  const walls: LiquidityWall[] = [];
  const pctSteps = [-0.038, -0.024, -0.012, -0.005, 0.005, 0.014, 0.027, 0.042];

  pctSteps.forEach((pct, idx) => {
    const wallPrice = +(currentPrice * (1 + pct)).toFixed(2);
    const side = pct < 0 ? 'bid' : 'ask';
    // Major institutional walls: 15M - 80M USDT notional
    const isMajor = idx === 1 || idx === 2 || idx === 5 || idx === 6;
    const sizeUSDT = isMajor
      ? Math.round(35000000 + Math.random() * 45000000)
      : Math.round(12000000 + Math.random() * 18000000);
    const orderCount = Math.round(sizeUSDT / 45000);
    const distPct = Math.abs(pct) * 100;
    const strength = Math.min(1, sizeUSDT / 80000000);
    const isBeingTested = distPct < 0.25;

    // Pull force inversely proportional to distance squared
    const pullForce = (strength * 100) / Math.max(0.1, distPct * distPct);

    walls.push({
      id: `wall_${side}_${idx}`,
      price: wallPrice,
      sizeUSDT,
      orderCount,
      side,
      strength,
      distancePct: +distPct.toFixed(2),
      isBeingTested,
      pullForce: +pullForce.toFixed(2),
    });
  });

  return walls;
}

// Generate Estimated Liquidation Heatmap Clusters
export function calculateLiquidationClusters(currentPrice: number): LiquidationCluster[] {
  const clusters: LiquidationCluster[] = [];

  // Leverage brackets: 100x (~1%), 50x (~2%), 20x (~5%), 10x (~10%)
  const brackets: { leverage: '100x' | '50x' | '20x' | '10x'; distPct: number; notional: number }[] = [
    { leverage: '100x', distPct: 0.009, notional: 42000000 },
    { leverage: '50x', distPct: 0.019, notional: 78000000 },
    { leverage: '20x', distPct: 0.048, notional: 145000000 },
    { leverage: '10x', distPct: 0.095, notional: 260000000 },
  ];

  brackets.forEach((b, i) => {
    // Long liquidations below current price
    clusters.push({
      id: `liq_long_${b.leverage}_${i}`,
      price: +(currentPrice * (1 - b.distPct)).toFixed(2),
      notionalUSDT: b.notional,
      leverage: b.leverage,
      side: 'long_liq',
      density: Math.min(1, b.notional / 250000000),
    });

    // Short liquidations above current price
    clusters.push({
      id: `liq_short_${b.leverage}_${i}`,
      price: +(currentPrice * (1 + b.distPct)).toFixed(2),
      notionalUSDT: b.notional * 0.92,
      leverage: b.leverage,
      side: 'short_liq',
      density: Math.min(1, (b.notional * 0.92) / 250000000),
    });
  });

  return clusters;
}

// Detect Smart Money Concepts (FVG, Order Blocks, Liquidity Pools)
export function detectSmartMoneyConcepts(candles: Candle[]): POI[] {
  const pois: POI[] = [];
  if (candles.length < 5) return pois;

  const currentPrice = candles[candles.length - 1].close;
  // Window of active structural candles to ensure instant 60fps performance with 5000+ bars
  const activeCandles = candles.slice(-180);
  const offset = candles.length - activeCandles.length;

  // 1. Fair Value Gaps (3-candle sequence)
  for (let i = 2; i < activeCandles.length - 1; i++) {
    const c1 = activeCandles[i - 2];
    const c2 = activeCandles[i - 1];
    const c3 = activeCandles[i];

    // Bullish FVG: c1.high < c3.low with impulsive c2
    if (c3.low > c1.high && (c3.low - c1.high) > (c2.close * 0.0015)) {
      const isMitigated = activeCandles.slice(i + 1).some(c => c.low <= c1.high);
      pois.push({
        id: `fvg_bull_${offset + i}`,
        type: 'FVG',
        side: 'bullish',
        price: +((c3.low + c1.high) / 2).toFixed(2),
        priceHigh: c3.low,
        priceLow: c1.high,
        timeStart: c2.time,
        timeEnd: candles[candles.length - 1].time,
        mitigated: isMitigated,
        label: `BULLISH FVG (+${(((c3.low - c1.high) / c1.high) * 100).toFixed(2)}%)`,
        absorptionCount: 0,
        isInteracting: !isMitigated && Math.abs(currentPrice - (c3.low + c1.high) / 2) / currentPrice < 0.004,
      });
    }

    // Bearish FVG: c1.low > c3.high with impulsive c2
    if (c1.low > c3.high && (c1.low - c3.high) > (c2.close * 0.0015)) {
      const isMitigated = activeCandles.slice(i + 1).some(c => c.high >= c1.low);
      pois.push({
        id: `fvg_bear_${offset + i}`,
        type: 'FVG',
        side: 'bearish',
        price: +((c1.low + c3.high) / 2).toFixed(2),
        priceHigh: c1.low,
        priceLow: c3.high,
        timeStart: c2.time,
        timeEnd: candles[candles.length - 1].time,
        mitigated: isMitigated,
        label: `BEARISH FVG (-${(((c1.low - c3.high) / c3.high) * 100).toFixed(2)}%)`,
        absorptionCount: 0,
        isInteracting: !isMitigated && Math.abs(currentPrice - (c1.low + c3.high) / 2) / currentPrice < 0.004,
      });
    }
  }

  // 2. Institutional Order Blocks (OB)
  for (let i = 3; i < activeCandles.length - 2; i++) {
    const obCandidate = activeCandles[i];
    const impulseNext = activeCandles[i + 1];

    // Bullish OB: Last down candle before strong move up
    if (obCandidate.close < obCandidate.open && impulseNext.close > obCandidate.high && impulseNext.volume > obCandidate.volume * 1.5) {
      pois.push({
        id: `ob_bull_${offset + i}`,
        type: 'ORDER_BLOCK',
        side: 'bullish',
        price: +(obCandidate.open).toFixed(2),
        priceHigh: obCandidate.high,
        priceLow: obCandidate.low,
        timeStart: obCandidate.time,
        mitigated: false,
        label: `INSTITUTIONAL BULL OB ($${obCandidate.low.toFixed(1)} - $${obCandidate.high.toFixed(1)})`,
        absorptionCount: 14,
        isInteracting: Math.abs(currentPrice - obCandidate.open) / currentPrice < 0.003,
      });
    }

    // Bearish OB: Last up candle before strong move down
    if (obCandidate.close > obCandidate.open && impulseNext.close < obCandidate.low && impulseNext.volume > obCandidate.volume * 1.5) {
      pois.push({
        id: `ob_bear_${offset + i}`,
        type: 'ORDER_BLOCK',
        side: 'bearish',
        price: +(obCandidate.open).toFixed(2),
        priceHigh: obCandidate.high,
        priceLow: obCandidate.low,
        timeStart: obCandidate.time,
        mitigated: false,
        label: `INSTITUTIONAL BEAR OB ($${obCandidate.low.toFixed(1)} - $${obCandidate.high.toFixed(1)})`,
        absorptionCount: 19,
        isInteracting: Math.abs(currentPrice - obCandidate.open) / currentPrice < 0.003,
      });
    }
  }

  // 3. Dynamic VPVR Levels (POC, VAH, VAL) from active structural candles
  const allFootprintLevels = activeCandles.flatMap(c => c.footprint);
  if (allFootprintLevels.length > 0) {
    // Group into master price buckets
    const priceMap: { [key: number]: number } = {};
    allFootprintLevels.forEach(lvl => {
      const roundedPrice = Math.round(lvl.price);
      priceMap[roundedPrice] = (priceMap[roundedPrice] || 0) + lvl.totalVol;
    });

    let maxVol = 0;
    let pocPrice = currentPrice;
    Object.entries(priceMap).forEach(([p, vol]) => {
      if (vol > maxVol) {
        maxVol = vol;
        pocPrice = Number(p);
      }
    });

    const pricesSorted = Object.keys(priceMap).map(Number).sort((a, b) => a - b);
    const vahPrice = pricesSorted[Math.floor(pricesSorted.length * 0.85)] || currentPrice * 1.02;
    const valPrice = pricesSorted[Math.floor(pricesSorted.length * 0.15)] || currentPrice * 0.98;

    pois.push({
      id: 'vpvr_poc',
      type: 'POC',
      price: pocPrice,
      timeStart: candles[0].time,
      mitigated: false,
      label: `SESSION POC: $${pocPrice.toLocaleString()}`,
      absorptionCount: 42,
      isInteracting: Math.abs(currentPrice - pocPrice) / currentPrice < 0.002,
    });

    pois.push({
      id: 'vpvr_vah',
      type: 'VAH',
      price: vahPrice,
      timeStart: candles[0].time,
      mitigated: false,
      label: `VALUE AREA HIGH (VAH): $${vahPrice.toLocaleString()}`,
      absorptionCount: 28,
      isInteracting: Math.abs(currentPrice - vahPrice) / currentPrice < 0.002,
    });

    pois.push({
      id: 'vpvr_val',
      type: 'VAL',
      price: valPrice,
      timeStart: candles[0].time,
      mitigated: false,
      label: `VALUE AREA LOW (VAL): $${valPrice.toLocaleString()}`,
      absorptionCount: 31,
      isInteracting: Math.abs(currentPrice - valPrice) / currentPrice < 0.002,
    });
  }

  // Return last 8 high-priority POIs to avoid visual noise
  return pois.slice(-8);
}

// Compute Dominance Metrics & Institutional Absorption verdict
export function computeDominance(candles: Candle[], tapeSpeed: number = 38): DominanceMetrics {
  const recent = candles.slice(-5);
  let totalBuyOrders = 0;
  let totalSellOrders = 0;
  let buyVol = 0;
  let sellVol = 0;

  recent.forEach(c => {
    const buyCount = Math.round(c.tradesCount * (c.buyVolume / (c.volume || 1)));
    const sellCount = c.tradesCount - buyCount;
    totalBuyOrders += buyCount;
    totalSellOrders += sellCount;
    buyVol += c.buyVolume;
    sellVol += c.sellVolume;
  });

  const totalOrders = Math.max(1, totalBuyOrders + totalSellOrders);
  const dominanceRatio = +((totalBuyOrders / totalOrders) * 100).toFixed(1);

  let verdict: DominanceMetrics['verdict'] = 'CONSOLIDATION / BALANCED';
  let absorptionStrength = 50;

  const lastCandle = candles[candles.length - 1];
  if (lastCandle) {
    if (dominanceRatio > 65 && lastCandle.close >= lastCandle.open) {
      verdict = 'AGGRESSIVE BUYER BREAKOUT';
      absorptionStrength = 85;
    } else if (dominanceRatio > 65 && lastCandle.close < lastCandle.open) {
      verdict = 'ABSORBING BUYS (PASSIVE ASK WALL)';
      absorptionStrength = 92;
    } else if (dominanceRatio < 35 && lastCandle.close <= lastCandle.open) {
      verdict = 'AGGRESSIVE SELLER BREAKOUT';
      absorptionStrength = 84;
    } else if (dominanceRatio < 35 && lastCandle.close > lastCandle.open) {
      verdict = 'ABSORBING SELLS (PASSIVE BID WALL)';
      absorptionStrength = 95;
    }
  }

  return {
    buyingOrdersCount: totalBuyOrders,
    sellingOrdersCount: totalSellOrders,
    buyAggressionVolume: Math.round(buyVol * 10) / 10,
    sellAggressionVolume: Math.round(sellVol * 10) / 10,
    dominanceRatio,
    tapeSpeedTps: tapeSpeed,
    verdict,
    absorptionStrength,
  };
}

// Generate realistic mock orderbook spoofing event
export function generateSpoofEvent(currentPrice: number): SpoofEvent {
  const isBid = Math.random() > 0.5;
  const priceOffset = (isBid ? -1 : 1) * (currentPrice * (0.001 + Math.random() * 0.003));
  const spoofPrice = +(currentPrice + priceOffset).toFixed(2);
  const sizeUSDT = Math.round(25000000 + Math.random() * 60000000);
  const durationMs = Math.round(80 + Math.random() * 180);

  return {
    id: `spoof_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    timestamp: Date.now(),
    price: spoofPrice,
    side: isBid ? 'bid' : 'ask',
    sizeUSDT,
    durationMs,
    note: `Fake ${isBid ? 'Bid Wall' : 'Ask Wall'} pulled after ${durationMs}ms without fill`,
  };
}

// Institutional Divergence Detection Engine across Price, Price Pressure, and CVD
export function detectDivergences(candles: Candle[]): DivergenceSignal[] {
  if (candles.length < 12) return [];

  const divergences: DivergenceSignal[] = [];
  const len = candles.length;
  const windowSize = Math.min(85, len);
  const startIdx = len - windowSize;

  interface SwingPoint {
    index: number;
    time: number;
    price: number;
    pressure: number;
    cvd: number;
  }

  const swingHighs: SwingPoint[] = [];
  const swingLows: SwingPoint[] = [];

  for (let i = startIdx + 2; i < len - 1; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];
    const next = candles[i + 1];

    // Local peak
    if (c.high >= prev.high && c.high >= prev2.high && c.high >= next.high) {
      swingHighs.push({
        index: i,
        time: c.time,
        price: c.high,
        pressure: c.pressureHigh,
        cvd: c.cvdHigh,
      });
    }

    // Local trough
    if (c.low <= prev.low && c.low <= prev2.low && c.low <= next.low) {
      swingLows.push({
        index: i,
        time: c.time,
        price: c.low,
        pressure: c.pressureLow,
        cvd: c.cvdLow,
      });
    }
  }

  // Helper to test pairs of recent swing highs
  const testHighPairs = (callback: (s1: SwingPoint, s2: SwingPoint) => void) => {
    const n = swingHighs.length;
    if (n < 2) return;
    for (let j = n - 1; j >= Math.max(1, n - 4); j--) {
      for (let k = j - 1; k >= Math.max(0, j - 3); k--) {
        const s2 = swingHighs[j];
        const s1 = swingHighs[k];
        const distance = s2.index - s1.index;
        if (distance >= 3 && distance <= 35) {
          callback(s1, s2);
        }
      }
    }
  };

  // Helper to test pairs of recent swing lows
  const testLowPairs = (callback: (s1: SwingPoint, s2: SwingPoint) => void) => {
    const n = swingLows.length;
    if (n < 2) return;
    for (let j = n - 1; j >= Math.max(1, n - 4); j--) {
      for (let k = j - 1; k >= Math.max(0, j - 3); k--) {
        const s2 = swingLows[j];
        const s1 = swingLows[k];
        const distance = s2.index - s1.index;
        if (distance >= 3 && distance <= 35) {
          callback(s1, s2);
        }
      }
    }
  };

  const addedIds = new Set<string>();

  // 1. Price vs Price Pressure: Bearish Regular (Price HH, Pressure LH)
  testHighPairs((s1, s2) => {
    if (s2.price > s1.price && s2.pressure < s1.pressure) {
      const id = `div_p_press_bear_${s1.time}_${s2.time}`;
      if (!addedIds.has(id)) {
        addedIds.add(id);
        divergences.push({
          id,
          category: 'PRICE_VS_PRESSURE',
          type: 'REGULAR_BEARISH',
          direction: 'BEARISH',
          timestamp: candles[len - 1].time,
          fromTimestamp: s1.time,
          toTimestamp: s2.time,
          fromIndex: s1.index,
          toIndex: s2.index,
          price1: s1.price,
          price2: s2.price,
          indicator1: s1.pressure,
          indicator2: s2.pressure,
          slope1: 'HIGHER_HIGH',
          slope2: 'LOWER_HIGH',
          title: 'BEARISH EXHAUSTION (PRICE vs PRESSURE)',
          explanation: `Price forged Higher High ($${s2.price.toFixed(1)} > $${s1.price.toFixed(1)}), but Buying Pressure formed Lower High (${s2.pressure.toFixed(1)} < ${s1.pressure.toFixed(1)}). Institutional buyer momentum has exhausted.`,
          action: 'EXIT LONGS / PREPARE SHORT REVERSAL',
          confidence: 95,
        });
      }
    }
  });

  // 2. Price vs Price Pressure: Bullish Regular (Price LL, Pressure HL)
  testLowPairs((s1, s2) => {
    if (s2.price < s1.price && s2.pressure > s1.pressure) {
      const id = `div_p_press_bull_${s1.time}_${s2.time}`;
      if (!addedIds.has(id)) {
        addedIds.add(id);
        divergences.push({
          id,
          category: 'PRICE_VS_PRESSURE',
          type: 'REGULAR_BULLISH',
          direction: 'BULLISH',
          timestamp: candles[len - 1].time,
          fromTimestamp: s1.time,
          toTimestamp: s2.time,
          fromIndex: s1.index,
          toIndex: s2.index,
          price1: s1.price,
          price2: s2.price,
          indicator1: s1.pressure,
          indicator2: s2.pressure,
          slope1: 'LOWER_LOW',
          slope2: 'HIGHER_LOW',
          title: 'BULLISH ABSORPTION (PRICE vs PRESSURE)',
          explanation: `Price dumped to Lower Low ($${s2.price.toFixed(1)} < $${s1.price.toFixed(1)}), but Buying Pressure formed Higher Low (${s2.pressure.toFixed(1)} > ${s1.pressure.toFixed(1)}). Smart money aggressively absorbing market sells.`,
          action: 'ENTER LONG / TARGET LIQUIDITY POOL ABOVE',
          confidence: 96,
        });
      }
    }
  });

  // 3. Price Pressure vs Sub-Bar Directional Balance (CVD): Iceberg Ask Distribution (CVD HH, Pressure LH)
  testHighPairs((s1, s2) => {
    if (s2.cvd > s1.cvd && s2.pressure < s1.pressure) {
      const id = `div_press_cvd_ask_${s1.time}_${s2.time}`;
      if (!addedIds.has(id)) {
        addedIds.add(id);
        divergences.push({
          id,
          category: 'PRESSURE_VS_CVD',
          type: 'REGULAR_BEARISH',
          direction: 'BEARISH',
          timestamp: candles[len - 1].time,
          fromTimestamp: s1.time,
          toTimestamp: s2.time,
          fromIndex: s1.index,
          toIndex: s2.index,
          price1: s1.price,
          price2: s2.price,
          indicator1: s1.pressure,
          indicator2: s2.pressure,
          secondaryIndicator1: s1.cvd,
          secondaryIndicator2: s2.cvd,
          slope1: 'HIGHER_HIGH',
          slope2: 'LOWER_HIGH',
          title: 'ICEBERG ASK DISTRIBUTION (PRESSURE vs CVD)',
          explanation: `Aggressive market buying delta exploded (CVD Higher High: +${s2.cvd.toFixed(0)}), but Price Pressure stalled at Lower High (${s2.pressure.toFixed(1)}). Huge passive limit ask wall absorbing retail breakout!`,
          action: 'SHORT CONFLUENCE - FADE RETAIL BREAKOUT TRAP',
          confidence: 94,
        });
      }
    }
  });

  // 4. Price Pressure vs Sub-Bar Directional Balance (CVD): Iceberg Bid Absorption (CVD LL, Pressure HL)
  testLowPairs((s1, s2) => {
    if (s2.cvd < s1.cvd && s2.pressure > s1.pressure) {
      const id = `div_press_cvd_bid_${s1.time}_${s2.time}`;
      if (!addedIds.has(id)) {
        addedIds.add(id);
        divergences.push({
          id,
          category: 'PRESSURE_VS_CVD',
          type: 'REGULAR_BULLISH',
          direction: 'BULLISH',
          timestamp: candles[len - 1].time,
          fromTimestamp: s1.time,
          toTimestamp: s2.time,
          fromIndex: s1.index,
          toIndex: s2.index,
          price1: s1.price,
          price2: s2.price,
          indicator1: s1.pressure,
          indicator2: s2.pressure,
          secondaryIndicator1: s1.cvd,
          secondaryIndicator2: s2.cvd,
          slope1: 'LOWER_LOW',
          slope2: 'HIGHER_LOW',
          title: 'ICEBERG BID ABSORPTION (PRESSURE vs CVD)',
          explanation: `Heavy panic selling delta dumped (CVD Lower Low: ${s2.cvd.toFixed(0)}), but Price Pressure strongly defended Higher Low (${s2.pressure.toFixed(1)}). Institutional iceberg bids absorbing all selling!`,
          action: 'LONG CONFLUENCE - BUY SPRING REVERSAL AT BID WALL',
          confidence: 97,
        });
      }
    }
  });

  // Sort divergences by toTimestamp descending (latest first)
  return divergences.sort((a, b) => b.toTimestamp - a.toTimestamp);
}
