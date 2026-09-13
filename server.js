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

  console.log(`🔍 Checking signals at ${new Date().toISOString()}`);

  for (const symbol of symbols) {
    try {
      const signalData = await signalEngine.generateSignal(symbol, interval);
      if (!signalData) continue;
      if (signalData.signal) {
        const today = new Date().toDateString();
        const signalKey = `${symbol}_${signalData.signal}_${today}`;
        if (!notifiedSignals.has(signalKey)) {
          console.log(`🚨 Signal: ${symbol} ${signalData.signal}`);
          const tpslData = signalEngine.calculateTPSL(parseFloat(signalData.currentPrice), signalData.signal, accountSize, riskPercent, rrRatio, symbol);
          await lineNotifier.sendSignalNotification(signalData, tpslData);
          notifiedSignals.add(signalKey);
        }
      }
    } catch (e) {
      console.error(`❌ ${symbol}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

console.log('🚀 Starting...');
monitorSignals();
setInterval(monitorSignals, 5 * 60 * 1000);

app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/trigger', async (req, res) => { await monitorSignals(); res.json({ triggered: true }); });
app.get('/status', (req, res) => res.json({ running: true, notified: notifiedSignals.size }));

app.listen(PORT, () => console.log(`✅ Server on ${PORT}`));
