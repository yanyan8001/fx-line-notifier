// FX Signal Data Fetch - Mock Mode
// テスト用モックデータ

/**
 * モック FX データを生成
 */
function generateMockFXData(symbol = 'USDJPY') {
  const candles = [];
  let basePrice = symbol === 'USDJPY' ? 150.5 : symbol === 'EURJPY' ? 160.2 : 190.8;

  for (let i = 0; i < 30; i++) {
    const variance = (Math.random() - 0.5) * 0.5;
    const close = basePrice + variance;
    const high = close + Math.random() * 0.2;
    const low = close - Math.random() * 0.2;
    const open = basePrice;

    candles.push({
      time: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      open: parseFloat(open.toFixed(4)),
      high: parseFloat(high.toFixed(4)),
      low: parseFloat(low.toFixed(4)),
      close: parseFloat(close.toFixed(4)),
    });

    basePrice = close;
  }

  return candles.reverse();
}

/**
 * Simple Moving Average
 */
function calculateSMA(candles, period = 20) {
  if (candles.length < period) return null;
  const sum = candles.slice(0, period).reduce((acc, c) => acc + c.close, 0);
  return sum / period;
}

/**
 * RSI (Relative Strength Index)
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

/**
 * シグナル生成（モック用）
 */
function generateSignalMock(symbol) {
  const candles = generateMockFXData(symbol);
  const price = candles[candles.length - 1].close;
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
  }

  return {
    symbol,
    signal,
    price: parseFloat(price.toFixed(4)),
    sma20: sma20 ? parseFloat(sma20.toFixed(4)) : null,
    rsi14: rsi14 ? parseFloat(rsi14.toFixed(1)) : null,
    reason,
    time: new Date().toISOString(),
  };
}

module.exports = {
  generateMockFXData,
  calculateSMA,
  calculateRSI,
  generateSignalMock,
};
