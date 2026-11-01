'use strict';
// 60日モメンタム（20営業日保有）の仮想売買 + LINE通知
// 日足データを毎回「開始日から再計算」するので、再起動しても状態が復元される。

const https = require('https');

const API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_USER = process.env.LINE_USER_ID;
const ACCOUNT = Number(process.env.ACCOUNT_SIZE) || 1000000;
const RISK_PCT = Number(process.env.RISK_PERCENT) || 1;
const ANCHOR = process.env.MOMENTUM_ANCHOR || '2026-11-02';

const SPREAD = 0.003; // 円（往復）
const K = 2;          // 損切り幅 = ATR14 x 2
const HOLD = 20;      // 保有営業日数
const LOOKBACK = 60;  // モメンタムの期間
const INTERVAL_MS = 3 * 60 * 60 * 1000;

// ---------- データ取得 ----------
function fetchDaily() {
  return new Promise((resolve, reject) => {
    if (!API_KEY) return reject(new Error('ALPHA_VANTAGE_API_KEY is not set'));
    const url =
      'https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=USD&to_symbol=JPY' +
      '&outputsize=full&apikey=' + API_KEY;
    https
      .get(url, (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const key = Object.keys(json).find((k) => k.startsWith('Time Series'));
            if (!key) {
              const msg = json.Information || json.Note || json['Error Message'] || 'no time series';
              return reject(new Error(String(msg).slice(0, 120)));
            }
            const candles = Object.entries(json[key])
              .map(([date, v]) => ({
                date,
                open: parseFloat(v['1. open']),
                high: parseFloat(v['2. high']),
                low: parseFloat(v['3. low']),
                close: parseFloat(v['4. close']),
              }))
              .sort((a, b) => (a.date < b.date ? -1 : 1));
            resolve(candles);
          } catch (e) {
            reject(e);
          }
        });
      })
      .on('error', reject);
  });
}

let cache = { t: 0, candles: null };
async function getCandles() {
  if (cache.candles && Date.now() - cache.t < INTERVAL_MS - 60000) return cache.candles;
  try {
    let cd = await fetchDaily();
    const today = new Date().toISOString().slice(0, 10);
    cd = cd.filter((x) => x.date < today); // 当日の未確定足は使わない
    cache = { t: Date.now(), candles: cd };
    return cd;
  } catch (e) {
    if (cache.candles) return cache.candles;
    throw e;
  }
}

// ---------- 再計算（バックテストと同じロジック） ----------
function atrSeries(cd) {
  const n = cd.length;
  const tr = new Array(n).fill(NaN);
  for (let i = 1; i < n; i++) {
    const pc = cd[i - 1].close;
    tr[i] = Math.max(cd[i].high - cd[i].low, Math.abs(cd[i].high - pc), Math.abs(cd[i].low - pc));
  }
  const atr = new Array(n).fill(NaN);
  for (let i = 14; i < n; i++) {
    let s = 0;
    for (let k = i - 13; k <= i; k++) s += tr[k];
    atr[i] = s / 14;
  }
  return atr;
}

function replay(cd) {
  const n = cd.length;
  const atr = atrSeries(cd);
  const riskYen = (ACCOUNT * RISK_PCT) / 100;
  const out = { trades: [], open: null, pending: null, waiting: false, lastDate: cd[n - 1].date, lastClose: cd[n - 1].close };
  let i = cd.findIndex((x) => x.date >= ANCHOR);
  if (i < 0) { out.waiting = true; return out; }

  while (i < n) {
    if (i < LOOKBACK || isNaN(atr[i])) { i++; continue; }
    const dir = cd[i].close / cd[i - LOOKBACK].close - 1 > 0 ? 1 : -1;
    const ret = (cd[i].close / cd[i - LOOKBACK].close - 1) * 100;
    const e = i + 1;
    const risk = K * atr[i];
    const units = Math.max(1000, Math.floor(riskYen / risk / 1000) * 1000);

    if (e > n - 1) {
      out.pending = { dir, signalDate: cd[i].date, refPx: cd[i].close, risk, units, ret };
      break;
    }
    const entry = cd[e].open + (SPREAD / 2) * dir;
    const sl = entry - dir * risk;
    let exitPx = null, exitJ = null, reason = null, exitPending = false;

    for (let j = e; j <= n - 1; j++) {
      if (dir === 1 && cd[j].low <= sl) { exitPx = j > e ? Math.min(sl, cd[j].open) : sl; exitJ = j; reason = 'stop'; break; }
      if (dir === -1 && cd[j].high >= sl) { exitPx = j > e ? Math.max(sl, cd[j].open) : sl; exitJ = j; reason = 'stop'; break; }
      if (j - e + 1 >= HOLD) {
        if (j + 1 <= n - 1) { exitPx = cd[j + 1].open; exitJ = j + 1; reason = 'time'; }
        else exitPending = true;
        break;
      }
    }

    const base = { dir, signalDate: cd[i].date, entryDate: cd[e].date, entry, sl, risk, units, ret };
    if (exitPx !== null) {
      const px = exitPx - (SPREAD / 2) * dir;
      out.trades.push({ ...base, exitDate: cd[exitJ].date, exit: px, reason,
        R: (dir * (px - entry)) / risk, pnl: dir * (px - entry) * units });
      i = Math.max(exitJ, i + 1);
    } else {
      out.open = { ...base, days: n - e, exitPending };
      break;
    }
  }
  return out;
}

