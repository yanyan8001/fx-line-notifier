// FX Signal Logic Module
// Alpha Vantage API 統合 + SMA20 + RSI14 + シグナル生成

const https = require('https');

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY || 'REHR876KWO5EZUGW';
const SYMBOLS = process.env.SYMBOLS || 'USD/JPY';

// ============================================
// Rate Limiter (Alpha Vantage: 5 calls/min)
// ============================================

class RateLimiter {
  constructor(maxCalls = 5, windowMs = 60000) {
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.calls = [];
  }

  async wait() {
    const now = Date.now();
    this.calls = this.calls.filter(time => now - time < this.windowMs);

    if (this.calls.length >= this.maxCalls) {
      const oldestCall = this.calls[0];
      const waitTime = this.windowMs - (now - oldestCall) + 1000;
      console.log(`⏳ Rate limit: waiting ${(waitTime / 1000).toFixed(1)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.wait(); // Recursive check
    }

    this.calls.push(now);
  }
}

const limiter = new RateLimiter(5, 60000);

// ============================================
// Data Cache
// ============================================

class DataCache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.cache = {};
    this.ttl = ttlMs;
  }

  set(key, value) {
    this.cache[key] = {
      value,
      timestamp: Date.now(),
    };
  }

  get(key) {
    const entry = this.cache[key];
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      delete this.cache[key];
      return null;
    }

    return entry.value;
  }

  clear() {
    this.cache = {};
  }
}

const cache = new DataCache(5 * 60 * 1000);

// ============================================
// Alpha Vantage API Call
// ============================================

/**
 * Alpha Vantage API から FX データを取得
 * @param {string} fromSymbol - 例: USD
 * @param {string} toSymbol - 例: JPY
 * @returns {Array} キャンドル配列 [{time, open, high, low, close}, ...]
 */
function fetchFXDataFromAlphaVantage(fromSymbol, toSymbol) {
  return new Promise((resolve, reject) => {
    const cacheKey = `${fromSymbol}/${toSymbol}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`📦 Using cache for ${cacheKey}`);
      return resolve(cached);
    }

    const url = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&apikey=${API_KEY}`;

    const timeout = setTimeout(() => {
      reject(new Error(`API request timeout for ${fromSymbol}/${toSymbol}`));
    }, 15000);

    https
      .get(url, resp => {
        let data = '';
        resp.on('data', chunk => (data += chunk));
        resp.on('end', () => {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(data);

            if (json.Error) {
              throw new Error(`API Error: ${json.Error}`);
            }

            if (json.Note) {
              console.warn(`⚠️ API Note: ${json.Note}`);
              return reject(new Error(json.Note));
            }

            const timeSeries = json['Time Series FX (daily)'];
            if (!timeSeries) {
              return reject(new Error(`No time series data for ${fromSymbol}/${toSymbol}`));
            }

            const candles = Object.entries(timeSeries)
              .slice(0, 30)
              .map(([time, data]) => ({
                time,
                open: parseFloat(data['1. open']),
                high: parseFloat(data['2. high']),
                low: parseFloat(data['3. low']),
                close: parseFloat(data['4. close']),
              }));

            cache.set(cacheKey, candles);
            resolve(candles);
          } catch (error) {
            reject(error);
          }
        });
      })
      .on('error', reject);

    (async () => {
      await limiter.wait();
    })();
  });
}

// ============================================
// Technical Indicators
// ============================================

/**
 * Simple Moving Average 20期間
 */
function calculateSMA(candles, period = 20) {
  if (candles.length < period) return null;

  const sum = candles.slice(0, period).reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

/**
 * RSI (Relative Strength Index) 14期間
 */
function calculateRSI(candles, period = 14) {
  if (candles.length < period + 1) return null;

  let gains = 0,
    losses = 0;
  for (let i = 0; i < period; i++) {
    const diff = candles[i].close - candles[i + 1].close;
    if (diff > 0) gains += diff;
    else losses += -diff;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============================================
// Signal Generation
// ============================================

/**
 * シグナルを生成
 */
function generateSignal(symbol, candles) {
  if (!candles || candles.length === 0) {
    return {
      symbol,
      signal: 'ERROR',
      price: 0,
      sma20: 'N/A',
      rsi14: 'N/A',
      reason: 'No candle data',
      time: new Date().toISOString(),
    };
  }

  const price = candles[0].close;
  const sma20 = calculateSMA(candles, 20);
  const rsi14 = calculateRSI(candles, 14);

  let signal = 'NEUTRAL';
  let reason = '';

  if (sma20 && rsi14) {
    if (price > sma20 && rsi14 < 50) {
      signal = 'BUY';
      reason = `Price (${price.toFixed(4)}) > SMA20 (${sma20.toFixed(4)}) AND RSI14 (${rsi14.toFixed(1)}) < 50`;
    } else if (price < sma20 && rsi14 > 50) {
      signal = 'SELL';
      reason = `Price (${price.toFixed(4)}) < SMA20 (${sma20.toFixed(4)}) AND RSI14 (${rsi14.toFixed(1)}) > 50`;
    } else {
      reason = `Price: ${price.toFixed(4)}, SMA20: ${sma20.toFixed(4)}, RSI14: ${rsi14.toFixed(1)}`;
    }
  } else {
    reason = 'Insufficient data for RSI/SMA calculation';
  }

  return {
    symbol,
    signal,
    price,
    sma20: sma20 ? sma20.toFixed(4) : 'N/A',
    rsi14: rsi14 ? rsi14.toFixed(1) : 'N/A',
    reason,
    time: candles[0].time,
  };
}

// ============================================
// Exports
// ============================================

module.exports = {
  fetchFXDataFromAlphaVantage,
  calculateSMA,
  calculateRSI,
  generateSignal,
  RateLimiter,
  DataCache,
};
