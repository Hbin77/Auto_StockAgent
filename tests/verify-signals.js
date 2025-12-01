const stockTools = require('../src/stock-tools');
const dayTradingMonitor = require('../src/daytrading-signal-monitor');
const multiFactorScreener = require('../src/multi-factor-screener');

// Helper to generate mock data
function generateData(startPrice, trend, volatility, length = 60) {
    const data = [];
    let price = startPrice;
    for (let i = 0; i < length; i++) {
        price = price * (1 + trend + (Math.random() - 0.5) * volatility);
        data.push({
            date: new Date(Date.now() - (length - i) * 5 * 60000),
            open: price,
            high: price * 1.01,
            low: price * 0.99,
            close: price,
            volume: 1000000
        });
    }
    return data;
}

console.log('--- Verifying Signal Accuracy ---');

// Scenario 1: Strong Uptrend (Golden Cross + High RSI)
// Should trigger BUY signals in MA, but maybe SELL in RSI if overbought
console.log('\nScenario 1: Strong Uptrend (Price rising 1% per step)');
const uptrendData = generateData(100, 0.01, 0.001);
const uptrendBasic = stockTools.analyze(uptrendData);
const uptrendDay = dayTradingMonitor.analyze(uptrendData);
const uptrendScore = multiFactorScreener.calculateScore(uptrendDay, { peRatio: 20 });

console.log('Basic Signal:', uptrendBasic.signal); // Expect BUY (MA20 > MA50) or SELL (RSI > 70)
console.log('Day Trading Signals:', uptrendDay.signals); // Expect MA_UPTREND, maybe RSI_OVERBOUGHT
console.log('Final Score:', uptrendScore.totalScore, uptrendScore.recommendation);


// Scenario 2: Strong Downtrend (Dead Cross + Low RSI)
console.log('\nScenario 2: Strong Downtrend (Price falling 1% per step)');
const downtrendData = generateData(100, -0.01, 0.001);
const downtrendBasic = stockTools.analyze(downtrendData);
const downtrendDay = dayTradingMonitor.analyze(downtrendData);
const downtrendScore = multiFactorScreener.calculateScore(downtrendDay, { peRatio: 20 });

console.log('MACD Details:', downtrendDay.indicators.macd); // Debug MACD
console.log('Basic Signal:', downtrendBasic.signal);
console.log('Day Trading Signals:', downtrendDay.signals);
console.log('Final Score:', downtrendScore.totalScore, downtrendScore.recommendation);


// Scenario 3: Oversold Bounce (Price drops then stabilizes low)
// We want to see if it catches the "Oversold" opportunity
console.log('\nScenario 3: Oversold Condition');
// Create data where RSI should be low
const oversoldData = generateData(100, -0.005, 0.002);
const oversoldDay = dayTradingMonitor.analyze(oversoldData);
const oversoldScore = multiFactorScreener.calculateScore(oversoldDay, { peRatio: 15 }); // Good PE

console.log('RSI:', oversoldDay.indicators.rsi);
console.log('Day Trading Signals:', oversoldDay.signals); // Expect RSI_OVERSOLD
console.log('Final Score:', oversoldScore.totalScore, oversoldScore.recommendation);
