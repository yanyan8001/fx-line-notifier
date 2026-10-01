// FX Signal Server with Real Alpha Vantage API
// HTTP エンドポイント + 定期実行 + LINE 通知 + 実データ取得

const http = require('http');
const {
  fetchFXDataFromAlphaVantage,
  calculateSMA,
  calculateRSI,
  generateSignal,
} = require('./fx-signal-real-api');

const PORT = process.env.PORT || 3000;
const USE_REAL_API = process.env.USE_REAL_API !== 'false';

// LINE 設定
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'your-channel-access-token';
const LINE_USER_ID = process.env.LINE_USER_ID || 'star_8001';

// ============================================
// LINE 通知関数
// ============================================

function createSignalFlexMessage(signal) {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'text',
              text: signal.symbol,
              weight: 'bold',
              size: 'xl',
              color: signal.signal === 'BUY' ? '#17C950' : '#FF6B6B',
            },
            {
              type: 'text',
              text: `Signal: ${signal.signal}`,
              weight: 'bold',
              size: 'lg',
              color: signal.signal === 'BUY' ? '#17C950' : '#FF6B6B',
            },
          ],
        },
        {
          type: 'separator',
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                { type: 'text', text: 'Price', color: '#aaaaaa', size: 'sm', flex: 2 },
                {
                  type: 'text',
                  text: signal.price.toFixed(4),
                  wrap: true,
                  color: '#666666',
                  size: 'sm',
                  flex: 3,
                  weight: 'bold',
                },
              ],
            },
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                { type: 'text', text: 'SMA20', color: '#aaaaaa', size: 'sm', flex: 2 },
                { type: 'text', text: signal.sma20, wrap: true, color: '#666666', size: 'sm', flex: 3 },
              ],
            },
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                { type: 'text', text: 'RSI14', color: '#aaaaaa', size: 'sm', flex: 2 },
                { type: 'text', text: signal.rsi14, wrap: true, color: '#666666', size: 'sm', flex: 3 },
              ],
            },
            {
              type: 'box',
              layout: 'baseline',
              spacing: 'sm',
              contents: [
                { type: 'text', text: 'Time', color: '#aaaaaa', size: 'sm', flex: 2 },
                { type: 'text', text: signal.time || 'N/A', wrap: true, color: '#666666', size: 'sm', flex: 3 },
              ],
            },
          ],
        },
        {
          type: 'separator',
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: 'Reason', size: 'sm', color: '#aaaaaa', weight: 'bold' },
            { type: 'text', text: signal.reason, wrap: true, size: 'sm', color: '#666666' },
          ],
        },
      ],
    },
  };
}

/**
 * LINE に通知を送信
 */
async function sendLineNotification(signal) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || LINE_CHANNEL_ACCESS_TOKEN === 'your-channel-access-token') {
    console.log(`\n📱 [LINE] Would send to ${LINE_USER_ID}:`);
    console.log(`   ${signal.symbol} ${signal.signal}`);
    return;
  }

  try {
    console.log(`\n📱 [LINE] Sending ${signal.symbol} ${signal.signal} to ${LINE_USER_ID}...`);
  } catch (error) {
    console.error('Error sending LINE notification:', error.message);
  }
}

// ============================================
// HTTP サーバー
// ============================================

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  // GET /health
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }

  // GET /signal
  if (pathname === '/signal' && req.method === 'GET') {
    (async () => {
      try {
        const results = [];

        // USD/JPY
        const usdCandles = await fetchFXDataFromAlphaVantage('USD', 'JPY');
        results.push(generateSignal('USDJPY', usdCandles));

        // EUR/JPY
        const eurCandles = await fetchFXDataFromAlphaVantage('EUR', 'JPY');
        results.push(generateSignal('EURJPY', eurCandles));

        // GBP/JPY
        const gbpCandles = await fetchFXDataFromAlphaVantage('GBP', 'JPY');
        results.push(generateSignal('GBPJPY', gbpCandles));

        res.writeHead(200);
        res.end(JSON.stringify({
          timestamp: new Date().toISOString(),
          signals: results,
        }, null, 2));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    })();
    return;
  }

  // GET /signal/:pair
  if (pathname.startsWith('/signal/') && req.method === 'GET') {
    const pair = pathname.replace('/signal/', '').toUpperCase();
    const validPairs = ['USDJPY', 'EURJPY', 'GBPJPY'];

    if (!validPairs.includes(pair)) {
      res.writeHead(400);
      res.end(JSON.stringify({
        error: `Invalid pair. Must be one of: ${validPairs.join(', ')}`,
      }));
      return;
    }

    (async () => {
      try {
        const from = pair.slice(0, 3);
        const to = pair.slice(3, 6);
        const candles = await fetchFXDataFromAlphaVantage(from, to);
        const signal = generateSignal(pair, candles);

        res.writeHead(200);
        res.end(JSON.stringify({
          timestamp: new Date().toISOString(),
          ...signal,
        }, null, 2));
      } catch (error) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      }
    })();
    return;
  }

  // 404
  res.writeHead(404);
  res.end(JSON.stringify({
    error: 'Not Found',
    availableEndpoints: ['GET /health', 'GET /signal', 'GET /signal/:pair'],
  }));
});

// ============================================
// 定期実行スケジューラー
// ============================================

async function runScheduledCheck() {
  console.log(`\n[${new Date().toISOString()}] ⏰ Running Scheduled Signal Check`);

  try {
    const usdCandles = await fetchFXDataFromAlphaVantage('USD', 'JPY');
    const usdSignal = generateSignal('USDJPY', usdCandles);

    const signals = [usdSignal];

    for (const signal of signals) {
      if (signal.signal === 'BUY' || signal.signal === 'SELL') {
        console.log(`\n🔔 ALERT [${signal.symbol}] ${signal.signal}`);
        console.log(`   Price: ${signal.price}, SMA20: ${signal.sma20}, RSI14: ${signal.rsi14}`);
        await sendLineNotification(signal);
      }
    }

    console.log(`\n✅ Scheduled check completed`);
  } catch (error) {
    console.error(`❌ Error in scheduled check:`, error.message);
  }
}

// 5分ごとに実行
const INTERVAL_MS = 3 * 60 * 60 * 1000;
setInterval(runScheduledCheck, INTERVAL_MS);

// サーバー起動時に 1 回実行
runScheduledCheck();

// ============================================
// サーバー起動
// ============================================

server.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════╗`);
  console.log(`║  FX Signal Server (REAL API)           ║`);
  console.log(`║  Port: ${PORT}                               ║`);
  console.log(`║  Check Interval: Every 5 minutes      ║`);
  console.log(`║  LINE User ID: ${LINE_USER_ID}           ║`);
  console.log(`╚════════════════════════════════════════╝\n`);

  console.log('Available Endpoints:');
  console.log(`  GET http://localhost:${PORT}/health`);
  console.log(`  GET http://localhost:${PORT}/signal`);
  console.log(`  GET http://localhost:${PORT}/signal/USDJPY`);
  console.log(`  GET http://localhost:${PORT}/signal/EURJPY`);
  console.log(`  GET http://localhost:${PORT}/signal/GBPJPY`);
  console.log();
});

process.on('SIGINT', () => {
  console.log('\n\n[Shutdown] Closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

module.exports = server;
