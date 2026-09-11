const line = require('@line/bot-sdk');

const client = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

async function sendSignalNotification(signalData, tpslData) {
  if (!signalData.signal) {
    console.log(`[${signalData.symbol}] No signal detected`);
    return;
  }

  const { symbol, interval, currentPrice, signal, ma, rsi } = signalData;
  const { entryPrice, tp, sl, riskAmount, rrRatio } = tpslData;

  const emoji = signal === 'BUY' ? '🟢' : '🔴';
  const action = signal === 'BUY' ? 'BUY' : 'SELL';

  const message = {
    type: 'flex',
    altText: `FX Signal: ${symbol} ${action}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'text',
            text: `${emoji} FXシグナル: ${symbol}`,
            size: 'xl',
            weight: 'bold',
            color: signal === 'BUY' ? '#0084ff' : '#ff0000'
          },
          {
            type: 'text',
            text: `時間足: ${interval.toUpperCase()} | 現在値: ${currentPrice}`,
            size: 'sm',
            color: '#999999'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            paddingAll: 'md',
            backgroundColor: '#f5f5f5',
            cornerRadius: 'md',
            contents: [
              {
                type: 'text',
                text: '推奨エントリー',
                size: 'sm',
                weight: 'bold'
              },
              {
                type: 'text',
                text: `${entryPrice} JPY`,
                size: 'xxl',
                weight: 'bold'
              },
              {
                type: 'text',
                text: `${ma.reason} / ${rsi.reason}`,
                size: 'xs',
                wrap: true,
                margin: 'sm'
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            paddingAll: 'md',
            backgroundColor: '#e8f5e9',
            cornerRadius: 'md',
            contents: [
              {
                type: 'text',
                text: '🎯 Take Profit',
                size: 'sm',
                weight: 'bold',
                color: '#2e7d32'
              },
              {
                type: 'text',
                text: `${tp} JPY`,
                size: 'lg',
                weight: 'bold',
                color: '#2e7d32'
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            paddingAll: 'md',
            backgroundColor: '#ffebee',
            cornerRadius: 'md',
            contents: [
              {
                type: 'text',
                text: '🛑 Stop Loss',
                size: 'sm',
                weight: 'bold',
                color: '#c62828'
              },
              {
                type: 'text',
                text: `${sl} JPY`,
                size: 'lg',
                weight: 'bold',
                color: '#c62828'
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            margin: 'md',
            paddingAll: 'md',
            backgroundColor: '#fff3e0',
            cornerRadius: 'md',
            contents: [
              {
                type: 'text',
                text: '💰 リスク額',
                size: 'sm',
                weight: 'bold',
                color: '#e65100'
              },
              {
                type: 'text',
                text: `${riskAmount.toLocaleString()} JPY (1%)`,
                size: 'lg',
                weight: 'bold',
                color: '#e65100'
              }
            ]
          }
        ]
      }
    }
  };

  try {
    await client.pushMessage(process.env.LINE_USER_ID, message);
    console.log(`✅ Signal sent: ${symbol} ${action}`);
    return true;
  } catch (error) {
    console.error('❌ Error:', error);
    return false;
  }
}

module.exports = {
  sendSignalNotification
};
