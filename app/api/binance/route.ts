import { NextRequest, NextResponse } from 'next/server';

const BINANCE_FAPI_BASE = 'https://fapi.binance.com';
const BINANCE_SPOT_BASE = 'https://api.binance.com';
const CRYPTO_INCEPTION_MS = 1501545600000; // August 1, 2017 (Binance Spot Genesis)

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'klines';
  const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  const rawInterval = searchParams.get('interval') || '15m';
  const interval = rawInterval === '1Y' ? '1M' : rawInterval;
  const limit = searchParams.get('limit') || '1000';
  const startTime = searchParams.get('startTime');
  const endTime = searchParams.get('endTime');
  const source = searchParams.get('source');

  try {
    // 1. ALL KLINES / GENESIS MODE: Fetch complete history from beginning to now
    if (type === 'allKlines') {
      const isGenesisTf = ['1M', '1w', '3d', '1d'].includes(interval);
      let mergedKlines: any[] = [];
      const seenTimes = new Set<number>();

      if (isGenesisTf) {
        // Forward pagination from genesis (Aug 2017) to present
        let currentStart = startTime ? parseInt(startTime, 10) : CRYPTO_INCEPTION_MS;
        const maxPages = interval === '1M' ? 2 : interval === '1w' ? 2 : interval === '3d' ? 3 : 6;

        for (let p = 0; p < maxPages; p++) {
          const fetchUrl = `${BINANCE_SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&limit=1000`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const resp = await fetch(fetchUrl, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Accept: 'application/json',
              },
              cache: 'no-store',
            });
            clearTimeout(timer);
            if (!resp.ok) break;
            const batch = await resp.json();
            if (!Array.isArray(batch) || batch.length === 0) break;

            for (const k of batch) {
              const t = Number(k[0]);
              if (!seenTimes.has(t)) {
                seenTimes.add(t);
                mergedKlines.push(k);
              }
            }

            if (batch.length < 1000) break;
            currentStart = Number(batch[batch.length - 1][6]) + 1; // closeTime + 1ms
          } catch {
            clearTimeout(timer);
            break;
          }
        }
      } else {
        // High-depth intraday backwards multi-page fetch (up to 4,000 - 5,000 bars)
        let currentEnd = endTime ? parseInt(endTime, 10) : undefined;
        const maxPages = 4; // 4 pages x 1000 = 4,000 candles

        for (let p = 0; p < maxPages; p++) {
          const endQuery = currentEnd ? `&endTime=${currentEnd}` : '';
          const fetchUrl = `${BINANCE_SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000${endQuery}`;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 12000);
          try {
            const resp = await fetch(fetchUrl, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                Accept: 'application/json',
              },
              cache: 'no-store',
            });
            clearTimeout(timer);
            if (!resp.ok) break;
            const batch = await resp.json();
            if (!Array.isArray(batch) || batch.length === 0) break;

            // Prepend batch so oldest is at beginning
            const newBatch: any[] = [];
            for (const k of batch) {
              const t = Number(k[0]);
              if (!seenTimes.has(t)) {
                seenTimes.add(t);
                newBatch.push(k);
              }
            }
            mergedKlines = [...newBatch, ...mergedKlines];

            if (batch.length < 1000) break;
            currentEnd = Number(batch[0][0]) - 1; // 1ms before oldest bar
          } catch {
            clearTimeout(timer);
            break;
          }
        }
      }

      if (mergedKlines.length > 0) {
        mergedKlines.sort((a, b) => Number(a[0]) - Number(b[0]));
        return NextResponse.json(mergedKlines);
      }
    }

    // 2. Standard single-request handling
    let url = '';
    const hasSymbol = searchParams.has('symbol');
    let timeParams = '';
    if (startTime) timeParams += `&startTime=${startTime}`;
    if (endTime) timeParams += `&endTime=${endTime}`;

    const numStart = startTime ? parseInt(startTime, 10) : 0;
    // Futures only started Sept 2019 (timestamp ~1567296000000). Pre-2019 requests MUST go to Spot
    const mustUseSpot = source === 'spot' || (numStart > 0 && numStart < 1567296000000);

    if (type === 'klines') {
      if (mustUseSpot) {
        url = `${BINANCE_SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${timeParams}`;
      } else {
        url = `${BINANCE_FAPI_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${timeParams}`;
      }
    } else if (type === 'ticker24h') {
      url = hasSymbol
        ? `${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr?symbol=${symbol}`
        : `${BINANCE_FAPI_BASE}/fapi/v1/ticker/24hr`;
    } else if (type === 'price') {
      url = `${BINANCE_FAPI_BASE}/fapi/v1/ticker/price?symbol=${symbol}`;
    } else if (type === 'depth') {
      url = `${BINANCE_FAPI_BASE}/fapi/v1/depth?symbol=${symbol}&limit=50`;
    } else if (type === 'oi') {
      url = `${BINANCE_FAPI_BASE}/fapi/v1/openInterest?symbol=${symbol}`;
    } else if (type === 'fundingRate') {
      url = `${BINANCE_FAPI_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=10`;
    } else {
      return NextResponse.json({ error: 'Invalid type parameter' }, { status: 400 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Primary endpoint status ${response.status}`);
      }
    } catch {
      // Spot mirror fallback
      const fallbackUrl = type === 'price'
        ? `${BINANCE_SPOT_BASE}/api/v3/ticker/price?symbol=${symbol}`
        : type === 'ticker24h' && hasSymbol
        ? `${BINANCE_SPOT_BASE}/api/v3/ticker/24hr?symbol=${symbol}`
        : type === 'klines'
        ? `${BINANCE_SPOT_BASE}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${timeParams}`
        : `${BINANCE_SPOT_BASE}/api/v3/ticker/24hr`;
      response = await fetch(fallbackUrl, { signal: controller.signal, cache: 'no-store' });
    }
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Binance responded with status ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown upstream error';
    return NextResponse.json({
      fallback: true,
      reason: errMessage,
      symbol,
      type,
    }, { status: 200 });
  }
}