// ---------- メッセージ ----------
const side = (d) => (d > 0 ? '買い' : '売り');
const f2 = (x) => x.toFixed(2);
const yen = (x) => (x >= 0 ? '+' : '') + Math.round(x).toLocaleString('ja-JP') + '円';

function entryText(p) {
  return [
    '【仮想エントリー】USD/JPY ' + side(p.dir),
    '戦略: 60日モメンタム（20営業日保有）',
    '約定(始値): ' + f2(p.entry) + '（' + p.entryDate + '）',
    '損切り: ' + f2(p.sl) + '（幅' + f2(p.risk) + '円 = ATR×2）',
    '数量: ' + p.units.toLocaleString('ja-JP') + '通貨 / 最大損失 約' + Math.round(p.units * p.risk).toLocaleString('ja-JP') + '円',
    '決済: 20営業日後の始値、または損切り',
    '根拠: 60日リターン ' + (p.ret >= 0 ? '+' : '') + p.ret.toFixed(1) + '%',
  ].join('\n');
}
function signalText(p) {
  return [
    '【仮想シグナル】USD/JPY ' + side(p.dir),
    '基準価格: ' + f2(p.refPx) + '（' + p.signalDate + ' 終値）',
    '損切り幅: ' + f2(p.risk) + '円（ATR×2）/ 想定数量 ' + p.units.toLocaleString('ja-JP') + '通貨',
    '次の営業日の始値でエントリー想定',
    '根拠: 60日リターン ' + (p.ret >= 0 ? '+' : '') + p.ret.toFixed(1) + '%',
  ].join('\n');
}
function exitText(t, cum, count) {
  return [
    '【仮想決済】USD/JPY ' + side(t.dir) + '（' + (t.reason === 'stop' ? '損切り' : '期間満了') + '）',
    f2(t.entry) + ' → ' + f2(t.exit) + '（' + t.exitDate + '）',
    '損益: ' + yen(t.pnl) + '（' + (t.R >= 0 ? '+' : '') + t.R.toFixed(2) + 'R）',
    '累計の仮想損益: ' + yen(cum) + '（' + count + '回）',
  ].join('\n');
}

function buildEvents(r) {
  const ev = [];
  let cum = 0, count = 0;
  for (const t of r.trades) {
    ev.push({ key: 'E:' + t.entryDate + ':' + t.dir, date: t.entryDate, text: entryText(t) });
    cum += t.pnl; count++;
    ev.push({ key: 'X:' + t.exitDate + ':' + t.dir, date: t.exitDate, text: exitText(t, cum, count) });
  }
  if (r.open) ev.push({ key: 'E:' + r.open.entryDate + ':' + r.open.dir, date: r.open.entryDate, text: entryText(r.open) });
  if (r.pending) ev.push({ key: 'S:' + r.pending.signalDate + ':' + r.pending.dir, date: r.pending.signalDate, text: signalText(r.pending) });
  return { ev, cum, count };
}

function statusText(r, cum, count) {
  const head = '【仮想売買 状況】USD/JPY 60日モメンタム\n最新データ: ' + r.lastDate + ' 終値 ' + f2(r.lastClose);
  let body;
  if (r.waiting) body = '開始日(' + ANCHOR + ')より前のため待機中です';
  else if (r.open) {
    body = '保有中: ' + side(r.open.dir) + '（' + r.open.entryDate + ' 約定 ' + f2(r.open.entry) + '）\n' +
      '損切り ' + f2(r.open.sl) + ' / ' + r.open.days + '日目/' + HOLD + (r.open.exitPending ? '（次の始値で決済予定）' : '');
  } else if (r.pending) body = 'シグナル発生中: ' + side(r.pending.dir) + '（次の始値でエントリー想定）';
  else body = 'ポジションなし';
  return head + '\n' + body + '\n累計の仮想損益: ' + yen(cum) + '（' + count + '回）';
}

// ---------- LINE ----------
function pushText(text) {
  return new Promise((resolve) => {
    if (!TOKEN || !LINE_USER) { console.log('[momentum] LINE not set:\n' + text); return resolve(); }
    const body = JSON.stringify({ to: LINE_USER, messages: [{ type: 'text', text }] });
    const req = https.request(
      'https://api.line.me/v2/bot/message/push',
      { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN, 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => { console.log('[momentum] LINE ' + res.statusCode + ' ' + d); resolve(); });
      }
    );
    req.on('error', (e) => { console.error('[momentum] LINE error: ' + e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

// ---------- 定期実行 ----------
const sent = new Set();
const daysBetween = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

async function runCheck(isStartup) {
  try {
    const cd = await getCandles();
    const r = replay(cd);
    const { ev, cum, count } = buildEvents(r);
    console.log('[momentum] checked. last=' + r.lastDate + ' trades=' + count + ' open=' + !!r.open + ' pending=' + !!r.pending);
    for (const e of ev) {
      if (daysBetween(r.lastDate, e.date) <= 4 && !sent.has(e.key)) {
        sent.add(e.key);
        await pushText(e.text);
      }
    }
    if (isStartup) await pushText(statusText(r, cum, count));
  } catch (e) {
    console.error('[momentum] error: ' + e.message);
  }
}

function start() {
  console.log('[momentum] start. anchor=' + ANCHOR + ' every ' + INTERVAL_MS / 3600000 + 'h');
  setTimeout(() => runCheck(true), 5000);
  setInterval(() => runCheck(false), INTERVAL_MS);
}

module.exports = { start, runCheck, replay, buildEvents, statusText };
