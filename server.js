require('dotenv').config();
const express = require('express');
const signalEngine = require('./signal-engine');
const lineNotifier = require('./line-notifier');

const app = express();
const PORT = process.env.PORT || 3000;
const notifiedSignals = new Set();

async function monitorSignals() {
  const symbols = (process.env.SYMBOLS || 'USD/JPY,EUR/JPY').split(',').map(s => s.trim());
  const interval = process.env.TIMEFRAME || '60min';
  const accountSize = parseInt(process.env.ACCOUNT_SIZE) || 1000000;
  const riskPercent = parseFloat(process.env.RISK_PERCENT) || 1;
  const rrRatio = parseInt(process.env.RR_RATIO) || 2;

  console.log(`\n🔍 [${new Date().toLocaleString('ja-JP')}] Checking signals...`);

  for (const symbol of symbols) {
    try {
      const signalData = await signalEngine.generateSignal(symbol, interval);

      if (!signalData) {
        console.log(`⏭️  [${symbol}] No data`);
        continue;
      }

      if (signalData.signal) {
        const today = new Date().toDateString();
        const signalKey = `${symbol}_${signalData.signal}_${today}`;

        if (!notifiedSignals.has(signalKey)) {
          console.log(`🚨 [${symbol}] ${signalData.signal} Signal!`);

          const tpslData = signalEngine.calculateTPSL(
            parseFloat(signalData.currentPrice),
            signalData.signal,
            accountSize,
            riskPercent,
            rrRatio,
            symbol
          );

          await lineNotifier.sendSignalNotification(signalData, tpslData);
          notifiedSignals.add(signalKey);
        }
      } else {
        console.log(`➖ [${symbol}] No signal`);
      }
    } catch (error) {
      console.error(`❌ Error ${symbol}:`, error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

console.log('🚀 FX Notifier starting...');
monitorSignals();

setInterval(monitorSignals, 5 * 60 * 1000);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/trigger', async (req, res) => {
  await monitorSignals();
  res.json({ message: 'Triggered' });
});

app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    notifiedCount: notifiedSignals.size
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server on port ${PORT}`);
});
