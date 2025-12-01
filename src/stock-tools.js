const { SMA, RSI, BollingerBands } = require('technicalindicators');

class StockTools {

    /**
     * Calculate Moving Average
     * @param {Array<number>} prices 
     * @param {number} period 
     */
    calculateMA(prices, period) {
        if (prices.length < period) return [];
        return SMA.calculate({ period: period, values: prices });
    }

    /**
     * Calculate RSI
     * @param {Array<number>} prices 
     * @param {number} period 
     */
    calculateRSI(prices, period = 14) {
        if (prices.length < period) return [];
        return RSI.calculate({ period: period, values: prices });
    }

    /**
     * Analyze basic signals
     * @param {Array<Object>} historicalData - Array of { close, volume, ... }
     */
    analyze(historicalData) {
        const closes = historicalData.map(d => d.close);

        const ma20 = this.calculateMA(closes, 20);
        const ma50 = this.calculateMA(closes, 50);
        const rsi = this.calculateRSI(closes, 14);

        const currentPrice = closes[closes.length - 1];
        const currentMA20 = ma20[ma20.length - 1];
        const currentMA50 = ma50[ma50.length - 1];
        const currentRSI = rsi[rsi.length - 1];

        let signal = 'NEUTRAL';

        // Golden Cross: MA20 crosses above MA50
        // Buy: Price > MA20 > MA50 (Trend Following)
        if (currentPrice > currentMA20 && currentMA20 > currentMA50) {
            signal = 'BUY';
        }
        // RSI Oversold (Potential Reversal) - Mark as BUY only if not in deep crash (simple check)
        // For safety, let's just mark it as NEUTRAL or OVERSOLD in basic tools, 
        // and let the advanced screener decide. But to keep it simple for this module:
        else if (currentRSI < 30) {
            signal = 'BUY_CANDIDATE'; // Changed from BUY to candidate
        }

        // Sell: Price < MA20 < MA50 (Downtrend)
        else if (currentPrice < currentMA20 && currentMA20 < currentMA50) {
            signal = 'SELL';
        }
        // RSI Overbought
        else if (currentRSI > 70) {
            signal = 'SELL_CANDIDATE';
        }

        return {
            ma20: currentMA20,
            ma50: currentMA50,
            rsi: currentRSI,
            signal: signal,
            price: currentPrice
        };
    }
}

module.exports = new StockTools();
