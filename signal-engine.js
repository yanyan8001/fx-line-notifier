const fetch = require('node-fetch');

async function fetchCandleData(symbol, interval = '60min') {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  const [fromSymbol, toSymbol] = symbol.split('/');
  
  const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&interval=${interval}&outputsize=full&apikey=${apiKey}`;

  try {
    console.log(`🔄 Fetching data for ${symbol}...`);
    const response = await fetch(url);
    const data = await response.json();

    if (data.note && data.note.includes('premium')) {
      console.error('❌ API Rate Limit reached');
      return null;
    }

    if (data['Error Message']) {
      console.error(`❌ API Error: ${data['Error Message']}`);
      return null;
    }

    const timeSeriesKey = `Time Series FX (${interval})`;
    const timeSeries = data[timeSeriesKey];

    if (!timeSeries) {
      console.error(`❌ No time series data for ${symbol}`);
      return null;
    }

    const timestamps = Object.keys(timeSeries).sort().reverse();
    const candleData = timestamps.slice(0, 100).map(time => ({
      time,
      open: parseFloat(timeSeries[time]['1. open']),
      high: parseFloat(timeSeries[time]['2. high']),
      low: parseFloat(timeSeries[time]['3. low']),
      close: parseFloat(timeSeries[time]['4. close'])
    }));

    console.log(`✅ Fetched ${candleData.length} candles for ${symbol}`);
    return candleData;
  } catch (error) {
    console.error(`❌ Error fetching candle data for ${symbol}:`, error.message);
    return null;
  }
}

function calculateSMA(closes, period) {
  if (closes.length < period) return null;
  const slice = closes.slice(0, period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0, losses = 0;

  for (let i = 0; i < period; i++) {
    const diff = closes[i] - closes[i + 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

function detectMACross(candles) {
  if (candles.length < 50) {
    return { signal: null, reason: 'Not enough data' };
  }

  const closes = candles.map(c => c.close);
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes, 50);

  if (!ma20 || !ma50) {
    return { signal: null, reason: 'Cannot calculate MA', ma20, ma50 };
  }

  const prevMA20 = calculateSMA(closes.slice(1), 20);
  const prevMA50 = calculateSMA(closes.slice(1), 50);

  if (prevMA20 && prevMA50) {
    if (prevMA20 <= prevMA50 && ma20 > ma50) {
      return { signal: 'BUY', reason: 'MA20 > MA50（ゴールデンクロス）', ma20, ma50 };
    }

    if (prevMA20 >= prevMA50 && ma20 < ma50) {
      return { signal: 'SELL', reason: 'MA20 < MA50（デッドクロス）', ma20, ma50 };
    }
  }

  return { signal: null, reason: 'No MA cross', ma20, ma50 };
}

function detectRSISignal(closes) {
  const rsi = calculateRSI(closes);
  const prevRsi = calculateRSI(closes.slice(1));

  if (rsi === null || prevRsi === null) {
    return { signal: null, reason: 'RSI calculation failed', rsi };
  }

  if (prevRsi <= 30 && rsi > 30) {
    return { signal: 'BUY', reason: 'RSI < 30 脱出（過売圏）', rsi: rsi.toFixed(2) };
  }

  if (prevRsi >= 70 && rsi < 70) {
    return { signal: 'SELL', reason: 'RSI > 70 脱出（過買圏）', rsi: rsi.toFixed(2) };
  }

  return { signal: null, reason: `RSI neutral (${rsi.toFixed(2)})`, rsi: rsi.toFixed(2) };
}

async function generateSignal(symbol, interval = '60min') {
  const candles = await fetchCandleData(symbol, interval);
  if (!candles || candles.length === 0) {
    console.error(`❌ No candle data for ${symbol}`);
    return null;
  }

  const closes = candles.map(c => c.close);
  const currentPrice = closes[0];

  const maCross = detectMACross(candles);
  const rsiSignal = detectRSISignal(closes);

  let finalSignal = null;
  if (maCross.signal === rsiSignal.signal && maCross.signal !== null) {
    finalSignal = maCross.signal;
  }

  return {
    symbol,
    interval,
    currentPrice: currentPrice.toFixed(2),
    signal: finalSignal,
    ma: maCross,
    rsi: rsiSignal,
    timestamp: new Date().toISOString()
  };
}

function calculateTPSL(entryPrice, signal, accountSize, riskPercent, rrRatio, symbol) {
  const riskAmount = accountSize * (riskPercent / 100);

  const pipsPerYen = symbol.includes('JPY') ? 100 : 10000;
  const riskPips = riskAmount / pipsPerYen;

  let tp, sl;

  if (signal === 'BUY') {
    sl = entryPrice - riskPips / 100;
    tp = entryPrice + (riskPips * rrRatio) / 100;
  } else {
    sl = entryPrice + riskPips / 100;
    tp = entryPrice - (riskPips * rrRatio) / 100;
  }

  return {
    entryPrice: parseFloat(entryPrice).toFixed(2),
    sl: sl.toFixed(2),
    tp: tp.toFixed(2),
    riskPips: riskPips.toFixed(2),
    riskAmount: Math.floor(riskAmount),
    rrRatio
  };
}

module.exports = {
  fetchCandleData,
  calculateSMA,
  calculateRSI,
  detectMACross,
  detectRSISignal,
  generateSignal,
  calculateTPSL
};
